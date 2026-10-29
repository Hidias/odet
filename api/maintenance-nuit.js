// api/maintenance-nuit.js
// Écritures automatiques de la nuit (migration 0376) : sessions passées « terminées », rappels du jour,
// alertes qualité (notes basses), statuts « due » et « en retard » des factures envoyées ; puis les relances à
// valider (0043, scheduled_actions_generate : préparées, jamais envoyées), les étapes des sessions (0160, pilote_generate)
// les purges RGPD à valider (0344, rgpd_purges_generer) et le point de la semaine (0407, point_semaine_generer).
// Toute la logique est dans la base (public.daily_maintenance, idempotente) ; cette route ne fait que la lancer.
//
// Déclenchée chaque nuit par la tâche planifiée Vercel (vercel.json, en-tête Authorization: Bearer CRON_SECRET),
// ou à la main par le super administrateur (POST, jeton de connexion).
// Réponse : le nombre de lignes traitées par catégorie, jamais de donnée personnelle.

import { getAdminClient, requireCronOrRole, SA } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'
import { withJobLog, purgerJournalTaches } from './_lib/taches.js'

export const config = { maxDuration: 60 }

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const ctx = await requireCronOrRole(req, res, SA)
  if (!ctx) return
  const admin = getAdminClient()
  // Chaque étape est indépendante (audit du 19/10 au soir) : une erreur dans l'une n'empêche plus les suivantes,
  // en particulier la préparation des relances. Les erreurs sont rendues dans la réponse et notées au journal des tâches.
  const erreurs = {}
  const { data, error } = await admin.rpc('daily_maintenance')
  if (error && !(error.code === 'PGRST202' || /daily_maintenance/.test(error.message || ''))) {
    erreurs.maintenance = error.code || 'erreur'
    console.error('[maintenance-nuit] maintenance', error.code || 'erreur')
  }
  // Relances préparées pour validation (lot 2, 0043) : rien n'est envoyé ; fonction absente = migration non appliquée
  let relances = null
  const { data: rel, error: relErr } = await admin.rpc('scheduled_actions_generate')
  if (!relErr) relances = rel
  else if (relErr.code !== 'PGRST202') { erreurs.relances = relErr.code || 'erreur'; console.error('[maintenance-nuit] relances', relErr.code || 'erreur') }
  // Contrats de maintenance (0460) : reconduction tacite, fin de préavis, information du particulier ; rien n'est envoyé
  let contrats = null
  const { data: ctr, error: ctrErr } = await admin.rpc('contrats_relances_generer')
  if (!ctrErr) contrats = ctr
  // Révisions de prix préparées 30 jours avant l'anniversaire (0462)
  const { data: rev, error: revErr } = await admin.rpc('contrats_revisions_generer')
  if (!revErr && contrats) contrats = { ...contrats, revisions: rev }
  if (revErr && revErr.code !== 'PGRST202') { erreurs.revisions = revErr.code || 'erreur'; console.error('[maintenance-nuit] revisions', revErr.code || 'erreur') }
  if (ctrErr && ctrErr.code !== 'PGRST202') { erreurs.contrats = ctrErr.code || 'erreur'; console.error('[maintenance-nuit] contrats', ctrErr.code || 'erreur') }
  // Impayés (0469) : relances graduées et mise en demeure préparées, avant le pilote (mêmes clés, celles-ci priment)
  let impayes = null
  const { data: imp, error: impErr } = await admin.rpc('impayes_generer')
  if (!impErr) impayes = imp
  else if (impErr.code !== 'PGRST202') { erreurs.impayes = impErr.code || 'erreur'; console.error('[maintenance-nuit] impayes', impErr.code || 'erreur') }
  // Étapes des sessions préparées pour validation (fonction 13, 0160) : rien n'est envoyé ; module inactif = rien
  let pilote = null
  const { data: pil, error: pilErr } = await admin.rpc('pilote_generate')
  if (!pilErr) pilote = pil
  else if (pilErr.code !== 'PGRST202') { erreurs.pilote = pilErr.code || 'erreur'; console.error('[maintenance-nuit] pilote', pilErr.code || 'erreur') }
  // Purges RGPD proposées pour validation (chantier F, 0344) : rien n'est supprimé sans une personne
  let purges = null
  const { data: pur, error: purErr } = await admin.rpc('rgpd_purges_generer')
  if (!purErr) purges = pur
  else if (purErr.code !== 'PGRST202') { erreurs.purges = purErr.code || 'erreur'; console.error('[maintenance-nuit] purges', purErr.code || 'erreur') }
  // Point de la semaine (0407) : le lundi le point, le vendredi le bilan, là où des destinataires sont choisis ;
  // préparé et signalé par une notification, jamais envoyé sans une personne
  let point = null
  const { data: pt, error: ptErr } = await admin.rpc('point_semaine_generer')
  if (!ptErr) point = pt
  else if (ptErr.code !== 'PGRST202') { erreurs.point = ptErr.code || 'erreur'; console.error('[maintenance-nuit] point', ptErr.code || 'erreur') }
  await purgerJournalTaches()
  const nbErreurs = Object.keys(erreurs).length
  // 500 si une étape a échoué : le journal des tâches la note « erreur » et le suivi des erreurs la reçoit
  return res.status(nbErreurs ? 500 : 200).json({ ok: !nbErreurs, resultat: data, relances, contrats, impayes, pilote, purges, point, ...(nbErreurs ? { error: `Étapes en erreur : ${Object.entries(erreurs).map(([k, v]) => `${k} (${v})`).join(', ')}` } : {}) })
}

export default withErrorLog(withJobLog(handler, 'maintenance-nuit'), 'maintenance-nuit')
