// ═══════════════════════════════════════════════════════════
// VERCEL API ROUTE — OAuth Google (My Business)
// GET /api/auth/google?code=...
// GET /api/auth/google?action=connect (initie le flow OAuth)
// ═══════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const APP_URL = process.env.APP_URL || 'https://app.accessformation.pro'
const REDIRECT_URI = `${APP_URL}/api/auth/google`

export default async function handler(req, res) {
  try {
    const { code, action, error: oauthError } = req.query

    // ── Erreur OAuth ────────────────────────────────────
    if (oauthError) {
      console.error('Google OAuth error:', oauthError)
      return res.redirect(`${APP_URL}/#/social?google=error&reason=${oauthError}`)
    }

    // ── Étape 1 : Initier la connexion ──────────────────
    if (action === 'connect') {
      const scope = [
        'https://www.googleapis.com/auth/business.manage',
      ].join(' ')

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(scope)}&response_type=code&access_type=offline&prompt=consent`

      return res.redirect(authUrl)
    }

    // ── Étape 2 : Échanger le code contre un token ──────
    if (!code) {
      return res.status(400).json({ error: 'Missing code parameter' })
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
      return res.redirect(`${APP_URL}/#/social?google=error&reason=token_exchange`)
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
    return res.redirect(`${APP_URL}/#/social?google=success&location=${encodeURIComponent(locationName || 'compte connecté')}`)

  } catch (err) {
    console.error('Google OAuth handler error:', err)
    return res.redirect(`${APP_URL}/#/social?google=error&reason=server_error`)
  }
}
