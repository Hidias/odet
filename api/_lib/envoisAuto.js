// api/_lib/envoisAuto.js
// ─────────────────────────────────────────────────────────────────────────────
// Envoi automatique des relances de la file (0519, décisions de H du 16/11) : seuls les types passés en
// « automatique » par le super administrateur, texte seul (pas de pièce jointe), boîte par défaut de l'organisme.
//   - mode démonstration ou préversion : rien ne part et rien n'est marqué (la route le dit dans son résultat) ;
//   - chaque relance est réservée par la base (relance_auto_reserver, mêmes contrôles qu'un envoi à la main), puis
//     terminée sans auteur (relance_envoi_terminer de 0518) ;
//   - échec sûrement avant l'envoi : erreur notée, la relance repart au passage suivant ; résultat incertain : la
//     réservation reste et la relance n'est jamais reprise seule (comme à la main).
// ─────────────────────────────────────────────────────────────────────────────

import { getOrgForCompany, getSender } from './mailer.js'
import { internalMailer } from './internal.js'
import { mailDeRelance, envoiRedirige, echecAvantEnvoi } from '../relance-envoi.js'

export const ENVOIS_AUTO_PAR_PASSAGE = 30

// Résultat d'un envoi : 'envoyee', 'erreur' (rien n'est parti, repart au passage suivant) ou 'incertain'
export function issueEnvoi({ info, err, destinataire }) {
  if (err) return echecAvantEnvoi(err) ? 'erreur' : 'incertain'
  const refuse = (info?.rejected || []).map((x) => String(x?.address || x).toLowerCase()).includes(String(destinataire || '').toLowerCase())
  return refuse ? 'erreur' : 'envoyee'
}

export async function envoyerRelancesAuto(admin, { dry = false, budgetMs = 40000 } = {}) {
  const { data: ids, error } = await admin.rpc('relances_auto_a_envoyer', { p_limite: ENVOIS_AUTO_PAR_PASSAGE })
  if (error) throw error
  const liste = (ids || []).map((x) => (typeof x === 'string' ? x : x?.relances_auto_a_envoyer)).filter(Boolean)
  if (!liste.length) return { envoyees: 0, aEnvoyer: 0 }
  const orgDefaut = await getOrgForCompany(admin, null)
  if (envoiRedirige({ envoiReel: false }, orgDefaut)) return { envoyees: 0, aEnvoyer: liste.length, raison: 'Mode démonstration ou préversion : aucun envoi automatique' }
  if (dry) return { envoyees: 0, aEnvoyer: liste.length, simulation: true }
  const mailer = await internalMailer(admin)
  if (mailer.error) return { envoyees: 0, aEnvoyer: liste.length, raison: mailer.error }
  const sender = await getSender(admin, mailer.cfg.email)
  const debut = Date.now()
  const resultats = []
  try {
    for (const id of liste) {
      if (Date.now() - debut > budgetMs) break
      const { data: r, error: rErr } = await admin.rpc('relance_auto_reserver', { p_id: id })
      if (rErr) { resultats.push({ id, erreur: rErr.message }); continue }
      if (!r) continue
      const terminer = async (args) => {
        const appel = () => admin.rpc('relance_envoi_terminer', { p_id: id, p_auteur: null, ...args })
        let fin = await appel()
        if (fin.error) fin = await appel()
        return fin
      }
      const org = await getOrgForCompany(admin, r.company_id)
      const mail = mailDeRelance({ objet: r.objet, texte: r.texte }, sender, org)
      let info = null
      let err = null
      try {
        info = await mailer.transporter.sendMail({ from: mailer.from, to: r.destinataire, bcc: org.email_bcc || undefined, subject: mail.sujet, text: mail.texte, html: mail.html })
      } catch (e) { err = e }
      const issue = issueEnvoi({ info, err, destinataire: r.destinataire })
      if (issue === 'envoyee') {
        await terminer({ p_ok: true, p_message_id: info?.messageId || null, p_boite: mailer.cfg.email })
      } else if (issue === 'erreur') {
        await terminer({ p_ok: false, p_erreur: err ? String(err.message || 'Échec').slice(0, 300) : `Adresse refusée par le serveur : ${r.destinataire}` })
      }
      resultats.push({ id, kind: r.kind, issue })
    }
  } finally { try { mailer.transporter.close() } catch { /* rien */ } }
  return { envoyees: resultats.filter((x) => x.issue === 'envoyee').length, aEnvoyer: liste.length, resultats }
}
