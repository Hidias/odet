// ═══════════════════════════════════════════════════════════
// VERCEL API ROUTE — Publication sur les réseaux sociaux
// POST /api/social/publish
// Body: { post_id } ou { platforms, content_facebook, content_instagram, content_gmb, media_urls }
// ═══════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { requireCronOrRole, SALES } from '../_lib/auth.js'
import { isTestEnvironment } from '../_lib/mailer.js'
import { withErrorLog } from '../_lib/errors.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET

// ── Rafraîchir le token Google si expiré ────────────────
async function refreshGoogleToken(token) {
  if (!token.refresh_token) return token.access_token

  const expiresAt = new Date(token.token_expires_at)
  if (expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
    return token.access_token // Encore valide (marge 5 min)
  }

  // Rafraîchir
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()

  if (data.access_token) {
    // Mettre à jour en base
    await supabase.from('social_tokens').update({
      access_token: data.access_token,
      token_expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('platform', 'gmb')

    return data.access_token
  }

  // Si le refresh échoue, log l'erreur et retourne l'ancien token
  console.error('Google token refresh failed:', JSON.stringify(data))
  return token.access_token
}

// ── Publier sur Facebook ────────────────────────────────
async function publishFacebook(content, mediaUrl, token) {
  const pageId = token.page_id
  const accessToken = token.access_token

  let endpoint, body
  if (mediaUrl) {
    // Post avec photo
    endpoint = `https://graph.facebook.com/v25.0/${pageId}/photos`
    body = { url: mediaUrl, message: content, access_token: accessToken }
  } else {
    // Post texte seul
    endpoint = `https://graph.facebook.com/v25.0/${pageId}/feed`
    body = { message: content, access_token: accessToken }
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()

  if (data.error) throw new Error(`Facebook: ${data.error.message}`)
  return data.id || data.post_id
}

// ── Publier sur Instagram ───────────────────────────────
async function publishInstagram(content, mediaUrl, token) {
  if (!mediaUrl) throw new Error('Instagram nécessite une image')

  const igAccountId = token.page_id
  const accessToken = token.access_token

  // Étape 1 : Créer le conteneur média
  const createRes = await fetch(`https://graph.facebook.com/v25.0/${igAccountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: mediaUrl,
      caption: content,
      access_token: accessToken,
    }),
  })
  const createData = await createRes.json()

  if (createData.error) throw new Error(`Instagram create: ${createData.error.message}`)
  const containerId = createData.id

  // Attendre que le conteneur soit prêt (polling)
  let ready = false
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const statusRes = await fetch(`https://graph.facebook.com/v25.0/${containerId}?fields=status_code&access_token=${accessToken}`)
    const statusData = await statusRes.json()
    if (statusData.status_code === 'FINISHED') {
      ready = true
      break
    }
    if (statusData.status_code === 'ERROR') {
      throw new Error(`Instagram media error: ${JSON.stringify(statusData)}`)
    }
  }

  if (!ready) throw new Error('Instagram: timeout waiting for media processing')

  // Étape 2 : Publier
  const publishRes = await fetch(`https://graph.facebook.com/v25.0/${igAccountId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: containerId,
      access_token: accessToken,
    }),
  })
  const publishData = await publishRes.json()

  if (publishData.error) throw new Error(`Instagram publish: ${publishData.error.message}`)
  return publishData.id
}

// ── Helpers LinkedIn ─────────────────────────────────────

// Attendre que l'image LinkedIn soit AVAILABLE avant de créer le post
// Sans ce polling, LinkedIn peut attacher l'image en état "en cours de traitement"
// ce qui provoque une troncature silencieuse du commentary au rendu
async function waitForLinkedInImageAvailable(imageUrn, headers, {
  maxAttempts = 15,
  delayMs = 2000,
} = {}) {
  const imageUrl = `https://api.linkedin.com/rest/images/${encodeURIComponent(imageUrn)}`

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(imageUrl, { method: 'GET', headers })
    const data = await res.json().catch(() => ({}))
    const status = data?.status

    console.log(`[linkedin] image status attempt ${attempt}/${maxAttempts}:`, status)

    if (status === 'AVAILABLE') return data
    if (status === 'PROCESSING_FAILED') {
      throw new Error(`LinkedIn image processing failed for ${imageUrn}`)
    }

    await new Promise(r => setTimeout(r, delayMs))
  }

  throw new Error(`LinkedIn image not AVAILABLE after ${maxAttempts} attempts`)
}

// Vérifier après publication que LinkedIn a bien stocké le commentary complet
async function verifyLinkedInPost(postId, expectedCommentary, headers) {
  try {
    const postUrl = `https://api.linkedin.com/rest/posts/${encodeURIComponent(postId)}`
    const res = await fetch(postUrl, { method: 'GET', headers })
    const data = await res.json().catch(() => ({}))
    const stored = data?.commentary || ''
    console.log('[linkedin] stored commentary length:', stored.length, '/ sent:', expectedCommentary.length)
    if (stored.length < expectedCommentary.length) {
      console.warn('[linkedin] ⚠️ commentary tronqué par LinkedIn à la réception', {
        sent: expectedCommentary.length,
        stored: stored.length,
        postId,
      })
    }
  } catch (err) {
    console.warn('[linkedin] verify post failed:', err.message)
  }
}

// Extraire le altText depuis la première ligne du contenu
function buildAltText(content) {
  const firstLine = (content || '')
    .split('\n')
    .map(s => s.trim())
    .find(Boolean) || 'Visuel'
  return firstLine.slice(0, 120)
}

// ── Échappement little Text LinkedIn ────────────────────
// LinkedIn traite le champ `commentary` comme du "little text" : tout caractère
// réservé NON échappé provoque la suppression silencieuse de la fin du texte
// (ex : la parenthèse de "(R485/R489)" coupe le post). Tous les caractères
// réservés doivent être précédés d'un backslash.
// Réservés : \ < > ~ _ @ # * [ ] { } ( ) |
function escapeLinkedInCommentary(text) {
  return (text || '').replace(/[\\<>~_@#*\[\]{}()|]/g, '\\$&')
}

// ── Publier sur LinkedIn ────────────────────────────────
async function publishLinkedIn(content, mediaUrl, token) {
  const accessToken = token.access_token
  const personUrn = token.page_id || token.account_id

  if (!personUrn) throw new Error('LinkedIn: aucun profil connecté')

  const authorUrn = personUrn.startsWith('urn:') ? personUrn : `urn:li:organization:${personUrn}`

  const LI_HEADERS = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': '202510',
  }

  // ── Upload image si présente (3 étapes LinkedIn Images API) ──
  let imageUrn = null
  if (mediaUrl) {
    try {
      // Étape 1 : Initialiser l'upload
      const initRes = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
        method: 'POST',
        headers: LI_HEADERS,
        body: JSON.stringify({
          initializeUploadRequest: { owner: authorUrn },
        }),
      })
      const initData = await initRes.json()
      console.log('[linkedin] initializeUpload:', JSON.stringify(initData).slice(0, 300))

      const uploadUrl = initData.value?.uploadUrl
      imageUrn = initData.value?.image

      if (!uploadUrl || !imageUrn) {
        throw new Error('LinkedIn: uploadUrl ou imageUrn manquant dans initializeUpload')
      }

      // Étape 2 : Uploader l'image
      const imageRes = await fetch(mediaUrl)
      if (!imageRes.ok) throw new Error(`LinkedIn: impossible de télécharger l'image (${imageRes.status})`)
      const imageBuffer = await imageRes.arrayBuffer()

      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': imageRes.headers.get('content-type') || 'image/jpeg',
        },
        body: imageBuffer,
      })

      if (!uploadRes.ok) {
        const uploadErr = await uploadRes.text()
        throw new Error(`LinkedIn image upload failed (${uploadRes.status}): ${uploadErr.slice(0, 300)}`)
      }

      console.log('[linkedin] Image uploadée, URN:', imageUrn)

      // ── VRAI FIX : attendre AVAILABLE avant de créer le post ──
      // Un délai fixe est insuffisant — on poll le statut réel de l'image
      await waitForLinkedInImageAvailable(imageUrn, LI_HEADERS, {
        maxAttempts: 15,
        delayMs: 2000,
      })

    } catch (imgErr) {
      throw new Error(`LinkedIn: échec upload image — ${imgErr.message}`)
    }
  }

  // ── Construire le corps du post ──────────────────────
  const postBody = {
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    visibility: 'PUBLIC',
    commentary: escapeLinkedInCommentary(content),
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    isReshareDisabledByAuthor: false,
  }

  // Étape 3 : Ajouter l'image avec altText
  if (imageUrn) {
    postBody.content = {
      media: {
        id: imageUrn,
        altText: buildAltText(content),
      },
    }
  }

  console.log('[linkedin] commentary length:', content.length)
  console.log('[linkedin] commentary full:', JSON.stringify(content))
  console.log('[linkedin] has media:', !!imageUrn)

  // ── Publier le post ──────────────────────────────────
  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: LI_HEADERS,
    body: JSON.stringify(postBody),
  })

  // LinkedIn renvoie 201 Created avec un header x-restli-id
  if (res.status === 201) {
    const postId = res.headers.get('x-restli-id') || 'published'
    // Vérifier que LinkedIn a stocké le texte complet
    await verifyLinkedInPost(postId, content, LI_HEADERS)
    return postId
  }

  const data = await res.json().catch(() => ({}))
  throw new Error(`LinkedIn ${res.status}: ${data.message || JSON.stringify(data)}`)
}

// ── Publier sur Google My Business ──────────────────────
async function publishGMB(content, mediaUrl, token) {
  const accessToken = await refreshGoogleToken(token)
  const accountId = token.account_id  // format: accounts/123456
  const locationId = token.page_id    // format: locations/789012

  if (!locationId) throw new Error('GMB: aucune fiche connectée')
  if (!accountId) throw new Error('GMB: aucun compte connecté (account_id manquant)')

  // Construire le parent path complet : accounts/XXX/locations/YYY
  const parent = `${accountId}/${locationId}`

  const postBody = {
    languageCode: 'fr',
    summary: content,
    topicType: 'STANDARD',
  }

  // Ajouter la photo si disponible
  if (mediaUrl) {
    postBody.media = [{
      mediaFormat: 'PHOTO',
      sourceUrl: mediaUrl,
    }]
  }

  // Ajouter le CTA
  // Bouton « En savoir plus » vers le site de l'organisme (Paramètres), seulement s'il est renseigné
  const { data: orgRow } = await supabase.from('organization_settings').select('website').limit(1).maybeSingle()
  const site = String(orgRow?.website || '').trim()
  if (site) {
    postBody.callToAction = {
      actionType: 'LEARN_MORE',
      url: /^https?:\/\//.test(site) ? site : `https://${site}`,
    }
  }

  // ⚠️ L'endpoint Local Posts est sur mybusiness.googleapis.com/v4
  const url = `https://mybusiness.googleapis.com/v4/${parent}/localPosts`
  console.log('[GMB] Publishing to:', url)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(postBody),
  })

  // Vérifier que la réponse est bien du JSON avant de parser
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    const text = await res.text()
    console.error(`[GMB] Non-JSON response (${res.status}):`, text.slice(0, 500))
    throw new Error(`Google: réponse inattendue (HTTP ${res.status}). Vérifiez que l'API My Business est activée dans Google Cloud Console.`)
  }

  const data = await res.json()

  if (data.error) {
    console.error('[GMB] API error:', JSON.stringify(data.error))
    throw new Error(`Google: ${data.error.message || JSON.stringify(data.error)}`)
  }

  return data.name
}

// ── Handler principal ───────────────────────────────────
async function handler(req, res) {
  // Publication manuelle (commercial et au-dessus) ou appel de cron-publish (CRON_SECRET)
  const ctx = await requireCronOrRole(req, res, SALES)
  if (!ctx) return
  req.user = ctx.user || null
  req.profile = ctx.profile || null
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Environnement de test : rien n'est publié sur les vrais comptes (les jetons viennent d'une copie de la production)
  if (isTestEnvironment()) {
    return res.status(200).json({ success: false, simulation: true, error: 'Environnement de test : publication simulée, rien n\'a été publié' })
  }

  try {
    const { post_id } = req.body
    let post

    if (post_id) {
      // Charger le post depuis Supabase
      const { data, error } = await supabase.from('social_posts').select('*').eq('id', post_id).single()
      if (error || !data) return res.status(404).json({ error: 'Post not found' })
      post = data
    } else {
      post = req.body
    }

    const platforms = post.platforms || []
    const mediaUrl = post.media_urls?.[0] || null
    const results = {}

    // Charger tous les tokens nécessaires
    const { data: tokens } = await supabase.from('social_tokens').select('*')
    const tokenMap = {}
    ;(tokens || []).forEach(t => { tokenMap[t.platform] = t })

    // ── Publier sur chaque plateforme ─────────────────
    for (const platform of platforms) {
      const token = tokenMap[platform === 'gmb' ? 'gmb' : platform]
      if (!token) {
        results[platform] = { status: 'error', reason: `${platform} non connecté` }
        continue
      }

      const content = post[`content_${platform}`]
      if (!content) {
        results[platform] = { status: 'skipped', reason: 'Pas de contenu' }
        continue
      }

      try {
        let externalId

        switch (platform) {
          case 'facebook':
            externalId = await publishFacebook(content, mediaUrl, token)
            break
          case 'instagram':
            externalId = await publishInstagram(content, mediaUrl, token)
            break
          case 'gmb':
            externalId = await publishGMB(content, mediaUrl, token)
            break
          case 'linkedin':
            externalId = await publishLinkedIn(content, mediaUrl, token)
            break
        }

        results[platform] = { status: 'published', external_id: externalId }

        // Mettre à jour le post en base si on a un post_id
        if (post_id) {
          const updates = {}
          updates[`published_${platform}_at`] = new Date().toISOString()
          updates[`external_id_${platform}`] = externalId
          await supabase.from('social_posts').update(updates).eq('id', post_id)
        }
      } catch (pubErr) {
        console.error(`Error publishing to ${platform}:`, pubErr.message)
        results[platform] = { status: 'error', reason: pubErr.message }
      }

      // Pause 2s entre chaque publication (rate limiting)
      await new Promise(r => setTimeout(r, 2000))
    }

    // Mettre à jour le statut global du post
    if (post_id) {
      const allPublished = Object.values(results).every(r => r.status === 'published' || r.status === 'skipped')
      const anyPublished = Object.values(results).some(r => r.status === 'published')

      await supabase.from('social_posts').update({
        status: anyPublished ? 'published' : 'failed',
        updated_at: new Date().toISOString(),
      }).eq('id', post_id)
    }

    return res.status(200).json({ success: true, results })

  } catch (err) {
    console.error('Publish handler error:', err)
    return res.status(500).json({ error: err.message })
  }
}

export default withErrorLog(handler, 'social/publish')
