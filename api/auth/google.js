// ═══════════════════════════════════════════════════════════
// VERCEL API ROUTE — OAuth Google (My Business)
// GET /api/auth/google?action=start (administrateur connecté, jeton Bearer) → { url } d'autorisation avec state signé
// GET /api/auth/google?code=...&state=... (retour du fournisseur, state vérifié)
// ═══════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { appUrl } from '../_lib/internal.js'
import { requireRole, ADMINS } from '../_lib/auth.js'
import { createOAuthState, verifyOAuthState, socialRedirect } from '../_lib/oauthState.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
// Adresse de l'application : variable APP_URL, sinon l'hôte de la requête (calculée dans le handler)
const ENV_APP_URL = String(process.env.APP_URL || '').replace(/\/$/, '')

export default async function handler(req, res) {
  const APP_URL = ENV_APP_URL || appUrl(req)
  const REDIRECT_URI = `${APP_URL}/api/auth/google`
  try {
    const { code, action, state, error: oauthError } = req.query

    // ── Étape 1 : Initier la connexion (administrateur connecté) ──
    // Appelée par l'interface avec le jeton de l'utilisateur ; renvoie l'adresse d'autorisation
    if (action === 'start' || action === 'connect') {
      const ctx = await requireRole(req, res, ADMINS)
      if (!ctx) return
      if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID non configuré' })
      const scope = [
        'https://www.googleapis.com/auth/business.manage',
      ].join(' ')
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(scope)}&response_type=code&access_type=offline&prompt=consent&state=${encodeURIComponent(createOAuthState(ctx.user.id, 'google'))}`
      return res.status(200).json({ url: authUrl })
    }

    // ── Erreur OAuth ────────────────────────────────────
    if (oauthError) {
      console.error('Google OAuth error:', oauthError)
      return res.redirect(socialRedirect(APP_URL, { google: 'error', reason: oauthError }))
    }

    // ── Étape 2 : Vérifier le state puis échanger le code contre un token ──
    if (!code) {
      return res.status(400).json({ error: 'Paramètre code manquant' })
    }
    const checked = await verifyOAuthState(state, 'google')
    if (checked.error) {
      return res.redirect(socialRedirect(APP_URL, { google: 'error', reason: checked.error }))
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })

    const tokenData = await tokenRes.json()

    if (tokenData.error) {
      console.error('Google token error:', tokenData.error)
      return res.redirect(socialRedirect(APP_URL, { google: 'error', reason: 'token_exchange' }))
    }

    const accessToken = tokenData.access_token
    const refreshToken = tokenData.refresh_token
    const expiresIn = tokenData.expires_in || 3600

    // ── Étape 3 : Récupérer les comptes GMB ─────────────
    let accountName = null
    let locationName = null
    let locationId = null

    try {
      // Lister les comptes
      const accountsRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const accountsData = await accountsRes.json()
      console.log('GMB accounts response:', JSON.stringify(accountsData).slice(0, 500))

      if (accountsData.accounts && accountsData.accounts.length > 0) {
        const account = accountsData.accounts[0]
        accountName = account.name // format: accounts/123456
        console.log('GMB account found:', accountName)

        // Lister les fiches (locations)
        const locationsRes = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title,storefrontAddress`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        const locationsData = await locationsRes.json()
        console.log('GMB locations response:', JSON.stringify(locationsData).slice(0, 500))

        if (locationsData.locations && locationsData.locations.length > 0) {
          const location = locationsData.locations.find(l =>
            l.title?.toLowerCase().includes('access')
          ) || locationsData.locations[0]

          locationName = location.title
          locationId = location.name // format: locations/123456
          console.log('GMB location found:', locationName, locationId)
        } else {
          console.log('No locations found, trying alternative endpoint...')
          // Essayer l'endpoint alternatif
          const altRes = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
          const altData = await altRes.json()
          console.log('GMB alt locations response:', JSON.stringify(altData).slice(0, 500))
        }
      } else {
        console.log('No GMB accounts found. Error details:', JSON.stringify(accountsData))
      }
    } catch (gmbErr) {
      console.error('GMB account lookup error:', gmbErr.message)
    }

    // ── Étape 4 : Stocker dans Supabase ─────────────────
    await supabase.from('social_tokens').upsert({
      platform: 'gmb',
      access_token: accessToken,
      refresh_token: refreshToken || null,
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      account_id: accountName,
      page_id: locationId,
      metadata: {
        location_name: locationName,
        account_name: accountName,
        location_id: locationId,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'platform' })

    // ── Succès ! ────────────────────────────────────────
    return res.redirect(socialRedirect(APP_URL, { google: 'success', location: locationName || 'compte connecté' }))

  } catch (err) {
    console.error('Google OAuth handler error:', err)
    return res.redirect(socialRedirect(APP_URL, { google: 'error', reason: 'server_error' }))
  }
}
