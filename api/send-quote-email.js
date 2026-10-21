// api/send-quote-email.js
// Envoyer un devis par email via SMTP (utilise user_email_configs existant)

import { getSupabaseAdmin, getMailer, sendWithRetry, getOrg, getSender, buildSignatureHTML, decrypt } from './_lib/mailer.js'
import { saveToSentFolder } from './_lib/save-to-sent.js'
import { requireRight, SALES } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

// Augmenter la limite du body parser Vercel (défaut 4.5MB)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb'
    }
  },
  maxDuration: 60
}

const supabase = getSupabaseAdmin()

// Déchiffrement AES-256

// Sleep pour retry

// Envoi avec retry

// Signatures importées depuis _lib/mailer.js

async function handler(req, res) {
  const ctx = await requireRight(req, res, 'commercial.devis.envoyer', SALES, SALES)
  if (!ctx) return
  req.user = ctx.user
  req.profile = ctx.profile
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let transporter = null

  try {
    const { userId, to, subject, body, pdfBase64, pdfFilename, programUrls, extraAttachments, quoteId, clientId, createdBy } = req.body || {}

    console.log('send-quote-email params:', { userId: !!userId, to: !!to, subject: !!subject, body: !!body, hasPdf: !!pdfBase64 })

    const missing = []
    if (!userId) missing.push('userId')
    if (!to) missing.push('to')
    if (!subject) missing.push('subject')
    if (!body) missing.push('body')
    if (missing.length > 0) {
      return res.status(400).json({ error: `Paramètres manquants: ${missing.join(', ')}` })
    }

    // 1. Configuration SMTP de l'utilisateur connecté et transporteur (redirection démo incluse)
    // Toujours la boîte de l'utilisateur connecté (userId du corps ignoré)
    const mailer = await getMailer(supabase, req.user.id, { envoiReel: true })
    if (mailer.error) {
      return res.status(400).json({ error: 'Configuration email non trouvée. Configurez votre email dans Paramètres.' })
    }
    const emailConfig = mailer.emailConfig
    transporter = mailer.transporter
    const smtpPassword = decrypt(emailConfig.smtp_password_encrypted)
    const org = await getOrg(supabase)
    const sender = await getSender(supabase, emailConfig.email)

    // 4. Préparer le corps HTML avec signature pro
    let htmlBody = body.replace(/\n/g, '<br>')
        htmlBody += `<br><br><p style="margin: 0;">Bien cordialement,</p>${buildSignatureHTML(sender, org)}`

    // 5. Construire les options du mail
    const mailOptions = {
      from: `"${sender.name} - ${org.name}" <${emailConfig.email}>`,
      to: to,
      bcc: org.email_bcc || undefined,
      subject: subject,
      text: body,
      html: htmlBody,
      attachments: []
    }

    // 6. Pièce jointe PDF
    if (pdfBase64 && pdfFilename) {
      console.log('PDF attachment:', pdfFilename, 'base64 length:', pdfBase64.length)
      mailOptions.attachments.push({
        filename: pdfFilename,
        content: Buffer.from(pdfBase64, 'base64'),
        contentType: 'application/pdf'
      })
    } else {
      console.warn('Pas de PJ PDF!', { hasPdfBase64: !!pdfBase64, hasPdfFilename: !!pdfFilename, base64Length: pdfBase64?.length || 0 })
    }

    // 6b. Programmes de formation : le transporteur lit directement depuis l'URL (pas de téléchargement préalable)
    // Seules les adresses du stockage Supabase du projet sont acceptées : nodemailer lit aussi
    // les chemins locaux du serveur et toute adresse réseau passée dans `path`
    const storageBase = (() => {
      try { return `${new URL(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL).origin}/storage/v1/object/` } catch { return null }
    })()
    if (Array.isArray(programUrls) && programUrls.length > 0) {
      for (const prog of programUrls) {
        if (prog?.url && prog.filename && storageBase && String(prog.url).startsWith(storageBase) && !String(prog.url).includes('..')) {
          console.log('Programme (stream URL):', prog.filename)
          mailOptions.attachments.push({
            filename: prog.filename,
            path: prog.url,
            contentType: 'application/pdf'
          })
        }
      }
    }

    // 6c. Pièces jointes manuelles (base64)
    if (extraAttachments && extraAttachments.length > 0) {
      for (const att of extraAttachments) {
        if (att.base64 && att.filename) {
          console.log('Extra attachment:', att.filename, 'base64 length:', att.base64.length)
          mailOptions.attachments.push({
            filename: att.filename,
            content: Buffer.from(att.base64, 'base64'),
          })
        }
      }
    }
    // 6d. Les conditions générales de vente sont jointes par l'écran (document qualité publié), parmi les pièces jointes

    console.log('Total attachments:', mailOptions.attachments.length)

    // 7. Envoyer avec retry
    const info = await sendWithRetry(transporter, mailOptions, 3)

    // 7b. Copier dans le dossier Envoyés (non-bloquant)
    saveToSentFolder(emailConfig, smtpPassword, mailOptions).catch(err => {
      console.warn('Save to Sent failed (non-blocking):', err.message)
    })

    // 8. Mettre à jour le statut du devis → "envoye"
    if (quoteId) {
      const { error: updateError } = await supabase
        .from('quotes')
        .update({ status: 'sent', updated_at: new Date().toISOString() })
        .eq('id', quoteId)

      if (updateError) {
        console.error('Erreur mise à jour statut devis:', updateError)
      }
    }

    // 9. Traçabilité : ajouter dans l'historique client
    if (clientId) {
      const now = new Date()
      const dateStr = now.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })
      const timeStr = now.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })
      const authorName = sender.name

      const { error: interactionError } = await supabase
        .from('client_interactions')
        .insert({
          client_id: clientId,
          type: 'devis',
          title: `Devis ${pdfFilename?.replace('.pdf', '') || ''} envoyé`,
          content: `Devis envoyé par ${authorName} le ${dateStr} à ${timeStr}\nDestinataire : ${to}\nObjet : ${subject}\n\n---EMAIL---\n${body || ''}`,
          author: authorName,
        })

      if (interactionError) {
        console.error('Erreur traçabilité:', interactionError)
      } else {
        console.log('Traçabilité ajoutée pour client:', clientId)
      }
    }

    // 10. Fermer le transporteur
    try { transporter.close() } catch (e) { /* ignore */ }

    return res.status(200).json({
      success: true,
      message: 'Devis envoyé par email avec succès',
      messageId: info.messageId,
      to: to
    })

  } catch (error) {
    console.error('send-quote-email error:', error)
    if (transporter) {
      try { transporter.close() } catch (e) { /* ignore */ }
    }
    return res.status(500).json({
      error: 'Erreur lors de l\'envoi de l\'email',
      details: error.message
    })
  }
}

export default withErrorLog(handler, 'send-quote-email')
