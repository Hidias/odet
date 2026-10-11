/**
 * ============================================================================
 * API ENDPOINT - ENRICHISSEMENT PROSPECTS VIA PAGES JAUNES
 * ============================================================================
 * 
 * Recherche les prospects sur PagesJaunes.fr pour extraire :
 * - Téléphone
 * - Email  
 * - Site web
 * 
 * Mode prudent pour éviter le blocage :
 * - 15-30 secondes de délai aléatoire entre chaque requête
 * - Rotation de User-Agent
 * - Batch de 10 prospects max
 * - Détection de blocage → arrêt immédiat
 * 
 * POST /api/enrich-prospects  { batch_size: 10 }
 * GET  /api/enrich-prospects  (cron)
 * ============================================================================
 */

import { createClient } from '@supabase/supabase-js'
import * as cheerio from 'cheerio'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
// Clé serveur : la table prospection_massive est protégée (RLS, accès connecté uniquement)
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// ============================================================================
// CONFIGURATION PRUDENTE
// ============================================================================

const DEFAULT_BATCH_SIZE = 10
const MIN_DELAY = 15000  // 15 secondes minimum entre requêtes
const MAX_DELAY = 30000  // 30 secondes maximum
const FETCH_TIMEOUT = 12000
const MAX_ENRICHMENT_ATTEMPTS = 2

// User-Agents rotatifs (navigateurs courants)
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
]

// Emails à ignorer
const BLACKLISTED_EMAIL_PREFIXES = [
  'noreply', 'no-reply', 'no_reply', 'unsubscribe',
  'mailer-daemon', 'postmaster', 'webmaster', 'root',
  'abuse', 'spam', 'newsletter', 'notification',
]

const BLACKLISTED_EMAIL_DOMAINS = [
  'example.com', 'test.com', 'pagesjaunes.fr', 'solocal.com',
  'googleapis.com', 'facebook.com', 'twitter.com', 'google.com',
]

// ============================================================================
// UTILITAIRES
// ============================================================================

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

function getRandomDelay() {
  return MIN_DELAY + Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY))
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Nettoyer le nom de l'entreprise pour la recherche
function cleanCompanyName(name) {
  if (!name) return ''
  return name
    .replace(/\b(SAS|SARL|SA|EURL|SCI|SNC)\b/gi, '')
    .replace(/[^\w\sÀ-ÿ-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Normaliser un numéro de téléphone français
function normalizePhone(raw) {
  if (!raw) return null
  let phone = raw.replace(/[\s.\-()]/g, '')
  
  if (phone.startsWith('+33')) phone = '0' + phone.slice(3)
  if (phone.startsWith('0033')) phone = '0' + phone.slice(4)
  
  if (!/^0[1-9]\d{8}$/.test(phone)) return null
  
  // Exclure les numéros suspects
  if (/^(\d)\1{9}$/.test(phone)) return null
  if (phone === '0123456789') return null
  
  // Formater : 02 98 12 34 56
  return phone.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5')
}

// Valider un email
function isValidEmail(email) {
  if (!email || email.length > 60) return false
  const lower = email.toLowerCase().trim()
  const prefix = lower.split('@')[0]
  const domain = lower.split('@')[1]
  if (!domain) return false
  if (BLACKLISTED_EMAIL_PREFIXES.some(bp => prefix.startsWith(bp))) return false
  if (BLACKLISTED_EMAIL_DOMAINS.some(bd => domain.includes(bd))) return false
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(lower)) return false
  return true
}

// ============================================================================
// RECHERCHE PAGES JAUNES
// ============================================================================

async function searchPagesJaunes(companyName, city) {
  const result = {
    phone: null,
    email: null,
    site_web: null,
    source: 'pagesjaunes',
    found: false,
    blocked: false,
    error: null,
  }

  try {
    const query = cleanCompanyName(companyName)
    if (!query || query.length < 3) {
      result.error = 'Nom entreprise trop court'
      return result
    }

    const searchCity = (city || '').trim()
    if (!searchCity) {
      result.error = 'Pas de ville'
      return result
    }

    // Construire l'URL de recherche
    const url = `https://www.pagesjaunes.fr/pagesblanches/recherche?quoiqui=${encodeURIComponent(query)}&ou=${encodeURIComponent(searchCity)}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.pagesjaunes.fr/',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
    })

    clearTimeout(timeoutId)

    // Détection de blocage
    if (response.status === 403 || response.status === 429 || response.status === 503) {
      result.blocked = true
      result.error = `Blocage détecté (HTTP ${response.status})`
      return result
    }

    if (!response.ok) {
      result.error = `HTTP ${response.status}`
      return result
    }

    const html = await response.text()

    // Vérifier si c'est un captcha
    if (html.includes('captcha') || html.includes('robot') || html.includes('bot-detection')) {
      result.blocked = true
      result.error = 'Captcha détecté'
      return result
    }

    // Parser avec Cheerio
    const $ = cheerio.load(html)

    // ---- Extraire le téléphone ----
    const phoneSelectors = [
      '.bi-phone',
      '.number-phone',
      '[data-phone]',
      '.tel',
      'a[href^="tel:"]',
      '.phone-number',
      '.coord-numero',
    ]

    for (const selector of phoneSelectors) {
      const el = $(selector).first()
      if (el.length) {
        const phoneText = el.attr('data-phone') || el.attr('href')?.replace('tel:', '') || el.text()
        const normalized = normalizePhone(phoneText)
        if (normalized) {
          result.phone = normalized
          break
        }
      }
    }

    // Fallback : chercher des patterns téléphone dans tout le texte
    if (!result.phone) {
      const bodyText = $('body').text()
      const phoneRegex = /(?:0[1-9])(?:[\s.\-]?\d{2}){4}/g
      const matches = bodyText.match(phoneRegex) || []
      for (const match of matches) {
        const normalized = normalizePhone(match)
        if (normalized) {
          result.phone = normalized
          break
        }
      }
    }

    // ---- Extraire l'email ----
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    const allEmails = html.match(emailRegex) || []
    for (const email of allEmails) {
      if (isValidEmail(email)) {
        result.email = email.toLowerCase().trim()
        break
      }
    }

    // Aussi chercher dans les liens mailto
    $('a[href^="mailto:"]').each((_, el) => {
      if (!result.email) {
        const email = $(el).attr('href').replace('mailto:', '').split('?')[0]
        if (isValidEmail(email)) {
          result.email = email.toLowerCase().trim()
        }
      }
    })

    // ---- Extraire le site web ----
    const siteSelectors = [
      'a[data-pjlabel="site_internet"]',
      'a.pj-link--site',
      '.site-internet a',
      '.website a',
    ]

    for (const selector of siteSelectors) {
      const el = $(selector).first()
      if (el.length) {
        const href = el.attr('href') || ''
        if (href && !href.includes('pagesjaunes.fr') && !href.includes('solocal.com')) {
          result.site_web = href
          break
        }
      }
    }

    result.found = !!(result.phone || result.email || result.site_web)
    return result

  } catch (error) {
    if (error.name === 'AbortError') {
      result.error = 'Timeout'
    } else {
      result.error = error.message
    }
    return result
  }
}

// ============================================================================
// SCRAPING DU SITE WEB (si trouvé via PJ)
// ============================================================================

async function scrapeWebsite(siteUrl) {
  const result = { phone: null, email: null }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)

    const response = await fetch(siteUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
      redirect: 'follow',
    })

    clearTimeout(timeoutId)

    if (!response.ok) return result

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html')) return result

    const html = (await response.text()).slice(0, 300000)

    // Extraire emails
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    const emails = html.match(emailRegex) || []
    for (const email of emails) {
      if (isValidEmail(email)) {
        result.email = email.toLowerCase().trim()
        break
      }
    }

    // Extraire téléphones
    const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ')
    const phoneRegex = /(?:0[1-9])(?:[\s.\-]?\d{2}){4}/g
    const phones = text.match(phoneRegex) || []
    for (const p of phones) {
      const normalized = normalizePhone(p)
      if (normalized) {
        result.phone = normalized
        break
      }
    }
  } catch (error) {
    // Silencieux
  }

  return result
}

// ============================================================================
// HANDLER PRINCIPAL
// ============================================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const batchSize = Math.min(req.body?.batch_size || DEFAULT_BATCH_SIZE, 15) // Max 15 sécurité

  try {
    if (!SUPABASE_SERVICE_KEY) {
      return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY manquante' })
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // 1. Récupérer les prospects à enrichir
    //    - Pas encore de phone
    //    - Moins de MAX_ENRICHMENT_ATTEMPTS tentatives
    //    - Pas encore enrichi avec succès
    //    - Triés par quality_score décroissant (les meilleurs d'abord)
    const { data: prospects, error: fetchError } = await supabase
      .from('prospection_massive')
      .select('id, siret, siren, name, city, postal_code, phone, email, site_web, enrichment_attempts, enrichment_status')
      .is('phone', null)
      .or(`enrichment_attempts.is.null,enrichment_attempts.lt.${MAX_ENRICHMENT_ATTEMPTS}`)
      .or('enrichment_status.is.null,enrichment_status.neq.done')
      .order('quality_score', { ascending: false })
      .limit(batchSize)

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message })
    }

    if (!prospects || prospects.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Aucun prospect à enrichir',
        stats: { total: 0 }
      })
    }

    // 2. Enrichir chaque prospect
    const stats = {
      total: prospects.length,
      phones_found: 0,
      emails_found: 0,
      sites_found: 0,
      both_found: 0,
      failed: 0,
      blocked: false,
    }

    for (let i = 0; i < prospects.length; i++) {
      const prospect = prospects[i]

      // Délai aléatoire AVANT chaque requête (sauf la première)
      if (i > 0) {
        const delay = getRandomDelay()
        await sleep(delay)
      }

      try {
        // Étape 1 : Chercher sur Pages Jaunes
        const pjResult = await searchPagesJaunes(prospect.name, prospect.city)

        // Si blocage détecté, on arrête TOUT le batch
        if (pjResult.blocked) {
          stats.blocked = true
          console.error('⚠️ BLOCAGE DÉTECTÉ - Arrêt du batch')
          break
        }

        // Préparer la mise à jour
        const update = {
          enrichment_attempts: (prospect.enrichment_attempts || 0) + 1,
          enrichment_last_attempt: new Date().toISOString(),
          enrichment_sources_tried: ['pagesjaunes'],
          updated_at: new Date().toISOString(),
        }

        let foundPhone = pjResult.phone
        let foundEmail = pjResult.email
        let foundSite = pjResult.site_web

        // Étape 2 : Si PJ a trouvé un site web mais pas de phone/email,
        // scraper le site web directement
        if (foundSite && (!foundPhone || !foundEmail)) {
          await sleep(3000) // petit délai
          const siteResult = await scrapeWebsite(foundSite)
          if (!foundPhone && siteResult.phone) foundPhone = siteResult.phone
          if (!foundEmail && siteResult.email) foundEmail = siteResult.email
          update.enrichment_sources_tried = ['pagesjaunes', 'site_web']
        }

        // Appliquer les résultats
        if (foundPhone) {
          update.phone = foundPhone
          update.phone_source = 'pagesjaunes'
          stats.phones_found++
        }

        if (foundEmail) {
          update.email = foundEmail
          update.email_source = pjResult.email ? 'pagesjaunes' : 'site_web'
          stats.emails_found++
        }

        if (foundSite && !prospect.site_web) {
          update.site_web = foundSite
          stats.sites_found++
        }

        // Statut
        if (foundPhone && foundEmail) {
          update.enrichment_status = 'done'
          stats.both_found++
        } else if (foundPhone || foundEmail) {
          update.enrichment_status = 'done'
        } else {
          update.enrichment_status = 'failed'
          if (pjResult.error) {
            update.enrichment_errors = [pjResult.error]
          }
        }

        await supabase
          .from('prospection_massive')
          .update(update)
          .eq('id', prospect.id)

      } catch (error) {
        stats.failed++
        await supabase
          .from('prospection_massive')
          .update({
            enrichment_attempts: (prospect.enrichment_attempts || 0) + 1,
            enrichment_last_attempt: new Date().toISOString(),
            enrichment_status: 'failed',
            enrichment_errors: [error.message],
          })
          .eq('id', prospect.id)
      }
    }

    const message = stats.blocked
      ? `⚠️ Blocage détecté après ${stats.phones_found} tels et ${stats.emails_found} emails. Réessayer plus tard.`
      : `✅ ${stats.phones_found} téléphones, ${stats.emails_found} emails, ${stats.sites_found} sites trouvés sur ${stats.total} prospects`

    return res.status(200).json({
      success: true,
      stats,
      message,
    })

  } catch (error) {
    console.error('Erreur enrichissement:', error)
    return res.status(500).json({ error: error.message })
  }
}
