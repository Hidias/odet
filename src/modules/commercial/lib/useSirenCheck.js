// ═══════════════════════════════════════════════════════════════
// useSirenCheck.js - Vérification SIREN avant création client
// Utilisé par : Clients.jsx, le phoning, WeeklyPlanner.jsx, BudgetModule.jsx
//
// Usage :
//   const { checkSiren, sirenMatches, clearSirenCheck } = useSirenCheck()
//
//   // Avant de créer un client :
//   const matches = await checkSiren('412209926')
//   if (matches.length > 0) → afficher modale SirenConflictModal
//   else → créer directement
// ═══════════════════════════════════════════════════════════════

import { useState, useCallback } from 'react'
import { supabase } from '../../../core/supabase'

export function useSirenCheck() {
  const [sirenMatches, setSirenMatches] = useState([]) // clients existants avec ce SIREN
  const [checking, setChecking] = useState(false)

  /**
   * Extrait le SIREN depuis un SIRET ou SIREN brut
   * Retourne null si invalide ou manuel (MANUAL_xxx)
   */
  const extractSiren = (siretOrSiren) => {
    if (!siretOrSiren) return null
    const clean = siretOrSiren.replace(/\s/g, '')
    if (clean.startsWith('MANUAL_')) return null
    if (clean.length >= 9) return clean.slice(0, 9)
    return null
  }

  /**
   * Vérifie si un SIREN existe déjà dans clients
   * @param {string} siretOrSiren - SIRET (14 car) ou SIREN (9 car)
   * @returns {Array} - liste des clients existants avec ce SIREN (vide = pas de doublon)
   */
  const checkSiren = useCallback(async (siretOrSiren) => {
    const siren = extractSiren(siretOrSiren)
    if (!siren || siren.length !== 9) return []

    setChecking(true)
    try {
      const { data, error } = await supabase.rpc('check_siren_exists', { p_siren: siren })
      if (error) {
        console.error('useSirenCheck error:', error)
        return []
      }
      const matches = data || []
      setSirenMatches(matches)
      return matches
    } catch (err) {
      console.error('useSirenCheck error:', err)
      return []
    } finally {
      setChecking(false)
    }
  }, [])

  /**
   * Réinitialise l'état (fermeture modale, annulation)
   */
  const clearSirenCheck = useCallback(() => {
    setSirenMatches([])
  }, [])

  return {
    checkSiren,
    extractSiren,
    sirenMatches,
    checking,
    clearSirenCheck,
  }
}
