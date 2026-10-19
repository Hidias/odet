// api/send-email-rdv.js
// Envoie un email de compte-rendu via SMTP IONOS avec retry
// Les PJ sont récupérées depuis Supabase Storage (pas en JSON body → évite la limite 4.5MB Vercel)

import { getSupabaseAdmin, getMailer, sendWithRetry, getOrg, getSender, buildSignatureHTML, wrapEmailHTML } from './_lib/mailer.js'
import { requireRight, SALES, isSafeStoragePath } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

const supabase = getSupabaseAdmin()

// Déchiffrement AES-256



async function handler(req, res) {
  const ctx = await requireRight(req, res, 'commercial.prospection.gerer', SALES, SALES)
  if (!ctx) return
  req.user = ctx.user
  req.profile = ctx.profile
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let transporter = null
  const tempPaths = []

  try {
    const { userId, to, subject, body, attachmentRefs = [], rdvId } = req.body

    if (!userId || !to || !subject || !body) {
      return res.status(400).json({ error: 'Paramètres manquants' })
    }

    // Pièces jointes : uniquement les fichiers temporaires déposés par l'appelant
    // (bucket email-attachments, « temp-email/<id utilisateur>/... ») ; ils sont supprimés après l'envoi
    if (!Array.isArray(attachmentRefs) || attachmentRefs.some((ref) => !isSafeStoragePath(ref?.storagePath, `temp-email/${req.user.id}/`))) {
      return res.status(400).json({ error: 'Pièce jointe non autorisée' })
    }

    // 1. Configuration SMTP de l'utilisateur connecté et transporteur (redirection démo incluse)
    // Toujours la boîte de l'utilisateur connecté (userId du corps ignoré)
    const mailer = await getMailer(supabase, req.user.id)
    if (mailer.error) {
      return res.status(400).json({ error: 'Configuration email non trouvée. Configurez votre email dans Paramètres.' })
    }
    const emailConfig = mailer.emailConfig
    transporter = mailer.transporter
    const org = await getOrg(supabase)
    const sender = await getSender(supabase, emailConfig.email)

    // 4. Télécharger les PJ depuis Supabase Storage
    const mailAttachments = []
    for (const ref of attachmentRefs) {
      try {
        console.log('Téléchargement PJ:', ref.storagePath)
        const { data, error: dlError } = await supabase.storage
          .from('email-attachments')
          .download(ref.storagePath)

        if (dlError) {
          console.error('Erreur download PJ:', ref.storagePath, dlError.message)
          continue
        }

        const buffer = Buffer.from(await data.arrayBuffer())
        mailAttachments.push({
          filename: ref.filename,
          content: buffer
        })
        tempPaths.push(ref.storagePath)
        console.log('PJ chargée:', ref.filename, buffer.length, 'bytes')
      } catch (err) {
        console.error('Erreur PJ:', ref.filename, err.message)
      }
    }

    // 5. Préparer le corps avec signature pro
    let htmlBody = body.replace(/\n/g, '<br>')

        htmlBody += `<br><br><p style="margin: 0;">Bien cordialement,</p>${buildSignatureHTML(sender, org)}`

    const mailOptions = {
      from: `"${sender.name}" <${emailConfig.email}>`,
      to,
      bcc: org.email_bcc || undefined,
      subject,
      text: body,
      html: htmlBody,
      attachments: mailAttachments
    }

    // 6. Envoyer avec retry
    const info = await sendWithRetry(transporter, mailOptions, 3)

    // 7. Sauvegarder dans l'historique
    const { error: historyError } = await supabase
      .from('rdv_emails_sent')
      .insert([{
        rdv_id: rdvId,
        to_email: to,
        to_name: to.split('@')[0],
        subject,
        body,
        resend_email_id: info.messageId,
        attachments: attachmentRefs.map(a => ({ name: a.filename, size: a.size || 0 })),
        status: 'sent',
        created_by: req.user.id
      }])

    if (historyError) {
      console.error('Erreur sauvegarde historique:', historyError)
    }

    // 8b. Traçabilité CRM : ajouter dans l'historique client
    if (rdvId) {
      try {
        const { data: rdvData } = await supabase.from('prospect_rdv').select('client_id, contact_name').eq('id', rdvId).single()
        if (rdvData?.client_id) {
          const now = new Date()
          const dateStr = now.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })
          const timeStr = now.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })
          const authorName = sender.name

          await supabase.from('client_interactions').insert({
            client_id: rdvData.client_id,
            type: 'email',
            title: 'Email post-RDV envoyé',
            content: `Email envoyé par ${authorName} le ${dateStr} à ${timeStr}\nDestinataire : ${to}\nObjet : ${subject}`,
            author: authorName,
          })
          console.log('Traçabilité CRM ajoutée pour client:', rdvData.client_id)
        }
      } catch (traceErr) {
        console.error('Erreur traçabilité CRM (non bloquant):', traceErr.message)
      }
    }

    // 8. Nettoyer les fichiers temporaires du Storage
    if (tempPaths.length > 0) {
      const { error: deleteError } = await supabase.storage
        .from('email-attachments')
        .remove(tempPaths)
      if (deleteError) {
        console.error('Erreur nettoyage Storage:', deleteError)
      } else {
        console.log('Fichiers temp nettoyés:', tempPaths.length)
      }
    }

    // 9. Fermer le transporteur
    if (transporter) transporter.close()

    return res.status(200).json({
      success: true,
      messageId: info.messageId,
      message: 'Email envoyé avec succès'
    })

  } catch (error) {
    console.error('Erreur envoi email:', error)

    // Nettoyage en cas d'erreur aussi
    if (tempPaths.length > 0) {
      try {
        await supabase.storage.from('email-attachments').remove(tempPaths)
      } catch (e) { /* ignore */ }
    }

    if (transporter) {
      try { transporter.close() } catch (e) { /* ignore */ }
    }

    return res.status(500).json({
      error: 'Erreur lors de l\'envoi de l\'email',
      details: error.message
    })
  }
}

export default withErrorLog(handler, 'send-email-rdv')
