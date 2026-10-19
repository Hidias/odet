// api/_lib/mailer.js : envoi d'emails côté serveur (configuration SMTP par utilisateur),
// identité de l'organisme, signatures et redirection des envois en mode démonstration.
// Import : import { getSupabaseAdmin, getMailer, sendWithRetry, getOrg, getSender, wrapEmailHTML } from './_lib/mailer.js'

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import crypto from 'crypto'

// ---- Supabase (clé serveur) -------------------------------------------------
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définies')
  return createClient(url, key, { auth: { persistSession: false } })
}

// ---- Mot de passe SMTP (chiffré en base avec ENCRYPTION_KEY) ---------------
export function decrypt(encryptedText) {
  if (!process.env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY manquante')
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex')
  const [ivHex, encrypted] = String(encryptedText).split(':')
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'))
  let out = decipher.update(encrypted, 'hex', 'utf8')
  out += decipher.final('utf8')
  return out
}

export function encrypt(text) {
  if (!process.env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY manquante')
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex')
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  let enc = cipher.update(String(text), 'utf8', 'hex')
  enc += cipher.final('hex')
  return `${iv.toString('hex')}:${enc}`
}

// ---- Identité de l'organisme ----------------------------------------------
let orgCache = { at: 0, value: null }

/**
 * Ligne organization_settings, avec quelques champs dérivés. Cache 30 s par instance de fonction.
 */
export async function getOrg(supabase) {
  if (orgCache.value && Date.now() - orgCache.at < 30000) return orgCache.value
  const client = supabase || getSupabaseAdmin()
  const { data } = await client.from('organization_settings').select('*').limit(1).maybeSingle()
  const o = data || {}
  const city = o.city || ''
  const org = {
    ...o,
    name: o.name || '',
    legal_name: o.legal_name || o.name || '',
    addressLine: [o.address, [o.postal_code, city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    // Adresse mise en avant (signatures, rendez-vous) : le site d'exploitation s'il existe, sinon le siège (0049)
    siteLine: [o.exploitation_address, [o.exploitation_postal_code, o.exploitation_city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
      || [o.address, [o.postal_code, city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    website: o.website || '',
    websiteLabel: (o.website || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    phone: o.phone || '',
    email: o.email || '',
    qualiopi: !!o.qualiopi_certified,
    brand_nav: o.brand_nav || (o.brand_primary || '#1C2024'),
    brand_highlight: o.brand_highlight || '#D9A62E',
    // En préversion, les liens des emails pointent vers la préversion elle-même, pas vers la production
    app_url: (isTestEnvironment() && process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : (process.env.APP_URL || '')).replace(/\/$/, ''),
  }
  orgCache = { at: Date.now(), value: org }
  return org
}

// Identité de la société d'un document (chantier C3) : la société qui porte l'instance garde les réglages de
// l'organisme ; une autre société prend les champs juridiques, de contact et bancaires de sa fiche (comme
// app.identite_societe en base). La marque des emails reste celle du groupe.
export async function getOrgForCompany(supabase, companyId) {
  const org = await getOrg(supabase)
  if (!companyId) return org
  const client = supabase || getSupabaseAdmin()
  const { data: c } = await client.from('companies').select('*').eq('id', companyId).maybeSingle()
  if (!c || c.is_instance_owner) return org
  const { data: siege } = await client.from('company_establishments').select('siret').eq('company_id', c.id).eq('is_head_office', true).maybeSingle()
  // Adresse mise en avant : l'établissement principal de la société (0054), sinon son siège
  const { data: site } = await client.from('company_establishments').select('address, postal_code, city')
    .eq('company_id', c.id).eq('is_main_site', true).eq('status', 'active').maybeSingle()
  const city = c.city || ''
  return {
    ...org,
    name: c.short_name || c.legal_name, legal_name: c.legal_name, forme_juridique: c.legal_form, capital_social: c.capital,
    siren: c.siren, siret: siege?.siret || null, naf: c.naf, tva_intra: c.vat_number, tva_applicable: c.vat_applicable, rcs: c.rcs,
    nda: c.nda, address: c.address, postal_code: c.postal_code, city, phone: c.phone || '', email: c.email || '',
    website: c.website || '', websiteLabel: (c.website || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    bank_name: c.bank_name, iban: c.iban, bic: c.bic, logo_url: c.logo_url || org.logo_url, doc_prefix: c.doc_prefix,
    addressLine: [c.address, [c.postal_code, city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    siteLine: site?.address
      ? [site.address, [site.postal_code, site.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
      : [c.address, [c.postal_code, city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
  }
}

// ---- Expéditeur (profil de l'utilisateur) ----------------------------------
/**
 * Personne qui signe l'email, d'après son adresse d'envoi (profiles.sender_email ou profiles.email).
 * Repli : l'organisme lui-même.
 */
export async function getSender(supabase, email) {
  const client = supabase || getSupabaseAdmin()
  const org = await getOrg(client)
  let p = null
  if (email) {
    const { data } = await client.from('profiles').select('first_name, last_name, display_name, fonction, phone, email, sender_email')
      .or(`sender_email.eq.${email},email.eq.${email}`).limit(1).maybeSingle()
    p = data
  }
  const name = p ? (p.display_name || [p.first_name, p.last_name].filter(Boolean).join(' ')) : ''
  return {
    name: name || org.name,
    title: p?.fonction || '',
    phone: p?.phone || org.phone,
    email: email || p?.email || org.email,
    isOrg: !p,
  }
}

// ---- Environnement de test ---------------------------------------------------
/**
 * Environnement de test : préversion Vercel (VERCEL_ENV=preview) ou EMAIL_MODE=test.
 * La préversion est protégée même si EMAIL_MODE a été oubliée. En production, rien ne change.
 */
export function isTestEnvironment() {
  return String(process.env.EMAIL_MODE || '').toLowerCase() === 'test' || process.env.VERCEL_ENV === 'preview'
}

/**
 * En test, tout envoi part vers EMAIL_TEST_TO (objet préfixé [TEST], copies supprimées).
 * Les destinataires d'origine sont rappelés en tête du message. Sans EMAIL_TEST_TO, l'envoi est refusé.
 */
export function applyTestRedirect(mailOptions) {
  if (!isTestEnvironment()) return mailOptions
  const target = String(process.env.EMAIL_TEST_TO || '').trim()
  if (!target) throw new Error('Environnement de test sans EMAIL_TEST_TO : envoi refusé')
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => (typeof x === 'string' ? x : x?.address || '')).filter(Boolean)
  const original = { to: list(mailOptions.to), cc: list(mailOptions.cc), bcc: list(mailOptions.bcc) }
  const summary = [original.to.length ? `à : ${original.to.join(', ')}` : '', original.cc.length ? `cc : ${original.cc.join(', ')}` : '', original.bcc.length ? `cci : ${original.bcc.join(', ')}` : ''].filter(Boolean).join(' / ')
  const banner = `<div style="font-family:Arial,sans-serif;font-size:12px;background:#fdecec;color:#b42318;padding:8px 12px;border-radius:6px;margin-bottom:12px;">Environnement de test : cet email aurait été envoyé ${summary || 'sans destinataire'}.</div>`
  return {
    ...mailOptions,
    to: target,
    cc: undefined,
    bcc: undefined,
    subject: `[TEST] ${mailOptions.subject || ''}`,
    html: mailOptions.html ? banner + mailOptions.html : undefined,
    text: mailOptions.text ? `Environnement de test : destinataires d'origine ${summary}\n\n${mailOptions.text}` : mailOptions.text,
  }
}

/**
 * Protège un transporteur nodemailer créé directement (hors createTransporter) :
 * en test, chaque envoi est redirigé. En production, l'envoi est inchangé.
 */
export function guardTransport(transporter) {
  const rawSend = transporter.sendMail.bind(transporter)
  transporter.sendMail = async (options) => rawSend(applyTestRedirect(options))
  return transporter
}

// ---- Transport SMTP ----------------------------------------------------------
/**
 * En mode démonstration (organization_settings.demo_mode), tous les envois partent vers MAIL_SINK.
 * Les destinataires d'origine sont rappelés dans l'objet et en tête du message.
 */
export async function applyMailSink(mailOptions, supabase) {
  const org = await getOrg(supabase)
  if (!org.demo_mode) return mailOptions
  const sink = process.env.MAIL_SINK
  if (!sink) throw new Error('Mode démonstration actif mais MAIL_SINK non définie : envoi refusé')
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => (typeof x === 'string' ? x : x?.address || '')).filter(Boolean)
  const original = { to: list(mailOptions.to), cc: list(mailOptions.cc), bcc: list(mailOptions.bcc) }
  const summary = [original.to.length ? `à : ${original.to.join(', ')}` : '', original.cc.length ? `cc : ${original.cc.join(', ')}` : '', original.bcc.length ? `cci : ${original.bcc.join(', ')}` : ''].filter(Boolean).join(' / ')
  const banner = `<div style="font-family:Arial,sans-serif;font-size:12px;background:#fff4d6;color:#8a5a00;padding:8px 12px;border-radius:6px;margin-bottom:12px;">Mode démonstration : cet email aurait été envoyé ${summary || 'sans destinataire'}.</div>`
  return {
    ...mailOptions,
    to: sink,
    cc: undefined,
    bcc: undefined,
    subject: `[DEMO] ${mailOptions.subject || ''}`,
    html: mailOptions.html ? banner + mailOptions.html : undefined,
    text: mailOptions.text ? `Mode démonstration : destinataires d'origine ${summary}\n\n${mailOptions.text}` : mailOptions.text,
  }
}

export function createTransporter(emailConfig, smtpPassword, supabase) {
  const transporter = nodemailer.createTransport({
    host: emailConfig.smtp_host,
    port: emailConfig.smtp_port,
    secure: emailConfig.smtp_secure,
    auth: { user: emailConfig.email, pass: smtpPassword },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    pool: false,
    maxConnections: 1,
    maxMessages: 1,
  })
  // Redirection à chaque envoi, quel que soit l'appelant : environnement de test d'abord, sinon mode démo
  const rawSend = transporter.sendMail.bind(transporter)
  transporter.sendMail = async (options) => rawSend(isTestEnvironment() ? applyTestRedirect(options) : await applyMailSink(options, supabase))
  return transporter
}

/**
 * Configuration email active d'un utilisateur + transporteur prêt à l'emploi.
 * @returns {{ transporter, emailConfig, fromEmail, error }}
 */
export async function getMailer(supabase, userId, options = {}) {
  if (!userId) return { transporter: null, emailConfig: null, fromEmail: null, error: 'Utilisateur inconnu' }
  const { data: configs, error: configError } = await supabase
    .from('user_email_configs').select('*').eq('user_id', userId).eq('is_active', true)
  if (configError || !configs || configs.length === 0) {
    return { transporter: null, emailConfig: null, fromEmail: null, error: 'Aucune configuration email active pour cet utilisateur' }
  }
  let emailConfig = configs[0]
  if (options.preferEmail) {
    const preferred = configs.find((c) => c.email === options.preferEmail)
    if (preferred) emailConfig = preferred
  }
  const transporter = createTransporter(emailConfig, decrypt(emailConfig.smtp_password_encrypted), supabase)
  return { transporter, emailConfig, fromEmail: emailConfig.email, error: null }
}

/**
 * Transporteur à partir d'une adresse d'envoi (toutes configurations confondues).
 */
export async function getMailerByEmail(supabase, email) {
  const { data: emailConfig } = await supabase.from('user_email_configs').select('*').eq('email', email).eq('is_active', true).limit(1).maybeSingle()
  if (!emailConfig) return { transporter: null, emailConfig: null, fromEmail: null, error: `Aucune configuration email pour ${email}` }
  const transporter = createTransporter(emailConfig, decrypt(emailConfig.smtp_password_encrypted), supabase)
  return { transporter, emailConfig, fromEmail: emailConfig.email, error: null }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Envoi avec nouvelles tentatives. Pas de transporter.verify() : il ouvrirait une seconde
 * connexion SMTP et certains fournisseurs limitent les connexions simultanées.
 */
export async function sendWithRetry(transporter, mailOptions, maxRetries = 3) {
  let lastError = null
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const info = await transporter.sendMail(mailOptions)
      return info
    } catch (error) {
      lastError = error
      console.error(`Envoi email, tentative ${attempt}/${maxRetries} :`, error.message)
      try { transporter.close() } catch {}
      const isConnLimit = error?.responseCode === 421 || /concurrent|4\.3\.2|too many/i.test(error?.message || '')
      if (isConnLimit) break
      if (/MAIL_SINK|EMAIL_TEST_TO/.test(error?.message || '')) break
      if (attempt < maxRetries) await sleep(attempt * 2000)
    }
  }
  throw lastError
}

// ---- HTML : signature et habillage -----------------------------------------
/**
 * Bloc de signature (modèle « sobre », choisi par H le 19/10) : logo à gauche, filet de la couleur d'accent,
 * nom, fonction et organisme, téléphones, adresse email et site, adresse du site d'exploitation.
 * Tout vient des réglages : logo et couleurs (Paramètres › Identité), fonction et téléphone du compte
 * (Paramètres › Utilisateurs), adresse et téléphone de l'organisme (Paramètres › Coordonnées).
 * @param {object} sender résultat de getSender()
 * @param {object} org résultat de getOrg()
 * @param {string} variant 'standard' | 'chaud' (bandeau de prise en charge)
 */
export function buildSignatureHTML(sender, org, variant = 'standard') {
  const s = sender || {}
  const o = org || {}
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const chaudBanner = variant === 'chaud' ? `
    <table cellpadding="0" cellspacing="0" style="font-family: Arial, sans-serif; margin-bottom: 8px; border-collapse: collapse; width: 440px;">
      <tr>
        <td bgcolor="#fff7ed" style="background-color: #fff7ed; padding: 10px 18px; border-radius: 8px; border: 1px solid #fed7aa;">
          <p style="margin: 0; font-size: 13px; color: #9a3412; line-height: 1.5;"><strong>Nous avons bien noté votre besoin.</strong> Un de nos formateurs vous recontactera rapidement pour affiner les détails avec vous.</p>
        </td>
      </tr>
    </table>` : ''
  const nav = o.brand_nav || '#1C2024'
  const accent = o.brand_accent || '#C8102E'
  const logo = o.logo_url && /^https:\/\//.test(o.logo_url) ? o.logo_url : ''
  const lien = (href, texte) => `<a href="${esc(href)}" style="color: ${nav}; text-decoration: none;">${esc(texte)}</a>`
  // Téléphone de la personne, puis celui de l'organisme s'il est différent
  const telPerso = s.isOrg ? '' : (s.phone || '')
  const norm = (v) => String(v || '').replace(/\D/g, '')
  const telOrg = o.phone && norm(o.phone) !== norm(telPerso) ? o.phone : ''
  const tels = [telPerso ? `Mobile ${esc(telPerso)}` : '', telOrg ? `${telPerso ? 'Agence' : 'Tél.'} ${esc(telOrg)}` : ''].filter(Boolean).join(' &middot; ')
  const liens = [s.email ? lien(`mailto:${s.email}`, s.email) : '', o.website ? lien(o.website, o.websiteLabel || o.website) : ''].filter(Boolean).join(' &middot; ')
  const fonction = [s.isOrg ? '' : s.title, s.isOrg ? '' : o.name].filter(Boolean).join(' &middot; ')
  const lignes = [tels, liens, esc(o.siteLine || o.addressLine || '')].filter(Boolean).join('<br>')
  return `${chaudBanner}
    <table cellpadding="0" cellspacing="0" style="font-family: Arial, sans-serif; margin-top: 16px; border-collapse: collapse;">
      <tr>
        ${logo ? `<td style="padding: 4px 16px 4px 0; vertical-align: middle;"><img src="${esc(logo)}" alt="${esc(o.name || '')}" width="112" style="display: block; width: 112px; height: auto; border: 0;"></td>` : ''}
        <td style="border-left: 3px solid ${accent}; padding: 2px 0 2px 16px; vertical-align: middle;">
          <p style="margin: 0; font-size: 16px; font-weight: bold; color: ${nav};">${esc(s.name || o.name || '')}</p>
          ${fonction ? `<p style="margin: 1px 0 6px 0; font-size: 12px; font-weight: bold; color: ${accent};">${fonction}</p>` : '<p style="margin: 0 0 6px 0;"></p>'}
          ${lignes ? `<p style="margin: 0; font-size: 12px; line-height: 1.55; color: #444;">${lignes}</p>` : ''}
          ${o.qualiopi ? `<p style="margin: 6px 0 0 0; font-size: 10px; font-weight: bold; color: ${nav}; text-transform: uppercase; letter-spacing: 1px;">Organisme de formation certifié Qualiopi</p>` : ''}
        </td>
      </tr>
    </table>`
}

/**
 * Normalise les styles inline d'un corps HTML pour les clients email (Outlook n'hérite pas les polices).
 */
export function normalizeBodyStyles(body) {
  const P_STYLE = 'font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;margin:0 0 10px 0;'
  const UL_STYLE = 'font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;margin:0 0 10px 0;padding-left:20px;'
  const LI_STYLE = 'font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;margin:0 0 4px 0;'
  let b = body || ''
  if (!/<(p|div|h[1-6]|ul|ol|br)[\s>/]/i.test(b)) {
    b = b.split(/\n{2,}/).map((para) => para.trim()).filter(Boolean).map((para) => `<p style="${P_STYLE}">${para.replace(/\n/g, '<br>')}</p>`).join('')
  }
  let normalized = b.replace(/(<[^>]+style=["'][^"']*?)font-family\s*:[^;]+;?/gi, '$1')
  normalized = normalized
    .replace(/<p(?![^>]*style=)([^>]*)>/gi, `<p style="${P_STYLE}"$1>`)
    .replace(/<p style="/gi, '<p style="font-family:Arial,sans-serif;')
    .replace(/<ul(?![^>]*style=)([^>]*)>/gi, `<ul style="${UL_STYLE}"$1>`)
    .replace(/<li(?![^>]*style=)([^>]*)>/gi, `<li style="${LI_STYLE}"$1>`)
  return normalized
}

/**
 * Corps HTML + formule de politesse + signature.
 */
export function wrapEmailHTML(body, sender, org, variant = 'standard') {
  return `
    <div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333; max-width: 650px;">
      ${normalizeBodyStyles(body || '')}
      <p style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;margin:16px 0 10px 0;">Bien cordialement,</p>
      ${buildSignatureHTML(sender, org, variant)}
    </div>
  `
}
