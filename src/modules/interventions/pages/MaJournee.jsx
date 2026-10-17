// Ma journée : visites du technicien pour un jour, dans l'ordre fixé au bureau.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Navigation, Phone, Loader2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { loadVisits } from '../lib/itvData'
import { todayIso, isoDay, parseDay, routeKm, summarize } from '../lib/schedule'
import { ScanButton, VisitBadge, Kpi, Empty, DueBadge } from '../components/ui'

const dayLabel = (iso) => parseDay(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const shiftDay = (iso, n) => { const d = parseDay(iso); d.setDate(d.getDate() + n); return isoDay(d) }
export const mapsUrl = (site) => site?.latitude != null
  ? `https://www.google.com/maps/dir/?api=1&destination=${site.latitude},${site.longitude}`
  : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([site?.address, site?.postal_code, site?.city].filter(Boolean).join(' '))}`

export default function MaJournee({ technicians, isManager, isTechnician, profile }) {
  const [day, setDay] = useState(todayIso())
  const [techId, setTechId] = useState(isTechnician ? profile?.id : (technicians[0]?.id || null))
  const [visits, setVisits] = useState(null)
  const [counts, setCounts] = useState({})
  const [contacts, setContacts] = useState({})

  useEffect(() => {
    if (!techId) { setVisits([]); return }
    let alive = true
    setVisits(null)
    ;(async () => {
      const vs = (await loadVisits({ from: day, to: day, technicianId: techId })).filter((v) => v.status !== 'annulee')
      vs.sort((a, b) => (a.route_order - b.route_order) || String(a.planned_time || '').localeCompare(String(b.planned_time || '')))
      const siteIds = [...new Set(vs.map((v) => v.site_id))]
      const clientIds = [...new Set(vs.map((v) => v.client_id))]
      const [{ data: eq }, { data: cc }, { data: items }] = await Promise.all([
        siteIds.length ? supabase.from('itv_equipment').select('site_id, itv_equipment_types(family)').in('site_id', siteIds).neq('status', 'retire') : { data: [] },
        clientIds.length ? supabase.from('client_contacts').select('client_id, phone, mobile, is_primary').in('client_id', clientIds).order('is_primary', { ascending: false }) : { data: [] },
        vs.length ? supabase.from('itv_visit_items').select('visit_id, result').in('visit_id', vs.map((v) => v.id)) : { data: [] },
      ])
      const c = {}
      for (const e of eq || []) {
        const s = (c[e.site_id] = c[e.site_id] || { total: 0, fam: {} })
        s.total += 1
        const f = e.itv_equipment_types?.family || 'Autre'
        s.fam[f] = (s.fam[f] || 0) + 1
      }
      for (const v of vs) v.progress = summarize((items || []).filter((i) => i.visit_id === v.id))
      const ph = {}
      for (const x of cc || []) if (!ph[x.client_id] && (x.mobile || x.phone)) ph[x.client_id] = x.mobile || x.phone
      if (alive) { setVisits(vs); setCounts(c); setContacts(ph) }
    })()
    return () => { alive = false }
  }, [day, techId])

  const total = useMemo(() => (visits || []).reduce((s, v) => s + (counts[v.site_id]?.total || 0), 0), [visits, counts])
  const km = useMemo(() => routeKm((visits || []).map((v) => ({ lat: v.sites?.latitude, lng: v.sites?.longitude }))), [visits])

  if (!isTechnician && !isManager) return <Empty title="Réservé aux techniciens">Un responsable peut vous ajouter aux techniciens dans Interventions, Réglages.</Empty>

  return (
    <div className="space-y-3 max-w-xl">
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-secondary btn-icon" onClick={() => setDay(shiftDay(day, -1))} aria-label="Jour précédent"><ChevronLeft className="w-5 h-5" /></button>
        <button type="button" className="flex-1 text-center font-semibold capitalize" onClick={() => setDay(todayIso())} title="Revenir à aujourd'hui">{dayLabel(day)}</button>
        <button type="button" className="btn btn-secondary btn-icon" onClick={() => setDay(shiftDay(day, 1))} aria-label="Jour suivant"><ChevronRight className="w-5 h-5" /></button>
        <ScanButton className="btn btn-primary btn-icon" label="" />
      </div>

      {isManager && technicians.length > 0 && (
        <div>
          <label className="label" htmlFor="itv-tech">Technicien</label>
          <select id="itv-tech" className="select" value={techId || ''} onChange={(e) => setTechId(e.target.value)}>
            {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      {visits === null ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : visits.length === 0 ? (
        <Empty title="Aucune visite ce jour-là">{isManager ? 'Les visites se placent dans Planning et tournées.' : 'Votre planning est préparé au bureau.'}</Empty>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Kpi value={visits.length} label={visits.length > 1 ? 'visites' : 'visite'} />
            <Kpi value={total} label="appareils" />
            <Kpi value={km ? `${km} km` : '-'} label="environ" />
          </div>
          {visits.map((v, i) => {
            const c = counts[v.site_id] || { total: 0, fam: {} }
            const current = v.status === 'en_cours'
            const done = v.status === 'terminee'
            const famText = Object.entries(c.fam).map(([f, n]) => `${n} ${f.toLowerCase()}`).join(', ')
            return (
              <div key={v.id} className={`card space-y-3 ${current ? 'ring-2 ring-accent-500' : ''}`}>
                <Link to={`/interventions/visite/${v.id}`} className="flex gap-3 items-start no-underline text-gray-900">
                  <span className={`w-8 h-8 rounded-full flex-none flex items-center justify-center font-display font-semibold ${current ? 'bg-accent-500 text-accent-fg' : done ? 'bg-[rgb(var(--c-success))] text-white' : 'bg-gray-100 text-gray-800'}`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{v.clients?.name}</div>
                    <div className="text-ui-sm text-gray-500">{[v.sites?.city, v.sites?.name].filter(Boolean).join(', ')}</div>
                    <div className="text-ui-sm text-gray-500">{[v.planned_time ? v.planned_time.slice(0, 5).replace(':', 'h') : null, famText || `${c.total} appareils`].filter(Boolean).join(', ')}</div>
                  </div>
                  {v.due_on && String(v.due_on).slice(0, 7) < todayIso().slice(0, 7) && !done ? <DueBadge date={v.due_on} short /> : <VisitBadge status={v.status} />}
                </Link>
                {(current || done) && v.progress?.total > 0 && (
                  <div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${done ? 'bg-[rgb(var(--c-success))]' : 'bg-accent-500'}`} style={{ width: `${Math.round((v.progress.done / v.progress.total) * 100)}%` }} /></div>
                    <div className="text-ui-sm text-gray-500 mt-1">{v.progress.done} appareils contrôlés sur {v.progress.total}</div>
                  </div>
                )}
                {!done && (
                  <div className="flex gap-2">
                    <a className="btn btn-secondary flex-1" href={mapsUrl(v.sites)} target="_blank" rel="noreferrer"><Navigation className="w-4 h-4" />Itinéraire</a>
                    {contacts[v.client_id] && <a className="btn btn-secondary flex-1" href={`tel:${String(contacts[v.client_id]).replace(/\s/g, '')}`}><Phone className="w-4 h-4" />Appeler</a>}
                  </div>
                )}
                {v.sites?.access_notes && !done && <div className="text-ui-sm text-gray-600 bg-gray-50 rounded-ui-sm px-3 py-2">Accès : {v.sites.access_notes}</div>}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
