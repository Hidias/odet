// api/manifest.js : manifeste PWA généré depuis les paramètres de l'organisme
// (nom de l'application, nom court, couleurs, icônes). Public : aucune donnée sensible.

import { getSupabaseAdmin } from './_lib/mailer.js'

export default async function handler(req, res) {
  let b = {}
  try {
    const { data } = await getSupabaseAdmin().rpc('get_public_branding')
    b = data || {}
  } catch (e) {
    console.error('manifest :', e.message)
  }
  const name = b.app_name || b.org_name || 'Application'
  const shortName = (b.app_short_name || name).slice(0, 12)
  const theme = b.brand_nav || b.brand_primary || '#1C2024'
  const icon192 = b.icon_192_url || b.favicon_url || b.logo_url
  const icon512 = b.icon_512_url || b.logo_url || icon192
  const icons = []
  if (icon192) icons.push({ src: icon192, sizes: '192x192', purpose: 'any' })
  if (icon512) icons.push({ src: icon512, sizes: '512x512', purpose: 'any' })

  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300')
  return res.status(200).send(JSON.stringify({
    name,
    short_name: shortName,
    description: b.org_name ? `${name}, ${b.org_name}` : name,
    lang: 'fr',
    start_url: '/#/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#F4F5F7',
    theme_color: theme,
    icons,
  }))
}
