import { requireUser } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'
// api/generate-mailing-body.js
// ─────────────────────────────────────────────────────────────────────────────
// Génère le corps HTML d'un email de prospection via Claude (Haiku)
// Appelé depuis Mailing.jsx — l'user décrit ce qu'il veut, l'IA génère le HTML
//
// RÈGLES STRICTES :
//   - Génère uniquement le body HTML (pas de signature, pas d'"Access Formation")
//   - L'utilisateur personnalise ensuite si besoin
//   - La signature est injectée par send-mailing-single.js côté serveur
// ─────────────────────────────────────────────────────────────────────────────

export const config = { maxDuration: 20 }

async function handler(req, res) {
  if (req.method !== 'OPTIONS') {
    const ctx = await requireUser(req)
    if (!ctx) return res.status(401).json({ error: 'Connexion requise' })
    req.user = ctx.user
    req.profile = ctx.profile
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { prompt } = req.body

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Prompt requis' })
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: `Tu es un expert en rédaction d'emails de prospection B2B en français.
Génère UNIQUEMENT le corps HTML d'un email de prospection.

RÈGLES ABSOLUES :
- HTML simple avec <p> et <ul>/<li> uniquement — pas de <html>, <head>, <body>, <div>
- Pas de signature, pas de "Bien cordialement", pas de coordonnées expéditeur
- Ne mentionne PAS le nom de l'organisme de formation ni ses coordonnées
- Vouvoiement uniquement
- Concis : maximum 120 mots
- Ton professionnel mais direct
- Commence directement par le corps du message (pas de "Objet :", pas de "Madame, Monsieur,")`,
        messages: [
          {
            role: 'user',
            content: `Génère le corps HTML d'un email de prospection avec ce contexte : ${prompt.trim()}`,
          },
        ],
      }),
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      throw new Error(errData.error?.message || `Anthropic HTTP ${response.status}`)
    }

    const data = await response.json()
    const html = data.content?.[0]?.text?.trim()

    if (!html) throw new Error('Réponse vide de l\'IA')

    return res.status(200).json({ html })

  } catch (error) {
    console.error('generate-mailing-body error:', error)
    return res.status(500).json({ error: error.message })
  }
}

export default withErrorLog(handler, 'generate-mailing-body')
