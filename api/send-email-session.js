// api/send-email-session.js
// Envoyer les documents de session (avant/après formation) par email

import { getSupabaseAdmin, getMailer, sendWithRetry, getOrg, getSender, buildSignatureHTML, wrapEmailHTML } from './_lib/mailer.js'
import { requireUser } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

const supabase = getSupabaseAdmin()




async function handler(req, res) {
  if (req.method !== 'OPTIONS') {
    const ctx = await requireUser(req)
    if (!ctx) return res.status(401).json({ error: 'Connexion requise' })
    req.user = ctx.user
    req.profile = ctx.profile
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let transporter = null

  try {
    const { userId, to, subject, body, attachmentPaths = [], sessionId, emailType } = req.body

    if (!userId || !to || !subject || !body || !sessionId || !emailType) {
      return res.status(400).json({ error: 'Paramètres manquants' })
    }

    // 1. Configuration SMTP de l'utilisateur connecté et transporteur (redirection démo incluse)
    const mailer = await getMailer(supabase, req.user?.id || userId)
    if (mailer.error) {
      return res.status(400).json({ error: 'Configuration email non trouvée. Configurez votre email dans Paramètres.' })
    }
    const emailConfig = mailer.emailConfig
    transporter = mailer.transporter
    const org = await getOrg(supabase)
    const sender = await getSender(supabase, emailConfig.email)

    // 4. Récupérer les fichiers depuis Supabase Storage via URL signée
    const mailAttachments = []
    for (const item of attachmentPaths) {
      try {
        // Générer une URL signée (valable 60s)
        const { data: signedUrlData, error: signError } = await supabase.storage
          .from('session-email-docs')
          .createSignedUrl(item.path, 60)

        if (signError || !signedUrlData?.signedUrl) {
          console.error('Erreur URL signée pour:', item.path, signError)
          continue
        }

        // Fetch le fichier via l'URL signée
        const fileResponse = await fetch(signedUrlData.signedUrl)
        if (!fileResponse.ok) {
          console.error('Erreur fetch fichier:', item.path, fileResponse.status)
          continue
        }

        const fileBuffer = Buffer.from(await fileResponse.arrayBuffer())
        mailAttachments.push({
          filename: item.filename,
          content: fileBuffer,
          contentType: 'application/pdf'
        })
        console.log('Fichier récupéré:', item.filename, fileBuffer.length, 'bytes')
      } catch (e) {
        console.error('Erreur récupération fichier:', item.path, e.message)
      }
    }

    // 5. Préparer le corps avec signature pro
    let htmlBody = body.replace(/\n/g, '<br>')
    
    htmlBody += `<br><br><p style="margin: 0;">Bien cordialement,</p>${buildSignatureHTML(sender, org)}`
    
    const mailOptions = {
      from: `"${sender.name}" <${emailConfig.email}>`,
      to: to,
      bcc: org.email_bcc || undefined,
      subject: subject,
      text: body,
      html: htmlBody,
      attachments: mailAttachments
    }

    // 6. Envoyer avec retry
    const info = await sendWithRetry(transporter, mailOptions, 3)

    // 7. Sauvegarder dans l'historique
    const { error: historyError } = await supabase
      .from('session_emails_sent')
      .insert([{
        session_id: sessionId,
        email_type: emailType,
        to_email: to,
        to_name: to.split('@')[0],
        subject: subject,
        body: body,
        resend_email_id: info.messageId,
        attachments: attachmentPaths.map(a => ({ name: a.filename, size: 0 })),
        status: 'sent',
        created_by: userId
      }])

    if (historyError) {
      console.error('Erreur sauvegarde historique:', historyError)
    }

    // 7b. Traçabilité CRM : ajouter dans l'historique client
    try {
      const { data: sessionData } = await supabase.from('sessions').select('client_id, reference').eq('id', sessionId).single()
      if (sessionData?.client_id) {
        const now = new Date()
        const dateStr = now.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })
        const timeStr = now.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })
        const authorName = sender.name
        const typeLabel = emailType === 'before' ? 'avant' : 'après'

        await supabase.from('client_interactions').insert({
          client_id: sessionData.client_id,
          type: 'email',
          title: `Email ${typeLabel} formation envoyé (${sessionData.reference || ''})`,
          content: `Email ${typeLabel} formation envoyé par ${authorName} le ${dateStr} à ${timeStr}\nSession : ${sessionData.reference || sessionId}\nDestinataire : ${to}\nObjet : ${subject}`,
          author: authorName,
        })
        console.log('Traçabilité CRM ajoutée pour client:', sessionData.client_id)
      }
    } catch (traceErr) {
      console.error('Erreur traçabilité CRM (non bloquant):', traceErr.message)
    }

    // 8. Nettoyer les fichiers temporaires dans le storage
    if (attachmentPaths.length > 0) {
      const paths = attachmentPaths.map(a => a.path)
      try {
        await supabase.storage.from('session-email-docs').remove(paths)
        console.log('Fichiers temporaires nettoyés:', paths.length)
      } catch (cleanupError) {
        console.error('Erreur nettoyage storage (non bloquant):', cleanupError)
      }
    }

    // 9. Fermer le transporteur
    try {
      transporter.close()
    } catch (e) {
      // Ignore
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Email envoyé avec succès',
      messageId: info.messageId 
    })

  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'email:', error)
    
    // Fermer le transporteur en cas d'erreur
    if (transporter) {
      try {
        transporter.close()
      } catch (e) {
        // Ignore
      }
    }
    
    return res.status(500).json({ 
      error: 'Erreur lors de l\'envoi de l\'email',
      details: error.message 
    })
  }
}

export default withErrorLog(handler, 'send-email-session')
