// ═══════════════════════════════════════════════════════════
// VERCEL CRON — Publication des posts planifiés
// Exécuté toutes les 5 minutes par Vercel Cron
// GET /api/social/cron-publish
// ═══════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { requireCronOrUser } from '../_lib/auth.js'
import { isTestEnvironment } from '../_lib/mailer.js'
import { withErrorLog } from '../_lib/errors.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const APP_URL = process.env.APP_URL || 'https://app.accessformation.pro'

async function handler(req, res) {
  if (!(await requireCronOrUser(req, res))) return

  // Environnement de test : aucune publication programmée n'est envoyée
  if (isTestEnvironment()) return res.status(200).json({ message: 'Environnement de test : publication désactivée', count: 0 })

  try {
    const now = new Date().toISOString()
    console.log(`[cron-publish] Checking scheduled posts at ${now}`)

    // Chercher les posts planifiés dont l'heure est passée
    const { data: posts, error } = await supabase
      .from('social_posts')
      .select('*')
      .eq('status', 'scheduled')
      .lte('scheduled_at', now)
      .order('scheduled_at', { ascending: true })
      .limit(10) // Max 10 posts par exécution pour éviter les timeouts

    if (error) {
      console.error('[cron-publish] Error fetching posts:', error)
      return res.status(500).json({ error: error.message })
    }

    if (!posts || posts.length === 0) {
      console.log('[cron-publish] No scheduled posts to publish')
      return res.status(200).json({ message: 'No posts to publish', count: 0 })
    }

    console.log(`[cron-publish] Found ${posts.length} post(s) to publish`)

    const results = []

    for (const post of posts) {
      try {
        // Marquer comme "publishing" pour éviter les doublons
        await supabase.from('social_posts').update({
          status: 'publishing',
          updated_at: new Date().toISOString(),
        }).eq('id', post.id)

        // Appeler l'API de publication
        const pubRes = await fetch(`${APP_URL}/api/social/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ post_id: post.id }),
        })
        const pubData = await pubRes.json()

        console.log(`[cron-publish] Post ${post.id} (${post.title}):`, JSON.stringify(pubData).slice(0, 200))

        results.push({
          id: post.id,
          title: post.title,
          success: pubData.success,
          results: pubData.results,
        })
      } catch (pubErr) {
        console.error(`[cron-publish] Error publishing post ${post.id}:`, pubErr.message)

        // Remettre en "scheduled" pour réessayer au prochain cron
        await supabase.from('social_posts').update({
          status: 'scheduled',
          updated_at: new Date().toISOString(),
        }).eq('id', post.id)

        results.push({
          id: post.id,
          title: post.title,
          success: false,
          error: pubErr.message,
        })
      }

      // Pause 3s entre chaque post
      await new Promise(r => setTimeout(r, 3000))
    }

    console.log(`[cron-publish] Done. Published ${results.filter(r => r.success).length}/${results.length} posts`)

    return res.status(200).json({
      message: `Processed ${results.length} post(s)`,
      results,
    })

  } catch (err) {
    console.error('[cron-publish] Handler error:', err)
    return res.status(500).json({ error: err.message })
  }
}

export default withErrorLog(handler, 'social/cron-publish')
