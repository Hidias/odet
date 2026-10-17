// api/_lib/errors.js : erreurs des routes /api enregistrées dans le suivi des erreurs (table error_logs).
// withErrorLog enveloppe une route sans changer son comportement : la réponse est la même,
// une exception continue d'être levée. Seules s'ajoutent l'enregistrement des réponses 5xx et des exceptions.
// Aucune donnée personnelle n'est journalisée : messages et piles masqués (redact.js), la personne
// n'est connue que par son identifiant de compte, jamais par son email.
// L'import de ce fichier installe aussi le masquage de tous les journaux console de la route.
// Import : import { withErrorLog } from './_lib/errors.js'

import { createClient } from '@supabase/supabase-js'
import { redact, installConsoleRedaction } from './redact.js'

installConsoleRedaction()

let admin = null
function adminClient() {
  if (admin) return admin
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  admin = createClient(url, key, { auth: { persistSession: false } })
  return admin
}

function messageOf(err) {
  if (err instanceof Error) return err.message || err.name || 'Erreur serveur'
  return String(err || 'Erreur serveur')
}

/**
 * Enregistre une erreur serveur. Ne lève jamais d'exception et n'attend pas plus de 3 secondes.
 */
export async function logApiError(route, err, req) {
  try {
    const client = adminClient()
    if (!client) return
    const call = client.rpc('log_error', {
      p_source: 'api',
      p_message: redact(messageOf(err)).slice(0, 1000),
      p_stack: err instanceof Error ? (redact(err.stack || '') || null) : null,
      p_page: `${req?.method || ''} /api/${route}`.trim(),
      p_user_agent: `node ${process.version}`,
      p_app_version: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
      p_user_id: req?.user?.id || null,
    })
    await Promise.race([call, new Promise((resolve) => setTimeout(resolve, 3000))])
  } catch { /* le suivi ne doit jamais faire échouer la route */ }
}

export function withErrorLog(handler, route) {
  return async function routeAvecSuivi(req, res) {
    let body
    if (res && typeof res.json === 'function') {
      const json = res.json.bind(res)
      res.json = (b) => { body = b; return json(b) }
    }
    try {
      const out = await handler(req, res)
      if (res && res.statusCode >= 500) {
        await logApiError(route, new Error(body?.error || body?.message || `Réponse ${res.statusCode}`), req)
      }
      return out
    } catch (e) {
      await logApiError(route, e, req)
      throw e
    }
  }
}
