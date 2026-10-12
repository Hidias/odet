// Parc et visites : clients suivis (appareils, retards), recherche, accès au parc d'un client.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, Loader2, ChevronRight } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { useAuthStore } from '../../../core/store'
import { loadClientsLight } from '../lib/itvData'
import { todayIso } from '../lib/schedule'
import { ScanButton, Empty } from '../components/ui'

export default function Parc({ isManager, profile }) {
  // Technicien de terrain : seulement les clients de ses propres visites.
  const fieldOnly = useAuthStore((st) => st.fieldOnly)
  const navigate = useNavigate()
  const [clients, setClients] = useState(null)
  const [stats, setStats] = useState({})
  const [q, setQ] = useState('')
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    (async () => {
      const [cl0, { data: eq }, { data: ct }, { data: mine }] = await Promise.all([
        loadClientsLight(),
        supabase.from('itv_equipment').select('client_id, next_check_on, status').neq('status', 'retire'),
        supabase.from('itv_contracts').select('client_id').eq('status', 'actif'),
        fieldOnly && profile?.id ? supabase.from('itv_visits').select('client_id').eq('technician_id', profile.id) : { data: null },
      ])
      const allowed = mine ? new Set(mine.map((v) => v.client_id)) : null
      const cl = allowed ? (cl0 || []).filter((c) => allowed.has(c.id)) : cl0
      const t = todayIso()
      const st = {}
      for (const e of eq || []) {
        const s = (st[e.client_id] = st[e.client_id] || { total: 0, late: 0, replace: 0 })
        s.total += 1
        if (e.next_check_on && e.next_check_on < t) s.late += 1
        if (e.status === 'a_remplacer') s.replace += 1
      }
      for (const c of ct || []) (st[c.client_id] = st[c.client_id] || { total: 0, late: 0, replace: 0 }).contract = true
      setStats(st); setClients(cl || [])
    })()
  }, [fieldOnly, profile?.id])

  const list = useMemo(() => {
    const n = q.trim().toLowerCase()
    return (clients || [])
      .filter((c) => (showAll || n || fieldOnly ? true : stats[c.id]))
      .filter((c) => !n || `${c.name} ${c.city || ''}`.toLowerCase().includes(n))
      .sort((a, b) => ((stats[b.id]?.late || 0) - (stats[a.id]?.late || 0)) || a.name.localeCompare(b.name, 'fr', { numeric: true }))
  }, [clients, stats, q, showAll])

  if (!clients) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  const followed = fieldOnly ? clients.length : Object.keys(stats).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <label className="sr-only" htmlFor="itv-parc-q">Rechercher un client</label>
          <input id="itv-parc-q" className="input" style={{ paddingLeft: 36 }} placeholder="Client ou ville" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ScanButton className="btn btn-secondary" label="Scanner" />
      </div>
      <div className="flex items-center gap-3 text-ui-sm">
        <span className="muted">{followed} clients suivis</span>
        {!fieldOnly && <label className="flex items-center gap-2"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Afficher tous les clients (pour créer un parc)</label>}
      </div>
      {list.length === 0 ? (
        <Empty title="Aucun client suivi">{isManager ? 'Cochez « Afficher tous les clients » puis ouvrez un client pour créer son parc.' : 'Aucun parc enregistré pour le moment.'}</Empty>
      ) : (
        <div className="card card-flush">
          {list.map((c) => {
            const s = stats[c.id]
            return (
              <button key={c.id} type="button" onClick={() => navigate(`/interventions/parc/${c.id}`)} className="w-full text-left flex items-center gap-3 min-h-[56px] px-4 py-2 border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-ui truncate">{c.name}</div>
                  <div className="text-ui-sm text-gray-500">{[c.city, s ? `${s.total} appareils` : 'Pas de parc', s?.contract ? 'contrat' : null].filter(Boolean).join(', ')}</div>
                </div>
                {s?.late > 0 && <span className="badge badge-danger">{s.late} en retard</span>}
                {s?.replace > 0 && <span className="badge badge-warning">{s.replace} à remplacer</span>}
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </button>
            )
          })}
        </div>
      )}
      {!fieldOnly && <p className="muted text-ui-sm">Les clients viennent de la liste des clients ; rien n'est ressaisi. <Link to="/clients">Ouvrir les clients</Link></p>}
    </div>
  )
}
