// ═══════════════════════════════════════════════════════════
// VERCEL API ROUTE — OAuth Meta (Facebook + Instagram)
// GET /api/auth/meta?code=...
// GET /api/auth/meta?action=connect (initie le flow OAuth)
// ═══════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const META_APP_ID = process.env.META_APP_ID
const META_APP_SECRET = process.env.META_APP_SECRET
const APP_URL = process.env.APP_URL || 'https://app.accessformation.pro'
const REDIRECT_URI = `${APP_URL}/api/auth/meta`

export default async function handler(req, res) {
  try {
    const { code, action, error: oauthError } = req.query

    // ── Étape 0 : Erreur OAuth ──────────────────────────
    if (oauthError) {
      console.error('Meta OAuth error:', oauthError)
      return res.redirect(`${APP_URL}/#/social?meta=error&reason=${oauthError}`)
    }

    // ── Étape 1 : Initier la connexion ──────────────────
    if (action === 'connect') {
      const scope = [
        'pages_show_list',
        'pages_manage_posts',
        'pages_read_engagement',
        'instagram_basic',
        'instagram_content_publish',
      ].join(',')

      const authUrl = `https://www.facebook.com/v25.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scope}&response_type=code&auth_type=rerequest`

      return res.redirect(authUrl)
    }

    // ── Étape 2 : Échanger le code contre un token ──────
    if (!code) {
      return res.status(400).json({ error: 'Missing code parameter' })
    }

    // Échanger le code
    const tokenUrl = `https://graph.facebook.com/v25.0/oauth/access_token?client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code=${code}`

    const tokenRes = await fetch(tokenUrl)
    const tokenData = await tokenRes.json()

    if (tokenData.error) {
      console.error('Token exchange error:', tokenData.error)
      return res.redirect(`${APP_URL}/#/social?meta=error&reason=token_exchange`)
    }

    const shortToken = tokenData.access_token

    // ── Étape 3 : Convertir en token longue durée ───────
    const longTokenUrl = `https://graph.facebook.com/v25.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${shortToken}`

    const longRes = await fetch(longTokenUrl)
    const longData = await longRes.json()
    console.log('Long token response:', JSON.stringify(longData).slice(0, 200))

    const longToken = longData.access_token || shortToken
    const expiresIn = longData.expires_in || 5184000 // 60 jours par défaut

    // ── Étape 4 : Récupérer les Pages Facebook ──────────
    // D'abord essayer avec le token longue durée
    let pagesUrl = `https://graph.facebook.com/v25.0/me/accounts?fields=id,name,access_token,category&access_token=${longToken}`
    let pagesRes = await fetch(pagesUrl)
    let pagesData = await pagesRes.json()
    console.log('Pages response (long token):', JSON.stringify(pagesData).slice(0, 500))

    // Si ça ne marche pas, essayer avec le token court
    if (pagesData.error || !pagesData.data || pagesData.data.length === 0) {
      console.log('Trying with short token...')
      pagesUrl = `https://graph.facebook.com/v25.0/me/accounts?fields=id,name,access_token,category&access_token=${shortToken}`
      pagesRes = await fetch(pagesUrl)
      pagesData = await pagesRes.json()
      console.log('Pages response (short token):', JSON.stringify(pagesData).slice(0, 500))
    }

    if (pagesData.error) {
      console.error('Pages API error:', pagesData.error)
      return res.redirect(`${APP_URL}/#/social?meta=error&reason=pages_api_${encodeURIComponent(pagesData.error.message?.slice(0, 50))}`)
    }

    if (!pagesData.data || pagesData.data.length === 0) {
      // Stocker quand même le user token pour debug
      console.log('No pages found. Storing user token for debug.')
      await supabase.from('social_tokens').upsert({
        platform: 'facebook',
        access_token: longToken,
        refresh_token: longToken,
        token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        metadata: { error: 'no_pages_found', user_token: longToken },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'platform' })
      return res.redirect(`${APP_URL}/#/social?meta=error&reason=no_pages`)
    }

    // Prendre la première page (ou celle d'Access Formation si trouvée)
    const page = pagesData.data.find(p => p.name?.toLowerCase().includes('access')) || pagesData.data[0]
    const pageAccessToken = page.access_token
    const pageId = page.id
    const pageName = page.name

    // Stocker le token Facebook (Page)
    await supabase.from('social_tokens').upsert({
      platform: 'facebook',
      access_token: pageAccessToken,
      refresh_token: longToken,
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      page_id: pageId,
      metadata: { page_name: pageName, user_token: longToken },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'platform' })

    // ── Étape 5 : Récupérer le compte Instagram lié ─────
    let igAccountId = null
    let igUsername = null
    try {
      const igUrl = `https://graph.facebook.com/v25.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`
      const igRes = await fetch(igUrl)
      const igData = await igRes.json()

      if (igData.instagram_business_account) {
        igAccountId = igData.instagram_business_account.id

        // Récupérer le username
        const igInfoUrl = `https://graph.facebook.com/v25.0/${igAccountId}?fields=username&access_token=${pageAccessToken}`
        const igInfoRes = await fetch(igInfoUrl)
        const igInfoData = await igInfoRes.json()
        igUsername = igInfoData.username

        // Stocker le token Instagram
        await supabase.from('social_tokens').upsert({
          platform: 'instagram',
          access_token: pageAccessToken, // Même token que la page
          page_id: igAccountId,
          account_id: igAccountId,
          token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
          metadata: { username: igUsername, page_id: pageId, page_name: pageName },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'platform' })
      }
    } catch (igErr) {
      console.warn('Instagram account not found:', igErr.message)
    }

    // ── Succès ! Rediriger vers l'app ───────────────────
    const igStatus = igAccountId ? 'ok' : 'no_ig'
    return res.redirect(`${APP_URL}/#/social?meta=success&page=${encodeURIComponent(pageName)}&ig=${igStatus}${igUsername ? '&ig_user=' + igUsername : ''}`)

  } catch (err) {
    console.error('Meta OAuth handler error:', err)
    return res.redirect(`${APP_URL}/#/social?meta=error&reason=server_error`)
  }
}
