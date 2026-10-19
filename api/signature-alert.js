// api/signature-alert.js
// ─────────────────────────────────────────────────────────────────────────────
// Mail au formateur, 30 min avant la fin de sa journée, s'il manque des
// signatures sur la feuille d'émargement.
//
// Déclenché par Supabase (fonction SQL public.signature_tick, toutes les
// 15 min en journée) : Vercel n'est réveillé que s'il y a vraiment à dire.
// Une seule alerte par session et par jour (table signature_alerts_sent).
//
//   GET /api/signature-alert        → traite toutes les sessions concernées
//   POST /api/signature-alert?dry=1 → simulation, n'envoie aucun mail
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from './_lib/mailer.js'
import { requireCronOrRole, ADMINS } from './_lib/auth.js'
import { internalRecipients, internalMailer, appUrl } from './_lib/internal.js'
import { withErrorLog } from './_lib/errors.js'
import { withJobLog } from './_lib/taches.js'

export const config = { maxDuration: 60 }


const esc = (s) => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))

function buildHTML(session, { APP_URL, color, signature }) {
  const lignes = (session.manquants || []).map(m => `
    <tr>
      <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:14px;">${esc(m.stagiaire)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#6b7280;">${esc(m.demi_journee)}</td>
    </tr>`).join('')

  const nb = (session.manquants || []).length

  return `
  <div style="font-family:Arial,sans-serif;color:#111827;max-width:600px;">
    <p style="font-size:15px;">Bonjour${session.trainer_name ? ' ' + esc(session.trainer_name.split(' ')[0]) : ''},</p>

    <p style="font-size:15px;line-height:1.6;">
      Il reste <strong>${nb} signature${nb > 1 ? 's' : ''}</strong> à recueillir avant la fin de la journée
      sur la formation <strong>${esc(session.course || '')}</strong>${session.client ? ' — ' + esc(session.client) : ''}.
    </p>

    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:16px 0;border:1px solid #e5e7eb;border-radius:6px;">
      <tr style="background:#f9fafb;">
        <th style="text-align:left;padding:8px 10px;font-size:12px;color:#6b7280;text-transform:uppercase;">Stagiaire</th>
        <th style="text-align:left;padding:8px 10px;font-size:12px;color:#6b7280;text-transform:uppercase;">Demi-journée</th>
      </tr>
      ${lignes}
    </table>

    <p style="margin:20px 0;">
      <a href="${APP_URL}/#/signature/${session.session_id}"
         style="background:${color};color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">
        Faire signer maintenant
      </a>
    </p>

    <p style="font-size:13px;color:#6b7280;line-height:1.6;">
      Session ${esc(session.reference || '')} — fin prévue à ${esc(session.end_time || '')}.<br>
      Une signature peut encore être recueillie après coup, mais il est plus simple de le faire pendant que tout le monde est là.
    </p>

    <p style="font-size:12px;color:#9ca3af;margin-top:24px;">${esc(signature)}</p>
  </div>`
}

async function handler(req, res) {
  // Tâche planifiée (CRON_SECRET) ou lancement manuel par un administrateur
  if (!(await requireCronOrRole(req, res, ADMINS))) return

  const dry = !!req.query?.dry
  const supabase = getSupabaseAdmin()

  try {
    const { data: sessions, error } = await supabase.rpc('signature_alerts_due')
    if (error) throw error

    const liste = Array.isArray(sessions) ? sessions : []
    if (liste.length === 0) return res.status(200).json({ ok: true, envoyes: 0 })

    let mailer = null
    const resultats = []
    // Sans formateur joignable, l'alerte part aux dirigeants (Paramètres > Utilisateurs)
    const fallback = (await internalRecipients(supabase)).map(r => r.email).join(', ')

    for (const s of liste) {
      const destinataire = s.trainer_email || fallback
      try {
        if (dry) {
          resultats.push({ session: s.reference, destinataire, manquants: s.manquants?.length || 0, simulation: true })
          continue
        }

        if (!destinataire) throw new Error('Aucun destinataire (formateur sans email et aucun dirigeant)')
        if (!mailer) {
          mailer = await internalMailer(supabase)
          if (mailer.error) throw new Error(mailer.error)
        }

        await mailer.transporter.sendMail({
          from: mailer.from,
          to: destinataire,
          subject: `Émargement à compléter — ${s.course || 'formation'}${s.client ? ' (' + s.client + ')' : ''}`,
          html: buildHTML(s, { APP_URL: appUrl(req), color: mailer.org.brand_nav, signature: mailer.org.app_name || mailer.org.name || '' }),
        })

        await supabase.rpc('signature_alert_mark_sent', { p_session_id: s.session_id })
        resultats.push({ session: s.reference, destinataire, manquants: s.manquants?.length || 0, envoye: true })
      } catch (e) {
        console.error('[signature-alert]', s.reference, e.message)
        resultats.push({ session: s.reference, erreur: e.message })
      }
    }

    try { mailer?.transporter?.close() } catch { /* rien */ }

    return res.status(200).json({ ok: true, envoyes: resultats.filter(r => r.envoye).length, resultats })
  } catch (e) {
    console.error('[signature-alert] erreur globale:', e)
    return res.status(500).json({ error: e.message })
  }
}

export default withErrorLog(withJobLog(handler, 'signature-alert'), 'signature-alert')
