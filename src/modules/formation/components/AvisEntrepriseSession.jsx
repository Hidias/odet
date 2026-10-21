import { useEffect, useState } from 'react'
import { Building2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { QUESTIONS_ENTREPRISE } from '../../portail/components/AvisEntreprise'

// Satisfaction de l'entreprise (0415), côté organisme : avis donnés depuis l'espace entreprise pour cette session
// (une ligne par entreprise ; plusieurs en inter). Lecture seulement.

export default function AvisEntrepriseSession({ sessionId }) {
  const [avis, setAvis] = useState(null)
  useEffect(() => {
    if (!sessionId) return
    let actif = true
    supabase.from('client_satisfactions').select('*, clients(name)').eq('session_id', sessionId)
      .then(({ data, error }) => { if (actif) setAvis(error ? [] : data || []) })
    return () => { actif = false }
  }, [sessionId])
  if (!avis || avis.length === 0) return null
  return (
    <div className="card space-y-3">
      <h3 className="font-semibold flex items-center gap-2"><Building2 className="w-5 h-5 text-accent-600" aria-hidden="true" />Avis de l'entreprise</h3>
      {avis.map((a) => (
        <div key={a.id} className="border-t border-gray-100 pt-2 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-medium text-gray-900">{a.clients?.name || 'Entreprise'}</span>
            <span className="text-ui text-gray-700">Note globale : <strong>{a.note_globale}</strong> sur 5</span>
            {a.recommande != null && <span className="text-ui-sm text-gray-500">{a.recommande ? 'Recommande la formation' : 'Ne la recommande pas'}</span>}
            <span className="text-ui-sm text-gray-400">{new Date(a.updated_at).toLocaleDateString('fr-FR')}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-ui-sm text-gray-600">
            {QUESTIONS_ENTREPRISE.filter(([k]) => a[k]).map(([k, l]) => <span key={k}>{l} : {a[k]}/5</span>)}
          </div>
          {a.commentaire && <p className="text-ui text-gray-700 italic">« {a.commentaire} »</p>}
          {a.besoins && <p className="text-ui text-gray-700"><span className="font-medium">Besoins à venir :</span> {a.besoins}</p>}
        </div>
      ))}
    </div>
  )
}
