// Outils couleur : génération d'une échelle 50..900 à partir d'une seule couleur,
// contraste du texte, conversion en canaux RGB pour les variables CSS.

export function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  const n = parseInt(full, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function rgbToHex({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      default: h = (r - g) / d + 4
    }
    h /= 6
  }
  return { h: h * 360, s: s * 100, l: l * 100 }
}

export function hslToRgb({ h, s, l }) {
  h = ((h % 360) + 360) % 360 / 360; s /= 100; l /= 100
  if (s === 0) { const v = l * 255; return { r: v, g: v, b: v } }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return { r: f(h + 1 / 3) * 255, g: f(h) * 255, b: f(h - 1 / 3) * 255 }
}

// Luminance relative (WCAG)
export function luminance(rgb) {
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b)
}

// Couleur de texte lisible sur un fond donné : blanc ou quasi noir
export function foregroundFor(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return '#ffffff'
  return luminance(rgb) > 0.4 ? '#16181D' : '#ffffff'
}

// Échelle 50..900. 500 = la couleur fournie, 600 = survol, 700 = enfoncé.
// Les teintes claires gardent la teinte, avec une saturation adoucie.
export function buildScale(hex) {
  const rgb = hexToRgb(hex) || hexToRgb('#1C2024')
  const base = rgbToHsl(rgb)
  const light = (l, sat = base.s * 0.75) => rgbToHex(hslToRgb({ h: base.h, s: Math.min(sat, 90), l }))
  const dark = (factor) => rgbToHex(hslToRgb({ h: base.h, s: base.s, l: Math.max(base.l * factor, 4) }))
  return {
    50: light(97, base.s * 0.5),
    100: light(93, base.s * 0.6),
    200: light(85),
    300: light(72),
    400: light(60, base.s * 0.9),
    500: rgbToHex(rgb),
    600: dark(0.85),
    700: dark(0.7),
    800: dark(0.55),
    900: dark(0.4),
  }
}

export function rgbChannels(hex) {
  const rgb = hexToRgb(hex)
  return rgb ? `${Math.round(rgb.r)} ${Math.round(rgb.g)} ${Math.round(rgb.b)}` : '0 0 0'
}

export function isDark(hex) {
  const rgb = hexToRgb(hex)
  return rgb ? luminance(rgb) < 0.25 : true
}
