// Fiches de démonstration (« Test ») : liste (table, identifiant) lue une fois par session avec public.demo_marques()
// (0052). Sert au badge « Test » et au bandeau des fiches, pour ne jamais confondre une donnée fictive avec une vraie.
// Avant la migration 0052, ou en cas d'erreur, la liste est vide : aucun badge, rien ne casse.

import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

let cache = null // Map<tbl, Set<id>>
let enCours = null
const abonnes = new Set()

export function indexerMarques(lignes) {
  const m = new Map()
  for (const l of lignes || []) {
    if (!l?.tbl || !l?.id) continue
    if (!m.has(l.tbl)) m.set(l.tbl, new Set())
    m.get(l.tbl).add(l.id)
  }
  return m
}

export function chargerMarquesDemo(force = false) {
  if (cache && !force) return Promise.resolve(cache)
  if (enCours && !force) return enCours
  enCours = (async () => {
    try {
      const { data, error } = await supabase.rpc('demo_marques')
      cache = error ? new Map() : indexerMarques(data)
    } catch {
      cache = new Map()
    }
    enCours = null
    abonnes.forEach((f) => f(cache))
    return cache
  })()
  return enCours
}

export function estDemo(marques, tbl, id) {
  return !!(id && marques?.get(tbl)?.has(id))
}

// const { estTest } = useMarquesDemo() ; estTest('clients', client.id)
export function useMarquesDemo() {
  const [marques, setMarques] = useState(cache)
  useEffect(() => {
    abonnes.add(setMarques)
    if (!cache) chargerMarquesDemo()
    else setMarques(cache)
    return () => { abonnes.delete(setMarques) }
  }, [])
  return { marques, estTest: (tbl, id) => estDemo(marques, tbl, id) }
}
