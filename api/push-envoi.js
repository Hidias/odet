// api/push-envoi.js
// Envoi des alertes en attente (0411). Appelée par la base (public.push_tick, chaque minute, seulement s'il y a des
// alertes en attente, un appareil et hors des heures calmes), ou à la main par le super administrateur.
// Une alerte par appareil et par passage : plusieurs notifications d'un coup sont regroupées en une seule.

import { requireCronOrRole, getAdminClient, SA } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'
import { withJobLog } from './_lib/taches.js'
import { clesVapid, envoyerA } from './push.js'

export const config = { maxDuration: 60 }
const court = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ''))

export function chargeAlerte(liste) {
  if (liste.length === 1) {
    const n = liste[0]
    return { title: court(n.title, 80), body: court(n.message, 180), url: n.link || '/', tag: `n-${n.id}` }
  }
  return {
    title: `${liste.length} nouvelles alertes`,
    body: court(liste.slice(0, 3).map((n) => n.title).join(' · ') + (liste.length > 3 ? '…' : ''), 180),
    url: '/',
    tag: 'groupe',
  }
}

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const ctx = await requireCronOrRole(req, res, SA)
  if (!ctx) return
  const admin = getAdminClient()
  const cles = await clesVapid(admin)
  if (!cles) return res.status(200).json({ ok: true, envoyes: 0, raison: 'alertes non activées' })
  const { data, error } = await admin.rpc('push_a_envoyer')
  if (error) return res.status(500).json({ error: error.code || 'erreur' })
  let envoyes = 0
  for (const a of data?.appareils || []) {
    if (await envoyerA(admin, cles, a, chargeAlerte(a.notifications || []))) envoyes += 1
  }
  return res.status(200).json({ ok: true, notifications: data?.notifications || 0, envoyes })
}

export default withErrorLog(withJobLog(handler, 'push-envoi'), 'push-envoi')
