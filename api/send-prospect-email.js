// api/send-prospect-email.js
// Envoi d'un email de suivi commercial à un prospect ou un client, avec signature de l'expéditeur.
// Expéditeur : la configuration email de l'utilisateur connecté, sinon l'expéditeur par défaut de l'organisme.

import { getSupabaseAdmin, getMailer, getMailerByEmail, sendWithRetry, getOrg, getSender, wrapEmailHTML, decrypt } from './_lib/mailer.js'
import { saveToSentFolder } from './_lib/save-to-sent.js'
import { requireUser } from './_lib/auth.js'

const supabase = getSupabaseAdmin()

export const config = {
  api: { bodyParser: { sizeLimit: '8mb' } },
  maxDuration: 30,
}

async function pickMailer(userId, org) {
  let m = await getMailer(supabase, userId)
  if (!m.error) return m
  if (org.email_default_sender) {
    m = await getMailerByEmail(supabase, org.email_default_sender)
    if (!m.error) return m
  }
  const { data: configs } = await supabase.from('user_email_configs').select('email').eq('is_active', true).limit(1)
  if (configs?.[0]) return getMailerByEmail(supabase, configs[0].email)
  return { error: 'Aucune configuration email active. Configurez un compte dans Paramètres.' }
}

export default async function handler(req, res) {
  if (req.method !== 'OPTIONS') {
    const ctx = await requireUser(req)
    if (!ctx) return res.status(401).json({ error: 'Connexion requise' })
    req.user = ctx.user
    req.profile = ctx.profile
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  let transporter = null
  const sentBy = req.profile?.display_name || [req.profile?.first_name, req.profile?.last_name].filter(Boolean).join(' ') || ''

  try {
    const { to, subject, body, prospectSiren, clientId, prospectName, templateType, attachments, signatureVariant } = req.body || {}
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'Paramètres manquants : to, subject, body requis' })
    }

    const org = await getOrg(supabase)
    const mailer = await pickMailer(req.user.id, org)
    if (mailer.error) return res.status(400).json({ error: mailer.error })
    const { emailConfig } = mailer
    transporter = mailer.transporter
    const sender = await getSender(supabase, emailConfig.email)
    const senderEmail = emailConfig.email

    const html = wrapEmailHTML(body, sender, org, signatureVariant || 'standard')
    const bccSet = new Set([senderEmail, org.email_bcc].filter(Boolean))
    bccSet.delete(to)

    const mailOptions = {
      from: `"${org.name}" <${senderEmail}>`,
      replyTo: `"${sender.name}" <${senderEmail}>`,
      to,
      bcc: [...bccSet].join(', ') || undefined,
      subject,
      html,
      attachments: [],
    }
    if (Array.isArray(attachments)) {
      for (const att of attachments) {
        if (att.base64 && att.filename) {
          mailOptions.attachments.push({ filename: att.filename, content: Buffer.from(att.base64, 'base64'), contentType: att.contentType || 'application/pdf' })
        }
      }
    }

    await sendWithRetry(transporter, mailOptions, 3)
    try { transporter.close() } catch {}

    if (!org.demo_mode) {
      saveToSentFolder(emailConfig, decrypt(emailConfig.smtp_password_encrypted), mailOptions).catch((err) => {
        console.warn('Copie dans Envoyés impossible (non bloquant) :', err.message)
      })
    }

    try {
      await supabase.from('prospect_email_logs').insert({
        prospect_siren: prospectSiren || null,
        client_id: clientId || null,
        prospect_name: prospectName || null,
        to_email: to,
        from_email: senderEmail,
        subject,
        template_type: templateType || 'custom',
        body_preview: body.replace(/<[^>]*>/g, '').substring(0, 500),
        sent_by: sentBy || sender.name,
        status: 'sent',
      })
    } catch (logErr) {
      console.error('Journal email (non bloquant) :', logErr.message)
    }

    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('Envoi email prospect :', error)
    if (transporter) try { transporter.close() } catch {}
    try {
      await supabase.from('prospect_email_logs').insert({
        prospect_siren: req.body?.prospectSiren || null,
        prospect_name: req.body?.prospectName || null,
        to_email: req.body?.to || '',
        from_email: '',
        subject: req.body?.subject || '',
        template_type: req.body?.templateType || 'custom',
        sent_by: sentBy,
        status: 'error',
        error_message: error.message,
      })
    } catch {}
    return res.status(500).json({ error: error.message || 'Erreur lors de l\'envoi' })
  }
}
