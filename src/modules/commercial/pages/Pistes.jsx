import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Loader2, Route as RouteIcon, FileText } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { useAuthStore } from '../../../core/store'
import { PageHeader } from '../../../ui/PageHeader'
import { DataTable } from '../../../ui/DataTable'
import { StatusBadge } from '../../../ui/StatusBadge'
import { Sheet } from '../../../ui/Sheet'
import { Banner } from '../../../ui/Banner'
import { EmptyState } from '../../../ui/EmptyState'
import { preparerDevisPiste } from '../lib/pistes'

// Pistes entre formation et maintenance (fonction 10, 0130) : signalées par un technicien à la fin d'une visite
// (vers la formation) ou créées à la fin d'une session incendie chez un client sans contrat (vers la maintenance).
// Une seule piste ouverte par client, sens et domaine. « Préparer le devis » ouvre un brouillon à relire.

export const SENS = { vers_formation: 'Vers la formation', vers_maintenance: 'Vers la maintenance' }
export const STATUTS = {
  nouvelle: ['warning', 'Nouvelle'], en_cours: ['info', 'En cours'], devis_envoye: ['info', 'Devis envoyé'],
  gagnee: ['success', 'Gagnée'], perdue: ['neutral', 'Perdue'], ignoree: ['neutral', 'Ignorée'],
}
const OUVERTES = ['nouvelle', 'en_cours', 'devis_envoye']
const fr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '')

export default function Pistes() {
  const navigate = useNavigate()
  const can = useAuthStore((s) => s.can)
  const peutModifier = can('clients.fiches.modifier') !== false
  const peutDevis = can('commercial.devis.modifier') !== false
  const [pistes, setPistes] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [filtre, setFiltre] = useState({ sens: '', statut: 'ouvertes' })
  const [ouverte, setOuverte] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const { data, error } = await supabase.from('cross_sell_leads')
      .select('*, clients(id, name, city), sites(name, city), quotes(id, reference, status)')
      .order('created_at', { ascending: false }).limit(500)
    if (error) { setErreur('Les pistes ne sont pas encore disponibles sur cette instance (migration 0130).'); setPistes([]); return }
    setPistes(data || [])
  }
  useEffect(() => { load() }, [])

  const liste = useMemo(() => (pistes || []).filter((p) => (!filtre.sens || p.direction === filtre.sens)
    && (filtre.statut === 'toutes' || (filtre.statut === 'ouvertes' ? OUVERTES.includes(p.status) : p.status === filtre.statut))), [pistes, filtre])

  const changer = async (status) => {
    setBusy(true)
    const { error } = await supabase.from('cross_sell_leads').update({ status, note: ouverte.note || null }).eq('id', ouverte.id)
    setBusy(false)
    if (error) return toast.error(error.message.includes('cross_sell_leads_ouverte') ? 'Une autre piste est déjà ouverte pour ce client et ce sens' : error.message)
    toast.success('Piste mise à jour')
    setOuverte(null)
    load()
  }

  const devis = async () => {
    if (ouverte.quote_id) { navigate(`/devis?open=${ouverte.quote_id}`); return }
    setBusy(true)
    try {
      const q = await preparerDevisPiste(ouverte)
      toast.success(`Devis ${q.reference} préparé (brouillon)`)
      navigate(`/devis?open=${q.id}`)
    } catch (e) {
      toast.error(e.message)
    } finally { setBusy(false) }
  }

  const colonnes = [
    { key: 'client', label: 'Client', mobile: 'title', render: (p) => p.clients?.name || '—' },
    { key: 'sens', label: 'Sens', mobile: 'subtitle', render: (p) => `${SENS[p.direction]} · ${p.domain}` },
    { key: 'site', label: 'Site', render: (p) => p.sites?.name || '—' },
    { key: 'source', label: 'Origine', render: (p) => `${p.source_kind === 'visite' ? 'Visite' : p.source_kind === 'session' ? 'Session' : 'Saisie'} du ${fr(p.created_at)}` },
    { key: 'devis', label: 'Devis', render: (p) => p.quotes?.reference || '—' },
    { key: 'statut', label: 'Statut', mobile: 'aside', render: (p) => <StatusBadge tone={STATUTS[p.status][0]}>{STATUTS[p.status][1]}</StatusBadge> },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="Pistes" meta={<span>Besoins de formation signalés en visite, maintenance proposée après une formation incendie.</span>} />
      {erreur && <Banner tone="warning">{erreur}</Banner>}
      <div className="flex flex-wrap gap-2">
        <select className="select w-auto" value={filtre.sens} onChange={(e) => setFiltre((f) => ({ ...f, sens: e.target.value }))} aria-label="Sens">
          <option value="">Tous les sens</option>
          {Object.entries(SENS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="select w-auto" value={filtre.statut} onChange={(e) => setFiltre((f) => ({ ...f, statut: e.target.value }))} aria-label="Statut">
          <option value="ouvertes">Ouvertes</option>
          <option value="toutes">Toutes</option>
          {Object.entries(STATUTS).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}
        </select>
      </div>
      <div className="card">
        <DataTable columns={colonnes} rows={liste} loading={pistes === null} onRowClick={(p) => setOuverte({ ...p })} caption="Pistes"
          empty={<EmptyState icon={RouteIcon} title="Aucune piste" compact>Les besoins signalés par les techniciens et les maintenances à proposer apparaissent ici.</EmptyState>} />
      </div>

      {ouverte && (
        <Sheet title={`${SENS[ouverte.direction]} · ${ouverte.clients?.name || ''}`} onClose={() => setOuverte(null)} size="lg"
          footer={peutModifier ? <>
            {OUVERTES.includes(ouverte.status) && <button type="button" className="btn btn-ghost mr-auto" onClick={() => changer('ignoree')} disabled={busy}>Ignorer</button>}
            {OUVERTES.includes(ouverte.status) && <button type="button" className="btn btn-secondary" onClick={() => changer('perdue')} disabled={busy}>Perdue</button>}
            {OUVERTES.includes(ouverte.status) && <button type="button" className="btn btn-secondary" onClick={() => changer('gagnee')} disabled={busy}>Gagnée</button>}
            {!OUVERTES.includes(ouverte.status) && <button type="button" className="btn btn-secondary" onClick={() => changer('en_cours')} disabled={busy}>Rouvrir</button>}
            {peutDevis && OUVERTES.includes(ouverte.status) && <button type="button" className="btn btn-primary" onClick={devis} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} {ouverte.quote_id ? 'Ouvrir le devis' : 'Préparer le devis'}</button>}
          </> : <button type="button" className="btn btn-secondary" onClick={() => setOuverte(null)}>Fermer</button>}>
          <div className="text-ui-sm text-gray-600 space-y-1">
            <div><Link to={`/clients/${ouverte.client_id}`} className="text-accent-700 hover:underline" onClick={() => setOuverte(null)}>Fiche client</Link>{ouverte.sites?.name ? ` · site ${ouverte.sites.name}` : ''}</div>
            <div>Statut : {STATUTS[ouverte.status][1]}{ouverte.quotes?.reference ? ` · devis ${ouverte.quotes.reference}` : ''}</div>
          </div>
          <div>
            <label className="label" htmlFor="pi-note">Notes</label>
            <textarea id="pi-note" className="input min-h-[120px]" value={ouverte.note || ''} disabled={!peutModifier}
              onChange={(e) => setOuverte((o) => ({ ...o, note: e.target.value }))}
              onBlur={async () => { const { error } = await supabase.from('cross_sell_leads').update({ note: ouverte.note || null }).eq('id', ouverte.id); if (error) toast.error(error.message); else load() }} />
          </div>
        </Sheet>
      )}
    </div>
  )
}
