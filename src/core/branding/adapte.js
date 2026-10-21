import { useCallback } from 'react'
import { useAuthStore } from '../store'
import { normaliserAdapte } from './presets'

// Affichage adapté de la personne connectée : { facile, voix, grand, contraste } (décisions de H du 19/10).
export function useAdapte() {
  const profile = useAuthStore((s) => s.profile)
  return normaliserAdapte(profile?.ui_prefs?.adapte)
}

// ─── Lecture à voix haute (synthèse du navigateur : gratuite, le texte ne quitte pas l'appareil) ───

export const voixDisponible = () => typeof window !== 'undefined' && 'speechSynthesis' in window

// Les voix arrivent après le chargement de la page (Chrome) : on attend au plus une seconde
function voixFrancaise() {
  return new Promise((resolve) => {
    const choisir = () => window.speechSynthesis.getVoices().find((v) => /^fr(-|_|$)/i.test(v.lang)) || null
    const v = choisir()
    if (v || window.speechSynthesis.getVoices().length) { resolve(v); return }
    const fin = setTimeout(() => resolve(choisir()), 1000)
    window.speechSynthesis.addEventListener('voiceschanged', () => { clearTimeout(fin); resolve(choisir()) }, { once: true })
  })
}

// Découpe en phrases courtes : Chrome coupe les lectures longues au bout d'une quinzaine de secondes
export function decouperPhrases(texte, max = 220) {
  const propre = String(texte || '').replace(/\s+/g, ' ').trim()
  if (!propre) return []
  const phrases = propre.match(/[^.!?;:\n]+[.!?;:]*/g) || [propre]
  const out = []
  for (const p of phrases.map((x) => x.trim()).filter(Boolean)) {
    if (p.length <= max) { out.push(p); continue }
    let reste = p
    while (reste.length > max) {
      const coupe = reste.lastIndexOf(' ', max) > 40 ? reste.lastIndexOf(' ', max) : max
      out.push(reste.slice(0, coupe).trim())
      reste = reste.slice(coupe).trim()
    }
    if (reste) out.push(reste)
  }
  return out
}

let lectureEnCours = 0
export function arreterLecture() {
  lectureEnCours += 1
  try { if (voixDisponible()) window.speechSynthesis.cancel() } catch { /* rien à arrêter */ }
}

/** Lit un texte à voix haute ; onFin est appelé à la fin ou à l'arrêt. Renvoie false si le navigateur ne sait pas lire. */
export function parler(texte, { onFin } = {}) {
  if (!texte || !voixDisponible()) return false
  arreterLecture()
  const moi = lectureEnCours
  const morceaux = decouperPhrases(texte)
  if (!morceaux.length) return false
  voixFrancaise().then((voix) => {
    let i = 0
    const suivant = () => {
      if (moi !== lectureEnCours || i >= morceaux.length) { onFin?.(); return }
      const u = new SpeechSynthesisUtterance(morceaux[i++])
      u.lang = 'fr-FR'
      u.rate = 0.95
      if (voix) u.voice = voix
      u.onend = suivant
      u.onerror = () => onFin?.()
      window.speechSynthesis.speak(u)
    }
    // Chrome ignore une lecture lancée juste après cancel() : petit délai
    setTimeout(suivant, 60)
  })
  return true
}

/** Texte à lire : la sélection si la personne en a fait une, sinon le contenu de la page (titre compris) */
export function texteALire(racine) {
  try {
    const sel = window.getSelection?.()?.toString()?.trim()
    if (sel) return sel
  } catch { /* pas de sélection */ }
  const zone = racine || document.querySelector('main') || document.body
  return (zone?.innerText || '').slice(0, 4000)
}

// ─── Dictée (reconnaissance vocale du navigateur) ───
// Le son est transformé en texte par le service du navigateur (Google pour Chrome et Android, Apple pour Safari) :
// rien n'est enregistré par l'outil. Firefox ne propose pas la dictée.

function Reconnaissance() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}
export const dicteeDisponible = () => !!Reconnaissance()

/** Démarre une dictée en français. Renvoie une fonction pour l'arrêter. */
export function demarrerDictee({ onTexte, onFin, onErreur } = {}) {
  const R = Reconnaissance()
  if (!R) { onErreur?.('indisponible'); return () => {} }
  const r = new R()
  r.lang = 'fr-FR'
  r.interimResults = false
  r.continuous = false
  r.maxAlternatives = 1
  r.onresult = (e) => {
    const t = Array.from(e.results).filter((x) => x.isFinal).map((x) => x[0]?.transcript || '').join(' ').trim()
    if (t) onTexte?.(t)
  }
  r.onerror = (e) => onErreur?.(e.error || 'erreur')
  r.onend = () => onFin?.()
  try { r.start() } catch (e) { onErreur?.(e?.message || 'erreur'); return () => {} }
  return () => { try { r.stop() } catch { /* déjà arrêtée */ } }
}

/** Ajoute le texte dicté dans une case de saisie, en prévenant React comme une frappe au clavier */
export function insererTexte(el, texte) {
  if (!el || !texte) return
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  const avant = el.value || ''
  const debut = typeof el.selectionStart === 'number' ? el.selectionStart : avant.length
  const fin = typeof el.selectionEnd === 'number' ? el.selectionEnd : avant.length
  const gauche = avant.slice(0, debut)
  const ajout = (gauche && !/\s$/.test(gauche) ? ' ' : '') + texte
  const valeur = gauche + ajout + avant.slice(fin)
  if (setter) setter.call(el, valeur); else el.value = valeur
  el.dispatchEvent(new Event('input', { bubbles: true }))
  try { const pos = (gauche + ajout).length; el.setSelectionRange(pos, pos) } catch { /* champ sans curseur */ }
}

/** Vrai pour une case où l'on écrit du texte (pas une date, une case à cocher, un nombre) */
export function caseDeTexte(el) {
  if (!el || el.disabled || el.readOnly) return false
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName !== 'INPUT') return false
  return ['text', 'search', 'email', ''].includes((el.getAttribute('type') || '').toLowerCase())
}

// Choix du texte : version facile quand le réglage est actif
export function useTexte() {
  const { facile } = useAdapte()
  return useCallback((normal, simple) => (facile && simple ? simple : normal), [facile])
}
