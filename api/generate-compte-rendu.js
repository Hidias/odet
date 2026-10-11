// api/generate-compte-rendu.js
// Génère le compte-rendu via l'API Claude (côté serveur pour éviter CORS)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { client, contact, date, notes, analysis } = req.body

    // Construire le prompt
    const prompt = `Génère un compte-rendu de RDV basé sur ces infos :

Client : ${client || 'Non précisé'}
Contact : ${contact || 'Non précisé'}
Date : ${date || 'Non précisée'}

NOTES CRM :
${notes}

${analysis ? `ANALYSE DES BESOINS :
- Enjeux : ${analysis.context_stakes || 'Non précisé'}
- Objectifs : ${analysis.objectives || 'Non précisé'}
- Participants : ${analysis.participants || 'Non précisé'}
` : ''}

FORMAT DE SORTIE :
OBJETS:
1. [objet 1]
2. [objet 2]
3. [objet 3]

MAIL:
[corps du mail complet]`

    const PROMPT_SYSTEM = `Tu es "AF Compte-rendu", assistant de rédaction de mails post-RDV pour Access Formation.

RÈGLES :
- Ton : pro, humain, chaleureux
- Phrase imposée : "Voici le récapitulatif des éléments abordés :"
- Pas de "Merci pour nos échanges", pas de "Si je reformule"
- Ne jamais écrire "Access Formation" dans le corps
- Liens URL en clair (pas de markdown)
- Ne pas inventer d'info absente

STRUCTURE MAIL :
1) Intro complète avec remerciement
2) "Voici le récapitulatif..." (5-9 puces)
3) "Prochaines étapes :" (De mon côté / De ton côté)
4) Clôture style Hicham : "Encore merci pour le temps accordé et pour ta confiance."

GÉNÈRE 3 OBJETS puis 1 MAIL COMPLET (sans signature)`

    // Appeler l'API Claude
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
        system: PROMPT_SYSTEM,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error?.message || 'Erreur API Claude')
    }

    const data = await response.json()
    const fullText = data.content[0].text

    // Parser la réponse
    const objetsMatch = fullText.match(/OBJETS?:(.*?)MAIL:/s)
    const mailMatch = fullText.match(/MAIL:(.*)/s)

    if (objetsMatch && mailMatch) {
      const objets = objetsMatch[1].trim().split('\n').filter(l => l.trim())
      const mail = mailMatch[1].trim()

      return res.status(200).json({
        success: true,
        objets,
        mail
      })
    } else {
      throw new Error('Format de réponse inattendu')
    }

  } catch (error) {
    console.error('Erreur génération compte-rendu:', error)
    return res.status(500).json({
      error: 'Erreur lors de la génération',
      details: error.message
    })
  }
}
