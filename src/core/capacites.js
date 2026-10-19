import { useEffect, useState } from 'react'
import { apiFetch } from './api'

// Services facultatifs de l'instance (assistant de rédaction par IA) : lus une fois par page ouverte.
// Tant que la réponse n'est pas arrivée, ou si elle échoue, le service est considéré comme absent :
// les modèles de texte prêts restent toujours disponibles (décision de H du 19/10).
let cache = null
let enCours = null

export function chargerCapacites() {
  if (cache) return Promise.resolve(cache)
  if (!enCours) {
    enCours = apiFetch('/api/capacites')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((j) => { cache = { ia: !!j?.ia }; return cache })
  }
  return enCours
}

export function useCapacites() {
  const [c, setC] = useState(cache || { ia: false })
  useEffect(() => { let ok = true; chargerCapacites().then((v) => { if (ok) setC(v) }); return () => { ok = false } }, [])
  return c
}
