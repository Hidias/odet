// api/push.js
// Alertes sur le téléphone (0411), côté personne connectée :
//  - cle : clé publique de l'instance ; à la toute première activation, le super administrateur la fait créer
//    (paire de clés générée ici, clé privée chiffrée en base, jamais renvoyée) ;
//  - tester : envoie une alerte d'essai aux appareils de la personne seulement.
// Aucun service payant : les alertes passent par le service gratuit du navigateur (Chrome, Safari, Firefox).

import webpush from 'web-push'
import { requireUser, getAdminClient } from './_lib/auth.js'
import { encrypt, decrypt, getOrg } from './_lib/mailer.js'
import { withErrorLog } from './_lib/errors.js'

export async function clesVapid(admin) {
  const { data } = await admin.from('push_keys').select('public_key, private_key_enc, subject').eq('id', 1).maybeSingle()
  if (!data) return null
  return { publicKey: data.public_key, privateKey: decrypt(data.private_key_enc), subject: data.subject }
}

export async function envoyerA(admin, cles, appareil, charge) {
  webpush.setVapidDetails(cles.subject || 'mailto:contact@example.com', cles.publicKey, cles.privateKey)
  try {
    await webpush.sendNotification({ endpoint: appareil.endpoint, keys: { p256dh: appareil.p256dh, auth: appareil.auth } }, JSON.stringify(charge), { TTL: 6 * 3600, urgency: 'normal' })
    await admin.from('push_subscriptions').update({ last_ok_at: new Date().toISOString(), failures: 0 }).eq('id', appareil.id)
    return true
  } catch (e) {
    // Appareil désinscrit ou abonnement expiré : retiré ; autre erreur : compté, retiré après 5 échecs
    if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from('push_subscriptions').delete().eq('id', appareil.id)
    else {
      const n = (appareil.failures || 0) + 1
      if (n >= 5) await admin.from('push_subscriptions').delete().eq('id', appareil.id)
      else await admin.from('push_subscriptions').update({ failures: n }).eq('id', appareil.id)
    }
    return false
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const ctx = await requireUser(req)
  if (!ctx || ctx.profile.role === 'entreprise') return res.status(403).json({ error: 'Accès refusé' })
  const admin = getAdminClient()
  const { action } = req.body || {}

  if (action === 'cle') {
    let cles = await clesVapid(admin)
    if (!cles) {
      if (ctx.profile.role !== 'superadmin') return res.status(400).json({ error: 'Les alertes ne sont pas encore activées sur cette instance : le super administrateur les active une première fois.' })
      const k = webpush.generateVAPIDKeys()
      const org = await getOrg(admin)
      const subject = `mailto:${org.email || ctx.profile.email}`
      const { error } = await admin.from('push_keys').insert({ id: 1, public_key: k.publicKey, private_key_enc: encrypt(k.privateKey), subject, created_by: ctx.user.id })
      if (error && !/duplicate/i.test(error.message)) return res.status(500).json({ error: 'Activation impossible' })
      cles = await clesVapid(admin)
    }
    return res.status(200).json({ publicKey: cles.publicKey })
  }

  if (action === 'tester') {
    // Délai facultatif (20 s au plus) : laisse le temps de fermer l'application pour un essai téléphone verrouillé
    const delai = Math.min(Math.max(Number(req.body?.delai) || 0, 0), 20)
    if (delai) await new Promise((r) => setTimeout(r, delai * 1000))
    const cles = await clesVapid(admin)
    if (!cles) return res.status(400).json({ error: 'Alertes non activées' })
    const { data: appareils } = await admin.from('push_subscriptions').select('*').eq('profile_id', ctx.user.id)
    if (!appareils?.length) return res.status(400).json({ error: 'Aucun appareil activé pour votre compte' })
    let ok = 0
    for (const a of appareils) {
      if (await envoyerA(admin, cles, a, delai ? { title: 'Alerte d\'essai', body: 'Les alertes arrivent bien sur cet appareil.', url: '/' } : { title: 'Alertes activées', body: 'Vous recevrez ici les notifications importantes, jamais entre 21 h et 7 h 30.', url: '/' })) ok += 1
    }
    return res.status(200).json({ envoyes: ok, appareils: appareils.length })
  }

  return res.status(400).json({ error: 'Action inconnue' })
}

export default withErrorLog(handler, 'push')
