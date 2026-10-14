import { requireRole, MANAGERS } from './_lib/auth.js'
// api/generate-compte-rendu-formation.js
// Proxy vers l'API Anthropic pour générer le compte rendu post-formation
// Évite le CORS en appelant depuis le serveur

export default async function handler(req, res) {
  const ctx = await requireRole(req, res, [...MANAGERS, 'formateur'])
  if (!ctx) return
  req.user = ctx.user
  req.profile = ctx.profile
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { prompt } = req.body

    if (!prompt) {
      return res.status(400).json({ error: 'Paramètre prompt manquant' })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('Erreur API Anthropic:', data)
      return res.status(500).json({ error: 'Erreur lors de la génération IA', details: data.error?.message || '' })
    }

    const text = data.content?.[0]?.text || ''
    return res.status(200).json({ text })

  } catch (error) {
    console.error('Erreur generate-compte-rendu-formation:', error)
    return res.status(500).json({ error: 'Erreur serveur', details: error.message })
  }
}
