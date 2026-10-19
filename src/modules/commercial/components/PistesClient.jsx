import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Route as RouteIcon } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { StatusBadge } from '../../../ui/StatusBadge'
import { SENS, STATUTS } from '../pages/Pistes'

// Pistes du client (fonction 10, 0130) sur sa fiche : formation et maintenance se répondent. Rien si aucune piste.

export default function PistesClient({ clientId }) {
  const [pistes, setPistes] = useState([])
  useEffect(() => {
    if (!clientId) return
    supabase.from('cross_sell_leads').select('id, direction, domain, status, created_at, quotes(reference)').eq('client_id', clientId)
      .order('created_at', { ascending: false }).limit(10)
      .then(({ data, error }) => setPistes(error ? [] : data || []))
  }, [clientId])
  if (!pistes.length) return null
  return (
    <div className="bg-white rounded-ui border border-gray-200">
      <div className="flex items-center gap-2 px-5 py-3.5">
        <RouteIcon className="w-5 h-5 text-primary-600" />
        <h2 className="font-semibold text-gray-900">Pistes</h2>
        <Link to="/pistes" className="ml-auto text-ui-sm text-accent-700 hover:underline">Toutes les pistes</Link>
      </div>
      <div className="px-5 pb-4 space-y-2">
        {pistes.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-2 p-2.5 bg-gray-50 rounded-ui-sm text-ui">
            <span className="min-w-0 truncate">{SENS[p.direction]} · {p.domain}{p.quotes?.reference ? ` · ${p.quotes.reference}` : ''}</span>
            <StatusBadge tone={STATUTS[p.status][0]}>{STATUTS[p.status][1]}</StatusBadge>
          </div>
        ))}
      </div>
    </div>
  )
}
