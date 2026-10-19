// api/_lib/taches.js : journal des tâches planifiées (table job_runs, migration 0382, audit du 19/10 au soir).
// withJobLog enveloppe une route planifiée sans changer son comportement : la réponse est la même, une exception
// continue d'être levée. S'ajoutent une ligne au début du passage et sa mise à jour à la fin : réussite, erreur, ou
// refus (appel de la tâche planifiée sans le bon secret : la cause la plus probable d'une tâche qui ne fait rien).
// Aucune donnée personnelle : seuls le nom de la tâche, les compteurs renvoyés et le message d'erreur masqué.
// Import : import { withJobLog } from './_lib/taches.js'

import { createClient } from '@supabase/supabase-js'
import { hasCronSecret } from './auth.js'
import { redact } from './redact.js'

let admin = null
function adminClient() {
  if (admin) return admin
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  admin = createClient(url, key, { auth: { persistSession: false } })
  return admin
}

// Appel de la tâche planifiée de Vercel (en-tête user-agent « vercel-cron/1.0 »)
function appelTache(req) {
  return /vercel-cron/i.test(String(req?.headers?.['user-agent'] || ''))
}

// Ne garde que les valeurs simples (compteurs, indicateurs) d'une réponse, jamais de liste ni de texte libre long
function resume(body) {
  if (!body || typeof body !== 'object') return null
  const out = {}
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sous = {}
      for (const [k2, v2] of Object.entries(v)) if (typeof v2 === 'number' || typeof v2 === 'boolean') sous[k2] = v2
      if (Object.keys(sous).length) out[k] = sous
    } else if (typeof v === 'string' && v.length <= 80 && /raison|statut|status/i.test(k)) out[k] = v
  }
  return Object.keys(out).length ? out : null
}

async function sans(promesse) {
  try { return await Promise.race([promesse, new Promise((r) => setTimeout(() => r(null), 3000))]) } catch { return null }
}

export function withJobLog(handler, job) {
  return async function routeJournalisee(req, res) {
    const client = adminClient()
    const declencheur = hasCronSecret(req) || appelTache(req) ? 'tache' : 'manuel'
    let id = null
    if (client) {
      const r = await sans(client.from('job_runs').insert({ job, declencheur }).select('id').single())
      id = r?.data?.id || null
    }
    let body
    if (res && typeof res.json === 'function') {
      const json = res.json.bind(res)
      res.json = (b) => { body = b; return json(b) }
    }
    const fin = async (status, error) => {
      if (!client || !id) return
      const detail = resume(body) || {}
      if (status === 'refuse') detail.secret_configure = !!process.env.CRON_SECRET
      await sans(client.from('job_runs').update({
        finished_at: new Date().toISOString(), status, detail: Object.keys(detail).length ? detail : null,
        error: error ? redact(String(error)).slice(0, 500) : null,
      }).eq('id', id))
    }
    try {
      const out = await handler(req, res)
      const code = res?.statusCode || 200
      if (code === 401 || code === 403) await fin('refuse', body?.error || `Réponse ${code}`)
      else if (code >= 400) await fin('erreur', body?.error || `Réponse ${code}`)
      else await fin('ok', null)
      return out
    } catch (err) {
      await fin('erreur', err instanceof Error ? err.message : err)
      throw err
    }
  }
}

// Nettoyage du journal : passages de plus de 60 jours (appelé par la tâche de nuit)
export async function purgerJournalTaches() {
  const client = adminClient()
  if (!client) return
  const avant = new Date(Date.now() - 60 * 86400000).toISOString()
  await sans(client.from('job_runs').delete().lt('started_at', avant))
}
