import { requireRole, OFFICE_WRITE } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'
// api/ai-proxy.js
// Proxy serveur vers l'API Anthropic.
// Les modules front (budget, réseaux sociaux) passent par ici au lieu d'appeler
// api.anthropic.com directement. La clé API ne quitte JAMAIS le serveur.
// (process.env.ANTHROPIC_API_KEY — la même que les autres endpoints /api).

export const config = { maxDuration: 60 }

// Seuls les modèles réellement utilisés par l'appli sont autorisés.
// Bloque toute tentative d'utiliser un modèle coûteux (ex. Opus) via ce proxy.
const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
])

function hostOf(value) {
  try {
    return new URL(value).host.toLowerCase()
  } catch {
    return ''
  }
}

// Contrôle principal : le jeton de l'utilisateur et son rôle. Contrôle d'origine en complément :
// seules l'adresse de l'application (APP_URL) et les adresses du déploiement courant
// (VERCEL_URL, VERCEL_BRANCH_URL, VERCEL_PROJECT_PRODUCTION_URL) et l'hôte qui reçoit la requête
// sont acceptées ; plus de *.vercel.app générique.
function ownHosts(req) {
  const env = process.env
  // L'hôte qui reçoit la requête (domaine personnalisé sans APP_URL) : un navigateur ne peut pas le falsifier
  const list = [env.APP_URL, req?.headers?.host ? `https://${req.headers.host}` : '']
  for (const v of [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (v) list.push(`https://${v}`)
  }
  // Développement local uniquement (hors Vercel)
  if (!env.VERCEL) list.push('http://localhost', 'http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173')
  return list.map(hostOf).filter(Boolean)
}

function originAllowed(req) {
  const origin = req.headers.origin || ''
  if (!origin) {
    // Sans Origin : refus seulement si la requête vient manifestement d'un navigateur
    // (en-têtes Sec-Fetch-* ajoutés par les navigateurs) ; les appels serveur restent soumis au jeton
    return !req.headers['sec-fetch-site'] && !req.headers['sec-fetch-mode']
  }
  const host = hostOf(origin)
  return !!host && ownHosts(req).includes(host)
}

async function handler(req, res) {
  // Appelants : réseaux sociaux (commercial), budget (comptable), emails stagiaires (formateur, gestion)
  const ctx = await requireRole(req, res, OFFICE_WRITE)
  if (!ctx) return
  req.user = ctx.user
  req.profile = ctx.profile
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!originAllowed(req)) {
    return res.status(403).json({ error: 'Origine non autorisée' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée' })
  }

  try {
    const payload = req.body || {}

    if (!payload.model || !ALLOWED_MODELS.has(payload.model)) {
      return res.status(400).json({ error: 'Modèle non autorisé' })
    }

    if (typeof payload.max_tokens === 'number' && payload.max_tokens > 8192) {
      payload.max_tokens = 8192
    }

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    })

    // On renvoie le statut ET le corps bruts, pour préserver exactement
    // le comportement front (retry sur 429, lecture de stop_reason, etc.).
    const text = await upstream.text()
    res.status(upstream.status)
    res.setHeader('Content-Type', 'application/json')
    return res.send(text)
  } catch (error) {
    console.error('ai-proxy error:', error)
    return res.status(500).json({ error: error.message })
  }
}

export default withErrorLog(handler, 'ai-proxy')
