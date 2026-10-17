import { requireRole } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

// État technique de l'instance, réservé au super administrateur :
// présence des variables d'environnement (jamais leurs valeurs) et accès à la base.

const ENV_KEYS = [
  ['SUPABASE_URL', 'Base de données (URL)'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'Clé serveur Supabase'],
  ['ENCRYPTION_KEY', 'Clé de chiffrement (mots de passe SMTP)'],
  ['CRON_SECRET', 'Secret des tâches planifiées'],
  ['APP_URL', 'Adresse publique de l\'application'],
  ['MAIL_SINK', 'Adresse de redirection des emails (mode démo)'],
  ['ANTHROPIC_API_KEY', 'Assistant de rédaction (IA)'],
  ['GOOGLE_SERVICE_ACCOUNT_KEY', 'Synchronisation Google Agenda'],
  ['FT_CLIENT_ID', 'API France Travail (offres d\'emploi)'],
  ['META_APP_ID', 'Facebook et Instagram'],
  ['LINKEDIN_CLIENT_ID', 'LinkedIn'],
]

async function handler(req, res) {
  const ctx = await requireRole(req, res, ['superadmin'])
  if (!ctx) return
  const env = ENV_KEYS.map(([key, label]) => ({ key, label, present: !!process.env[key] }))

  let db = { ok: false }
  try {
    const { count, error } = await ctx.admin.from('schema_migrations').select('*', { count: 'exact', head: true })
    db = { ok: !error, migrations: count ?? null, error: error?.message }
  } catch (e) {
    db = { ok: false, error: e.message }
  }

  return res.status(200).json({
    ok: true,
    node: process.version,
    region: process.env.VERCEL_REGION || null,
    deployment: process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null,
    deployed_branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    env,
    db,
    time: new Date().toISOString(),
  })
}

export default withErrorLog(handler, 'health')
