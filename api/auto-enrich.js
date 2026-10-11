/**
 * ============================================================================
 * API - AUTO-ENRICHISSEMENT PROSPECT v3 (Anthropic + Web Search)
 * ============================================================================
 * 
 * À METTRE : afm-app-main/api/auto-enrich.js
 * 
 * Utilise Claude Haiku + web_search pour trouver téléphone, site web, email.
 * Coût : ~0.005€ par recherche — ~1€/jour pour 200 prospects
 * 
 * Requiert : ANTHROPIC_API_KEY dans les variables d'environnement Vercel
 * ============================================================================
 */

// Vercel Pro = 60s max, Hobby = 10s (trop court, il faut Pro ou configurer)
export const config = {
  maxDuration: 25,
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  
  const { name, city, postal_code, siren, siret, site_web: existingSiteWeb } = req.body
  if (!name) return res.status(400).json({ error: 'name requis' })
  
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ 
      success: false, error: true,
      message: 'ANTHROPIC_API_KEY manquante dans Vercel > Settings > Environment Variables'
    })
  }
  
  const cityInfo = city || postal_code || ''
  const id = siren || siret || ''
  
  console.log(`Auto-enrich v3: "${name}" (${cityInfo})`)
  
  try {
    const prompt = buildPrompt(name, cityInfo, id, existingSiteWeb)
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        tools: [{
          type: 'web_search_20250305',
          name: 'web_search',
        }],
        messages: [{
          role: 'user',
          content: prompt,
        }],
      }),
      signal: AbortSignal.timeout(20000),
    })
    
    if (response.status === 429) {
      return res.status(200).json({
        success: false, error: true,
        message: '⏳ Rate limit — attends 30s puis réessaie',
        phone: null, site_web: null, email: null, sources: [],
      })
    }
    
    if (!response.ok) {
      const err = await response.text()
      console.error('Anthropic error:', response.status, err)
      return res.status(200).json({
        success: false, error: true,
        message: `Erreur API (${response.status})`,
        phone: null, site_web: null, email: null, sources: [],
      })
    }
    
    const data = await response.json()
    
    // Extraire le texte de la réponse
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
    
    console.log('Claude raw:', text.substring(0, 300))
    
    const result = parseResponse(text)
    
    console.log(`Result: tel=${result.phone} site=${result.site_web} email=${result.email}`)
    
    return res.status(200).json({
      success: true,
      ...result,
    })
    
  } catch (error) {
    console.error('Auto-enrich error:', error.message)
    return res.status(200).json({
      success: false, error: true,
      message: error.name === 'TimeoutError' 
        ? 'Timeout — la recherche a pris trop de temps, réessaie'
        : error.message,
      phone: null, site_web: null, email: null, sources: [],
    })
  }
}


function buildPrompt(name, city, id, existingSite) {
  const cleanName = name
    .replace(/\b(SAS|SARL|SA|EURL|SCI|SNC|SASU|SELARL|EARL|GAEC|GIE)\b/gi, '')
    .trim()

  let p = `Coordonnées de "${cleanName}" à ${city || 'France'}.`
  if (id) p += ` SIREN: ${id}.`
  if (existingSite) p += ` Site connu: ${existingSite}.`
  p += `\nRéponds UNIQUEMENT en JSON: {"phone":"0X XX XX XX XX","site_web":"url","email":"email","sources":["src"]}`
  p += `\nMets NON_TROUVE si introuvable.`
  return p
}


function parseResponse(text) {
  const result = { phone: null, site_web: null, email: null, sources: [] }
  if (!text) return result
  
  // Tenter parse JSON
  try {
    const match = text.match(/\{[^{}]*"phone"[^{}]*\}/)
    if (match) {
      const j = JSON.parse(match[0])
      if (j.phone && j.phone !== 'NON_TROUVE' && j.phone !== 'null' && j.phone.length > 5) {
        result.phone = cleanPhone(j.phone)
      }
      if (j.site_web && j.site_web !== 'NON_TROUVE' && j.site_web !== 'null' && j.site_web.includes('.')) {
        result.site_web = j.site_web.replace(/\/+$/, '')
      }
      if (j.email && j.email !== 'NON_TROUVE' && j.email !== 'null' && j.email.includes('@')) {
        result.email = j.email.toLowerCase().trim()
      }
      if (j.sources) result.sources = j.sources
      return result
    }
  } catch (e) {
    console.log('JSON parse failed, regex fallback')
  }
  
  // Fallback regex
  const phoneMatch = text.match(/(?:(?:\+33|0033)[\s.]?|0)[1-9](?:[\s.]?\d{2}){4}/)
  if (phoneMatch) result.phone = cleanPhone(phoneMatch[0])
  
  const siteMatch = text.match(/https?:\/\/(?:www\.)?[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}/)
  if (siteMatch) {
    const url = siteMatch[0]
    const skip = ['google', 'bing', 'pagesjaunes.fr/pros', 'linkedin', 'facebook', 'wikipedia', 'societe.com']
    if (!skip.some(s => url.includes(s))) result.site_web = url
  }
  
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  if (emailMatch) {
    const em = emailMatch[0].toLowerCase()
    if (!em.includes('exemple') && !em.includes('example')) result.email = em
  }
  
  if (result.phone || result.site_web || result.email) result.sources = ['Web']
  return result
}


function cleanPhone(raw) {
  if (!raw) return null
  let d = raw.replace(/[^\d+]/g, '')
  if (d.startsWith('+33')) d = '0' + d.slice(3)
  if (d.startsWith('0033')) d = '0' + d.slice(4)
  if (d.startsWith('33') && d.length === 11) d = '0' + d.slice(2)
  if (/^0[1-9]\d{8}$/.test(d)) {
    if (d.startsWith('08') && !d.startsWith('080')) return null
    return d.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5')
  }
  return null
}
