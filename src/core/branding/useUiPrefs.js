import { useEffect, useState, useCallback } from 'react'
import { useAuthStore } from '../store'
import { applyUiPrefs, normalizeUiPrefs, UI_PRESETS } from './presets'

const LOCAL_KEY = 'odet.uiPrefs.v1'

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeLocal(p) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(p))
  } catch {
    // stockage indisponible
  }
}

// Préférences d'affichage de l'utilisateur courant : appliquées sur <html>,
// mémorisées sur le profil (tous appareils) et en cache local (démarrage sans clignotement).
export function useUiPrefs() {
  const profile = useAuthStore((s) => s.profile)
  const saveUiPrefs = useAuthStore((s) => s.saveUiPrefs)
  const [prefs, setPrefs] = useState(() => normalizeUiPrefs(readLocal() || {}))

  useEffect(() => {
    if (profile?.ui_prefs && Object.keys(profile.ui_prefs).length > 0) {
      const p = normalizeUiPrefs(profile.ui_prefs)
      setPrefs(p)
      writeLocal(p)
    }
    // Seulement quand on change d'utilisateur
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  useEffect(() => {
    applyUiPrefs(prefs)
  }, [prefs])

  const update = useCallback((patch) => {
    setPrefs((prev) => {
      // Choisir un préréglage remet tous les réglages fins à ceux du préréglage
      const base = patch.preset && patch.preset !== prev.preset
        ? { preset: patch.preset, ...UI_PRESETS[patch.preset] }
        : prev
      const next = normalizeUiPrefs({ ...base, ...patch })
      writeLocal(next)
      saveUiPrefs(next)
      return next
    })
  }, [saveUiPrefs])

  return { prefs, update }
}

// À appeler au tout premier rendu, avant que le profil soit chargé
export function applyCachedUiPrefs() {
  applyUiPrefs(normalizeUiPrefs(readLocal() || {}))
}
