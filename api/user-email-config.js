// api/user-email-config.js
// Comptes email d'envoi de l'utilisateur connecté : lecture, test de connexion, enregistrement, suppression.
// Le serveur SMTP est fourni par l'utilisateur (hôte, port, sécurité) ; le mot de passe est chiffré en base.

import nodemailer from 'nodemailer'
import { getSupabaseAdmin, encrypt } from './_lib/mailer.js'
import { requireRight, OFFICE_WRITE } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

const supabase = getSupabaseAdmin()

// Préréglages courants ; l'utilisateur peut saisir n'importe quel serveur
export const SMTP_PRESETS = {
  'ionos-basic': { smtp_host: 'smtp.ionos.fr', smtp_port: 587, smtp_secure: false, imap_host: 'imap.ionos.fr' },
  'ionos-exchange': { smtp_host: 'smtp.exchange.ionos.eu', smtp_port: 587, smtp_secure: false, imap_host: 'exchange.ionos.eu' },
  ovh: { smtp_host: 'ssl0.ovh.net', smtp_port: 587, smtp_secure: false, imap_host: 'ssl0.ovh.net' },
  gmail: { smtp_host: 'smtp.gmail.com', smtp_port: 587, smtp_secure: false, imap_host: 'imap.gmail.com' },
  outlook: { smtp_host: 'smtp.office365.com', smtp_port: 587, smtp_secure: false, imap_host: 'outlook.office365.com' },
  orange: { smtp_host: 'smtp.orange.fr', smtp_port: 465, smtp_secure: true, imap_host: 'imap.orange.fr' },
}

function smtpSettings(body, existing) {
  const preset = body.preset ? SMTP_PRESETS[body.preset] : null
  return {
    smtp_host: body.smtpHost || preset?.smtp_host || existing?.smtp_host || '',
    smtp_port: Number(body.smtpPort || preset?.smtp_port || existing?.smtp_port || 587),
    smtp_secure: typeof body.smtpSecure === 'boolean' ? body.smtpSecure : (preset?.smtp_secure ?? existing?.smtp_secure ?? false),
    imap_host: body.imapHost || preset?.imap_host || existing?.imap_host || null,
  }
}

async function handler(req, res) {
  // Personnel qui envoie des emails : les rôles externes et « lecture » (dont les techniciens de terrain) n'ont pas de boîte
  const ctx = await requireRight(req, res, 'organisation.preferences.gerer', OFFICE_WRITE, OFFICE_WRITE)
  if (!ctx) return
  const userId = ctx.user.id
  const { method } = req

  try {
    if (method === 'GET') {
      const { data, error } = await supabase
        .from('user_email_configs')
        .select('id, user_id, email, smtp_host, smtp_port, smtp_secure, imap_host, is_active, last_tested_at')
        .eq('user_id', userId)
        .order('email')
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ data: data?.[0] || null, configs: data || [], presets: SMTP_PRESETS })
    }

    if (method === 'POST') {
      const { email, password: motDePasse, signatureImage, testConnection } = req.body || {}
      if (!email) return res.status(400).json({ error: 'Adresse email requise' })
      const cleanEmail = String(email).trim().toLowerCase()

      const { data: existing } = await supabase
        .from('user_email_configs').select('*').eq('user_id', userId).eq('email', cleanEmail).maybeSingle()
      const smtp = smtpSettings(req.body || {}, existing)
      if (!smtp.smtp_host) return res.status(400).json({ error: 'Serveur SMTP requis' })
      // Gmail : le mot de passe d'application s'affiche en 4 blocs séparés par des espaces ; collé tel quel, il est
      // refusé (535 BadCredentials). Il ne contient jamais d'espace : on les retire.
      const password = /(^|\.)gmail\.com$|(^|\.)googlemail\.com$/i.test(smtp.smtp_host) && motDePasse
        ? String(motDePasse).replace(/\s+/g, '') : motDePasse

      if (testConnection) {
        if (!password) return res.status(400).json({ error: 'Mot de passe requis pour tester' })
        const transporter = nodemailer.createTransport({
          host: smtp.smtp_host, port: smtp.smtp_port, secure: smtp.smtp_secure,
          auth: { user: cleanEmail, pass: password },
          tls: { rejectUnauthorized: false }, connectionTimeout: 10000, greetingTimeout: 10000,
        })
        try {
          await transporter.verify()
          return res.status(200).json({ success: true, message: 'Connexion SMTP réussie' })
        } catch (error) {
          const gmail = /gmail\.com$/i.test(smtp.smtp_host) && /535|BadCredentials|Username and Password not accepted/i.test(error.message || '')
          return res.status(400).json({ success: false, error: gmail
            ? 'Gmail refuse la connexion : utilisez un mot de passe d\'application (validation en deux étapes activée, puis compte Google › Sécurité › Mots de passe des applications), pas le mot de passe habituel du compte.'
            : `SMTP : ${error.message}` })
        } finally {
          try { transporter.close() } catch {}
        }
      }

      const payload = {
        email: cleanEmail,
        ...smtp,
        signature_image: signatureImage || null,
        is_active: true,
        last_tested_at: new Date().toISOString(),
      }
      if (password) payload.smtp_password_encrypted = encrypt(password)

      if (existing) {
        const { error } = await supabase.from('user_email_configs').update(payload).eq('id', existing.id)
        if (error) throw error
      } else {
        if (!password) return res.status(400).json({ error: 'Mot de passe requis pour un nouveau compte' })
        const { error } = await supabase.from('user_email_configs').insert([{ user_id: userId, ...payload }])
        if (error) throw error
      }
      return res.status(200).json({ success: true, message: 'Configuration enregistrée' })
    }

    if (method === 'DELETE') {
      const email = String(req.query?.email || '').trim().toLowerCase()
      let q = supabase.from('user_email_configs').delete().eq('user_id', userId)
      if (email) q = q.eq('email', email)
      const { error } = await q
      if (error) throw error
      return res.status(200).json({ success: true, message: 'Configuration supprimée' })
    }

    return res.status(405).json({ error: 'Méthode non autorisée' })
  } catch (error) {
    console.error('user-email-config :', error.message)
    return res.status(500).json({ error: error.message })
  }
}

export default withErrorLog(handler, 'user-email-config')
