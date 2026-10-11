// api/send-quote-email.js
// Envoyer un devis par email via SMTP (utilise user_email_configs existant)

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import crypto from 'crypto'
import { saveToSentFolder } from './_lib/save-to-sent.js'
import { buildSignatureHTML, getCallerByEmail } from './_lib/mailer.js'

// Augmenter la limite du body parser Vercel (défaut 4.5MB)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb'
    }
  },
  maxDuration: 60
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Déchiffrement AES-256
function decrypt(encryptedText) {
  const algorithm = 'aes-256-cbc'
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex')
  const [ivHex, encrypted] = encryptedText.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const decipher = crypto.createDecipheriv(algorithm, key, iv)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

// Sleep pour retry
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Envoi avec retry
async function sendEmailWithRetry(transporter, mailOptions, maxRetries = 3) {
  let lastError = null
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Tentative d'envoi ${attempt}/${maxRetries}`)
      await transporter.verify()
      const info = await transporter.sendMail(mailOptions)
      console.log('Email envoyé avec succès:', info.messageId)
      return info
    } catch (error) {
      lastError = error
      console.error(`Tentative ${attempt} échouée:`, error.message)
      try { transporter.close() } catch (e) { /* ignore */ }
      if (attempt < maxRetries) {
        const waitTime = attempt * 2000
        console.log(`Attente de ${waitTime}ms avant nouvelle tentative...`)
        await sleep(waitTime)
      }
    }
  }
  throw lastError
}

// Signatures importées depuis _lib/mailer.js

export default async function handler(req, res) {
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

    // 1. Récupérer la config SMTP de l'utilisateur
    const { data: emailConfig, error: configError } = await supabase
      .from('user_email_configs')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single()

    if (configError || !emailConfig) {
      return res.status(400).json({
        error: 'Configuration email non trouvée. Configurez votre email dans Paramètres.'
      })
    }

    // 2. Déchiffrer le mot de passe
    const smtpPassword = decrypt(emailConfig.smtp_password_encrypted)

    // 3. Créer le transporteur SMTP
    transporter = nodemailer.createTransport({
      host: emailConfig.smtp_host,
      port: emailConfig.smtp_port,
      secure: emailConfig.smtp_secure,
      auth: {
        user: emailConfig.email,
        pass: smtpPassword
      },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 60000,
      pool: false,
      maxConnections: 1,
      maxMessages: 1
    })

    // 4. Préparer le corps HTML avec signature pro
    let htmlBody = body.replace(/\n/g, '<br>')
    const caller = getCallerByEmail(emailConfig.email)
    htmlBody += `<br><br><p style="margin: 0;">Bien cordialement,</p>${buildSignatureHTML(caller)}`

    // 5. Construire les options du mail
    const senderName = emailConfig.email.includes('maxime') ? 'Maxime Langlais' : 'Hicham Saidi'
    const mailOptions = {
      from: `"${senderName} - Access Formation" <${emailConfig.email}>`,
      to: to,
      bcc: 'contact@accessformation.pro',
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

    // 6b. Programmes de formation — nodemailer streame directement depuis l'URL (pas de téléchargement préalable)
    if (programUrls && programUrls.length > 0) {
      for (const prog of programUrls) {
        if (prog.url && prog.filename) {
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
    // 6d. CGV automatiques — toujours jointes aux devis
    try {
      const protocol = req.headers['x-forwarded-proto'] || 'https'
      const host = req.headers['x-forwarded-host'] || req.headers.host
      const cgvUrl = `${protocol}://${host}/assets/CGV_Access_Formation.pdf`
      console.log('CGV attachment URL:', cgvUrl)
      mailOptions.attachments.push({
        filename: 'CGV_Access_Formation.pdf',
        path: cgvUrl,
        contentType: 'application/pdf'
      })
    } catch (cgvErr) {
      console.warn('CGV attachment failed (non-blocking):', cgvErr.message)
    }

    console.log('Total attachments:', mailOptions.attachments.length)

    // 7. Envoyer avec retry
    const info = await sendEmailWithRetry(transporter, mailOptions, 3)

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
      const authorName = (createdBy || 'Hicham Saidi').split(' ')[0]

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
