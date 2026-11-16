// api/relances-circuit.js
// ─────────────────────────────────────────────────────────────────────────────
// Relances du client pendant le circuit devis signé → session (0437, décision de H du 22/10) :
//   - participants non saisis à 10 jours de la formation ;
//   - convention non signée à 7 jours.
// Depuis 0519 (décision de H du 16/11) : la relance est préparée dans la file « Relances à valider » (une par session
// et par objet), puis validée et envoyée depuis l'outil ; écartée par la base si la situation se règle avant. Réglage
// « fermé » : rien n'est préparé. Réglage « automatique » : elle part seule, avec les autres relances de la file
// passées en automatique (envoyerRelancesAuto, boîte par défaut de l'organisme, jamais en mode démonstration).
//
//   GET  /api/relances-circuit        → tâche planifiée (CRON_SECRET) ou administrateur
//   GET  /api/relances-circuit?dry=1  → simulation, ne prépare ni n'envoie rien
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin, getOrgForCompany } from './_lib/mailer.js'
import { requireCronOrRole, ADMINS } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'
import { withJobLog } from './_lib/taches.js'
import { envoyerRelancesAuto } from './_lib/envoisAuto.js'
import { nomPourAppel } from '../src/core/nomPersonne.js'

export const config = { maxDuration: 60 }

const dateFr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '')

export function texteRelance(r, orgName) {
  const quand = `${dateFr(r.start_date)}${r.start_time ? ` à ${String(r.start_time).slice(0, 5).replace(':', 'h')}` : ''}`
  const bonjour = r.contact_name ? `Bonjour ${nomPourAppel(r.contact_name)},` : 'Bonjour,'
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
    const preparees = []
    const noms = new Map()
    for (const r of liste) {
      try {
        if (!noms.has(r.company_id)) noms.set(r.company_id, (await getOrgForCompany(supabase, r.company_id))?.name || '')
        const { sujet, corps } = texteRelance(r, noms.get(r.company_id))
        if (dry) { preparees.push({ session: r.reference, kind: r.kind, destinataire: r.email, sujet, simulation: true }); continue }
        const { data: id, error: pErr } = await supabase.rpc('circuit_relance_preparer', { p_session: r.session_id, p_kind: r.kind, p_destinataire: r.email, p_objet: sujet, p_texte: corps })
        if (pErr) throw pErr
        preparees.push({ session: r.reference, kind: r.kind, preparee: !!id })
      } catch (e) {
        console.error('[relances-circuit]', r.reference, e.message)
        preparees.push({ session: r.reference, kind: r.kind, erreur: e.message })
      }
    }
    let ecartees = 0
    if (!dry) {
      const { data: n, error: eErr } = await supabase.rpc('circuit_relances_ecarter')
      if (eErr) throw eErr
      ecartees = n || 0
    }
    const auto = await envoyerRelancesAuto(supabase, { dry })
    return res.status(200).json({ ok: true, preparees: preparees.filter((x) => x.preparee).length, ecartees, auto, resultats: preparees })
  } catch (e) {
    console.error('[relances-circuit] erreur globale :', e)
    return res.status(500).json({ error: e.message })
  }
}

export default withErrorLog(withJobLog(handler, 'relances-circuit'), 'relances-circuit')
