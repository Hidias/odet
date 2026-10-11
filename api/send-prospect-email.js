// api/send-prospect-email.js
// Envoie un email de prospection au prospect (suite echange / NRP / relance)
// Signature HTML selon l'expediteur (Hicham / Maxime / Marine)
// Log dans prospect_email_logs + BCC sender + contact@

import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { saveToSentFolder } from './_lib/save-to-sent.js'
import { buildSignatureHTML, wrapEmailHTML, SIGNATURES as SIG_DATA } from './_lib/mailer.js'

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

// Signatures importées depuis _lib/mailer.js
// senderEmail par caller pour l'envoi SMTP
function getSenderEmail(caller) {
  const sig = SIG_DATA[caller] || SIG_DATA.Marine
  return sig.senderEmail
}

// Trouver la config SMTP pour un email donné, avec fallback intelligent
async function findSmtpConfig(senderEmail) {
  const { data: configs } = await supabase
    .from('user_email_configs')
    .select('*')
    .eq('is_active', true)

  if (!configs || configs.length === 0) return null

  // 1. Config exacte pour le senderEmail
  let config = configs.find(c => c.email === senderEmail)
  if (config) return config

  // 2. Fallback : entreprise@ (compte générique)
  config = configs.find(c => c.email === 'entreprise@accessformation.pro')
  if (config) return config

  // 3. Fallback : contact@
  config = configs.find(c => c.email === 'contact@accessformation.pro')
  if (config) return config

  // 4. Dernier recours : n'importe quelle config active
  return configs[0]
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let transporter = null

  try {
    const {
      to, subject, body, caller,
      prospectSiren, clientId, prospectName, templateType,
      attachments, signatureVariant
    } = req.body

    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'Parametres manquants: to, subject, body requis' })
    }

    const senderEmail = getSenderEmail(caller)
    const html = wrapEmailHTML(body, caller, signatureVariant || 'standard')

    // Chercher la config SMTP correspondant au sender
    const emailConfig = await findSmtpConfig(senderEmail)

    if (!emailConfig) {
      return res.status(400).json({ error: 'Aucune configuration email active trouvee' })
    }

    const smtpPassword = decrypt(emailConfig.smtp_password_encrypted)

    transporter = nodemailer.createTransport({
      host: emailConfig.smtp_host,
      port: emailConfig.smtp_port,
      secure: emailConfig.smtp_secure,
      pool: false,
      auth: { user: emailConfig.email, pass: smtpPassword },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    })

    // Retry logic — 3 tentatives avec délai croissant
    async function sendWithRetry(mailOpts, retries = 3) {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          await transporter.verify()
          await transporter.sendMail(mailOpts)
          return
        } catch (err) {
          if (attempt < retries && (err.message.includes('421') || err.message.includes('concurrent') || err.message.includes('greeting'))) {
            console.log(`Tentative ${attempt}/${retries} échouée, retry dans ${attempt * 3}s...`)
            if (transporter) try { transporter.close() } catch (e) {}
            await new Promise(r => setTimeout(r, attempt * 3000))
            transporter = nodemailer.createTransport({
              host: emailConfig.smtp_host, port: emailConfig.smtp_port, secure: emailConfig.smtp_secure,
              pool: false, auth: { user: emailConfig.email, pass: smtpPassword },
              tls: { rejectUnauthorized: false }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
            })
          } else {
            throw err
          }
        }
      }
    }

    // BCC : toujours l'adresse d'envoi + contact@ (dédupliqué)
    const bccSet = new Set([senderEmail, 'contact@accessformation.pro'])
    // Ne pas se mettre en BCC si on envoie déjà à cette adresse
    bccSet.delete(to)

    const mailOptions = {
      from: `"Access Formation" <${senderEmail}>`,
      sender: emailConfig.email,
      replyTo: `"Access Formation" <${senderEmail}>`,
      to: to,
      bcc: [...bccSet].join(', '),
      subject: subject,
      html: html,
      attachments: [],
    }

    // Ajouter les pièces jointes si présentes
    if (attachments && Array.isArray(attachments)) {
      for (const att of attachments) {
        if (att.base64 && att.filename) {
          mailOptions.attachments.push({
            filename: att.filename,
            content: Buffer.from(att.base64, 'base64'),
            contentType: att.contentType || 'application/pdf',
          })
        }
      }
    }

    await sendWithRetry(mailOptions)
    if (transporter) try { transporter.close() } catch (e) {}

    // Copier dans le dossier Envoyés (non-bloquant)
    saveToSentFolder(emailConfig, smtpPassword, mailOptions).catch(err => {
      console.warn('Save to Sent failed (non-blocking):', err.message)
    })

    // Log dans prospect_email_logs
    try {
      await supabase.from('prospect_email_logs').insert({
        prospect_siren: prospectSiren || null,
        client_id: clientId || null,
        prospect_name: prospectName || null,
        to_email: to,
        from_email: senderEmail,
        subject: subject,
        template_type: templateType || 'custom',
        body_preview: body.replace(/<[^>]*>/g, '').substring(0, 500),
        sent_by: caller || 'Marine',
        status: 'sent',
      })
    } catch (logErr) {
      console.error('Erreur log email (non bloquant):', logErr)
    }

    return res.status(200).json({ success: true })

  } catch (error) {
    console.error('Erreur envoi email prospect:', error)
    if (transporter) try { transporter.close() } catch (e) {}

    // Log erreur
    try {
      await supabase.from('prospect_email_logs').insert({
        prospect_siren: req.body?.prospectSiren || null,
        prospect_name: req.body?.prospectName || null,
        to_email: req.body?.to || '',
        from_email: '',
        subject: req.body?.subject || '',
        template_type: req.body?.templateType || 'custom',
        sent_by: req.body?.caller || 'Marine',
        status: 'error',
        error_message: error.message,
      })
    } catch (logErr) {}

    return res.status(500).json({ error: error.message })
  }
}
