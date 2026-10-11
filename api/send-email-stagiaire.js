// api/send-email-stagiaire.js
// Envoie un email individuel à un stagiaire avec ses documents en PJ

import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { buildSignatureHTML, getCallerByEmail } from './_lib/mailer.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function sendEmailWithRetry(transporter, mailOptions, maxRetries = 3) {
  let lastError = null
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Tentative d'envoi ${attempt}/${maxRetries} à ${mailOptions.to}`)
      await transporter.verify()
      const info = await transporter.sendMail(mailOptions)
      console.log('Email envoyé avec succès:', info.messageId)
      return info
    } catch (error) {
      lastError = error
      console.error(`Tentative ${attempt} échouée:`, error.message)
      try { transporter.close() } catch (e) {}
      if (attempt < maxRetries) {
        const waitTime = attempt * 2000
        console.log(`Attente de ${waitTime}ms avant nouvelle tentative...`)
        await sleep(waitTime)
      }
    }
  }
  throw lastError
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let transporter = null

  try {
    const { userId, to, subject, body, attachmentPaths = [], sessionId, traineeId } = req.body

    if (!userId || !to || !subject || !body) {
      return res.status(400).json({ error: 'Paramètres manquants' })
    }

    // 1. Config SMTP
    const { data: emailConfig, error: configError } = await supabase
      .from('user_email_configs')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single()

    if (configError || !emailConfig) {
      return res.status(400).json({ error: 'Configuration email non trouvée.' })
    }

    // 2. Déchiffrer mot de passe
    const smtpPassword = decrypt(emailConfig.smtp_password_encrypted)

    // 3. Transporteur
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
      socketTimeout: 30000,
      pool: false,
      maxConnections: 1,
      maxMessages: 1
    })

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
    const caller = getCallerByEmail(emailConfig.email)
    htmlBody += `<br><br><p style="margin: 0;">Bien cordialement,</p>${buildSignatureHTML(caller)}`

    // 6. BCC contact@accessformation.pro
    const mailOptions = {
      from: `"${emailConfig.email.split('@')[0]}" <${emailConfig.email}>`,
      to: to,
      bcc: 'contact@accessformation.pro',
      subject: subject,
      text: body,
      html: htmlBody,
      attachments: mailAttachments
    }

    // 7. Envoyer
    const info = await sendEmailWithRetry(transporter, mailOptions, 3)

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
        const authorName = emailConfig.email.includes('hicham') ? 'Hicham' : emailConfig.email.includes('maxime') ? 'Maxime' : 'Access Formation'

        await supabase.from('client_interactions').insert({
          client_id: sessionData.client_id,
          type: 'email',
          title: `Email stagiaire envoyé (${sessionData.reference || ''})`,
          content: `Email stagiaire envoyé par ${authorName} le ${dateStr} à ${timeStr}\nSession : ${sessionData.reference || sessionId}\nDestinataire : ${to}\nObjet : ${subject}`,
          author: authorName,
        })
        console.log('📋 Traçabilité CRM ajoutée pour client:', sessionData.client_id)
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
