// api/send-invoice-email.js
// Envoie une facture ou relance par email avec Factur-X en PJ
// Log dans invoice_relances + BCC + dossier Envoyés

import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { saveToSentFolder } from './_lib/save-to-sent.js'
import { wrapEmailHTML, SIGNATURES as SIG_DATA } from './_lib/mailer.js'
import { requireUser } from './_lib/auth.js'

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

// Normalise 'Hicham Saidi' → 'Hicham', 'Maxime Langlais' → 'Maxime'
function normalizeCaller(caller) {
  if (!caller) return 'Hicham'
  if (caller.toLowerCase().includes('hicham')) return 'Hicham'
  if (caller.toLowerCase().includes('maxime')) return 'Maxime'
  if (caller.toLowerCase().includes('marine')) return 'Marine'
  return caller
}

function getSenderEmail(caller) {
  const sig = SIG_DATA[normalizeCaller(caller)] || SIG_DATA['Hicham']
  return sig.senderEmail
}

async function findSmtpConfig(senderEmail) {
  const { data: configs } = await supabase
    .from('user_email_configs')
    .select('*')
    .eq('is_active', true)

  if (!configs || configs.length === 0) return null

  let config = configs.find(c => c.email === senderEmail)
  if (config) return config

  config = configs.find(c => c.email === 'entreprise@accessformation.pro')
  if (config) return config

  config = configs.find(c => c.email === 'contact@accessformation.pro')
  if (config) return config

  return configs[0]
}

export default async function handler(req, res) {
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
    const {
      invoice_id,
      to,
      subject,
      body,
      caller,
      relance_number,
      invoice_ref,
      pdf_base64,
    } = req.body

    if (!to || !subject || !body || !invoice_id) {
      return res.status(400).json({ error: 'Paramètres manquants: invoice_id, to, subject, body requis' })
    }

    // Normaliser le caller : "Hicham Saidi" → "Hicham", "Maxime Langlais" → "Maxime"
    const callerKey = caller?.toLowerCase().includes('hicham') ? 'Hicham'
      : caller?.toLowerCase().includes('maxime') ? 'Maxime'
      : 'Marine'

    const senderEmail = getSenderEmail(callerKey)
    const emailConfig = await findSmtpConfig(senderEmail)

    if (!emailConfig || !emailConfig.smtp_password_encrypted) {
      return res.status(500).json({ error: 'Configuration SMTP introuvable pour ' + senderEmail })
    }

    const smtpPassword = decrypt(emailConfig.smtp_password_encrypted)
    const html = wrapEmailHTML(body.replace(/\n/g, '<br>'), callerKey)

    const bccSet = new Set([senderEmail, 'contact@accessformation.pro'])
    bccSet.delete(to)

    const mailOptions = {
      from: `"Access Formation" <${senderEmail}>`,
      sender: emailConfig.email,
      replyTo: `"Access Formation" <${senderEmail}>`,
      to,
      bcc: [...bccSet].join(', '),
      subject,
      html,
      attachments: [],
    }

    if (pdf_base64 && invoice_ref) {
      mailOptions.attachments.push({
        filename: `${invoice_ref}_facturx.pdf`,
        content: Buffer.from(pdf_base64, 'base64'),
        contentType: 'application/pdf',
      })
    }

    const retries = 3
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

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await transporter.verify()
        await transporter.sendMail(mailOptions)
        break
      } catch (err) {
        if (attempt < retries && (err.message.includes('421') || err.message.includes('concurrent') || err.message.includes('greeting'))) {
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

    if (transporter) try { transporter.close() } catch (e) {}

    saveToSentFolder(emailConfig, smtpPassword, mailOptions).catch(err => {
      console.warn('Save to Sent failed (non-blocking):', err.message)
    })

    // Log dans invoice_relances
    try {
      await supabase.from('invoice_relances').insert({
        invoice_id,
        relance_number: relance_number || 1,
        to_email: to,
        from_email: senderEmail,
        sent_by: caller || 'Hicham Saidi',
        subject,
        body_preview: body.substring(0, 300),
        status: 'sent',
        sent_at: new Date().toISOString(),
      })
    } catch (logErr) {
      console.error('Erreur log invoice_relances (non bloquant):', logErr)
    }

    // Passer la facture en "due" si elle était draft
    try {
      const { data: inv } = await supabase
        .from('invoices')
        .select('status')
        .eq('id', invoice_id)
        .single()
      if (inv && inv.status === 'draft') {
        await supabase.from('invoices').update({
          status: 'due',
          updated_at: new Date().toISOString()
        }).eq('id', invoice_id)
      }
    } catch (statusErr) {
      console.error('Erreur mise à jour statut (non bloquant):', statusErr)
    }

    return res.status(200).json({ success: true })

  } catch (error) {
    console.error('Erreur envoi facture:', error)
    if (transporter) try { transporter.close() } catch (e) {}
    return res.status(500).json({ error: error.message })
  }
}
