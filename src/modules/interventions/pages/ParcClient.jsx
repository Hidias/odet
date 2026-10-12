// Parc d'un client : sites (table sites existante), appareils, contrat, visites, étiquettes et registre.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Loader2, Plus, Printer, BookOpen, MapPin, Pencil, Play, CalendarPlus, ExternalLink } from 'lucide-react'
import {
  loadClient, loadSites, loadEquipmentForClient, loadContracts, loadVisits, createDefaultSite, saveSite, createVisit,
  loadVisitItems,
} from '../lib/itvData'
import { todayIso, frShort, monthLabel, dueState } from '../lib/schedule'
import { DueBadge, VisitBadge, Kpi, Empty, Sheet } from '../components/ui'
import EquipmentForm from '../components/EquipmentForm'
import { ContractForm } from './Contrats'
import { buildEtiquettesPDF } from '../pdf/etiquettesPDF'
import { buildRegistrePDF } from '../pdf/registrePDF'

export default function ParcClient({ settings, types, isManager, canWrite, isTechnician, profile }) {
  const { clientId } = useParams()
  const navigate = useNavigate()
  const [client, setClient] = useState(null)
  const [sites, setSites] = useState([])
  const [equipment, setEquipment] = useState([])
  const [contracts, setContracts] = useState([])
  const [visits, setVisits] = useState([])
  const [siteFilter, setSiteFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [editEq, setEditEq] = useState(null)
  const [editSite, setEditSite] = useState(null)
  const [editContract, setEditContract] = useState(null)
  const [busy, setBusy] = useState(null)

  const load = async () => {
    const [c, s, e, ct, v] = await Promise.all([loadClient(clientId), loadSites(clientId), loadEquipmentForClient(clientId), loadContracts(clientId), loadVisits({ clientId })])
    setClient(c); setSites((s || []).filter((x) => x.is_active !== false)); setEquipment(e || []); setContracts(ct || [])
    setVisits((v || []).sort((a, b) => String(b.planned_on || b.due_on || '').localeCompare(String(a.planned_on || a.due_on || ''))))
  }
  useEffect(() => { load().catch((e) => toast.error(e.message)) }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => equipment
    .filter((e) => !siteFilter || e.site_id === siteFilter)
    .filter((e) => !typeFilter || e.type_id === typeFilter)
    .sort((a, b) => String(a.sites?.name || '').localeCompare(String(b.sites?.name || ''), 'fr', { numeric: true }) || String(a.location || '').localeCompare(String(b.location || ''), 'fr', { numeric: true })),
  [equipment, siteFilter, typeFilter])

  if (!client) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>

  const late = equipment.filter((e) => dueState(e.next_check_on) === 'late').length
  const toReplace = equipment.filter((e) => e.status === 'a_remplacer').length
  const lastDone = visits.find((v) => v.status === 'terminee')

  const ensureSite = async () => {
    try { await createDefaultSite(client); await load(); toast.success('Site créé depuis l\'adresse du client') } catch (e) { toast.error(e.message) }
  }
  const labels = async () => {
    const rows = selected.size ? list.filter((e) => selected.has(e.id)) : list
    if (!rows.length) return
    setBusy('labels')
    try { const { doc, filename } = await buildEtiquettesPDF(rows, { client }); doc.save(filename) } catch (e) { toast.error(e.message) } finally { setBusy(null) }
  }
  const registre = async (site) => {
    setBusy(`reg-${site.id}`)
    try {
      const siteVisits = visits.filter((v) => v.site_id === site.id && v.status === 'terminee')
      const withItems = await Promise.all(siteVisits.map(async (v) => ({ ...v, items: await loadVisitItems(v.id) })))
      const { doc, filename } = await buildRegistrePDF({ client, site, equipment: equipment.filter((e) => e.site_id === site.id), visits: withItems, settings })
      doc.save(filename)
    } catch (e) { toast.error(e.message) } finally { setBusy(null) }
  }
  const visitNow = async (site) => {
    try {
      const open = visits.find((v) => v.site_id === site.id && ['planifiee', 'en_cours'].includes(v.status) && (!v.planned_on || v.planned_on <= todayIso()))
      if (open) { navigate(`/interventions/visite/${open.id}`); return }
      const v = await createVisit({ client_id: client.id, site_id: site.id, planned_on: todayIso(), technician_id: profile?.id || null, status: 'planifiee' })
      navigate(`/interventions/visite/${v.id}`)
    } catch (e) { toast.error(e.message) }
  }
  const toPlan = async (site) => {
    try {
      const firstDue = equipment.filter((e) => e.site_id === site.id).map((e) => e.next_check_on).filter(Boolean).sort()[0] || todayIso()
      await createVisit({ client_id: client.id, site_id: site.id, due_on: firstDue, status: 'a_planifier' })
      toast.success('Visite ajoutée à la liste « À planifier »'); load()
    } catch (e) { toast.error(e.message) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <div>
          <Link to="/interventions/parc" className="muted text-ui-sm">Parc et visites</Link>
          <h2 className="font-display font-semibold text-xl">{client.name}</h2>
          <div className="muted text-ui-sm">{[client.address, client.postal_code, client.city].filter(Boolean).join(' ')}</div>
        </div>
        <Link to={`/clients/${client.id}`} className="btn btn-ghost btn-sm"><ExternalLink className="w-4 h-4" />Fiche client</Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi value={equipment.length} label={`appareils, ${sites.length} site${sites.length > 1 ? 's' : ''}`} />
        <Kpi value={late} label="vérifications en retard" tone={late ? 'danger' : null} />
        <Kpi value={toReplace} label="à remplacer" tone={toReplace ? 'warning' : null} />
        <Kpi value={lastDone ? frShort(lastDone.started_at?.slice(0, 10) || lastDone.planned_on, { year: false }) : '-'} label="dernière visite" />
      </div>

      {/* Contrats */}
      <section className="card space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="section-title">Contrat de maintenance</h3>
          {isManager && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditContract({ client_id: client.id })}><Plus className="w-4 h-4" />Nouveau contrat</button>}
        </div>
        {contracts.length === 0 && <p className="muted text-ui-sm">Aucun contrat : les visites se planifient à l'échéance des appareils.</p>}
        {contracts.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
            <div className="flex-1 min-w-[200px]">
              <div className="font-semibold">{c.label}{c.reference ? ` (${c.reference})` : ''}</div>
              <div className="text-ui-sm text-gray-500">Visites en {(c.visit_months || []).map(monthLabel).join(' et ') || 'mois à définir'}. {Number(c.annual_price_ht || 0).toLocaleString('fr-FR')} € HT par an. Depuis le {frShort(c.start_on)}.</div>
            </div>
            <span className={`badge ${c.status === 'actif' ? 'badge-success' : 'badge-neutral'}`}>{c.status === 'actif' ? 'Actif' : c.status === 'suspendu' ? 'Suspendu' : 'Terminé'}</span>
            {isManager && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditContract(c)}><Pencil className="w-4 h-4" />Modifier</button>}
          </div>
        ))}
      </section>

      {/* Sites */}
      <section className="card space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="section-title">Sites</h3>
          {canWrite && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditSite({ client_id: client.id })}><Plus className="w-4 h-4" />Ajouter un site</button>}
        </div>
        {sites.length === 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="muted text-ui-sm flex-1">Aucun site. Le premier se crée depuis l'adresse de la fiche client.</p>
            {canWrite && <button type="button" className="btn btn-primary btn-sm" onClick={ensureSite}><MapPin className="w-4 h-4" />Créer le site principal</button>}
          </div>
        )}
        {sites.map((s) => {
          const n = equipment.filter((e) => e.site_id === s.id).length
          return (
            <div key={s.id} className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
              <div className="flex-1 min-w-[200px]">
                <div className="font-semibold">{s.name}</div>
                <div className="text-ui-sm text-gray-500">{[s.address, s.postal_code, s.city].filter(Boolean).join(' ')}. {n} appareils.{s.latitude == null ? ' Position non trouvée.' : ''}</div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => registre(s)} disabled={busy === `reg-${s.id}`}><BookOpen className="w-4 h-4" />Registre</button>
              {canWrite && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditSite(s)}><Pencil className="w-4 h-4" />Modifier</button>}
              {isManager && <button type="button" className="btn btn-ghost btn-sm" onClick={() => toPlan(s)}><CalendarPlus className="w-4 h-4" />À planifier</button>}
              {(isTechnician || isManager) && <button type="button" className="btn btn-secondary btn-sm" onClick={() => visitNow(s)}><Play className="w-4 h-4" />Visite maintenant</button>}
            </div>
          )
        })}
      </section>

      {/* Parc */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="section-title flex-1">Appareils</h3>
          {sites.length > 1 && (
            <select className="select" style={{ width: 'auto' }} aria-label="Site" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
              <option value="">Tous les sites</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <select className="select" style={{ width: 'auto' }} aria-label="Type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">Tous les types</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button type="button" className="btn btn-secondary" onClick={labels} disabled={!list.length || busy === 'labels'}><Printer className="w-4 h-4" />{selected.size ? `Étiquettes (${selected.size})` : 'Étiquettes'}</button>
          {canWrite && sites.length > 0 && <button type="button" className="btn btn-primary" onClick={() => setEditEq({})}><Plus className="w-4 h-4" />Ajouter un appareil</button>}
        </div>
        {list.length === 0 ? <Empty title="Aucun appareil">{sites.length ? 'Ajoutez les appareils un par un, ou pendant la première visite.' : 'Créez d\'abord un site.'}</Empty> : (
          <div className="card card-flush overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                <th style={{ width: 32 }}><input type="checkbox" aria-label="Tout sélectionner" checked={selected.size === list.length} onChange={(e) => setSelected(e.target.checked ? new Set(list.map((x) => x.id)) : new Set())} /></th>
                <th>Appareil</th><th className="hidden md:table-cell">Emplacement</th><th className="hidden sm:table-cell">Étiquette</th><th className="hidden md:table-cell">Dernière vérif.</th><th>Prochaine</th>
              </tr></thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id} className="cursor-pointer hover:bg-gray-50" onClick={() => navigate(`/interventions/appareil/${encodeURIComponent(e.label_code)}`)}>
                    <td onClick={(ev) => ev.stopPropagation()}><input type="checkbox" aria-label={`Sélectionner ${e.label_code}`} checked={selected.has(e.id)} onChange={(ev) => { const s = new Set(selected); if (ev.target.checked) s.add(e.id); else s.delete(e.id); setSelected(s) }} /></td>
                    <td><div className="font-medium">{e.itv_equipment_types?.name}</div><div className="text-ui-sm text-gray-500">{[e.brand, e.manufactured_year].filter(Boolean).join(', ')}<span className="md:hidden">{e.location ? ` ${e.location}` : ''}</span></div></td>
                    <td className="hidden md:table-cell">{[sites.length > 1 ? e.sites?.name : null, e.location].filter(Boolean).join(', ')}</td>
                    <td className="hidden sm:table-cell font-mono text-ui-sm">{e.label_code}</td>
                    <td className="hidden md:table-cell">{e.last_check_on ? frShort(e.last_check_on) : 'Jamais'}</td>
                    <td>{e.status === 'a_remplacer' ? <span className="badge badge-warning">À remplacer</span> : <DueBadge date={e.next_check_on} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Visites */}
      <section className="card space-y-1">
        <h3 className="section-title">Visites</h3>
        {visits.length === 0 && <p className="muted text-ui-sm">Aucune visite.</p>}
        {visits.map((v) => (
          <Link key={v.id} to={`/interventions/visite/${v.id}`} className="flex items-center gap-2 py-2 border-b border-gray-100 last:border-b-0 no-underline text-gray-900">
            <div className="flex-1 min-w-0">
              <div className="text-ui font-medium">{v.planned_on ? frShort(v.planned_on) : `Échéance ${frShort(v.due_on)}`}, {v.sites?.name}</div>
              <div className="text-ui-sm text-gray-500">{[v.reference, v.itv_contracts ? 'contrat' : null].filter(Boolean).join(', ')}</div>
            </div>
            <VisitBadge status={v.status} />
          </Link>
        ))}
      </section>

      {editEq && <EquipmentForm equipment={editEq.id ? editEq : null} clientId={client.id} siteId={siteFilter || sites[0]?.id} types={types} onClose={() => setEditEq(null)} onSaved={() => { setEditEq(null); load() }} />}
      {editSite && <SiteForm site={editSite} onClose={() => setEditSite(null)} onSaved={() => { setEditSite(null); load() }} />}
      {editContract && <ContractForm contract={editContract} sites={sites} types={types} onClose={() => setEditContract(null)} onSaved={() => { setEditContract(null); load() }} />}
    </div>
  )
}

function SiteForm({ site, onClose, onSaved }) {
  const [f, setF] = useState({ name: site.name || '', address: site.address || '', postal_code: site.postal_code || '', city: site.city || '', access_notes: site.access_notes || '' })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!f.name.trim()) { toast.error('Nom du site obligatoire'); return }
    setBusy(true)
    try {
      const s = await saveSite({ ...(site.id ? { id: site.id } : {}), client_id: site.client_id, ...f })
      toast.success(s.latitude != null ? 'Site enregistré et placé sur la carte' : 'Site enregistré (adresse non trouvée sur la carte)')
      onSaved(s)
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  return (
    <Sheet title={site.id ? 'Modifier le site' : 'Ajouter un site'} onClose={onClose} footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn btn-primary" onClick={save} disabled={busy}>Enregistrer</button></>}>
      <div><label className="label" htmlFor="st-name">Nom du site</label><input id="st-name" className="input" placeholder="Bâtiment principal, entrepôt..." value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div><label className="label" htmlFor="st-addr">Adresse</label><input id="st-addr" className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
      <div className="grid grid-cols-3 gap-2">
        <div><label className="label" htmlFor="st-cp">Code postal</label><input id="st-cp" className="input" inputMode="numeric" value={f.postal_code} onChange={(e) => setF({ ...f, postal_code: e.target.value })} /></div>
        <div className="col-span-2"><label className="label" htmlFor="st-city">Ville</label><input id="st-city" className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
      </div>
      <div><label className="label" htmlFor="st-acc">Consignes d'accès</label><textarea id="st-acc" className="textarea" rows={2} placeholder="Code portail, interlocuteur à l'accueil, horaires..." value={f.access_notes} onChange={(e) => setF({ ...f, access_notes: e.target.value })} /></div>
    </Sheet>
  )
}
