// api/generate-relance-email.js
// Génère un email de relance de devis personnalisé via Claude
// Prend en compte : contexte client, âge du devis, historique de relances, formations concernées

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const {
      quote,           // { reference, quote_date, total_ht, total_ttc, object, relance_count, notes }
      client,          // { name, contact_name, contact_email }
      items,           // [{ description_title, quantity, unit_price_ht }]
      senderName,      // 'Hicham Saidi' ou 'Maxime Langlais'
      daysSinceQuote,  // nombre de jours depuis l'envoi
      interactions,    // [{ type, title, content, interaction_date }] historique récent
      rdvContext,      // { rdv_date, notes } si un RDV a eu lieu avant
    } = req.body

    if (!quote || !client) {
      return res.status(400).json({ error: 'Données manquantes (quote, client)' })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée' })
    }

    const relanceNum = (quote.relance_count || 0) + 1
    const totalHt = parseFloat(quote.total_ht) || 0
    const montant = totalHt.toFixed(2).replace('.', ',')

    const itemsList = (items || []).map(it =>
      `- ${it.description_title || ''} (${it.quantity || 1} x ${parseFloat(it.unit_price_ht || 0).toFixed(2).replace('.', ',')} EUR HT)`
    ).join('\n')

    const interactionHistory = (interactions || []).slice(0, 5).map(i => {
      let contentPreview = ''
      if (i.content) {
        const emailMarker = i.content.indexOf('---EMAIL---')
        if (emailMarker !== -1) {
          const emailBody = i.content.slice(emailMarker + 11).trim()
          contentPreview = emailBody ? ` | Email original : "${emailBody.slice(0, 500)}"` : ''
        } else {
          contentPreview = ` (${i.content.slice(0, 150)})`
        }
      }
      return `- ${i.interaction_date || ''} : ${i.type || ''} — ${i.title || ''}${contentPreview}`
    }).join('\n')

    const rdvInfo = rdvContext
      ? `Un RDV a eu lieu le ${rdvContext.rdv_date || 'date inconnue'}. Notes du RDV : ${rdvContext.notes || 'aucune'}`
      : 'Aucun RDV enregistré avec ce client.'

    // Notes existantes sur le devis (historique relances)
    const quoteNotes = quote.notes ? `Historique devis : ${quote.notes.slice(0, 300)}` : ''

    const urgencyLevel = relanceNum === 1 ? 'première relance, ton courtois et intéressé'
      : relanceNum === 2 ? 'deuxième relance, ton un peu plus direct mais toujours poli'
      : 'troisième et dernière relance, ton ferme mais professionnel, proposer un échange téléphonique'

    const prompt = `Tu es l'assistant commercial d'Access Formation, organisme de formation professionnelle certifié Qualiopi basé à Concarneau (Bretagne). Spécialités : SST, CACES, incendie, habilitation électrique, gestes et postures, DUERP.

MISSION : Rédiger un email de RELANCE pour un devis resté sans réponse.

CONTEXTE CLIENT :
- Entreprise : ${client.name || 'Non précisé'}
- Contact : ${client.contact_name || 'le responsable'}
- Email : ${client.contact_email || 'non précisé'}

DEVIS :
- Référence : ${quote.reference || ''}
- Date d'envoi : ${quote.quote_date || ''}
- Jours écoulés : ${daysSinceQuote || '?'} jours
- Montant HT : ${montant} EUR
- Objet : ${quote.object || 'Formation professionnelle'}
- Formations concernées :
${itemsList || '(non précisé)'}

HISTORIQUE RELANCES :
- C'est la ${relanceNum === 1 ? '1ère' : relanceNum === 2 ? '2ème' : '3ème'} relance
- Niveau d'urgence : ${urgencyLevel}
${quoteNotes}

CONTEXTE RELATION :
${rdvInfo}
${interactionHistory ? 'Dernières interactions :\n' + interactionHistory : 'Pas d\'historique d\'interactions.'}

REGLES STRICTES :
- Ton professionnel, courtois, jamais agressif
- Vouvoiement systématique
- Court : 4-6 lignes maximum pour le corps
- ${relanceNum === 1 ? 'Demander simplement si le devis a été consulté et si des questions se posent' : ''}
- ${relanceNum === 2 ? 'Proposer d\'adapter le devis si besoin, mentionner possibilité d\'appel' : ''}
- ${relanceNum === 3 ? 'Dernière relance, proposer un appel pour faire le point, indiquer que le devis reste valable' : ''}
- Si un RDV a eu lieu, y faire référence naturellement
- Si des formations spécifiques sont mentionnées, les utiliser comme levier (obligations légales, échéances)
- Mentionner les financements OPCO si pertinent (formations éligibles)
- NE PAS inclure de signature (ajoutée automatiquement)
- NE PAS inclure de formule de politesse finale (cordialement, etc.) car ajoutée automatiquement
- NE PAS écrire "Objet:" dans le body
- Langue : français

FORMAT DE RÉPONSE — JSON strict, sans backticks ni markdown :
{"subject": "objet de l'email", "body": "corps de l'email avec \\n pour les retours à la ligne", "tone": "courtois|direct|ferme"}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Anthropic API error:', errText)
      return res.status(500).json({ error: 'Erreur API Anthropic', details: errText })
    }

    const data = await response.json()
    const textContent = data.content?.[0]?.text || ''

    try {
      // Nettoyer le JSON (parfois Claude ajoute des backticks)
      const cleaned = textContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      const parsed = JSON.parse(cleaned)
      return res.status(200).json({
        subject: parsed.subject,
        body: parsed.body,
        tone: parsed.tone || 'courtois',
        relanceNum,
      })
    } catch (parseErr) {
      // Fallback
      console.error('Parse error, raw:', textContent)
      return res.status(200).json({
        subject: `${relanceNum > 1 ? 'Relance — ' : ''}Devis ${quote.reference || ''} — Access Formation`,
        body: textContent.replace(/[{}"]/g, '').trim(),
        tone: 'courtois',
        relanceNum,
      })
    }
  } catch (error) {
    console.error('generate-relance-email error:', error)
    return res.status(500).json({ error: error.message || 'Erreur serveur' })
  }
}
