// Préréglages d'affichage (par utilisateur) et duos de polices (par organisme).

// Trois préréglages présentés dans les maquettes. Chacun est une combinaison
// de réglages fins que l'utilisateur peut ensuite ajuster un par un.
export const UI_PRESETS = {
  atelier: {
    label: 'Atelier',
    description: 'Sobre, menu sombre, la marque sur les accents',
    density: 'normal',
    nav: 'dark',
    radius: 'md',
    lists: 'table',
  },
  terrain: {
    label: 'Terrain',
    description: 'Chaleureux, arrondi, grands boutons, menu clair',
    density: 'large',
    nav: 'light',
    radius: 'lg',
    lists: 'cards',
  },
  cockpit: {
    label: 'Cockpit',
    description: 'Dense, barre d\'icônes et sous-menu, tableaux d\'abord',
    density: 'compact',
    nav: 'rail',
    radius: 'sm',
    lists: 'table',
  },
}

export const DEFAULT_UI_PREFS = { preset: 'atelier', ...UI_PRESETS.atelier }

export const DENSITIES = ['compact', 'normal', 'large']
export const NAVS = ['dark', 'light', 'rail']
export const RADII = ['sm', 'md', 'lg']
export const LISTS = ['table', 'cards']
// Mode d'utilisation (par personne) : « simple » = menu limité aux pages du quotidien (le reste reste accessible par
// les onglets et l'adresse), « complet » = tout. Vide = choix par défaut selon le rôle (voir modeParDefaut).
export const MODES = ['simple', 'complet']
export function modeParDefaut(role) {
  return role === 'superadmin' ? 'complet' : 'simple'
}

// Duos de polices auto-hébergés (fichiers dans node_modules/@fontsource).
export const FONT_PAIRS = {
  atelier: { label: 'Sora et Instrument Sans', display: "'Sora', system-ui, sans-serif", body: "'Instrument Sans', system-ui, sans-serif" },
  terrain: { label: 'Bricolage Grotesque et Public Sans', display: "'Bricolage Grotesque', system-ui, sans-serif", body: "'Public Sans', system-ui, sans-serif" },
  cockpit: { label: 'Space Grotesk et IBM Plex Sans', display: "'Space Grotesk', system-ui, sans-serif", body: "'IBM Plex Sans', system-ui, sans-serif" },
  lisibilite: { label: 'Atkinson Hyperlegible Next', display: "'Atkinson Hyperlegible Next', system-ui, sans-serif", body: "'Atkinson Hyperlegible Next', system-ui, sans-serif" },
}

// Normalise un objet de préférences (valeurs inconnues ramenées au préréglage)
export function normalizeUiPrefs(raw) {
  const preset = UI_PRESETS[raw?.preset] ? raw.preset : 'atelier'
  const base = UI_PRESETS[preset]
  return {
    preset,
    density: DENSITIES.includes(raw?.density) ? raw.density : base.density,
    nav: NAVS.includes(raw?.nav) ? raw.nav : base.nav,
    radius: RADII.includes(raw?.radius) ? raw.radius : base.radius,
    lists: LISTS.includes(raw?.lists) ? raw.lists : base.lists,
    mode: MODES.includes(raw?.mode) ? raw.mode : null,
    // Affichage adapté (décision de H du 19/10, 23h15) : réglage par personne, jamais de motif enregistré
    adapte: normaliserAdapte(raw?.adapte),
  }
}

export const OPTIONS_ADAPTE = [
  { key: 'facile', label: 'Français facile', aide: 'Phrases courtes et mots simples sur les écrans de terrain' },
  { key: 'voix', label: 'Lecture à voix haute', aide: 'Un bouton lit les consignes à voix haute' },
  { key: 'grand', label: 'Texte agrandi', aide: 'Textes et boutons plus grands' },
  { key: 'contraste', label: 'Contraste renforcé', aide: 'Textes plus foncés, plus faciles à lire' },
]
export function normaliserAdapte(a) {
  const o = {}
  for (const { key } of OPTIONS_ADAPTE) if (a && a[key] === true) o[key] = true
  return o
}

// Applique les préférences sur <html> (lues par le CSS via les attributs data-*)
export function applyUiPrefs(prefs) {
  const p = normalizeUiPrefs(prefs)
  const el = document.documentElement
  el.dataset.density = p.density
  el.dataset.nav = p.nav
  el.dataset.radius = p.radius
  el.dataset.lists = p.lists
  for (const { key } of OPTIONS_ADAPTE) {
    const attr = `adapte${key.charAt(0).toUpperCase()}${key.slice(1)}`
    if (p.adapte[key]) el.dataset[attr] = '1'
    else delete el.dataset[attr]
  }
  return p
}
