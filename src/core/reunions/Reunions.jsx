import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, BookOpenText, Loader2 } from 'lucide-react'
import { supabase } from '../supabase'
import { fetchAll } from '../fetchAll'
import { useAuthStore } from '../store'
import { getCurrentCompanyId } from '../company/companyContext'
import { PageHeader } from '../../ui/PageHeader'
import { DataTable } from '../../ui/DataTable'
import { StatusBadge } from '../../ui/StatusBadge'
import { Sheet } from '../../ui/Sheet'
import { EmptyState } from '../../ui/EmptyState'
import { Banner } from '../../ui/Banner'
import SearchSelect from '../../ui/SearchSelect'
import { TYPES_REUNION, guideDepuisTrame, sujetsDuPoint } from './reunions'
import { lundi } from '../point/pointSemaine'

// Réunions et rendez-vous (0408) : liste, et préparation d'une nouvelle réunion à partir d'une trame (questions à
// poser, sujets à traiter). Une réunion d'équipe peut reprendre le point de la semaine comme ordre du jour.

const fr = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '')
const maintenantLocal = () => {
  const d = new Date(); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export default function Reunions() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const can = useAuthStore((s) => s.can)
  const direction = can?.('manager.cockpit.voir') === true
  const [liste, setListe] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [trames, setTrames] = useState([])
  const [clients, setClients] = useState([])
  const [fournisseurs, setFournisseurs] = useState([])
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [filtre, setFiltre] = useState('toutes')

  const charger = async () => {
    const { data, error } = await supabase.from('meetings').select('id, kind, title, starts_at, status, client_id, clients(name), suppliers(name)')
      .order('starts_at', { ascending: false, nullsFirst: true }).limit(500)
    if (error) { setErreur('Les réunions ne sont pas encore disponibles.'); setListe([]); return }
    setListe(data || [])
  }

  const ouvrirNouvelle = (init = {}) => setForm({ kind: 'rdv_client', template_id: '', title: '', starts_at: maintenantLocal(), location: '', client_id: '', supplier_id: '', reprendrePoint: true, ...init })

  useEffect(() => {
    charger()
    supabase.from('meeting_templates').select('*').eq('active', true).order('position').then(({ data }) => setTrames(data || []))
    fetchAll(() => supabase.from('clients').select('id, name, city').order('name')).then(({ data }) => setClients(data || []))
    supabase.from('suppliers').select('id, name').is('archived_at', null).order('name').then(({ data }) => setFournisseurs(data || []))
    // Ouverture depuis une fiche client : ?nouvelle=1&client=<id>
    if (params.get('nouvelle')) {
      ouvrirNouvelle({ client_id: params.get('client') || '' })
      setParams({}, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Une trame de la société remplace la trame proposée de même code
  const tramesDuType = useMemo(() => {
    if (!form) return []
    const t = trames.filter((x) => x.kind === form.kind)
    return t.filter((x) => x.company_id || !t.some((y) => y.company_id && y.code && y.code === x.code))
  }, [trames, form?.kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtrees = useMemo(() => (liste || []).filter((m) => filtre === 'toutes' || (filtre === 'a_traiter' ? m.status !== 'terminee' : m.status === 'terminee')), [liste, filtre])

  const creer = async () => {
    setBusy(true)
    try {
      const trame = trames.find((t) => t.id === form.template_id)
      let guide = guideDepuisTrame(trame?.items)
      if (form.kind === 'reunion_interne' && form.reprendrePoint && direction) {
        let q = supabase.from('weekly_briefs').select('lines').eq('week_start', lundi()).eq('kind', 'point')
        if (getCurrentCompanyId()) q = q.eq('company_id', getCurrentCompanyId())
        const { data } = await q.limit(1).maybeSingle()
        guide = [...sujetsDuPoint(data?.lines), ...guide]
      }
      const client = clients.find((c) => c.id === form.client_id)
      const titre = form.title.trim() || [trame?.name || TYPES_REUNION[form.kind], client?.name].filter(Boolean).join(' : ')
      const { data, error } = await supabase.from('meetings').insert({
        kind: form.kind, template_id: form.template_id || null, title: titre.slice(0, 200),
        starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null, location: form.location.trim() || null,
        client_id: form.kind === 'rdv_client' ? form.client_id || null : null,
        supplier_id: form.kind === 'rdv_fournisseur' ? form.supplier_id || null : null,
        guide,
      }).select('id').single()
      if (error) throw error
      navigate(`/reunions/${data.id}`)
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const colonnes = [
    { key: 'titre', label: 'Réunion', mobile: 'title', render: (m) => m.title },
    { key: 'type', label: 'Type', mobile: 'subtitle', render: (m) => [TYPES_REUNION[m.kind], m.clients?.name || m.suppliers?.name].filter(Boolean).join(' · ') },
    { key: 'date', label: 'Date', render: (m) => fr(m.starts_at) || '—' },
    { key: 'statut', label: 'Statut', mobile: 'aside', render: (m) => <StatusBadge tone={m.status === 'terminee' ? 'success' : 'info'}>{m.status === 'terminee' ? 'Compte rendu fait' : 'À traiter'}</StatusBadge> },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="Réunions et rendez-vous" meta={<span>Un guide pour les questions à poser, les notes à la volée, puis le compte rendu et l'email récapitulatif.</span>}
        actions={<button type="button" className="btn btn-primary" onClick={() => ouvrirNouvelle()}><Plus className="w-4 h-4" />Nouvelle réunion</button>} />
      {erreur && <Banner tone="warning">{erreur}</Banner>}
      <div className="flex gap-2">
        <select className="select w-auto" value={filtre} onChange={(e) => setFiltre(e.target.value)} aria-label="Statut">
          <option value="toutes">Toutes</option>
          <option value="a_traiter">À traiter</option>
          <option value="terminees">Compte rendu fait</option>
        </select>
      </div>
      <div className="card">
        <DataTable columns={colonnes} rows={filtrees} loading={liste === null} onRowClick={(m) => navigate(`/reunions/${m.id}`)} caption="Réunions"
          empty={<EmptyState icon={BookOpenText} title="Aucune réunion" compact>Préparez un rendez-vous client, fournisseur ou une réunion d'équipe.</EmptyState>} />
      </div>

      {form && (
        <Sheet title="Nouvelle réunion" onClose={() => setForm(null)}
          footer={<><button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Annuler</button>
            <button type="button" className="btn btn-primary" onClick={creer} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpenText className="w-4 h-4" />}Préparer</button></>}>
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="re-type">Type</label>
              <select id="re-type" className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, template_id: '' })}>
                {Object.entries(TYPES_REUNION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="re-trame">Trame</label>
              <select id="re-trame" className="select" value={form.template_id} onChange={(e) => setForm({ ...form, template_id: e.target.value })}>
                <option value="">Sans trame (notes libres)</option>
                {tramesDuType.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {form.template_id && <p className="text-ui-sm text-gray-500 mt-1">{trames.find((t) => t.id === form.template_id)?.description}</p>}
            </div>
            {form.kind === 'rdv_client' && (
              <div>
                <label className="label" htmlFor="re-client">Client</label>
                <SearchSelect id="re-client" value={form.client_id} onChange={(v) => setForm({ ...form, client_id: v })} placeholder="Choisir un client"
                  options={clients.map((c) => ({ value: c.id, label: c.name, hint: c.city || '', testTbl: 'clients' }))} />
              </div>
            )}
            {form.kind === 'rdv_fournisseur' && (
              <div>
                <label className="label" htmlFor="re-fourn">Fournisseur</label>
                <select id="re-fourn" className="select" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                  <option value="">Aucun fournisseur enregistré</option>
                  {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            )}
            {form.kind === 'reunion_interne' && direction && (
              <label className="inline-flex items-center gap-2 text-ui">
                <input type="checkbox" checked={form.reprendrePoint} onChange={(e) => setForm({ ...form, reprendrePoint: e.target.checked })} />
                Reprendre le point de la semaine (urgent, pas fait, à relancer)
              </label>
            )}
            <div>
              <label className="label" htmlFor="re-titre">Titre</label>
              <input id="re-titre" className="input" maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Par défaut : la trame et le client" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="re-date">Date et heure</label>
                <input id="re-date" type="datetime-local" className="input" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="re-lieu">Lieu</label>
                <input id="re-lieu" className="input" maxLength={300} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Sur site, visio, bureau…" />
              </div>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  )
}
