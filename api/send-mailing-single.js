// api/send-mailing-single.js
// ─────────────────────────────────────────────────────────────────────────────
// Envoie 1 email dans le cadre d'une campagne mailing Access Campus
//
// Appelé en boucle depuis Mailing.jsx avec un délai de 2s entre chaque appel
// (orchestration côté client — évite les timeouts Vercel)
//
// Responsabilités :
//   1. Construire le HTML complet (body + "Bien cordialement" + signature + footer désabonnement)
//   2. Envoyer via SMTP IONOS (retry × 3)
//   3. Mettre à jour mailing_sends.status (sent | error)
//   Pas de BCC — le rapport complet est envoyé en fin de campagne par send-mailing-report.js
// ─────────────────────────────────────────────────────────────────────────────

import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'
import { buildSignatureHTML, wrapEmailHTML, SIGNATURES, decrypt } from './_lib/mailer.js'
import { requireUser } from './_lib/auth.js'

export const config = { maxDuration: 30 }

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const APP_URL = 'https://app.accessformation.pro'

// ─── Config SMTP : cherche la config correspondant au senderEmail ─────────────
async function findSmtpConfig(senderEmail) {
  const { data: configs } = await supabase
    .from('user_email_configs')
    .select('*')
    .eq('is_active', true)

  if (!configs || configs.length === 0) return null

  return (
    configs.find(c => c.email === senderEmail) ||
    configs.find(c => c.email === 'entreprise@accessformation.pro') ||
    configs.find(c => c.email === 'contact@accessformation.pro') ||
    configs[0]
  )
}

// ─── Footer désabonnement ─────────────────────────────────────────────────────
function buildUnsubscribeFooter(token) {
  const linkDesabo = `${APP_URL}/api/unsubscribe?token=${token}`
  const mailDesabo = `mailto:contact@accessformation.pro?subject=D%C3%A9sabonnement`

  return `
    <table cellpadding="0" cellspacing="0" style="margin-top: 28px; border-top: 1px solid #e5e7eb; width: 100%; max-width: 650px; border-collapse: collapse;">
      <tr>
        <td style="padding-top: 12px;">
          <p style="font-family: Arial, sans-serif; font-size: 11px; color: #9ca3af; margin: 0 0 6px 0; line-height: 1.6;">
            <strong style="color: #6b7280;">Access Formation SARL</strong> — 24 rue Kerbleiz, 29900 Concarneau<br>
            SIRET : 943 563 866 00012 &nbsp;|&nbsp; NDA : 53 29 10261 29 &nbsp;|&nbsp; Organisme certifié Qualiopi
          </p>
          <p style="font-family: Arial, sans-serif; font-size: 11px; color: #9ca3af; margin: 0; line-height: 1.6;">
            Vous recevez cet email car votre entreprise correspond à notre domaine d'activité.
            Pour ne plus recevoir nos communications :
            <a href="${linkDesabo}" style="color: #6b7280; text-decoration: underline;">Se désabonner en un clic</a>
            &nbsp;·&nbsp;
            <a href="${mailDesabo}" style="color: #6b7280; text-decoration: underline;">Nous écrire directement</a>
          </p>
        </td>
      </tr>
    </table>
  `
}

// ─── Mise à jour mailing_sends en erreur (non bloquant) ──────────────────────
async function markSendError(sendId, message) {
  try {
    await supabase
      .from('mailing_sends')
      .update({ status: 'error', error_message: message.substring(0, 500) })
      .eq('id', sendId)
  } catch (e) {
    console.error('markSendError failed:', e.message)
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────
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

  const {
    send_id,           // uuid — ligne mailing_sends à mettre à jour
    to,                // email destinataire
    subject,           // objet de l'email
    body_html,         // corps HTML saisi dans l'éditeur (sans signature)
    caller,            // 'Hicham' | 'Maxime' | 'Marine'
    unsubscribe_token, // uuid — token unique pour ce destinataire
    attachments,       // [{ filename, base64, contentType }] optionnel
  } = req.body

  // ── Validation minimale ──
  if (!send_id || !to || !subject || !body_html || !unsubscribe_token) {
    return res.status(400).json({
      error: 'Paramètres manquants : send_id, to, subject, body_html, unsubscribe_token requis'
    })
  }

  // ── Signature ──
  const effectiveCaller = ['Hicham', 'Maxime', 'Marine'].includes(caller) ? caller : 'Marine'
  const sig = SIGNATURES[effectiveCaller]
  const senderEmail = sig.senderEmail

  // ── Construction HTML complet ──
  // wrapEmailHTML produit : <div>body + "Bien cordialement," + signature</div>
  // On injecte le footer désabonnement avant le </div> final
  const baseHTML = wrapEmailHTML(body_html, effectiveCaller)
  const footerHTML = buildUnsubscribeFooter(unsubscribe_token)
  // Injection robuste : remplace la DERNIÈRE occurrence de </div>
  const lastDivIdx = baseHTML.lastIndexOf('</div>')
  const fullHTML = lastDivIdx !== -1
    ? baseHTML.slice(0, lastDivIdx) + footerHTML + baseHTML.slice(lastDivIdx)
    : baseHTML + footerHTML

  let transporter = null

  try {
    // ── Config SMTP ──
    const emailConfig = await findSmtpConfig(senderEmail)
    if (!emailConfig) {
      await markSendError(send_id, 'Aucune configuration SMTP active trouvée')
      return res.status(400).json({ error: 'Config SMTP introuvable' })
    }

    const smtpPassword = decrypt(emailConfig.smtp_password_encrypted)

    function makeTransporter() {
      return nodemailer.createTransport({
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
    }

    transporter = makeTransporter()

    // ── Options email ──
    // Identifiant de message stable : permet de reconnaître une réponse directe
    // à ce mail (api/mailing-replies-cron.js) — les envois de test n'en ont pas
    const isRealSend = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(send_id))
    const messageId = isRealSend ? `<mailing-${String(send_id).toLowerCase()}@accessformation.pro>` : undefined

    const mailOptions = {
      ...(messageId ? { messageId } : {}),
      from: `"Access Formation" <${senderEmail}>`,
      sender: emailConfig.email,
      replyTo: `"Access Formation" <${senderEmail}>`,
      to,
      subject,
      html: fullHTML,
      attachments: [],
    }

    // Pièces jointes (base64 → Buffer)
    if (attachments && Array.isArray(attachments)) {
      for (const att of attachments) {
        if (att.base64 && att.filename) {
          mailOptions.attachments.push({
            filename: att.filename,
            content: Buffer.from(att.base64, 'base64'),
            contentType: att.contentType || 'application/octet-stream',
          })
        }
      }
    }

    // ── Envoi avec retry × 3 ──
    let lastError = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await transporter.verify()
        await transporter.sendMail(mailOptions)
        lastError = null
        break
      } catch (err) {
        lastError = err
        console.error(`Tentative ${attempt}/3 échouée (${to}):`, err.message)
        try { transporter.close() } catch {}
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, attempt * 3000))
          transporter = makeTransporter()
        }
      }
    }

    if (lastError) throw lastError

    try { transporter.close() } catch {}

    // ── Marquer comme envoyé ──
    await supabase
      .from('mailing_sends')
      .update({ status: 'sent', sent_at: new Date().toISOString(), ...(messageId ? { message_id: messageId } : {}) })
      .eq('id', send_id)

    return res.status(200).json({ success: true })

  } catch (error) {
    console.error(`Erreur envoi mailing → ${to}:`, error.message)
    try { if (transporter) transporter.close() } catch {}
    await markSendError(send_id, error.message)
    return res.status(500).json({ error: error.message })
  }
}
