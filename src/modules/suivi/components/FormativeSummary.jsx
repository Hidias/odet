// Résumé du suivi formatif d'un stagiaire, en lecture seule (onglets Certification SST et Objectifs).
// N'écrit rien et ne coche rien : la certification et la validation des objectifs restent décidées par le formateur.

import { useEffect, useState } from 'react'
import { useAuthStore } from '../../../core/store'
import { SF_MODULE, loadSessionSummary, traineeSummary, hasRoles, principalRole, effectiveStatus, indexEvaluations } from '../lib/sfData'

/** Charge une fois le résumé de la session ; null si le module est coupé ou la session sans séquence */
export function useFormativeSummary(sessionId) {
  const { modules } = useAuthStore()
  const enabled = (modules || []).includes(SF_MODULE)
  const [summary, setSummary] = useState(null)
  useEffect(() => {
    let alive = true
    if (!enabled || !sessionId) { setSummary(null); return undefined }
    loadSessionSummary(sessionId).then((s) => { if (alive) setSummary(s) })
    return () => { alive = false }
  }, [enabled, sessionId])
  return summary
}

/** Petite ligne : « Formatif : 9 A · 1 EC · 1 AR · sauveteur 1 fois » (+ compétences jamais vues en rôle principal) */
export default function FormativeSummary({ summary, traineeId, className = '' }) {
  if (!summary?.sequences?.length || !traineeId) return null
  const r = traineeSummary(summary.sequences, summary.evaluations, traineeId)
  const roleSeqs = summary.sequences.filter(hasRoles)
  const roleName = principalRole(roleSeqs[0])
  const idx = indexEvaluations(summary.evaluations)
  const notSeen = new Set()
  for (const s of roleSeqs) for (const c of s.competences || []) notSeen.add(c)
  for (const s of roleSeqs) {
    const row = idx.get(`${s.id}|${traineeId}`)
    if (row?.role && row.role === principalRole(s)) for (const c of s.competences || []) notSeen.delete(c)
  }
  const aRevoir = summary.sequences.filter((s) => effectiveStatus(s, idx.get(`${s.id}|${traineeId}`)).key === 'a_revoir').length
  const parts = [
    r.counts.acquis ? `${r.counts.acquis} A` : null,
    r.counts.en_cours ? `${r.counts.en_cours} EC` : null,
    aRevoir ? `${aRevoir} AR` : null,
    r.counts.non_observe ? `${r.counts.non_observe} NO` : null,
    r.counts.none ? `${r.counts.none} non noté${r.counts.none > 1 ? 's' : ''}` : null,
  ].filter(Boolean)
  return (
    <p className={`text-xs text-gray-600 ${className}`}>
      <span className="font-medium text-gray-700">Formatif :</span> {parts.join(' · ') || 'rien de noté'}
      {roleSeqs.length > 0 && <> · {String(roleName).toLowerCase()} {r.principal} fois</>}
      {roleSeqs.length > 0 && notSeen.size > 0 && <span className="text-amber-700"> · jamais vu en {String(roleName).toLowerCase()} sur {[...notSeen].sort().join(', ')}</span>}
    </p>
  )
}
