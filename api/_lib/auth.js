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

// ─── Droits composés (C1b) ───────────────────────────────────────────────────
/**
 * Droits du compte appelant dans sa société courante, calculés par la base (fonction my_rights, la même que
 * l'écran). L'appel part avec le jeton de l'utilisateur : la base voit l'utilisateur, pas la clé serveur.
 * L'en-tête x-company-id éventuel est transmis (la base le contrôle). Retourne un tableau de codes, ou null si
 * les droits sont inconnus (fonction absente, erreur) : l'appelant retombe alors sur les rôles.
 */
/**
 * Client Supabase au nom de l'appelant (sa session, sa société) : les règles de la base s'appliquent.
 * Sert à vérifier qu'il voit bien la ligne qu'il demande de traiter avant toute écriture par le client serveur.
 */
export function clientDeLAppelant(req) {
  const token = bearerToken(req)
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const apikey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!token || !url || !apikey) return null
  const headers = { Authorization: `Bearer ${token}` }
  const societe = req.headers?.['x-company-id']
  if (typeof societe === 'string' && /^[0-9a-f-]{36}$/i.test(societe)) headers['x-company-id'] = societe
  return createClient(url, apikey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers } })
}

export async function droitsDeLAppelant(req) {
  const token = bearerToken(req)
  if (!token) return null
  try {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const apikey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !apikey) return null
    const headers = { Authorization: `Bearer ${token}` }
    const societe = req.headers?.['x-company-id']
    if (typeof societe === 'string' && /^[0-9a-f-]{36}$/i.test(societe)) headers['x-company-id'] = societe
    const client = createClient(url, apikey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers } })
    const { data, error } = await client.rpc('my_rights')
    if (error || !data || !Array.isArray(data.rights)) return null
    return data.rights.filter((d) => typeof d === 'string')
  } catch {
    return null
  }
}

/**
 * Exige un droit (ou un des droits d'une liste) dans la société courante.
 * Droits connus : le droit décide (comme les règles de la base) ; si `roles` est donné, le rôle doit aussi y
 * figurer (le droit ne fait alors que restreindre l'accès d'avant ; un compte au rôle de base « membre » n'a que
 * ses droits). Droits inconnus : repli sur `fallbackRoles` (le contrôle d'avant), jamais d'ouverture plus large.
 * Répond 401/403 et retourne null en cas de refus.
 */
export async function requireRight(req, res, codes, fallbackRoles, roles) {
  const ctx = await requireUser(req)
  if (!ctx) {
    res.status(401).json({ error: 'Connexion requise' })
    return null
  }
  // Vue groupe (C3) : lecture seule ; une action du serveur se fait toujours dans une société choisie
  if (req.headers?.['x-company-id'] === 'groupe') {
    res.status(403).json({ error: 'Vue groupe : lecture seule. Choisissez une société dans l\'en-tête.' })
    return null
  }
  const liste = Array.isArray(codes) ? codes : [codes]
  const droits = await droitsDeLAppelant(req)
  if (droits) {
    const roleOk = !roles || ctx.profile.role === 'membre' || roles.includes(ctx.profile.role)
    if (!roleOk || !liste.some((c) => droits.includes(c))) {
      res.status(403).json({ error: 'Cette action ne fait pas partie de vos accès' })
      return null
    }
    return { ...ctx, droits }
  }
  if (!fallbackRoles || !fallbackRoles.includes(ctx.profile.role)) {
    res.status(403).json({ error: 'Accès refusé pour ce rôle' })
    return null
  }
  return { ...ctx, droits: null }
}

/** Tâches planifiées lançables aussi à la main : CRON_SECRET, ou un utilisateur qui a le droit */
export async function requireCronOrRight(req, res, codes, fallbackRoles, roles) {
  if (hasCronSecret(req)) return { cron: true }
  return requireRight(req, res, codes, fallbackRoles, roles)
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
