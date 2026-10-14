import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// Client serveur (clé service role : contourne la RLS, à n'utiliser qu'après vérification de l'appelant)
export function getAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définies')
  return createClient(url, key, { auth: { persistSession: false } })
}

// ─── Groupes de rôles ────────────────────────────────────────────────────────
// Rôles du personnel : superadmin, admin, direction, gestionnaire, formateur, commercial, comptable, lecture.
// Les rôles externes (entreprise, formateur_externe, stagiaire) ne figurent dans AUCUN groupe.
// « lecture » est en lecture seule ; un technicien de terrain a aussi le rôle « lecture » :
// toute route qui écrit ou envoie ne doit donc jamais autoriser « lecture ».
export const SA = ['superadmin']
export const ADMINS = ['superadmin', 'admin']
export const MANAGERS = [...ADMINS, 'direction', 'gestionnaire']
export const SALES = [...MANAGERS, 'commercial']
export const FINANCE = [...ADMINS, 'direction', 'comptable']
export const BILLING = [...SALES, 'comptable']
export const STAFF = [...MANAGERS, 'formateur', 'commercial', 'lecture']
/** Personnel de bureau (inclut « lecture » : à réserver aux routes de pure consultation) */
export const OFFICE = [...STAFF, 'comptable']
/** Personnel de bureau sans « lecture » : routes qui écrivent, envoient ou consomment un service payant */
export const OFFICE_WRITE = OFFICE.filter((r) => r !== 'lecture')

/** Compatibilité : ancien nom */
export const ADMIN_ROLES = ADMINS

// ─── Jeton porteur ───────────────────────────────────────────────────────────
function bearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

/** Comparaison à temps constant de deux chaînes (false si l'une est vide) */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8')
  const y = Buffer.from(String(b || ''), 'utf8')
  if (x.length === 0 || y.length === 0) return false
  if (x.length !== y.length) {
    // Comparaison factice pour ne pas révéler la longueur par le temps de réponse
    crypto.timingSafeEqual(x, x)
    return false
  }
  return crypto.timingSafeEqual(x, y)
}

/** true si la requête porte le secret des tâches planifiées (en-tête Authorization uniquement) */
export function hasCronSecret(req) {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return safeEqual(bearerToken(req), expected)
}

/**
 * Vérifie le jeton de l'utilisateur connecté (en-tête Authorization: Bearer <jwt>)
 * et retourne { user, profile, admin } ou null.
 */
export async function requireUser(req) {
  const token = bearerToken(req)
  if (!token) return null
  const admin = getAdminClient()
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) return null
  const { data: profile } = await admin.from('profiles').select('*').eq('id', data.user.id).maybeSingle()
  if (!profile || profile.is_active === false) return null
  return { user: data.user, profile, admin }
}

/**
 * Comme requireUser, mais exige un rôle parmi ceux fournis.
 * Répond 401/403 et retourne null si l'accès est refusé.
 */
export async function requireRole(req, res, roles) {
  const ctx = await requireUser(req)
  if (!ctx) {
    res.status(401).json({ error: 'Connexion requise' })
    return null
  }
  if (roles && roles.length > 0 && !roles.includes(ctx.profile.role)) {
    res.status(403).json({ error: 'Accès refusé pour ce rôle' })
    return null
  }
  return ctx
}

/**
 * Vérifie le secret des tâches planifiées : en-tête Authorization: Bearer <CRON_SECRET> uniquement
 * (plus de ?secret= dans l'adresse, qui finit dans les journaux). Refuse si CRON_SECRET n'est pas définie.
 */
export function requireCronSecret(req, res) {
  if (!hasCronSecret(req)) {
    res.status(401).json({ error: 'Secret invalide' })
    return false
  }
  return true
}

/**
 * Tâches planifiées lançables aussi à la main : accepte le CRON_SECRET (Vercel, Supabase, appel interne)
 * OU un utilisateur actif dont le rôle figure dans `roles`.
 * Retourne { cron: true } ou le contexte utilisateur ; null après avoir répondu 401/403 en cas de refus.
 */
export async function requireCronOrRole(req, res, roles) {
  if (hasCronSecret(req)) return { cron: true }
  return requireRole(req, res, roles)
}

/**
 * Conservé pour compatibilité, n'est plus utilisé par les routes : accepte le CRON_SECRET
 * ou n'importe quel utilisateur actif. Préférer requireCronOrRole.
 */
export async function requireCronOrUser(req, res) {
  if (hasCronSecret(req)) return { cron: true }
  const ctx = await requireUser(req)
  if (ctx) return ctx
  res.status(401).json({ error: 'Connexion requise' })
  return false
}

/**
 * Chemin de stockage sûr : relatif, sans « .. », sans barre oblique initiale ni caractère de contrôle,
 * et commençant par le préfixe attendu (ex. `${sessionId}/`).
 */
export function isSafeStoragePath(path, prefix) {
  const p = String(path || '')
  if (!p || p.length > 512) return false
  if (p.startsWith('/') || p.includes('\\') || /[\u0000-\u001f]/.test(p)) return false
  if (p.split('/').some((seg) => seg === '..' || seg === '.')) return false
  return prefix ? p.startsWith(prefix) : true
}
