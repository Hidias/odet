import { requireUser } from './_lib/auth.js'
// api/parse-planning-import.js
// Parse un planning copié-collé (ex: Pilocap) via Claude et retourne des sessions structurées

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
    const { rawText, baseTitle } = req.body

    if (!rawText || rawText.trim().length < 20) {
      return res.status(400).json({ error: 'Texte trop court pour être analysé' })
    }

    const systemPrompt = `Tu es un assistant qui analyse des plannings de formation copiés-collés depuis des plateformes de donneurs d'ordre (type Pilocap, AFPI, etc.).

Tu dois extraire les données structurées et retourner UNIQUEMENT du JSON valide, sans aucun texte avant ou après.

RÈGLES D'EXTRACTION :
1. Identifie chaque JOUR de formation distinct (par date)
2. Pour chaque jour, liste les numéros de session actifs ce jour-là (format type "2026-02-046")  
3. Compte les stagiaires UNIQUES par jour (un stagiaire qui apparaît dans plusieurs sessions le même jour = 1 seul)
4. Détecte le lieu si mentionné
5. Détecte les horaires si mentionnés
6. Un stagiaire peut revenir sur plusieurs jours (sa session dure plusieurs jours) — il compte 1 par jour mais c'est toujours le même numéro de session

FORMAT DE SORTIE (JSON strict) :
{
  "days": [
    {
      "date": "2026-02-02",
      "session_refs": ["2026-02-046", "2026-02-048"],
      "nb_trainees": 4,
      "trainee_names": ["Edouard GUERIN", "Quentin LEFORESTIER"],
      "location": "PILOCAP Rennes, 4 Rue des Champs Géons, 35170 Bruz",
      "start_time": "08:00",
      "end_time": "17:00"
    }
  ],
  "total_unique_trainees": 8,
  "all_trainee_names": ["Edouard GUERIN", "Quentin LEFORESTIER", "..."],
  "detected_training_type": "CACES R.489",
  "detected_client": "PILOCAP RENNES Formation",
  "notes": "Remarques éventuelles sur le parsing"
}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `Analyse ce planning copié-collé et retourne le JSON structuré :\n\n${rawText.substring(0, 50000)}`
        }]
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error?.message || 'Erreur API Claude')
    }

    const data = await response.json()
    const rawResponse = data.content[0].text

    // Parser le JSON depuis la réponse
    let parsed
    try {
      // Nettoyer si Claude a mis des backticks
      const cleaned = rawResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      parsed = JSON.parse(cleaned)
    } catch (parseErr) {
      console.error('JSON parse error:', rawResponse.substring(0, 500))
      return res.status(500).json({ error: 'Erreur de parsing JSON', raw: rawResponse.substring(0, 1000) })
    }

    return res.status(200).json(parsed)

  } catch (err) {
    console.error('Parse planning error:', err)
    return res.status(500).json({ error: err.message || 'Erreur interne' })
  }
}
