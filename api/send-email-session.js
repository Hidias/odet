// api/send-email-session.js
// Envoyer les documents de session (avant/après formation) par email

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import crypto from 'crypto'
import { buildSignatureHTML, getCallerByEmail } from './_lib/mailer.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Fonction de déchiffrement
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

// Fonction sleep pour retry
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Fonction d'envoi avec retry
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
      
      try {
        transporter.close()
      } catch (e) {
        // Ignore
      }
      
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
    const { userId, to, subject, body, attachmentPaths = [], sessionId, emailType } = req.body

    if (!userId || !to || !subject || !body || !sessionId || !emailType) {
      return res.status(400).json({ error: 'Paramètres manquants' })
    }

    // 1. Récupérer la config SMTP de l'utilisateur
    const { data: emailConfig, error: configError } = await supabase
      .from('user_email_configs')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single()

    if (configError || !emailConfig) {
      return res.status(400).json({ error: 'Configuration email non trouvée. Configurez votre email dans Paramètres.' })
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
      tls: {
        rejectUnauthorized: false
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
      pool: false,
      maxConnections: 1,
      maxMessages: 1
    })

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
        console.log('✅ Fichier récupéré:', item.filename, fileBuffer.length, 'bytes')
      } catch (e) {
        console.error('Erreur récupération fichier:', item.path, e.message)
      }
    }

    // 5. Préparer le corps avec signature pro
    let htmlBody = body.replace(/\n/g, '<br>')
    
    // Signature HTML Access Formation
    const caller = getCallerByEmail(emailConfig.email)
    htmlBody += `<br><br><p style="margin: 0;">Bien cordialement,</p>${buildSignatureHTML(caller)}`
    
    const mailOptions = {
      from: `"${emailConfig.email.split('@')[0]}" <${emailConfig.email}>`,
      to: to,
      bcc: 'contact@accessformation.pro',
      subject: subject,
      text: body,
      html: htmlBody,
      attachments: mailAttachments
    }

    // 6. Envoyer avec retry
    const info = await sendEmailWithRetry(transporter, mailOptions, 3)

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
        const authorName = emailConfig.email.includes('hicham') ? 'Hicham' : emailConfig.email.includes('maxime') ? 'Maxime' : 'Access Formation'
        const typeLabel = emailType === 'before' ? 'avant' : 'après'

        await supabase.from('client_interactions').insert({
          client_id: sessionData.client_id,
          type: 'email',
          title: `Email ${typeLabel} formation envoyé (${sessionData.reference || ''})`,
          content: `Email ${typeLabel} formation envoyé par ${authorName} le ${dateStr} à ${timeStr}\nSession : ${sessionData.reference || sessionId}\nDestinataire : ${to}\nObjet : ${subject}`,
          author: authorName,
        })
        console.log('📋 Traçabilité CRM ajoutée pour client:', sessionData.client_id)
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
