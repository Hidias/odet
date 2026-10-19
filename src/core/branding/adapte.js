import { useCallback } from 'react'
import { useAuthStore } from '../store'
import { normaliserAdapte } from './presets'

// Affichage adapté de la personne connectée : { facile, voix, grand, contraste } (décisions de H du 19/10).
export function useAdapte() {
  const profile = useAuthStore((s) => s.profile)
  return normaliserAdapte(profile?.ui_prefs?.adapte)
}

// Lecture à voix haute par le navigateur (gratuite, aucune donnée envoyée) ; voix française si le téléphone en a une
export function parler(texte) {
  try {
    if (!texte || typeof window === 'undefined' || !('speechSynthesis' in window)) return false
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(String(texte))
    u.lang = 'fr-FR'
    u.rate = 0.95
    const voix = window.speechSynthesis.getVoices().find((v) => /^fr/i.test(v.lang))
    if (voix) u.voice = voix
    window.speechSynthesis.speak(u)
    return true
  } catch { return false }
}

export const voixDisponible = () => typeof window !== 'undefined' && 'speechSynthesis' in window

// Choix du texte : version facile quand le réglage est actif
export function useTexte() {
  const { facile } = useAdapte()
  return useCallback((normal, simple) => (facile && simple ? simple : normal), [facile])
}
