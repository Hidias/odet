import { requireUser } from './_lib/auth.js'
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

// On autorise uniquement les requêtes venant de nos propres domaines.
// Si aucune origine n'est fournie, on laisse passer pour ne casser aucun
// appel légitime (le garde-fou modèle + le plafond de dépense couvrent le reste).
function originAllowed(req) {
  const host = hostOf(req.headers.origin || '') || hostOf(req.headers.referer || '')
  if (!host) return true
  return (
    host === 'localhost' ||
    host.startsWith('localhost:') ||
    host.startsWith('127.0.0.1') ||
    host.endsWith('accessformation.pro') ||
    host.endsWith('.vercel.app')
  )
}

export default async function handler(req, res) {
  if (req.method !== 'OPTIONS') {
    const ctx = await requireUser(req)
    if (!ctx) return res.status(401).json({ error: 'Connexion requise' })
    req.user = ctx.user
    req.profile = ctx.profile
  }
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
