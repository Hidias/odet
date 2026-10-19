import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { euros } from '../lib/previsionnel'

// Fiche client : « Attendu sur 12 mois » (fonction 12, 0150). Rien si aucune échéance connue.

export default function CaClient({ clientId }) {
  const [t, setT] = useState(null)
  useEffect(() => {
    if (!clientId) return
    supabase.from('v_recurring_revenue').select('montant_attendu, montant_devise, nb_sans_prix, nb_echeances').eq('client_id', clientId)
      .then(({ data, error }) => {
        if (error || !data?.length) { setT(null); return }
        setT(data.reduce((a, l) => ({ attendu: a.attendu + Number(l.montant_attendu || 0), devise: a.devise + Number(l.montant_devise || 0),
          sansPrix: a.sansPrix + Number(l.nb_sans_prix || 0), echeances: a.echeances + Number(l.nb_echeances || 0) }), { attendu: 0, devise: 0, sansPrix: 0, echeances: 0 }))
      })
  }, [clientId])
  if (!t) return null
  return (
    <div className="bg-white rounded-ui border border-gray-200 px-5 py-3.5 flex items-center gap-2 flex-wrap">
      <TrendingUp className="w-5 h-5 text-primary-600" />
      <span className="font-semibold text-gray-900">Attendu sur 12 mois : {euros(t.attendu)}</span>
      <span className="text-ui-sm text-gray-500">{t.echeances} échéance{t.echeances > 1 ? 's' : ''}{t.devise ? `, ${euros(t.devise)} déjà devisé` : ''}{t.sansPrix ? `, ${t.sansPrix} sans prix` : ''}</span>
      <Link to="/previsionnel" className="ml-auto text-ui-sm text-accent-700 hover:underline">Prévisionnel</Link>
    </div>
  )
}
