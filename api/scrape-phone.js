// api/scrape-phone.js
// Scrape un site web pour extraire le numéro de téléphone français

export const config = { maxDuration: 10 }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { url } = req.body
  if (!url) {
    return res.status(400).json({ error: 'URL requise' })
  }

  try {
    let fullUrl = url.trim()
    if (!fullUrl.startsWith('http')) fullUrl = 'https://' + fullUrl

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 7000)

    const response = await fetch(fullUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      }
    })
    clearTimeout(timeout)

    if (!response.ok) {
      return res.status(200).json({ success: true, phone: null, email: null, message: 'Site inaccessible' })
    }

    const html = await response.text()

    // === EXTRACTION TÉLÉPHONE ===
    // Patterns français : 01-09, +33, 0033
    const phonePatterns = [
      // +33 6 12 34 56 78 ou +33 (0)6 12 34 56 78
      /(?:\+33|0033)\s*\(?\s*0?\s*\)?\s*[1-9](?:[\s.-]*\d{2}){4}/g,
      // 01 23 45 67 89 ou 01.23.45.67.89 ou 0123456789
      /0[1-9](?:[\s.-]*\d{2}){4}/g,
    ]

    const phones = new Set()
    for (const pattern of phonePatterns) {
      const matches = html.match(pattern) || []
      matches.forEach(m => {
        // Nettoyer
        let clean = m.replace(/[\s.-]/g, '').replace(/\(0\)/, '')
        // Convertir +33 en 0
        if (clean.startsWith('+33')) clean = '0' + clean.slice(3)
        if (clean.startsWith('0033')) clean = '0' + clean.slice(4)
        // Valider longueur
        if (clean.length === 10 && /^0[1-9]\d{8}$/.test(clean)) {
          // Formater : 02 98 12 34 56
          const formatted = clean.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5')
          phones.add(formatted)
        }
      })
    }

    // Prioriser : fixe (01-05) > mobile (06-07) > autres
    const phoneList = [...phones]
    const fixe = phoneList.filter(p => /^0[1-5]/.test(p))
    const mobile = phoneList.filter(p => /^0[67]/.test(p))
    const other = phoneList.filter(p => /^0[89]/.test(p))
    const bestPhone = fixe[0] || mobile[0] || other[0] || null

    // === EXTRACTION EMAIL ===
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    const emails = new Set()
    const emailMatches = html.match(emailPattern) || []
    emailMatches.forEach(e => {
      const lower = e.toLowerCase()
      // Ignorer les emails de tracking/techniques
      if (!lower.includes('sentry') && !lower.includes('webpack') && 
          !lower.includes('wixpress') && !lower.includes('.png') &&
          !lower.includes('.jpg') && !lower.includes('example.com')) {
        emails.add(lower)
      }
    })

    // Prioriser : contact@ > info@ > accueil@ > premier trouvé
    const emailList = [...emails]
    const bestEmail = emailList.find(e => e.startsWith('contact@')) ||
                      emailList.find(e => e.startsWith('info@')) ||
                      emailList.find(e => e.startsWith('accueil@')) ||
                      emailList[0] || null

    return res.status(200).json({
      success: true,
      phone: bestPhone,
      email: bestEmail,
      all_phones: [...phones].slice(0, 5),
      all_emails: emailList.slice(0, 5),
    })

  } catch (err) {
    console.error('Erreur scraping:', err.message)
    return res.status(200).json({ 
      success: true, 
      phone: null, 
      email: null, 
      message: err.name === 'AbortError' ? 'Timeout' : err.message 
    })
  }
}
