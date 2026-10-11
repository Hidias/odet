// ═══════════════════════════════════════════════════════════════
// useOrgForPDF.js — Hook React pour préparer l'organisation pour les PDFs
//
// Wrap `useDataStore` pour fournir un objet `organization` enrichi avec
// la signature dirigeant préchargée en base64 (prête pour jsPDF).
//
// Usage typique dans un composant qui génère des PDFs :
//
//   const { organization, isReady } = useOrgForPDF()
//   if (!isReady) return <Spinner />
//   // organization a maintenant dirigeant_signature_base64 si dispo
//   await generatePDF(..., { orgSettings: organization })
//
// Avantages :
// - Aucun race condition : isReady garantit que tout est chargé
// - Signature préchargée une seule fois et mémorisée (pas de fetch à chaque génération)
// - Compatible avec tous les générateurs qui acceptent orgSettings
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react'
import { useDataStore } from '../store'
import { prepareOrgForPDF } from './orgUtils'

/**
 * Hook qui retourne l'organisation prête pour les générateurs PDF.
 *
 * @returns {{ organization: object|null, isReady: boolean }}
 *   - organization : ligne organization_settings enrichie avec dirigeant_signature_base64
 *   - isReady : true quand l'organization est chargée ET la signature préchargée (ou échec gracieux)
 */
export function useOrgForPDF() {
  const rawOrganization = useDataStore(state => state.organization)
  const fetchOrganization = useDataStore(state => state.fetchOrganization)
  const [enrichedOrg, setEnrichedOrg] = useState(null)
  const [isReady, setIsReady] = useState(false)

  // 1. Charger organization au mount si pas déjà là
  useEffect(() => {
    if (!rawOrganization) {
      fetchOrganization()
    }
  }, [rawOrganization, fetchOrganization])

  // 2. Précharger la signature dès que rawOrganization est disponible
  useEffect(() => {
    let cancelled = false

    if (!rawOrganization) {
      setIsReady(false)
      setEnrichedOrg(null)
      return
    }

    // Si pas d'URL signature → ready directement, organization tel quel
    if (!rawOrganization.dirigeant_signature_url) {
      setEnrichedOrg(rawOrganization)
      setIsReady(true)
      return
    }

    // Sinon précharger
    setIsReady(false)
    prepareOrgForPDF(rawOrganization).then(enriched => {
      if (!cancelled) {
        setEnrichedOrg(enriched)
        setIsReady(true)
      }
    })

    return () => { cancelled = true }
  }, [rawOrganization])

  return { organization: enrichedOrg, isReady }
}
