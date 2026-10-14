// api/_lib/safeFetch.js
// Récupération d'une page web externe en refusant les adresses internes (protection SSRF) :
// http/https uniquement, hôte résolu par DNS et refusé s'il pointe vers une IP privée ou locale,
// redirections suivies à la main (3 au plus) avec la même vérification à chaque étape.

import dns from 'dns'
import net from 'net'

const MAX_REDIRECTS = 3

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0
}

function inV4(ip, base, bits) {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask)
}

/** true si l'adresse IP est privée, locale, de bouclage, lien-local ou non routable */
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    return (
      inV4(ip, '0.0.0.0', 8) ||
      inV4(ip, '10.0.0.0', 8) ||
      inV4(ip, '100.64.0.0', 10) ||
      inV4(ip, '127.0.0.0', 8) ||
      inV4(ip, '169.254.0.0', 16) ||
      inV4(ip, '172.16.0.0', 12) ||
      inV4(ip, '192.168.0.0', 16) ||
      inV4(ip, '224.0.0.0', 4) ||
      inV4(ip, '240.0.0.0', 4)
    )
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase()
    if (low === '::1' || low === '::') return true
    // Adresse IPv4 encapsulée (::ffff:a.b.c.d)
    const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateIp(mapped[1])
    const first = parseInt(low.split(':')[0] || '0', 16)
    if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 (adresses uniques locales)
    if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 (lien-local)
    if ((first & 0xff00) === 0xff00) return true // ff00::/8 (multidiffusion)
    return false
  }
  return true
}

/** Vérifie qu'une URL est publique ; lève une erreur explicite sinon */
export async function assertPublicUrl(rawUrl) {
  let u
  try { u = new URL(rawUrl) } catch { throw new Error('Adresse invalide') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Seules les adresses http et https sont acceptées')
  if (u.username || u.password) throw new Error('Adresse avec identifiants refusée')
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Hôte non autorisé')
  }
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.promises.lookup(host, { all: true, verbatim: true })
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('Hôte non autorisé (adresse interne)')
  return u
}

/**
 * fetch() vers une adresse publique, redirections revérifiées une à une.
 * Même valeur de retour que fetch (Response de la dernière étape).
 */
export async function safeFetch(rawUrl, init = {}) {
  let current = rawUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertPublicUrl(current)
    const response = await fetch(u.toString(), { ...init, redirect: 'manual' })
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), u).toString()
      continue
    }
    return response
  }
  throw new Error('Trop de redirections')
}
