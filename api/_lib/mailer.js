// ═══════════════════════════════════════════════════════════════
// api/_lib/mailer.js — Config SMTP partagée Access Campus
// ═══════════════════════════════════════════════════════════════
// Fichier dans _lib/ → Vercel ne le route PAS comme un endpoint API
// Import: import { getSupabaseAdmin, getMailer, sendWithRetry } from './_lib/mailer.js'

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import crypto from 'crypto'

// ─── Supabase Admin ──────────────────────────────────────────
export function getSupabaseAdmin() {
  return createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

// ─── Decrypt mot de passe SMTP ───────────────────────────────
export function decrypt(encryptedText) {
  const algorithm = 'aes-256-cbc'
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex')
  const [ivHex, encrypted] = encryptedText.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const decipher = crypto.createDecipheriv(algorithm, key, iv)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

// ─── Créer un transporter SMTP ───────────────────────────────
export function createTransporter(emailConfig, smtpPassword) {
  return nodemailer.createTransport({
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
}

// ─── Raccourci : config + transporter en un appel ────────────
/**
 * @param {object} supabase - Client Supabase admin
 * @param {string} userId - UUID utilisateur
 * @param {object} [options]
 * @param {string} [options.preferEmail] - Email à préférer si plusieurs configs
 * @returns {{ transporter, emailConfig, fromEmail, error }}
 */
export async function getMailer(supabase, userId, options = {}) {
  // Récupérer config(s) email
  const query = supabase
    .from('user_email_configs')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)

  const { data: configs, error: configError } = await query

  if (configError || !configs || configs.length === 0) {
    return { transporter: null, emailConfig: null, fromEmail: null, error: 'Config email non trouvée' }
  }

  // Sélectionner la bonne config
  let emailConfig = configs[0]
  if (options.preferEmail) {
    const preferred = configs.find(c => c.email === options.preferEmail)
    if (preferred) emailConfig = preferred
  }

  // Déchiffrer et créer le transporter
  const smtpPassword = decrypt(emailConfig.smtp_password_encrypted)
  const transporter = createTransporter(emailConfig, smtpPassword)

  return {
    transporter,
    emailConfig,
    fromEmail: emailConfig.email,
    error: null
  }
}

// ─── Envoi avec retry ────────────────────────────────────────
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Envoyer un email avec retry automatique
 * @param {object} transporter - Nodemailer transporter
 * @param {object} mailOptions - Options nodemailer (from, to, subject, html, attachments...)
 * @param {number} [maxRetries=3]
 * @returns {object} Info d'envoi nodemailer
 */
export async function sendWithRetry(transporter, mailOptions, maxRetries = 3) {
  let lastError = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📧 Tentative d'envoi ${attempt}/${maxRetries}`)
      // Pas de transporter.verify() : avec pool:false il ouvre une 2e connexion SMTP
      // redondante → saturation IONOS (421 max concurrent connections). sendMail() établit
      // la connexion lui-même, verify() ne sert qu'à doubler le nombre de connexions.
      const info = await transporter.sendMail(mailOptions)
      console.log('✅ Email envoyé:', info.messageId)
      return info
    } catch (error) {
      lastError = error
      console.error(`❌ Tentative ${attempt} échouée:`, error.message)

      try { transporter.close() } catch {}

      // 421 / 4.3.2 = saturation de connexions IONOS : réessayer ouvre encore plus de
      // connexions et aggrave le problème. On abandonne immédiatement.
      const isConnLimit = error?.responseCode === 421 || /concurrent|4\.3\.2|too many/i.test(error?.message || '')
      if (isConnLimit) { console.error('🚫 Limite de connexions SMTP atteinte — abandon sans retry'); break }

      if (attempt < maxRetries) {
        const waitTime = attempt * 2000
        console.log(`⏳ Attente ${waitTime}ms avant nouvelle tentative...`)
        await sleep(waitTime)
      }
    }
  }

  throw lastError
}

// ─── Signatures HTML Access Formation ────────────────────────
export const SIGNATURES = {
  Hicham: {
    name: 'Hicham SAIDI',
    title: 'Dirigeant associé',
    phone: '06 35 20 04 28',
    email: 'hicham.saidi@accessformation.pro',
    senderEmail: 'hicham.saidi@accessformation.pro',
  },
  Maxime: {
    name: 'Maxime LANGLAIS',
    title: 'Dirigeant associé',
    phone: '07 83 51 17 95',
    email: 'maxime.langlais@accessformation.pro',
    senderEmail: 'maxime.langlais@accessformation.pro',
  },
  Marine: {
    name: 'Marine',
    title: '',
    phone: '02 98 90 30 24',
    email: 'contact@accessformation.pro',
    senderEmail: 'entreprise@accessformation.pro',
  },
}

/**
 * Détermine le caller (Hicham/Maxime/Marine) depuis une adresse email
 */
export function getCallerByEmail(email) {
  if (email?.includes('hicham')) return 'Hicham'
  if (email?.includes('maxime')) return 'Maxime'
  return 'Marine'
}

/**
 * Génère le bloc HTML de signature
 */
export function buildSignatureHTML(caller, variant = 'standard') {
  const sig = SIGNATURES[caller] || SIGNATURES.Marine
  const chaudBanner = variant === 'chaud' ? `
    <table cellpadding="0" cellspacing="0" style="font-family: Arial, sans-serif; margin-bottom: 8px; border-collapse: collapse; width: 440px;">
      <tr>
        <td bgcolor="#fff7ed" style="background-color: #fff7ed; padding: 10px 18px; border-radius: 8px; border: 1px solid #fed7aa;">
          <p style="margin: 0; font-size: 13px; color: #9a3412; line-height: 1.5;">
            🔥 <strong>Nous avons bien noté votre besoin.</strong> Un de nos formateurs vous recontactera rapidement pour affiner les détails avec vous.
          </p>
        </td>
      </tr>
    </table>` : ''

  return `${chaudBanner}
    <table cellpadding="0" cellspacing="0" style="font-family: Arial, sans-serif; margin-top: 16px; border-collapse: collapse; width: 440px;">
      <tr>
        <td bgcolor="#1a2e3d" style="background-color: #1a2e3d; padding: 14px 18px; border-radius: 8px 8px 0 0;">
          <p style="margin: 0; font-size: 15px; font-weight: bold; color: #ffffff;">${sig.name}</p>
          ${sig.title ? `<p style="margin: 2px 0 0 0; font-size: 11px; color: rgba(255,255,255,0.7);">${sig.title}</p>` : ''}
        </td>
      </tr>
      <tr>
        <td bgcolor="#f8f9fa" style="background-color: #f8f9fa; padding: 12px 18px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
          <p style="margin: 0 0 4px 0; font-size: 13px; font-weight: bold; color: #1a2e3d;">ACCESS FORMATION</p>
          <p style="margin: 0 0 1px 0; font-size: 12px; color: #555;">📞 ${sig.phone} · ✉️ <a href="mailto:${sig.email}" style="color: #2563eb; text-decoration: none;">${sig.email}</a></p>
          <p style="margin: 0; font-size: 12px;">🌐 <a href="https://www.accessformation.pro" style="color: #2563eb; text-decoration: none;">www.accessformation.pro</a></p>
        </td>
      </tr>
      <tr>
        <td bgcolor="#c8993c" style="background-color: #c8993c; padding: 5px 18px; border-radius: 0 0 8px 8px;">
          <p style="margin: 0; font-size: 10px; color: #1a2e3d; font-weight: bold; text-transform: uppercase; letter-spacing: 1.2px; text-align: center;">Organisme de formation certifié Qualiopi</p>
        </td>
      </tr>
    </table>`
}

/**
 * Normalise les styles inline d'un body HTML pour compatibilité email.
 * (Outlook et clients email n'héritent pas les polices du parent)
 *
 * Étape 1 : supprime toute déclaration font-family existante dans les attributs
 *           style inline (évite qu'un copier-coller depuis Gmail/Word impose
 *           Georgia, Times New Roman, etc.)
 * Étape 2 : injecte font-family:Arial,sans-serif sur tous les <p>, <ul>, <li>
 *           qui n'en ont pas encore.
 */
function normalizeBodyStyles(body) {
  const P_STYLE  = 'font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;margin:0 0 10px 0;'
  const UL_STYLE = 'font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;margin:0 0 10px 0;padding-left:20px;'
  const LI_STYLE = 'font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;margin:0 0 4px 0;'

  // Si texte brut (pas de balises block HTML) → convertir les sauts de ligne en HTML
  if (!/<(p|div|h[1-6]|ul|ol|br)[\s>/]/i.test(body)) {
    body = body
      .split(/\n{2,}/)
      .map(para => para.trim())
      .filter(Boolean)
      .map(para => `<p style="${P_STYLE}">${para.replace(/\n/g, '<br>')}</p>`)
      .join('')
  }

  // Étape 1 — écraser toute font-family déjà présente dans un style="..."
  // (gère les espaces autour des : et les guillemets simples/doubles)
  let normalized = body.replace(
    /(<[^>]+style=["'][^"']*?)font-family\s*:[^;]+;?/gi,
    '$1'
  )

  // Étape 2 — injecter nos styles sur les balises sans style
  normalized = normalized
    // <p> sans style → injecter
    .replace(/<p(?![^>]*style=)([^>]*)>/gi, `<p style="${P_STYLE}"$1>`)
    // <p style="..."> existant (font-family déjà purgée) → préfixer
    .replace(/<p style="/gi, `<p style="font-family:Arial,sans-serif;`)
    // <ul> sans style → injecter
    .replace(/<ul(?![^>]*style=)([^>]*)>/gi, `<ul style="${UL_STYLE}"$1>`)
    // <li> sans style → injecter
    .replace(/<li(?![^>]*style=)([^>]*)>/gi, `<li style="${LI_STYLE}"$1>`)

  return normalized
}

/**
 * Wrap un body HTML avec "Bien cordialement," + signature
 */
export function wrapEmailHTML(body, caller, variant = 'standard') {
  const signature = buildSignatureHTML(caller, variant)
  const normalizedBody = normalizeBodyStyles(body || '')
  return `
    <div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333; max-width: 650px;">
      ${normalizedBody}
      <p style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;margin:16px 0 10px 0;">Bien cordialement,</p>
      ${signature}
    </div>
  `
}
