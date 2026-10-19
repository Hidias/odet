// api/maintenance-nuit.js
// Écritures automatiques de la nuit (migration 0376) : sessions passées « terminées », rappels du jour,
// alertes qualité (notes basses), statuts « due » et « en retard » des factures envoyées ; puis les relances à
// valider (0043, scheduled_actions_generate : préparées, jamais envoyées), et les étapes des sessions (0160, pilote_generate).
// Toute la logique est dans la base (public.daily_maintenance, idempotente) ; cette route ne fait que la lancer.
//
// Déclenchée chaque nuit par la tâche planifiée Vercel (vercel.json, en-tête Authorization: Bearer CRON_SECRET),
// ou à la main par le super administrateur (POST, jeton de connexion).
// Réponse : le nombre de lignes traitées par catégorie, jamais de donnée personnelle.

import { getAdminClient, requireCronOrRole, SA } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

export const config = { maxDuration: 60 }

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const ctx = await requireCronOrRole(req, res, SA)
  if (!ctx) return
  const admin = getAdminClient()
  const { data, error } = await admin.rpc('daily_maintenance')
  if (error) {
    // Fonction absente : migration 0376 pas encore appliquée, rien à faire (les pages d'avant s'en chargeaient)
    if (error.code === 'PGRST202' || /daily_maintenance/.test(error.message || '')) {
      return res.status(200).json({ ok: false, raison: 'migration 0376 non appliquée' })
    }
    throw new Error(`daily_maintenance : ${error.message}`)
  }
  // Relances préparées pour validation (lot 2, 0043) : rien n'est envoyé ; fonction absente = migration non appliquée
  let relances = null
  const { data: rel, error: relErr } = await admin.rpc('scheduled_actions_generate')
  if (!relErr) relances = rel
  else if (relErr.code !== 'PGRST202') console.error('[maintenance-nuit] relances', relErr.code || 'erreur')
  // Étapes des sessions préparées pour validation (fonction 13, 0160) : rien n'est envoyé ; module inactif = rien
  let pilote = null
  const { data: pil, error: pilErr } = await admin.rpc('pilote_generate')
  if (!pilErr) pilote = pil
  else if (pilErr.code !== 'PGRST202') console.error('[maintenance-nuit] pilote', pilErr.code || 'erreur')
  return res.status(200).json({ ok: true, resultat: data, relances, pilote })
}

export default withErrorLog(handler, 'maintenance-nuit')
