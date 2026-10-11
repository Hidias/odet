// api/adapt-prospect-email.js
// Adapte un email de prospection avec IA selon le secteur et contexte du prospect

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { prospectName, sector, formations, contactName, contactFunction, notes, currentBody } = req.body

    if (!currentBody) {
      return res.status(400).json({ error: 'Corps du mail requis' })
    }

    const prompt = `Tu es Marine, assistante commerciale chez Access Formation (organisme de formation sante securite, Concarneau).
Adapte ce mail de prospection pour ${prospectName || 'cette entreprise'}${sector ? ' (secteur : ' + sector + ')' : ''}.
${formations ? 'Formations evoquees pendant l\'appel : ' + formations : ''}
${contactName ? 'Contact : ' + contactName + (contactFunction ? ' (' + contactFunction + ')' : '') : ''}
${notes ? 'Notes de l\'appel : ' + notes : ''}

REGLES :
- Garde le MEME format HTML (paragraphes <p>, listes <ul><li>)
- Garde le vouvoiement
- Personnalise l'introduction selon le contexte (secteur, contact, formations evoquees)
- Mets en avant les formations les plus pertinentes pour ce secteur en premier dans la liste
- Ne change PAS la conclusion ni les infos sur Qualiopi/OPCO
- Reponds UNIQUEMENT avec le HTML du body, sans signature, sans balise html/body
- Maximum 300 mots

Voici le mail actuel :
${currentBody}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      throw new Error(errData.error?.message || 'Erreur API Anthropic')
    }

    const data = await response.json()
    const adapted = data.content?.[0]?.text || ''

    return res.status(200).json({ adapted })

  } catch (error) {
    console.error('Erreur adaptation email:', error)
    return res.status(500).json({ error: error.message })
  }
}
