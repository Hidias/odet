// api/send-email-stagiaire.js
// Envoie un email individuel à un stagiaire avec ses documents en PJ

import { getSupabaseAdmin, getMailer, sendWithRetry, getOrg, getSender, buildSignatureHTML, wrapEmailHTML } from './_lib/mailer.js'
import { requireRight, OFFICE_WRITE, isSafeStoragePath } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

const supabase = getSupabaseAdmin()




async function handler(req, res) {
  const ctx = await requireRight(req, res, ['formation.convocations.envoyer', 'formation.sessions.modifier_siennes'], OFFICE_WRITE, OFFICE_WRITE)
  if (!ctx) return
  req.user = ctx.user
  req.profile = ctx.profile
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let transporter = null

  try {
    const { userId, to, subject, body, attachmentPaths = [], sessionId, traineeId } = req.body

    if (!userId || !to || !subject || !body) {
      return res.status(400).json({ error: 'Paramètres manquants' })
    }

    // Pièces jointes : uniquement des fichiers déposés pour CETTE session (bucket documents, « stagiaire-emails/<sessionId>/... »)
    if (!Array.isArray(attachmentPaths)) return res.status(400).json({ error: 'Pièces jointes invalides' })
    if (attachmentPaths.length > 0 && (!sessionId || attachmentPaths.some((att) => !isSafeStoragePath(att?.path, `stagiaire-emails/${sessionId}/`)))) {
      return res.status(400).json({ error: 'Pièce jointe non autorisée pour cette session' })
    }

    // 1. Configuration SMTP de l'utilisateur connecté et transporteur (redirection démo incluse)
    // Toujours la boîte de l'utilisateur connecté (userId du corps ignoré)
    const mailer = await getMailer(supabase, req.user.id)
    if (mailer.error) {
      return res.status(400).json({ error: 'Configuration email non trouvée.' })
    }
    const emailConfig = mailer.emailConfig
    transporter = mailer.transporter
    const org = await getOrg(supabase)
    const sender = await getSender(supabase, emailConfig.email)

    // 4. Télécharger les PJ depuis Supabase Storage via signed URLs
    const mailAttachments = []
    for (const att of attachmentPaths) {
      const { data: signedUrlData, error: urlError } = await supabase
        .storage.from('documents')
        .createSignedUrl(att.path, 300) // 5 min

      if (urlError || !signedUrlData?.signedUrl) {
        console.error(`Erreur signed URL pour ${att.path}:`, urlError)
        continue
      }

      const fileResponse = await fetch(signedUrlData.signedUrl)
      if (!fileResponse.ok) {
        console.error(`Erreur téléchargement ${att.path}: ${fileResponse.status}`)
        continue
      }

      const fileBuffer = await fileResponse.arrayBuffer()
      mailAttachments.push({
        filename: att.filename,
        content: Buffer.from(fileBuffer),
        contentType: 'application/pdf'
      })
    }

    // 5. Signature pro
    let htmlBody = body.replace(/\n/g, '<br>')
        htmlBody += `<br><br><p style="margin: 0;">Bien cordialement,</p>${buildSignatureHTML(sender, org)}`

    // 6. Copie cachée d'archivage (paramètre de l'organisme)
    const mailOptions = {
      from: `"${sender.name}" <${emailConfig.email}>`,
      to: to,
      bcc: org.email_bcc || undefined,
      subject: subject,
      text: body,
      html: htmlBody,
      attachments: mailAttachments
    }

    // 7. Envoyer
    const info = await sendWithRetry(transporter, mailOptions, 3)

    // 8. Log dans session_emails_sent
    await supabase
      .from('session_emails_sent')
      .insert([{
        session_id: sessionId,
        to_email: to,
        to_name: traineeId,
        subject: subject,
        body: body,
        resend_email_id: info.messageId,
        attachments: attachmentPaths.map(a => ({ name: a.filename })),
        status: 'sent',
        created_by: userId,
        email_type: 'stagiaire'
      }])

    // 8b. Traçabilité CRM : ajouter dans l'historique client
    try {
      const { data: sessionData } = await supabase.from('sessions').select('client_id, reference').eq('id', sessionId).single()
      if (sessionData?.client_id) {
        const now = new Date()
        const dateStr = now.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })
        const timeStr = now.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })
        const authorName = sender.name

        await supabase.from('client_interactions').insert({
          client_id: sessionData.client_id,
          type: 'email',
          title: `Email stagiaire envoyé (${sessionData.reference || ''})`,
          content: `Email stagiaire envoyé par ${authorName} le ${dateStr} à ${timeStr}\nSession : ${sessionData.reference || sessionId}\nDestinataire : ${to}\nObjet : ${subject}`,
          author: authorName,
        })
        console.log('Traçabilité CRM ajoutée pour client:', sessionData.client_id)
      }
    } catch (traceErr) {
      console.error('Erreur traçabilité CRM (non bloquant):', traceErr.message)
    }

    if (transporter) transporter.close()

    return res.status(200).json({
      success: true,
      messageId: info.messageId,
      message: 'Email envoyé avec succès'
    })

  } catch (error) {
    console.error('Erreur envoi email stagiaire:', error)
    if (transporter) { try { transporter.close() } catch (e) {} }
    return res.status(500).json({
      error: 'Erreur lors de l\'envoi de l\'email',
      details: error.message
    })
  }
}

export default withErrorLog(handler, 'send-email-stagiaire')
