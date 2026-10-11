import { createClient } from '@supabase/supabase-js'

// Client serveur (clé service role : contourne la RLS, à n'utiliser qu'après vérification de l'appelant)
export function getAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définies')
  return createClient(url, key, { auth: { persistSession: false } })
}

/**
 * Vérifie le jeton de l'utilisateur connecté (en-tête Authorization: Bearer <jwt>)
 * et retourne { user, profile } ou null.
 */
export async function requireUser(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
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

export const ADMIN_ROLES = ['superadmin', 'admin']

/** Vérifie le secret des tâches planifiées (en-tête Authorization: Bearer <CRON_SECRET> ou ?secret=) */
export function requireCronSecret(req, res) {
  const expected = process.env.CRON_SECRET
  const header = req.headers?.authorization || ''
  const given = header.startsWith('Bearer ') ? header.slice(7) : (req.query?.secret || '')
  if (!expected || given !== expected) {
    res.status(401).json({ error: 'Secret invalide' })
    return false
  }
  return true
}
