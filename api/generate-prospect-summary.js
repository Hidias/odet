import { requireRole, getAdminClient, SALES } from './_lib/auth.js'
import { loadOrgProfile, orgIdentityBlock, senderFromProfile } from './_lib/orgProfile.js'
// api/generate-prospect-summary.js
// Génère un résumé IA du prospect : scrape le site web si dispo + analyse NAF/nom

export default async function handler(req, res) {
  const ctx = await requireRole(req, res, SALES)
  if (!ctx) return
  req.user = ctx.user
  req.profile = ctx.profile
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { name, city, naf, effectif, site_web, siret } = req.body

    if (!name) {
      return res.status(400).json({ error: 'Nom requis' })
    }

    // Tenter de scraper le site web si disponible
    let siteContent = ''
    if (site_web) {
      try {
        let url = site_web.trim()
        if (!url.startsWith('http')) url = 'https://' + url
        
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        
        const siteRes = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FicheProspect/1.0)' }
        })
        clearTimeout(timeout)
        
        if (siteRes.ok) {
          const html = await siteRes.text()
          // Extraire le texte brut (title + meta description + body text)
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
          const metaMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
          const bodyText = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 2000)
          
          const parts = []
          if (titleMatch) parts.push('Titre: ' + titleMatch[1].trim())
          if (metaMatch) parts.push('Description: ' + metaMatch[1].trim())
          if (bodyText) parts.push('Contenu: ' + bodyText.slice(0, 1500))
          siteContent = parts.join('\n')
        }
      } catch (e) {
        // Site inaccessible, on continue sans
        console.log('Site inaccessible:', site_web, e.message)
      }
    }

    const org = await loadOrgProfile(getAdminClient())
    const prompt = `Tu génères une FICHE PROSPECT pour la personne qui va appeler cette entreprise au nom de ${org.name || "l'organisme de formation"}.

CE N'EST PAS UN PITCH. C'est une fiche d'intelligence rapide que l'on lit en 10 secondes avant d'appeler.

INFORMATIONS PROSPECT :
- Nom entreprise : ${name}
- Ville : ${city || 'Inconnue'}
- Code NAF : ${naf || 'Inconnu'}
- Effectif : ${effectif || 'Inconnu'}
- SIRET : ${siret || ''}
${siteContent ? `\nSITE WEB :\n${siteContent}` : ''}

${orgIdentityBlock(org)}

RÈGLES MÉTIER (obligations générales, à relier UNIQUEMENT aux formations du catalogue ci-dessus) :
- Premiers secours : présence de secouristes formés selon l'activité et l'effectif (Code du travail, R4224-15).
- Incendie : consignes, personnes désignées pour la mise en oeuvre des extincteurs et l'évacuation, exercices réguliers (R4227-28 et R4227-39).
- Document unique d'évaluation des risques : obligatoire dès le premier salarié (R4121-1).
- Entrepôt, logistique, stockage : conduite d'engins de manutention ; manutention et postures pour le port de charges.
- Travail à proximité d'installations électriques : habilitation électrique adaptée.
- Si aucune formation du catalogue ne correspond à un besoin, ne propose rien pour ce besoin.

FORMAT OBLIGATOIRE (texte brut, une ligne par rubrique, pas de markdown) :
Entreprise : [nom commercial + enseigne ou groupe si identifiable, activité en 5 mots max]
Risques : [risques métier principaux, séparés par des virgules]
Obligations : [ce qui s'applique selon l'effectif]
À proposer : [2 ou 3 formations du catalogue avec une raison courte]
Accroche : [un angle d'approche personnalisé basé sur l'activité réelle]

IMPORTANT :
- Pas de formule de politesse
- Pas de texte à réciter, seulement des faits
- Si le site web ou le nom révèle un groupe ou une enseigne, le mentionner
- Chaque ligne doit être très concise`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error?.message || 'Erreur API Claude')
    }

    const data = await response.json()
    const summary = data.content[0].text

    return res.status(200).json({ success: true, summary })

  } catch (error) {
    console.error('Erreur génération résumé:', error)
    return res.status(500).json({
      error: 'Erreur lors de la génération du résumé',
      details: error.message
    })
  }
}
