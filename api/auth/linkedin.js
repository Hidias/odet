// ═══════════════════════════════════════════════════════════
// VERCEL API ROUTE — OAuth LinkedIn
// GET /api/auth/linkedin?action=connect (initie le flow OAuth)
// GET /api/auth/linkedin?code=... (callback après auth)
// Scope : r_organization_social w_organization_social
// L'org URN est défini via LINKEDIN_ORG_ID (variable Vercel)
// ═══════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET
const LINKEDIN_ORG_ID = process.env.LINKEDIN_ORG_ID // ex: "12345678" (numéro dans l'URL de la page)
const APP_URL = process.env.APP_URL || 'https://app.accessformation.pro'
const REDIRECT_URI = `${APP_URL}/api/auth/linkedin`

export default async function handler(req, res) {
  try {
    const { code, action, error: oauthError, error_description } = req.query

    // ── Erreur OAuth ────────────────────────────────────
    if (oauthError) {
      console.error('LinkedIn OAuth error:', oauthError, error_description)
      return res.redirect(`${APP_URL}/#/social?linkedin=error&reason=${encodeURIComponent(oauthError)}`)
    }

    // ── Étape 1 : Initier la connexion ──────────────────
    if (action === 'connect') {
      if (!LINKEDIN_CLIENT_ID) {
        return res.status(500).json({ error: 'LINKEDIN_CLIENT_ID non configuré' })
      }
      if (!LINKEDIN_ORG_ID) {
        return res.status(500).json({ error: 'LINKEDIN_ORG_ID non configuré' })
      }

      const scope = 'r_organization_social w_organization_social'
      const state = Math.random().toString(36).substring(2, 15)

      const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${LINKEDIN_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(scope)}&state=${state}`

      return res.redirect(authUrl)
    }

    // ── Étape 2 : Échanger le code contre un token ──────
    if (!code) {
      return res.status(400).json({ error: 'Missing code parameter' })
    }

    if (!LINKEDIN_ORG_ID) {
      console.error('[linkedin] LINKEDIN_ORG_ID non configuré')
      return res.redirect(`${APP_URL}/#/social?linkedin=error&reason=org_id_missing`)
    }

    console.log('[linkedin] Exchanging code for token...')

    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: LINKEDIN_CLIENT_ID,
        client_secret: LINKEDIN_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      }),
    })

    const tokenData = await tokenRes.json()

    if (tokenData.error) {
      console.error('LinkedIn token error:', tokenData)
      return res.redirect(`${APP_URL}/#/social?linkedin=error&reason=token_exchange`)
    }

    const accessToken = tokenData.access_token
    const expiresIn = tokenData.expires_in || 5184000 // 60 jours par défaut

    console.log('[linkedin] Token obtained, expires in', expiresIn, 'seconds')

    // ── Étape 3 : Construire l'org URN depuis la variable d'env ─
    const orgUrn = `urn:li:organization:${LINKEDIN_ORG_ID}`
    const orgName = 'Access Formation'

    console.log('[linkedin] Org URN (from env):', orgUrn)

    // ── Étape 4 : Stocker dans Supabase ─────────────────
    // page_id = URN de la page entreprise — utilisé comme author dans les posts
    await supabase.from('social_tokens').upsert({
      platform: 'linkedin',
      access_token: accessToken,
      refresh_token: null,
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      page_id: orgUrn,
      account_id: orgUrn,
      metadata: {
        org_name: orgName,
        org_urn: orgUrn,
        scope: 'r_organization_social w_organization_social',
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'platform' })

    // ── Succès ! ────────────────────────────────────────
    return res.redirect(
      `${APP_URL}/#/social?linkedin=success&page=${encodeURIComponent(orgName)}`
    )

  } catch (err) {
    console.error('LinkedIn OAuth handler error:', err)
    return res.redirect(`${APP_URL}/#/social?linkedin=error&reason=server_error`)
  }
}
