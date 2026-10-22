// api/relances-circuit.js
// ─────────────────────────────────────────────────────────────────────────────
// Relances du client pendant le circuit devis signé → session (0437, décision de H du 22/10) :
//   - participants non saisis à 10 jours de la formation ;
//   - convention non signée à 7 jours.
// Une relance par session et par objet (table circuit_relances). Message au contact du client, organisme en copie
// cachée, sans lien (le client retrouve son espace avec son adresse et son code habituels). Le mode démonstration
// de l'organisme redirige les envois vers l'adresse de test.
//
//   GET  /api/relances-circuit        → tâche planifiée (CRON_SECRET) ou administrateur
//   GET  /api/relances-circuit?dry=1  → simulation, n'envoie rien
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin, buildSignatureHTML } from './_lib/mailer.js'
import { requireCronOrRole, ADMINS } from './_lib/auth.js'
import { internalMailer } from './_lib/internal.js'
import { withErrorLog } from './_lib/errors.js'
import { withJobLog } from './_lib/taches.js'

export const config = { maxDuration: 60 }

const esc = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
const dateFr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '')

export function texteRelance(r, orgName) {
  const quand = `${dateFr(r.start_date)}${r.start_time ? ` à ${String(r.start_time).slice(0, 5).replace(':', 'h')}` : ''}`
  const bonjour = r.contact_name ? `Bonjour ${r.contact_name},` : 'Bonjour,'
  if (r.kind === 'participants') {
    return {
      sujet: `Participants à indiquer : ${r.course || 'votre formation'} du ${dateFr(r.start_date)}`,
      corps: `${bonjour}\n\nLa formation « ${r.course || ''} » approche : elle a lieu le ${quand}.\n\nPour préparer la convention et les convocations, merci d'indiquer vos participants dans votre espace client${orgName ? ` ${orgName}` : ''} (nom et prénom suffisent : chacun complétera ses informations lui-même). Vous y accédez avec l'adresse et le code habituels.\n\nNous restons à votre disposition pour toute question.`,
    }
  }
  return {
    sujet: `Convention à signer : ${r.course || 'votre formation'} du ${dateFr(r.start_date)}`,
    corps: `${bonjour}\n\nLa formation « ${r.course || ''} » a lieu le ${quand}. La convention de formation n'est pas encore signée.\n\nVous pouvez la signer en ligne dans votre espace client, ou l'imprimer, la signer et la déposer au même endroit. Vous y accédez avec l'adresse et le code habituels.\n\nNous restons à votre disposition pour toute question.`,
  }
}

async function handler(req, res) {
  if (!(await requireCronOrRole(req, res, ADMINS))) return
  const dry = !!req.query?.dry
  const supabase = getSupabaseAdmin()
  try {
    const { data, error } = await supabase.rpc('circuit_relances_dues')
    if (error) throw error
    const liste = Array.isArray(data) ? data : []
    if (!liste.length) return res.status(200).json({ ok: true, envoyes: 0 })
    let mailer = null
    const resultats = []
    for (const r of liste) {
      try {
        if (!mailer) {
          mailer = await internalMailer(supabase)
          if (mailer.error) throw new Error(mailer.error)
        }
        const { sujet, corps } = texteRelance(r, mailer.org.name || '')
        if (dry) { resultats.push({ session: r.reference, kind: r.kind, destinataire: r.email, sujet, simulation: true }); continue }
        await mailer.transporter.sendMail({
          from: mailer.from,
          to: r.email,
          bcc: mailer.org.email_bcc || undefined,
          subject: sujet,
          text: corps,
          html: `${esc(corps).replace(/\n/g, '<br>')}<br><br><p style="margin:0;">Bien cordialement,</p>${buildSignatureHTML({ name: mailer.org.name || '', email: mailer.cfg.email }, mailer.org)}`,
        })
        await supabase.rpc('circuit_relance_marquer', { p_session: r.session_id, p_kind: r.kind, p_to: r.email })
        resultats.push({ session: r.reference, kind: r.kind, envoye: true })
      } catch (e) {
        console.error('[relances-circuit]', r.reference, e.message)
        resultats.push({ session: r.reference, kind: r.kind, erreur: e.message })
      }
    }
    try { mailer?.transporter?.close() } catch { /* rien */ }
    return res.status(200).json({ ok: true, envoyes: resultats.filter((x) => x.envoye).length, resultats })
  } catch (e) {
    console.error('[relances-circuit] erreur globale :', e)
    return res.status(500).json({ error: e.message })
  }
}

export default withErrorLog(withJobLog(handler, 'relances-circuit'), 'relances-circuit')
