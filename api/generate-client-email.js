import { requireRight, SALES } from './_lib/auth.js'
import { loadOrgProfile, orgIdentityBlock, senderFromProfile } from './_lib/orgProfile.js'
import { withErrorLog } from './_lib/errors.js'
// api/generate-client-email.js
// Génère un email pro à un client via Claude Sonnet
// Contexte enrichi : sessions, devis, RDV, historique complet

async function handler(req, res) {
  const ctx = await requireRight(req, res, 'commercial.prospection.gerer', SALES, SALES)
  if (!ctx) return
  req.user = ctx.user
  req.profile = ctx.profile
  req.admin = ctx.admin
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const {
      brief,
      clientName,
      contactName,
      contactFunction,
      senderName,
      recentInteractions,
      sessions,
      quotes,
      rdvs,
      emailHistory,
      clientInfo,
    } = req.body

    if (!brief) {
      return res.status(400).json({ error: 'Brief requis' })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée' })
    }

    // ── System prompt : identité et catalogue lus dans les paramètres de l'organisme ──
    const org = await loadOrgProfile(req.admin)
    const sender = senderFromProfile(req.profile, senderName)
    const systemPrompt = `Tu rédiges un email au nom de ${sender || "l'équipe"}, pour ${org.name || "l'organisme de formation"}.

${orgIdentityBlock(org)}

TON & STYLE :
- Professionnel mais humain, direct, pas pompeux
- Vouvoiement systématique
- Phrases courtes et percutantes
- Pas de jargon marketing creux
- Tu tutoies jamais un client
- Adapte la longueur au besoin : une relance = court (3-5 lignes), une proposition détaillée = plus long
- NE JAMAIS inclure de signature ni de formule de politesse finale (pas de "Cordialement", "Bien à vous", "Au plaisir", "Bonne journée", etc.) — la signature est ajoutée automatiquement après ton texte
- Le texte doit se terminer par la dernière phrase utile du message, RIEN d'autre après`

    // ── Construire le contexte client ──
    const contextParts = []

    // Info client
    if (clientInfo) {
      const parts = [`Entreprise : ${clientName || 'N/C'}`]
      if (clientInfo.city) parts.push(`Ville : ${clientInfo.city}`)
      if (clientInfo.effectif) parts.push(`Effectif : ${clientInfo.effectif}`)
      if (clientInfo.naf_label) parts.push(`Activité : ${clientInfo.naf_label}`)
      if (clientInfo.opco_name) parts.push(`OPCO : ${clientInfo.opco_name}`)
      if (clientInfo.status) parts.push(`Statut CRM : ${clientInfo.status}`)
      contextParts.push('CLIENT :\n' + parts.join('\n'))
    }

    // Contact destinataire
    if (contactName || contactFunction) {
      contextParts.push(`DESTINATAIRE : ${contactName || 'N/C'}${contactFunction ? ' — ' + contactFunction : ''}`)
    }

    // Sessions / formations avec ce client
    if (sessions?.length > 0) {
      const sessCtx = sessions.slice(0, 8).map(s => {
        const course = s.courseTitle || 'Formation'
        const dates = s.startDate ? `du ${s.startDate}${s.endDate ? ' au ' + s.endDate : ''}` : ''
        const nbTrainees = s.nbTrainees ? `${s.nbTrainees} stagiaire(s)` : ''
        const status = s.status === 'completed' ? '✅ terminée' : s.status === 'planned' ? '📅 planifiée' : s.status === 'in_progress' ? '🔄 en cours' : s.status
        return `- ${course} ${dates} — ${nbTrainees} — ${status}`
      }).join('\n')
      contextParts.push('FORMATIONS (sessions) :\n' + sessCtx)
    }

    // Devis en cours
    if (quotes?.length > 0) {
      const qCtx = quotes.slice(0, 5).map(q => {
        const status = q.status === 'draft' ? 'brouillon' : q.status === 'sent' ? 'envoyé' : q.status === 'accepted' ? 'accepté' : q.status === 'refused' ? 'refusé' : q.status
        return `- ${q.reference || 'Devis'} : ${q.object || 'N/C'} — ${q.totalHt ? q.totalHt + '€ HT' : ''} — ${status}${q.sentDate ? ' (envoyé le ' + q.sentDate + ')' : ''}`
      }).join('\n')
      contextParts.push('DEVIS :\n' + qCtx)
    }

    // RDV
    if (rdvs?.length > 0) {
      const rCtx = rdvs.slice(0, 3).map(r => {
        const type = r.rdv_type === 'tel' ? '📞 tel' : r.rdv_type === 'visio' ? '💻 visio' : r.rdv_type === 'presentiel' ? '🤝 présentiel' : r.rdv_type || ''
        return `- ${r.rdv_date || ''}${r.rdv_time ? ' à ' + r.rdv_time : ''} — ${type} — ${r.status || ''}`
      }).join('\n')
      contextParts.push('RDV :\n' + rCtx)
    }

    // Derniers emails envoyés (pour éviter la redite)
    if (emailHistory?.length > 0) {
      const eCtx = emailHistory.slice(0, 5).map(e =>
        `- ${e.date || ''} : "${e.subject || '(sans objet)'}" → ${e.to || ''}`
      ).join('\n')
      contextParts.push('DERNIERS EMAILS ENVOYÉS :\n' + eCtx)
    }

    // Interactions récentes (appels, notes, réunions)
    if (recentInteractions?.length > 0) {
      const iCtx = recentInteractions.slice(0, 5).map(i =>
        `- ${i.date || ''} [${i.type || ''}] ${i.title || ''} : ${(i.content || '').substring(0, 200)}`
      ).join('\n')
      contextParts.push('DERNIÈRES INTERACTIONS :\n' + iCtx)
    }

    const contextBlock = contextParts.length > 0 ? contextParts.join('\n\n') : 'Aucun historique disponible.'

    // ── User prompt ──
    const userPrompt = `Voici le contexte de ce client :

${contextBlock}

BRIEF DE L'UTILISATEUR :
"${brief}"

Génère l'email correspondant. Adapte le ton et la longueur au brief :
- Relance / suivi → court et direct (3-6 lignes)
- Proposition / envoi doc → moyen (5-10 lignes)
- Réponse à une demande → adapté au sujet

Réponds UNIQUEMENT en JSON valide, sans backticks, sans markdown :
{"subject": "objet de l'email", "body": "corps en HTML simple (balises <p> et <br> uniquement, pas de <strong> ni mise en forme)"}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Anthropic API error:', errText)
      return res.status(500).json({ error: 'Erreur API Anthropic' })
    }

    const data = await response.json()
    let textContent = (data.content?.[0]?.text || '').trim()

    // Nettoyer les artefacts markdown
    textContent = textContent.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()

    try {
      const parsed = JSON.parse(textContent)
      const cleanBody = (parsed.body || '').trim()
      const cleanSubject = (parsed.subject || '').trim()
      return res.status(200).json({ subject: cleanSubject, body: cleanBody })
    } catch (parseErr) {
      // Fallback : extraction manuelle
      const subjectMatch = textContent.match(/"subject"\s*:\s*"([^"]*)"/)
      const bodyMatch = textContent.match(/"body"\s*:\s*"([\s\S]*?)"\s*}/)
      return res.status(200).json({
        subject: subjectMatch?.[1] || [org.name, clientName].filter(Boolean).join(' : '),
        body: (bodyMatch?.[1] || textContent).replace(/\\n/g, '\n').replace(/["`}]+$/g, '').trim(),
      })
    }
  } catch (error) {
    console.error('generate-client-email error:', error)
    return res.status(500).json({ error: error.message })
  }
}

export default withErrorLog(handler, 'generate-client-email')
