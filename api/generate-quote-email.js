import { requireUser } from './_lib/auth.js'
import { loadOrgProfile, orgIdentityBlock, senderFromProfile } from './_lib/orgProfile.js'
import { withErrorLog } from './_lib/errors.js'
// api/generate-quote-email.js
// Génère le texte email d'envoi de devis via l'API Anthropic (Claude)

async function handler(req, res) {
  if (req.method !== 'OPTIONS') {
    const ctx = await requireUser(req)
    if (!ctx) return res.status(401).json({ error: 'Connexion requise' })
    req.user = ctx.user
    req.profile = ctx.profile
    req.admin = ctx.admin
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { quote, client, contact, senderName, items, customInstructions, hasPrograms, programTitles } = req.body

    if (!quote || !client) {
      return res.status(400).json({ error: 'Données manquantes (quote, client)' })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée' })
    }

    // Construire le contexte
    const totalTtc = parseFloat(quote.total_ttc) || 0
    const itemsList = (items || []).map(it =>
      `- ${it.description_title || it.title || ''} (${it.quantity || 1}x ${it.unit_price_ht || 0} EUR HT)`
    ).join('\n')

    const contactName = contact
      ? [(contact.civilite || ''), (contact.first_name || ''), (contact.last_name || '')].filter(Boolean).join(' ')
      : ''

    const org = await loadOrgProfile(req.admin)
    const sender = senderFromProfile(req.profile, senderName)
    const prompt = `Tu es l'assistant commercial de ${org.name || "l'organisme de formation"}.

${orgIdentityBlock(org)}

Genere un email professionnel pour accompagner l'envoi d'un devis en piece jointe.

CONTEXTE :
- Expediteur : ${sender || "l'equipe"}${org.name ? ', ' + org.name : ''}
- Destinataire : ${contactName || 'le responsable formation'}
- Entreprise cliente : ${client.name || ''}
- Reference devis : ${quote.reference || ''}
- Objet du devis : ${quote.object || 'Formation professionnelle'}
- Montant TTC : ${totalTtc.toFixed(2).replace('.', ',')} EUR
- Formations incluses :
${itemsList || '(non precise)'}
${hasPrograms ? `\nProgrammes de formation joints en piece jointe : ${(programTitles || []).join(', ')}` : ''}

${customInstructions ? 'INSTRUCTIONS SUPPLEMENTAIRES : ' + customInstructions : ''}

REGLES :
- Ton professionnel mais chaleureux
- Court et efficace (5-8 lignes max pour le corps)
- Vouvoiement
- Mentionner que le devis est en piece jointe
${hasPrograms ? '- Mentionner que les programmes de formation correspondants sont egalement joints' : ''}
- Inviter a revenir vers nous pour toute question
- NE PAS inclure de signature (elle sera ajoutee automatiquement)
- NE PAS inclure de formule de politesse finale (cordialement, bien a vous, etc.) car elle est ajoutee automatiquement avec la signature
- PAS de formule trop longue ou pompeuse
- Langue : francais

Reponds UNIQUEMENT au format JSON suivant, sans backticks ni markdown :
{"subject": "l'objet de l'email", "body": "le corps de l'email (avec \\n pour les retours a la ligne)"}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
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

    // Parser le JSON
    try {
      const parsed = JSON.parse(textContent.trim())
      return res.status(200).json({ subject: parsed.subject, body: parsed.body })
    } catch (parseErr) {
      // Fallback si parsing échoue
      return res.status(200).json({
        subject: `Devis ${quote.reference || ''}${org.name ? ' ' + org.name : ''}`,
        body: textContent,
      })
    }
  } catch (error) {
    console.error('generate-quote-email error:', error)
    return res.status(500).json({ error: error.message || 'Erreur serveur' })
  }
}

export default withErrorLog(handler, 'generate-quote-email')
