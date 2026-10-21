// api/send-invoice-email.js
// Envoi d'une facture (ou d'une relance) par email, avec PDF Factur-X en pièce jointe.
// Expéditeur : la configuration email de l'utilisateur connecté uniquement (pas de repli vers la boîte d'un tiers).

import { getSupabaseAdmin, getMailer, sendWithRetry, getOrg, getSender, wrapEmailHTML, decrypt } from './_lib/mailer.js'
import { saveToSentFolder } from './_lib/save-to-sent.js'
import { requireRight, BILLING } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

const supabase = getSupabaseAdmin()

export const config = {
  api: { bodyParser: { sizeLimit: '8mb' } },
  maxDuration: 60,
}

// Boîte de l'utilisateur appelant uniquement : aucun appel automatique n'utilise cette route
async function pickMailer(userId) {
  const m = await getMailer(supabase, userId, { envoiReel: true })
  if (m.error) return { error: 'Configurez votre compte email dans Paramètres > Comptes email' }
  return m
}

async function handler(req, res) {
  const ctx = await requireRight(req, res, 'facturation.factures.envoyer', BILLING, BILLING)
  if (!ctx) return
  req.user = ctx.user
  req.profile = ctx.profile
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  let transporter = null
  try {
    const { invoice_id, to, subject, body, relance_number, invoice_ref, pdf_base64 } = req.body || {}
    if (!to || !subject || !body || !invoice_id) {
      return res.status(400).json({ error: 'Paramètres manquants : invoice_id, to, subject, body requis' })
    }

    const org = await getOrg(supabase)
    const mailer = await pickMailer(req.user.id)
    if (mailer.error) return res.status(400).json({ error: mailer.error })
    const { emailConfig } = mailer
    transporter = mailer.transporter
    const sender = await getSender(supabase, emailConfig.email)
    const senderEmail = emailConfig.email

    const html = wrapEmailHTML(body.replace(/\n/g, '<br>'), sender, org)
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
    if (pdf_base64 && invoice_ref) {
      mailOptions.attachments.push({ filename: `${invoice_ref}_facturx.pdf`, content: Buffer.from(pdf_base64, 'base64'), contentType: 'application/pdf' })
    }

    await sendWithRetry(transporter, mailOptions, 3)
    try { transporter.close() } catch {}

    if (!org.demo_mode) {
      saveToSentFolder(emailConfig, decrypt(emailConfig.smtp_password_encrypted), mailOptions).catch((err) => {
        console.warn('Copie dans Envoyés impossible (non bloquant) :', err.message)
      })
    }

    const sentBy = req.profile?.display_name || [req.profile?.first_name, req.profile?.last_name].filter(Boolean).join(' ') || sender.name
    try {
      await supabase.from('invoice_relances').insert({
        invoice_id,
        relance_number: relance_number || 1,
        to_email: to,
        from_email: senderEmail,
        sent_by: sentBy,
        subject,
        body_preview: body.substring(0, 300),
        status: 'sent',
        sent_at: new Date().toISOString(),
      })
    } catch (logErr) {
      console.error('Journal invoice_relances (non bloquant) :', logErr.message)
    }

    try {
      const { data: inv } = await supabase.from('invoices').select('status').eq('id', invoice_id).single()
      if (inv && inv.status === 'draft') {
        await supabase.from('invoices').update({ status: 'due', updated_at: new Date().toISOString() }).eq('id', invoice_id)
      }
    } catch (statusErr) {
      console.error('Mise à jour du statut (non bloquant) :', statusErr.message)
    }

    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('Envoi facture :', error)
    if (transporter) try { transporter.close() } catch {}
    return res.status(500).json({ error: error.message || 'Erreur lors de l\'envoi' })
  }
}

export default withErrorLog(handler, 'send-invoice-email')
