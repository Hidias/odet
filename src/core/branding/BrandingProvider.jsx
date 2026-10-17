import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabase'
import { buildScale, rgbChannels, foregroundFor, isDark } from './colors'
import { FONT_PAIRS } from './presets'
import { setOrgCache } from '../org/currentOrg'

// Marque de l'instance (logo, nom affiché, couleurs, polices), chargée au démarrage
// depuis organization_settings via la RPC publique get_public_branding, avec un cache
// local pour éviter le clignotement au chargement.

const CACHE_KEY = 'odet.branding.v1'

const FALLBACK = {
  org_name: '',
  app_name: 'Chargement',
  app_short_name: '',
  logo_url: null,
  logo_base64: null,
  logo_on_dark_url: null,
  favicon_url: null,
  brand_primary: '#1C2024',
  brand_accent: '#C8102E',
  brand_highlight: '#D9A62E',
  brand_nav: null,
  font_pair: 'atelier',
  setup_completed: false,
  activity_kind: 'of',
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? { ...FALLBACK, ...JSON.parse(raw) } : FALLBACK
  } catch {
    return FALLBACK
  }
}

function writeCache(b) {
  try {
    const { logo_base64, ...light } = b
    // Le logo en base64 peut être lourd : on ne le met en cache que s'il reste raisonnable
    const toStore = logo_base64 && logo_base64.length < 150000 ? { ...light, logo_base64 } : light
    localStorage.setItem(CACHE_KEY, JSON.stringify(toStore))
  } catch {
    // stockage indisponible : on fait sans
  }
}

function setVar(name, value) {
  document.documentElement.style.setProperty(name, value)
}

export function applyBranding(b) {
  const primary = buildScale(b.brand_primary || FALLBACK.brand_primary)
  const accent = buildScale(b.brand_accent || FALLBACK.brand_accent)
  const highlight = buildScale(b.brand_highlight || FALLBACK.brand_highlight)
  for (const [k, v] of Object.entries(primary)) setVar(`--c-primary-${k}`, rgbChannels(v))
  for (const [k, v] of Object.entries(accent)) setVar(`--c-accent-${k}`, rgbChannels(v))
  for (const [k, v] of Object.entries(highlight)) setVar(`--c-highlight-${k}`, rgbChannels(v))
  setVar('--c-primary-fg', rgbChannels(foregroundFor(primary[500])))
  setVar('--c-accent-fg', rgbChannels(foregroundFor(accent[500])))
  setVar('--c-highlight-fg', rgbChannels(foregroundFor(highlight[500])))

  // Fond de navigation : couleur dédiée, sinon la couleur principale si elle est sombre,
  // sinon un neutre sombre (un texte blanc sur une couleur claire serait illisible)
  const nav = b.brand_nav || (isDark(b.brand_primary) ? b.brand_primary : '#1C2024')
  setVar('--c-nav', rgbChannels(nav))
  setVar('--c-nav-fg', rgbChannels(foregroundFor(nav)))

  const pair = FONT_PAIRS[b.font_pair] || FONT_PAIRS.atelier
  setVar('--font-display', pair.display)
  setVar('--font-body', pair.body)

  if (b.app_name) document.title = b.app_name
  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = nav

  const iconHref = b.favicon_url || b.icon_192_url || b.logo_url
  if (iconHref) {
    let link = document.querySelector('link[rel="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.href = iconHref
    let apple = document.querySelector('link[rel="apple-touch-icon"]')
    if (!apple) {
      apple = document.createElement('link')
      apple.rel = 'apple-touch-icon'
      document.head.appendChild(apple)
    }
    apple.href = b.icon_192_url || iconHref
  }
}

const BrandingContext = createContext({ branding: FALLBACK, loaded: false, refresh: async () => {} })

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(readCache)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    applyBranding(branding)
  }, [branding])

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_public_branding')
    if (!error && data) {
      const next = { ...FALLBACK, ...data }
      setBranding(next)
      writeCache(next)
      setOrgCache(next)
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <BrandingContext.Provider value={{ branding, loaded, refresh }}>
      {children}
    </BrandingContext.Provider>
  )
}

export function useBranding() {
  return useContext(BrandingContext)
}

// Logo à afficher selon le fond (sombre ou clair)
export function brandLogo(branding, onDark = false) {
  if (onDark && branding.logo_on_dark_url) return branding.logo_on_dark_url
  return branding.logo_url || branding.logo_base64 || null
}

// Icône carrée de l'application (menu, connexion), sinon null : l'écran retombe sur le logo
export function appIcon(branding) {
  return branding.icon_192_url || branding.icon_512_url || null
}

