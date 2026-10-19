import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Workflow } from 'lucide-react'
import { supabase } from '../../core/supabase'

// Frise du pilote sur la fiche session (fonction 13, 0160) : étapes préparées pour cette session, leur état et la
// raison d'un blocage. L'action manuelle reste toujours possible depuis la session.

const ETAPES = [
  ['convocation', 'Convocation'], ['rappel', 'Rappel'], ['emargement_manquant', 'Émargement'], ['eval_chaud', 'Évaluation à chaud'],
  ['attestations', 'Attestations'], ['facture_brouillon', 'Facture'], ['evaluation_froid', 'Évaluation à froid'], ['relance_impaye', 'Impayé'],
]
const STATUTS = { a_valider: 'à valider', valide: 'à envoyer', envoye: 'faite', ignore: 'ignorée', erreur: 'erreur' }
const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '')

export default function PiloteSession({ sessionId }) {
  const [actions, setActions] = useState(null)
  useEffect(() => {
    if (!sessionId) return
    supabase.from('scheduled_actions').select('id, kind, status, due_on, blocked_reason').eq('session_id', sessionId).order('due_on')
      .then(({ data, error }) => setActions(error ? [] : data || []))
  }, [sessionId])
  if (!actions || actions.length === 0) return null
  const parType = Object.fromEntries(actions.map((a) => [a.kind, a]))
  return (
    <div className="card space-y-2">
      <div className="flex items-center gap-2">
        <Workflow className="w-5 h-5 text-primary-600" />
        <h3 className="font-semibold flex-1">Pilote de la session</h3>
        <Link to="/a-valider" className="text-ui-sm text-accent-700 hover:underline">Relances à valider</Link>
      </div>
      <ol className="flex flex-wrap gap-2">
        {ETAPES.filter(([k]) => parType[k]).map(([k, l]) => {
          const a = parType[k]
          const ton = a.blocked_reason ? 'border-[rgb(var(--c-warning))] text-[rgb(var(--c-warning))]'
            : a.status === 'envoye' ? 'border-[rgb(var(--c-success))] text-[rgb(var(--c-success))]'
              : a.status === 'ignore' ? 'border-gray-200 text-gray-400' : 'border-gray-300 text-gray-700'
          return (
            <li key={k} className={`border rounded-ui-sm px-2.5 py-1.5 text-ui-sm ${ton}`}>
              <span className="font-medium">{l}</span> · {a.blocked_reason ? `bloquée : ${a.blocked_reason}` : `${STATUTS[a.status] || a.status}${a.due_on ? ` (${fr(a.due_on)})` : ''}`}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
