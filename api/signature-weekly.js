// api/signature-weekly.js
// ─────────────────────────────────────────────────────────────────────────────
// Récap du lundi : sessions terminées où il manque encore des signatures,
// regroupées par entreprise, avec le contact à rappeler.
//
// Déclenché par Supabase (public.signature_weekly_tick, lundi matin) :
// s'il n'y a rien à signaler, Vercel n'est pas réveillé.
//
//   GET /api/signature-weekly         → envoie le récap
//   POST /api/signature-weekly?dry=1  → simulation, renvoie le contenu sans l'envoyer
// ─────────────────────────────────────────────────────────────────────────────

import nodemailer from 'nodemailer'
import { getSupabaseAdmin, decrypt } from './_lib/mailer.js'

export const config = { maxDuration: 60 }

const APP_URL = process.env.APP_URL || 'https://app.accessformation.pro'
const RECIPIENT = 'hicham.saidi@accessformation.pro'

const esc = (s) => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
const fmtDate = (d) => {
  if (!d) return ''
  const [y, m, j] = String(d).substring(0, 10).split('-')
  return `${j}/${m}/${y}`
}

function buildHTML(groupes) {
  const nbSessions = groupes.reduce((n, g) => n + (g.sessions?.length || 0), 0)

  const blocs = groupes.map(g => {
    const sessions = (g.sessions || []).map(s => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;">
          ${esc(s.course || '')}<br>
          <span style="color:#9ca3af;font-size:12px;">${esc(s.reference || '')} — ${fmtDate(s.start_date)}${s.end_date !== s.start_date ? ' au ' + fmtDate(s.end_date) : ''}</span>
        </td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;text-align:right;white-space:nowrap;">
          <a href="${APP_URL}/#/signature/${s.session_id}" style="color:#0F2D35;font-weight:bold;text-decoration:none;">Faire signer</a>
        </td>
      </tr>`).join('')

    const contact = [g.contact, g.contact_email, g.contact_phone].filter(Boolean).map(esc).join(' — ')

    return `
      <div style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:14px;overflow:hidden;">
        <div style="background:#f9fafb;padding:10px 12px;">
          <strong style="font-size:15px;">${esc(g.client || 'Sans client')}</strong>
          ${contact ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${contact}</div>` : ''}
        </div>
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${sessions}</table>
      </div>`
  }).join('')

  return `
  <div style="font-family:Arial,sans-serif;color:#111827;max-width:640px;">
    <p style="font-size:15px;">Bonjour Hicham,</p>
    <p style="font-size:15px;line-height:1.6;">
      ${nbSessions} session${nbSessions > 1 ? 's' : ''} terminée${nbSessions > 1 ? 's' : ''}
      ${nbSessions > 1 ? 'comportent' : 'comporte'} encore des signatures manquantes,
      chez ${groupes.length} entreprise${groupes.length > 1 ? 's' : ''}.
    </p>
    ${blocs}
    <p style="font-size:13px;color:#6b7280;line-height:1.6;">
      Les signatures peuvent être régularisées depuis ton compte, sans limite de temps :
      ouvre la session, bouton « Faire signer », puis choisis la demi-journée concernée.
      L'heure réelle de signature est conservée en base.
    </p>
    <p style="font-size:12px;color:#9ca3af;margin-top:24px;">Access Campus — récap du lundi</p>
  </div>`
}

export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers?.authorization || ''
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Non autorisé' })
    }
  }

  const dry = !!req.query?.dry
  const supabase = getSupabaseAdmin()

  try {
    const { data, error } = await supabase.rpc('signature_weekly_report')
    if (error) throw error

    const groupes = Array.isArray(data) ? data : []
    if (groupes.length === 0) return res.status(200).json({ ok: true, envoye: false, raison: 'rien à signaler' })

    const html = buildHTML(groupes)
    if (dry) return res.status(200).json({ ok: true, envoye: false, entreprises: groupes.length, html })

    const { data: configs } = await supabase
      .from('user_email_configs')
      .select('*')
      .eq('is_active', true)

    if (!configs || configs.length === 0) throw new Error('Aucune configuration email active')

    const cfg =
      configs.find(c => c.email === RECIPIENT) ||
      configs.find(c => c.email === 'contact@accessformation.pro') ||
      configs[0]

    const transporter = nodemailer.createTransport({
      host: cfg.smtp_host,
      port: cfg.smtp_port,
      secure: cfg.smtp_secure,
      auth: { user: cfg.email, pass: decrypt(cfg.smtp_password_encrypted) },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    })

    await transporter.sendMail({
      from: `"Access Campus" <${cfg.email}>`,
      to: RECIPIENT,
      subject: `Signatures manquantes — ${groupes.length} entreprise${groupes.length > 1 ? 's' : ''} à relancer`,
      html,
    })
    transporter.close()

    return res.status(200).json({ ok: true, envoye: true, entreprises: groupes.length })
  } catch (e) {
    console.error('[signature-weekly] erreur:', e)
    return res.status(500).json({ error: e.message })
  }
}
