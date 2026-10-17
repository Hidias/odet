// Contrats de maintenance annuels : sites et types couverts, mois de visite, tarif ; génération des visites à planifier.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Loader2, Plus, CalendarPlus, Pencil } from 'lucide-react'
import { loadContracts, saveContract, generateContractVisits, loadClientsLight, loadSites } from '../lib/itvData'
import { MONTHS, monthLabel, frShort } from '../lib/schedule'
import { Sheet, Empty } from '../components/ui'
import SearchSelect, { clientOptions } from '../../../ui/SearchSelect'

export default function Contrats({ types }) {
  const [contracts, setContracts] = useState(null)
  const [edit, setEdit] = useState(null)
  const [busy, setBusy] = useState(null)
  const year = new Date().getFullYear()

  const load = async () => setContracts(await loadContracts())
  useEffect(() => { load().catch((e) => toast.error(e.message)) }, [])

  const generate = async (c, y) => {
    setBusy(c.id)
    try {
      const n = await generateContractVisits(c.id, y)
      toast.success(n ? `${n} visite${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} à planifier pour ${y}` : `Les visites ${y} existent déjà`)
    } catch (e) { toast.error(e.message) } finally { setBusy(null) }
  }

  if (!contracts) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  const total = contracts.filter((c) => c.status === 'actif').reduce((s, c) => s + Number(c.annual_price_ht || 0), 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="muted text-ui-sm flex-1">{contracts.filter((c) => c.status === 'actif').length} contrats actifs, {total.toLocaleString('fr-FR')} € HT par an.</p>
        <button type="button" className="btn btn-primary" onClick={() => setEdit({})}><Plus className="w-4 h-4" />Nouveau contrat</button>
      </div>
      {contracts.length === 0 ? <Empty title="Aucun contrat">Un contrat fixe les mois de visite : les visites de l'année s'ajoutent à la liste « À planifier » en un clic.</Empty> : (
        <div className="card card-flush">
          {contracts.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100 last:border-b-0">
              <div className="flex-1 min-w-[220px]">
                <Link to={`/interventions/parc/${c.client_id}`} className="font-semibold">{c.clients?.name}</Link>
                <div className="text-ui-sm text-gray-500">{c.label}{c.reference ? ` (${c.reference})` : ''}. Visites en {(c.visit_months || []).map(monthLabel).join(' et ') || '?'}. {Number(c.annual_price_ht || 0).toLocaleString('fr-FR')} € HT par an.</div>
              </div>
              <span className={`badge ${c.status === 'actif' ? 'badge-success' : 'badge-neutral'}`}>{c.status === 'actif' ? 'Actif' : c.status === 'suspendu' ? 'Suspendu' : 'Terminé'}</span>
              {c.status === 'actif' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => generate(c, year)} disabled={busy === c.id}><CalendarPlus className="w-4 h-4" />Visites {year}</button>}
              {c.status === 'actif' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => generate(c, year + 1)} disabled={busy === c.id}>{year + 1}</button>}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(c)}><Pencil className="w-4 h-4" />Modifier</button>
            </div>
          ))}
        </div>
      )}
      <p className="muted text-ui-sm">La facture d'une visite sous contrat se prépare depuis la visite terminée, dans les Factures existantes.</p>
      {edit && <ContractForm contract={edit} types={types} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
    </div>
  )
}

export function ContractForm({ contract, sites: sitesIn = null, types, onClose, onSaved }) {
  const [clients, setClients] = useState([])
  const [sites, setSites] = useState(sitesIn || [])
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState(() => ({
    client_id: contract.client_id || '', label: contract.label || 'Contrat de maintenance', reference: contract.reference || '',
    start_on: contract.start_on || new Date().toISOString().slice(0, 10), end_on: contract.end_on || '',
    annual_price_ht: contract.annual_price_ht ?? '', visit_months: contract.visit_months || [], site_ids: contract.site_ids || [],
    type_ids: contract.type_ids || [], status: contract.status || 'actif', notes: contract.notes || '',
  }))
  useEffect(() => { if (!contract.client_id) loadClientsLight().then(setClients) }, [contract.client_id])
  useEffect(() => { if (f.client_id && !sitesIn) loadSites(f.client_id).then((s) => setSites(s || [])) }, [f.client_id, sitesIn])

  const toggle = (key, v) => setF((x) => ({ ...x, [key]: x[key].includes(v) ? x[key].filter((y) => y !== v) : [...x[key], v].sort((a, b) => (typeof a === 'number' ? a - b : 0)) }))
  const save = async () => {
    if (!f.client_id) { toast.error('Choisissez le client'); return }
    if (!f.visit_months.length) { toast.error('Choisissez au moins un mois de visite'); return }
    setBusy(true)
    try {
      await saveContract({ ...(contract.id ? { id: contract.id } : {}), ...f, end_on: f.end_on || null, annual_price_ht: Number(f.annual_price_ht || 0), reference: f.reference || null, notes: f.notes || null,
        site_ids: f.site_ids.length ? f.site_ids : null, type_ids: f.type_ids.length ? f.type_ids : null })
      toast.success('Contrat enregistré'); onSaved()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <Sheet title={contract.id ? 'Modifier le contrat' : 'Nouveau contrat de maintenance'} onClose={onClose} wide
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn btn-primary" onClick={save} disabled={busy}>Enregistrer</button></>}>
      {!contract.client_id && (
        <div><label className="label" htmlFor="ct-client">Client</label>
          <SearchSelect id="ct-client" value={f.client_id} onChange={(v) => setF({ ...f, client_id: v, site_ids: [] })}
            options={clientOptions(clients)} emptyLabel="Choisir" searchPlaceholder="Rechercher un client..." aria-label="Client" /></div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2"><label className="label" htmlFor="ct-label">Intitulé</label><input id="ct-label" className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></div>
        <div><label className="label" htmlFor="ct-ref">Référence</label><input id="ct-ref" className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div><label className="label" htmlFor="ct-start">Début</label><input id="ct-start" type="date" className="input" value={f.start_on} onChange={(e) => setF({ ...f, start_on: e.target.value })} /></div>
        <div><label className="label" htmlFor="ct-end">Fin (facultatif)</label><input id="ct-end" type="date" className="input" value={f.end_on} onChange={(e) => setF({ ...f, end_on: e.target.value })} /></div>
        <div><label className="label" htmlFor="ct-price">Prix annuel HT</label><input id="ct-price" className="input" inputMode="decimal" value={f.annual_price_ht} onChange={(e) => setF({ ...f, annual_price_ht: e.target.value.replace(',', '.') })} /></div>
        <div><label className="label" htmlFor="ct-status">Statut</label>
          <select id="ct-status" className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="actif">Actif</option><option value="suspendu">Suspendu</option><option value="termine">Terminé</option></select></div>
      </div>
      <fieldset>
        <legend className="label">Mois de visite</legend>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
          {MONTHS.map((m, i) => (
            <button key={m} type="button" aria-pressed={f.visit_months.includes(i + 1)} onClick={() => toggle('visit_months', i + 1)}
              className={`rounded-ui-sm border text-ui-sm capitalize ${f.visit_months.includes(i + 1) ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300'}`} style={{ height: 36 }}>{m}</button>
          ))}
        </div>
      </fieldset>
      {sites.length > 0 && (
        <fieldset>
          <legend className="label">Sites couverts (aucun coché : tous)</legend>
          <div className="flex flex-wrap gap-3">{sites.map((s) => <label key={s.id} className="flex items-center gap-2 text-ui"><input type="checkbox" checked={f.site_ids.includes(s.id)} onChange={() => toggle('site_ids', s.id)} />{s.name}</label>)}</div>
        </fieldset>
      )}
      <fieldset>
        <legend className="label">Matériel couvert (aucun coché : tout)</legend>
        <div className="flex flex-wrap gap-3">{types.filter((t) => t.is_active).map((t) => <label key={t.id} className="flex items-center gap-2 text-ui"><input type="checkbox" checked={f.type_ids.includes(t.id)} onChange={() => toggle('type_ids', t.id)} />{t.name}</label>)}</div>
      </fieldset>
      <div><label className="label" htmlFor="ct-notes">Notes</label><textarea id="ct-notes" className="textarea" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      {contract.start_on && <p className="muted text-ui-sm">En vigueur depuis le {frShort(contract.start_on)}.</p>}
    </Sheet>
  )
}
