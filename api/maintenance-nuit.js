// api/maintenance-nuit.js
// Écritures automatiques de la nuit (migration 0376) : sessions passées « terminées », rappels du jour,
// alertes qualité (notes basses), statuts « due » et « en retard » des factures envoyées.
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
  return res.status(200).json({ ok: true, resultat: data })
}

export default withErrorLog(handler, 'maintenance-nuit')
