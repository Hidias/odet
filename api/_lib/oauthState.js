// api/_lib/oauthState.js
// Paramètre `state` des flux OAuth (Google, LinkedIn, Meta), signé HMAC-SHA256.
// Contenu : identifiant de l'utilisateur qui lance la connexion, plateforme, expiration (10 min), aléa.
// Clé : OAUTH_STATE_SECRET, sinon CRON_SECRET. Sans clé, aucun flux ne peut démarrer.

import crypto from 'crypto'
import { getAdminClient, safeEqual, ADMINS } from './auth.js'

const TTL_MS = 10 * 60 * 1000

function stateKey() {
  return process.env.OAUTH_STATE_SECRET || process.env.CRON_SECRET || ''
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')

function sign(payload) {
  return b64url(crypto.createHmac('sha256', stateKey()).update(payload).digest())
}

/** Produit un state signé pour `userId` et `platform`. Lève une erreur si aucune clé n'est définie. */
export function createOAuthState(userId, platform) {
  if (!stateKey()) throw new Error('OAUTH_STATE_SECRET (ou CRON_SECRET) non définie')
  const payload = b64url(JSON.stringify({ u: userId, p: platform, e: Date.now() + TTL_MS, n: b64url(crypto.randomBytes(9)) }))
  return `${payload}.${sign(payload)}`
}

/**
 * Vérifie le state reçu au retour du fournisseur : signature, plateforme, expiration,
 * et que l'utilisateur est toujours un administrateur actif.
 * Retourne { userId } ou { error }.
 */
export async function verifyOAuthState(state, platform) {
  if (!stateKey()) return { error: 'state_key_missing' }
  const [payload, sig] = String(state || '').split('.')
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return { error: 'invalid_state' }
  let data
  try { data = JSON.parse(fromB64url(payload).toString('utf8')) } catch { return { error: 'invalid_state' } }
  if (!data?.u || data.p !== platform) return { error: 'invalid_state' }
  if (!Number.isFinite(data.e) || data.e < Date.now()) return { error: 'expired_state' }
  const { data: profile } = await getAdminClient().from('profiles').select('id, role, is_active').eq('id', data.u).maybeSingle()
  if (!profile || profile.is_active === false || !ADMINS.includes(profile.role)) return { error: 'forbidden' }
  return { userId: data.u }
}

/** Redirection vers l'écran Réseaux sociaux, chaque valeur étant encodée */
export function socialRedirect(appUrl, params) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v).slice(0, 200))}`)
    .join('&')
  return `${appUrl}/#/social?${qs}`
}
