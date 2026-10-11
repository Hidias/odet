import { requireUser } from './_lib/auth.js'
// api/generate-document.js
// Génère ou reformule du texte pour les courriers officiels via Claude

export default async function handler(req, res) {
  if (req.method !== 'OPTIONS') {
    const ctx = await requireUser(req)
    if (!ctx) return res.status(401).json({ error: 'Connexion requise' })
    req.user = ctx.user
    req.profile = ctx.profile
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { action, docType, destinataire, objet, context, currentText } = req.body

    let prompt = ''
    let systemPrompt = `Tu es l'assistant rédactionnel d'Access Formation, organisme de formation professionnelle à Concarneau (Bretagne).
Tu rédiges des documents officiels professionnels en français.

RÈGLES :
- Ton : professionnel, clair, courtois
- Pas de formules creuses ou trop longues
- Phrases concises et bien structurées
- Utilise "Access Formation" quand tu mentionnes l'organisme
- Le dirigeant est Hicham SAIDI
- Ne jamais inventer d'informations non fournies
- Format : texte brut, pas de markdown, pas de puces sauf si pertinent
- Commence directement par le contenu, sans "Voici..." ni préambule`

    if (action === 'generate') {
      const typeLabel = docType === 'attestation' ? 'une attestation' : 'une note interne / compte-rendu'
      prompt = `Rédige le corps de ${typeLabel} avec ces informations :
- Type : ${docType}
- Destinataire : ${destinataire || 'Non précisé'}
- Objet : ${objet || 'Non précisé'}
${context ? `- Contexte supplémentaire : ${context}` : ''}

Rédige uniquement le corps du document (sans en-tête, sans date, sans objet — ils sont déjà gérés).
Le texte doit être complet, professionnel et prêt à l'emploi.`
    } else if (action === 'reformulate') {
      prompt = `Reformule et améliore ce texte pour un document officiel d'organisme de formation. Garde le même sens mais rends-le plus professionnel et mieux structuré :

${currentText}

Renvoie uniquement le texte reformulé, sans commentaire.`
    } else if (action === 'shorter') {
      prompt = `Raccourcis ce texte tout en gardant les informations essentielles :

${currentText}

Renvoie uniquement le texte raccourci.`
    } else if (action === 'longer') {
      prompt = `Développe et enrichis ce texte avec plus de détails professionnels :

${currentText}

Renvoie uniquement le texte enrichi.`
    } else {
      return res.status(400).json({ error: 'Action non reconnue' })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error?.message || 'Erreur API Claude')
    }

    const data = await response.json()
    const text = data.content[0].text

    return res.status(200).json({ success: true, text })

  } catch (error) {
    console.error('Erreur génération document:', error)
    return res.status(500).json({
      error: 'Erreur lors de la génération',
      details: error.message
    })
  }
}
