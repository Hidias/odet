// Planning et tournées : vérifications à planifier (échéances des appareils et visites de contrat), carte,
// tournée du jour par technicien. Glisser un site sur un technicien crée la visite ; glisser une visite
// change l'ordre de passage. Sur tablette et téléphone, le bouton « Placer » remplace le glisser-déposer.

import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ChevronLeft, ChevronRight, GripVertical, Loader2, X, Plus } from 'lucide-react'
import { loadDueSites, loadVisits, planSite, reorderVisits, updateVisit } from '../lib/itvData'
import { todayIso, isoDay, parseDay, daysBetween, routeKm, frShort } from '../lib/schedule'
import { Empty, Sheet } from '../components/ui'

const weekStart = (iso) => { const d = parseDay(iso); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return isoDay(d) }
const plusDays = (iso, n) => { const d = parseDay(iso); d.setDate(d.getDate() + n); return isoDay(d) }
const endOfNextMonth = () => { const d = new Date(); return isoDay(new Date(d.getFullYear(), d.getMonth() + 2, 0)) }
const dept = (cp) => String(cp || '').slice(0, 2)

function numberIcon(n, color) {
  return L.divIcon({
    className: '',
    html: `<div style="width:26px;height:26px;border-radius:13px;background:${color};color:#fff;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font:600 12px system-ui,sans-serif">${n}</div>`,
    iconSize: [26, 26], iconAnchor: [13, 13],
  })
}

function FitBounds({ points }) {
  const map = useMap()
  useEffect(() => {
    const pts = points.filter((p) => p[0] != null)
    if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 12 })
  }, [JSON.stringify(points)]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export default function Planning({ technicians }) {
  const [day, setDay] = useState(todayIso())
  const [due, setDue] = useState(null)
  const [visits, setVisits] = useState([])
  const [sector, setSector] = useState('')
  const [placing, setPlacing] = useState(null)
  const [dragOver, setDragOver] = useState(null)

  const load = async () => {
    const [d, v] = await Promise.all([loadDueSites(endOfNextMonth()), loadVisits({ from: day, to: day })])
    setDue(d)
    setVisits((v || []).filter((x) => x.status !== 'annulee' && x.technician_id))
  }
  useEffect(() => { load().catch((e) => toast.error(e.message)) }, [day]) // eslint-disable-line react-hooks/exhaustive-deps

  const sectors = useMemo(() => {
    const m = new Map()
    for (const d of due || []) { const k = dept(d.site?.postal_code); if (k) m.set(k, (m.get(k) || 0) + 1) }
    return [...m.entries()].sort()
  }, [due])
  const dueList = useMemo(() => (due || []).filter((d) => !sector || dept(d.site?.postal_code) === sector || d.site?.city === sector), [due, sector])
  const byTech = useMemo(() => {
    const m = Object.fromEntries(technicians.map((t) => [t.id, []]))
    for (const v of visits) (m[v.technician_id] = m[v.technician_id] || []).push(v)
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.route_order - b.route_order)
    return m
  }, [visits, technicians])
  const today = todayIso()

  const place = async (d, techId) => {
    try {
      const n = (byTech[techId] || []).length
      await planSite(d, { day, technicianId: techId, order: n + 1 })
      toast.success(`${d.client?.name} placé le ${frShort(day, { year: false })}`)
      setPlacing(null); await load()
    } catch (e) { toast.error(e.message) }
  }
  const unplan = async (v) => {
    try { await updateVisit(v.id, { status: 'a_planifier', planned_on: null, technician_id: null, route_order: 0 }); await load() } catch (e) { toast.error(e.message) }
  }
  const moveVisit = async (visitId, techId, beforeId = null) => {
    const v = visits.find((x) => x.id === visitId)
    if (!v) return
    const list = (byTech[techId] || []).filter((x) => x.id !== visitId)
    const idx = beforeId ? list.findIndex((x) => x.id === beforeId) : list.length
    list.splice(idx < 0 ? list.length : idx, 0, v)
    setVisits((all) => all.map((x) => (x.id === visitId ? { ...x, technician_id: techId } : x)).map((x) => { const i = list.findIndex((y) => y.id === x.id); return i >= 0 ? { ...x, route_order: i + 1 } : x }))
    try {
      if (v.technician_id !== techId) await updateVisit(visitId, { technician_id: techId })
      await reorderVisits(list.map((x) => x.id))
    } catch (e) { toast.error(e.message); load() }
  }
  const onDrop = async (e, techId, beforeId = null) => {
    e.preventDefault(); setDragOver(null)
    let data
    try { data = JSON.parse(e.dataTransfer.getData('text/plain')) } catch { return }
    if (data.kind === 'due') { const d = (due || []).find((x) => x.site_id === data.siteId); if (d) await place(d, techId) }
    if (data.kind === 'visit') await moveVisit(data.id, techId, beforeId)
  }

  const ws = weekStart(day)
  const week = [0, 1, 2, 3, 4].map((i) => plusDays(ws, i))
  const mapPoints = [
    ...visits.filter((v) => v.sites?.latitude != null).map((v) => [v.sites.latitude, v.sites.longitude]),
    ...dueList.filter((d) => d.site?.latitude != null).map((d) => [d.site.latitude, d.site.longitude]),
  ]

  if (!due) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-secondary btn-icon" onClick={() => setDay(plusDays(ws, -7))} aria-label="Semaine précédente"><ChevronLeft className="w-5 h-5" /></button>
        <div className="flex gap-1 flex-wrap">
          {week.map((d) => (
            <button key={d} type="button" onClick={() => setDay(d)} aria-pressed={d === day}
              className={`btn btn-sm capitalize ${d === day ? 'bg-gray-900 text-white border-gray-900' : 'btn-secondary'} ${d === today ? 'ring-1 ring-accent-500' : ''}`}>
              {parseDay(d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-secondary btn-icon" onClick={() => setDay(plusDays(ws, 7))} aria-label="Semaine suivante"><ChevronRight className="w-5 h-5" /></button>
        <span className="muted text-ui-sm ml-auto">Glisser un site sur un technicien, ou « Placer »</span>
      </div>

      {technicians.length === 0 && <div className="card text-ui-sm">Aucun technicien : cochez les comptes concernés dans <Link to="/interventions/reglages">Réglages, Techniciens</Link>.</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)_380px] gap-3 items-start">
        {/* À planifier */}
        <section className="card space-y-2 xl:max-h-[calc(100vh-220px)] xl:overflow-y-auto" aria-label="Vérifications à planifier">
          <div className="flex items-center justify-between"><h2 className="section-title">À planifier</h2><span className="muted text-ui-sm">{dueList.length} sites</span></div>
          {sectors.length > 1 && (
            <select className="select" aria-label="Secteur" value={sector} onChange={(e) => setSector(e.target.value)}>
              <option value="">Tous les secteurs</option>
              {sectors.map(([k, n]) => <option key={k} value={k}>Département {k} ({n})</option>)}
            </select>
          )}
          {dueList.length === 0 && <p className="muted text-ui-sm">Rien à planifier d'ici la fin du mois prochain.</p>}
          {dueList.map((d) => {
            const late = d.first_due && d.first_due < today
            const n = d.first_due ? daysBetween(today, d.first_due) : null
            const fam = Object.entries(d.families || {}).map(([f, c]) => `${c} ${f.toLowerCase()}`).join(', ')
            return (
              <div key={d.site_id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'due', siteId: d.site_id }))}
                className="flex gap-2 p-2.5 rounded-lg border border-gray-200 bg-white cursor-grab active:cursor-grabbing">
                <GripVertical className="w-4 h-4 text-gray-300 flex-none mt-0.5 hidden xl:block" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-ui truncate">{d.client?.name}</div>
                  <div className="text-ui-sm text-gray-500 truncate">{[d.site?.city, fam || (d.pending_visit ? 'visite de contrat' : null), d.contract ? 'contrat' : null].filter(Boolean).join('. ')}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {d.first_due && <span className={`badge ${late ? 'badge-danger' : n <= 31 ? 'badge-warning' : 'badge-neutral'}`}>{late ? `${n} j` : frShort(d.first_due, { year: false })}</span>}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlacing(d)} disabled={!technicians.length}>Placer</button>
                </div>
              </div>
            )
          })}
        </section>

        {/* Carte */}
        <section className="card card-flush overflow-hidden order-last xl:order-none" style={{ height: 'min(70vh, 640px)' }} aria-label="Carte des visites">
          <MapContainer center={[47.9, -4.0]} zoom={9} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <FitBounds points={mapPoints} />
            {dueList.filter((d) => d.site?.latitude != null).map((d) => (
              <CircleMarker key={`d-${d.site_id}`} center={[d.site.latitude, d.site.longitude]} radius={7}
                pathOptions={{ color: '#ffffff', weight: 2, fillOpacity: 0.95, fillColor: d.first_due && d.first_due < today ? '#B91C1C' : '#B45309' }}>
                <Popup>
                  <div style={{ minWidth: 180 }}>
                    <strong>{d.client?.name}</strong><br />{d.site?.city}{d.first_due ? `, échéance ${frShort(d.first_due)}` : ''}
                    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {technicians.map((t) => <button key={t.id} type="button" className="btn btn-secondary btn-sm" onClick={() => place(d, t.id)}>Placer pour {t.name}</button>)}
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
            {technicians.map((t) => {
              const list = (byTech[t.id] || []).filter((v) => v.sites?.latitude != null)
              return (
                <Fragment key={t.id}>
                  {list.length > 1 && <Polyline positions={list.map((v) => [v.sites.latitude, v.sites.longitude])} pathOptions={{ color: t.color, weight: 3, dashArray: '6 6' }} />}
                  {list.map((v, i) => (
                    <Marker key={v.id} position={[v.sites.latitude, v.sites.longitude]} icon={numberIcon(i + 1, t.color)}>
                      <Popup><strong>{v.clients?.name}</strong><br />{t.name}, passage {i + 1}</Popup>
                    </Marker>
                  ))}
                </Fragment>
              )
            })}
          </MapContainer>
        </section>

        {/* Tournées du jour */}
        <section className="card space-y-3" aria-label="Tournées du jour">
          <h2 className="section-title capitalize">{parseDay(day).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          {technicians.map((t) => {
            const list = byTech[t.id] || []
            const km = routeKm(list.map((v) => ({ lat: v.sites?.latitude, lng: v.sites?.longitude })))
            return (
              <div key={t.id} className={`space-y-1.5 rounded-lg p-1 ${dragOver === t.id ? 'bg-gray-50 ring-1 ring-gray-300' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(t.id) }} onDragLeave={() => setDragOver(null)} onDrop={(e) => onDrop(e, t.id)}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: t.color }} />{t.name}</span>
                  <span className="muted text-ui-sm">{list.length} visite{list.length > 1 ? 's' : ''}{km ? `, ${km} km environ` : ''}</span>
                </div>
                {list.map((v, i) => (
                  <div key={v.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'visit', id: v.id }))}
                    onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.stopPropagation(); onDrop(e, t.id, v.id) }}
                    className="flex items-center gap-2 p-2 rounded-lg border border-gray-200 bg-white cursor-grab">
                    <span className="w-6 h-6 rounded-full text-white text-xs font-semibold flex items-center justify-center flex-none" style={{ background: t.color }}>{i + 1}</span>
                    <Link to={`/interventions/visite/${v.id}`} className="flex-1 min-w-0 text-gray-900 no-underline">
                      <div className="text-ui font-medium truncate">{v.clients?.name}</div>
                      <div className="text-ui-sm text-gray-500 truncate">{[v.sites?.city, v.status === 'terminee' ? 'terminée' : v.status === 'en_cours' ? 'en cours' : null].filter(Boolean).join(', ')}</div>
                    </Link>
                    <div className="flex flex-col">
                      <button type="button" className="text-gray-500 hover:text-gray-900 disabled:opacity-30" aria-label="Monter" disabled={i === 0} onClick={() => moveVisit(v.id, t.id, list[i - 1]?.id)}><ChevronLeft className="w-4 h-4 rotate-90" /></button>
                      <button type="button" className="text-gray-500 hover:text-gray-900 disabled:opacity-30" aria-label="Descendre" disabled={i === list.length - 1} onClick={() => moveVisit(v.id, t.id, list[i + 2]?.id || null)}><ChevronRight className="w-4 h-4 rotate-90" /></button>
                    </div>
                    {v.status !== 'terminee' && v.status !== 'en_cours' && <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Retirer de la journée" onClick={() => unplan(v)}><X className="w-4 h-4" /></button>}
                  </div>
                ))}
                <div className="h-9 border border-dashed border-gray-300 rounded-lg flex items-center justify-center text-ui-sm text-gray-500"><Plus className="w-3.5 h-3.5 mr-1" />Déposer un site ici</div>
              </div>
            )
          })}
          {technicians.length > 0 && visits.length === 0 && <p className="muted text-ui-sm">Aucune visite ce jour-là.</p>}
        </section>
      </div>

      {placing && (
        <Sheet title={`Placer ${placing.client?.name}`} onClose={() => setPlacing(null)}>
          <p className="text-ui-sm text-gray-600">{[placing.site?.name, placing.site?.city].filter(Boolean).join(', ')}, le {frShort(day)}.</p>
          {technicians.map((t) => (
            <button key={t.id} type="button" className="btn btn-secondary w-full justify-start" onClick={() => place(placing, t.id)}>
              <span className="w-3 h-3 rounded-full" style={{ background: t.color }} />{t.name} ({(byTech[t.id] || []).length} visites)
            </button>
          ))}
        </Sheet>
      )}
      {due.length === 0 && visits.length === 0 && technicians.length > 0 && <Empty title="Rien à planifier">Les échéances apparaissent ici dès que des appareils sont enregistrés dans le parc des clients.</Empty>}
    </div>
  )
}
