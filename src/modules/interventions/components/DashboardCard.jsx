// Encart du tableau de bord : vérifications en retard, à planifier ce mois-ci, remplacements à chiffrer.
// Affiché seulement si le module Interventions est actif.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPin } from 'lucide-react'
import { loadDashboard } from '../lib/itvData'

export default function InterventionsDashboardCard() {
  const [d, setD] = useState(null)
  useEffect(() => { loadDashboard().then(setD).catch(() => setD(null)) }, [])
  if (!d) return null
  const tiles = [
    { to: '/interventions/planning', value: d.late_sites, label: `site${d.late_sites > 1 ? 's' : ''} en retard (${d.late_equipment} appareils)`, tone: d.late_sites ? 'text-red-700' : 'text-gray-900' },
    { to: '/interventions/planning', value: d.due_month_sites + (d.unplanned_contract_visits || 0), label: 'visites à planifier ce mois-ci', tone: 'text-amber-800' },
    { to: '/interventions/parc', value: d.to_quote, label: 'remplacements à chiffrer', tone: d.to_quote ? 'text-amber-800' : 'text-gray-900' },
    { to: '/interventions/journee', value: d.today_visits, label: 'visites aujourd\'hui', tone: 'text-gray-900' },
  ]
  return (
    <section className="card space-y-3" aria-label="Interventions">
      <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-gray-500" /><h3 className="text-sm font-semibold text-gray-700">Interventions</h3></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {tiles.map((t) => (
          <Link key={t.label} to={t.to} className="rounded-lg border border-gray-100 hover:bg-gray-50 p-3 no-underline">
            <div className={`font-display font-semibold text-xl ${t.tone}`}>{t.value}</div>
            <div className="text-ui-sm text-gray-500">{t.label}</div>
          </Link>
        ))}
      </div>
    </section>
  )
}
