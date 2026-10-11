// ═══════════════════════════════════════════════════════════
// VERCEL API ROUTE — Statut des connexions réseaux sociaux
// GET /api/social/status
// ═══════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { data: tokens } = await supabase
      .from('social_tokens')
      .select('platform, page_id, account_id, token_expires_at, metadata, updated_at')

    const status = {}
    const platforms = ['facebook', 'instagram', 'gmb', 'linkedin']

    for (const platform of platforms) {
      const token = (tokens || []).find(t => t.platform === platform)
      if (token) {
        const expiresAt = new Date(token.token_expires_at)
        const isExpired = expiresAt < new Date()
        status[platform] = {
          connected: !isExpired,
          expired: isExpired,
          expires_at: token.token_expires_at,
          page_id: token.page_id,
          metadata: token.metadata,
          updated_at: token.updated_at,
        }
      } else {
        status[platform] = { connected: false }
      }
    }

    return res.status(200).json(status)
  } catch (err) {
    console.error('Status handler error:', err)
    return res.status(500).json({ error: err.message })
  }
}
