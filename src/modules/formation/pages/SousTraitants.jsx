import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Briefcase, FileDown, FileText, Loader2, Plus, Trash2, Upload } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { useAuthStore } from '../../../core/store'
import { buildStorageFileName } from '../../../core/storageUtils'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { PageHeader } from '../../../ui/PageHeader'
import { DataTable } from '../../../ui/DataTable'
import { StatusBadge } from '../../../ui/StatusBadge'
import { Sheet } from '../../../ui/Sheet'
import { Banner } from '../../../ui/Banner'
import { EmptyState, Spinner } from '../../../ui/EmptyState'
import { confirmer } from '../../../ui/Confirm'
import { buildBonCommandePDF } from '../pdf/bonCommandePDF'

// Sous-traitance, l'organisme donneur d'ordres (lot 2, 0045) : prestataires (organismes ou formateurs indépendants),
// justificatifs à tenir (attestation de vigilance tous les six mois au-delà de 5 000 € HT, D8222-5 et R8222-1 ;
// assurance, Qualiopi, CV, charte, contrat) et bons de commande. Un justificatif périmé est un avertissement, jamais
// un blocage. Relances des justificatifs préparées chaque nuit dans « Relances à valider ».
// Fichiers dans le bucket privé « prestataires », chemin <société>/<prestataire>/<fichier>.

const ETATS = { a_jour: ['success', 'À jour'], a_renouveler: ['warning', 'À renouveler'], perime: ['danger', 'Périmé'], manquant: ['danger', 'Manquant'] }
const STATUTS_BC = { brouillon: 'Brouillon', envoye: 'Envoyé', signe: 'Signé', realise: 'Réalisé', facture: 'Facturé', paye: 'Payé', annule: 'Annulé' }
const KINDS = { organisme: 'Organisme de formation', independant: 'Formateur indépendant' }
const fr = (d) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('fr-FR') : '')
const euros = (n) => (n == null ? '' : `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`)
const VIDE = { name: '', kind: 'organisme', siren: '', siret: '', address: '', postal_code: '', city: '', email: '', phone: '', contact_name: '', nda: '', qualiopi: false, qualiopi_until: '', daily_rate: '', notes: '', is_active: true }

export default function SousTraitants() {
  const can = useAuthStore((s) => s.can)
  const peutGerer = can('formation.formateurs.dossier') !== false
  const peutCommander = can('formation.couts.gerer') !== false
  const [liste, setListe] = useState(null)
  const [conformite, setConformite] = useState([])
  const [erreur, setErreur] = useState(null)
  const [ouvert, setOuvert] = useState(null)

  const load = async () => {
    const [{ data, error }, { data: c }] = await Promise.all([
      supabase.from('subcontractors').select('*').order('name'),
      supabase.from('v_subcontractor_compliance').select('subcontractor_id, code, label, status, valid_until'),
    ])
    if (error) { setErreur('La sous-traitance n\'est pas encore disponible. Prévenez le support.'); setListe([]); return }
    setListe(data || [])
    setConformite(c || [])
  }
  useEffect(() => { load() }, [])

  const parPrestataire = useMemo(() => {
    const m = {}
    conformite.forEach((r) => { (m[r.subcontractor_id] = m[r.subcontractor_id] || []).push(r) })
    return m
  }, [conformite])

  const resume = (s) => {
    const l = parPrestataire[s.id] || []
    const ko = l.filter((r) => r.status === 'manquant' || r.status === 'perime').length
    const bientot = l.filter((r) => r.status === 'a_renouveler').length
    if (!s.is_active) return <StatusBadge tone="neutral">Inactif</StatusBadge>
    if (ko) return <StatusBadge tone="danger">{ko} justificatif{ko > 1 ? 's' : ''} à fournir</StatusBadge>
    if (bientot) return <StatusBadge tone="warning">{bientot} à renouveler</StatusBadge>
    return <StatusBadge tone="success">À jour</StatusBadge>
  }

  const colonnes = [
    { key: 'name', label: 'Prestataire', mobile: 'title' },
    { key: 'kind', label: 'Type', mobile: 'subtitle', render: (s) => KINDS[s.kind] },
    { key: 'contact', label: 'Contact', render: (s) => [s.contact_name, s.email || s.phone].filter(Boolean).join(' · ') || '—' },
    { key: 'qualiopi', label: 'Qualiopi', render: (s) => (s.qualiopi ? `Oui${s.qualiopi_until ? ` (jusqu'au ${fr(s.qualiopi_until)})` : ''}` : 'Non') },
    { key: 'etat', label: 'Justificatifs', mobile: 'aside', render: resume },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="Sous-traitants" meta={<span>Prestataires, justificatifs à tenir et bons de commande.</span>}
        actions={peutGerer && !erreur ? <button type="button" className="btn btn-secondary" onClick={() => setOuvert({ ...VIDE })}><Plus className="w-4 h-4" /> Ajouter un prestataire</button> : null} />
      {erreur && <Banner tone="warning">{erreur}</Banner>}
      {!erreur && <Banner tone="info">Un justificatif manquant ou périmé est signalé, jamais bloquant. Les demandes de justificatifs sont préparées chaque nuit dans <Link to="/a-valider" className="underline">Relances à valider</Link>.</Banner>}
      <div className="card">
        <DataTable columns={colonnes} rows={liste || []} loading={liste === null} onRowClick={(s) => setOuvert({ ...VIDE, ...s })}
          caption="Prestataires" empty={<EmptyState icon={Briefcase} title="Aucun prestataire" compact>Ajoutez les organismes et formateurs indépendants à qui vous confiez des formations.</EmptyState>} />
      </div>
      {ouvert && <FichePrestataire initial={ouvert} peutGerer={peutGerer} peutCommander={peutCommander}
        onClose={() => setOuvert(null)} onSaved={(s) => { load(); if (s) setOuvert({ ...VIDE, ...s }) }} />}
    </div>
  )
}

function FichePrestataire({ initial, peutGerer, peutCommander, onClose, onSaved }) {
  const [p, setP] = useState(initial)
  const [onglet, setOnglet] = useState('identite')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setP((x) => ({ ...x, [k]: v }))

  const enregistrer = async () => {
    if (!p.name?.trim()) return toast.error('Nom requis')
    setBusy(true)
    const champs = {
      name: p.name.trim(), kind: p.kind, siren: p.siren || null, siret: p.siret || null, address: p.address || null,
      postal_code: p.postal_code || null, city: p.city || null, email: p.email || null, phone: p.phone || null,
      contact_name: p.contact_name || null, nda: p.nda || null, qualiopi: !!p.qualiopi, qualiopi_until: p.qualiopi_until || null,
      daily_rate: p.daily_rate === '' || p.daily_rate == null ? null : Number(String(p.daily_rate).replace(',', '.')),
      notes: p.notes || null, is_active: p.is_active !== false,
    }
    const { data, error } = p.id
      ? await supabase.from('subcontractors').update(champs).eq('id', p.id).select().single()
      : await supabase.from('subcontractors').insert(champs).select().single()
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(p.id ? 'Prestataire enregistré' : 'Prestataire ajouté : déposez ses justificatifs')
    onSaved(data)
    if (!p.id) setOnglet('justificatifs')
  }

  const onglets = [['identite', 'Identité'], ...(p.id ? [['justificatifs', 'Justificatifs'], ...(peutCommander ? [['commandes', 'Bons de commande']] : [])] : [])]

  return (
    <Sheet title={p.id ? p.name : 'Nouveau prestataire'} onClose={onClose} size="lg"
      footer={onglet === 'identite' && peutGerer ? <>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Fermer</button>
        <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer</button>
      </> : <button type="button" className="btn btn-secondary" onClick={onClose}>Fermer</button>}>
      {onglets.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Fiche prestataire">
          {onglets.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={onglet === k} onClick={() => setOnglet(k)}
              className={`btn btn-sm ${onglet === k ? 'btn-primary' : 'btn-secondary'}`}>{l}</button>
          ))}
        </div>
      )}
      {onglet === 'identite' && (
        <fieldset disabled={!peutGerer} className="grid gap-3">
          <div className="grid sm:grid-cols-[1fr_220px] gap-2">
            <div>
              <label className="label" htmlFor="st-nom">Nom ou raison sociale</label>
              <input id="st-nom" className="input" value={p.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="st-kind">Type</label>
              <select id="st-kind" className="input" value={p.kind} onChange={(e) => set('kind', e.target.value)}>
                {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            <div>
              <label className="label" htmlFor="st-siret">SIRET</label>
              <input id="st-siret" className="input" inputMode="numeric" value={p.siret || ''}
                onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 14); set('siret', v); if (v.length >= 9) set('siren', v.slice(0, 9)) }} />
            </div>
            <div>
              <label className="label" htmlFor="st-nda">N° de déclaration d'activité</label>
              <input id="st-nda" className="input" value={p.nda || ''} onChange={(e) => set('nda', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="st-tj">Prix par jour HT (€)</label>
              <input id="st-tj" className="input" inputMode="decimal" value={p.daily_rate ?? ''} onChange={(e) => set('daily_rate', e.target.value.replace(/[^\d,.]/g, ''))} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="st-adr">Adresse</label>
            <input id="st-adr" className="input" value={p.address || ''} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div className="grid sm:grid-cols-[140px_1fr] gap-2">
            <div>
              <label className="label" htmlFor="st-cp">Code postal</label>
              <input id="st-cp" className="input" value={p.postal_code || ''} onChange={(e) => set('postal_code', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="st-ville">Ville</label>
              <input id="st-ville" className="input" value={p.city || ''} onChange={(e) => set('city', e.target.value)} />
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            <div>
              <label className="label" htmlFor="st-contact">Contact ou intervenant</label>
              <input id="st-contact" className="input" value={p.contact_name || ''} onChange={(e) => set('contact_name', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="st-mail">Email</label>
              <input id="st-mail" className="input" type="email" value={p.email || ''} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="st-tel">Téléphone</label>
              <input id="st-tel" className="input" value={p.phone || ''} onChange={(e) => set('phone', e.target.value)} />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-2 items-end">
            <label className="flex items-center gap-2 text-ui text-gray-800"><input type="checkbox" checked={!!p.qualiopi} onChange={(e) => set('qualiopi', e.target.checked)} /> Certifié Qualiopi</label>
            {p.qualiopi && (
              <div>
                <label className="label" htmlFor="st-qual">Certificat valable jusqu'au</label>
                <input id="st-qual" className="input" type="date" value={p.qualiopi_until || ''} onChange={(e) => set('qualiopi_until', e.target.value)} />
              </div>
            )}
          </div>
          <div>
            <label className="label" htmlFor="st-notes">Notes</label>
            <textarea id="st-notes" className="input min-h-[64px]" value={p.notes || ''} onChange={(e) => set('notes', e.target.value)} />
          </div>
          {p.id && <label className="flex items-center gap-2 text-ui text-gray-800"><input type="checkbox" checked={p.is_active !== false} onChange={(e) => set('is_active', e.target.checked)} /> Prestataire actif</label>}
        </fieldset>
      )}
      {onglet === 'justificatifs' && p.id && <Justificatifs prestataire={p} peutGerer={peutGerer} onChange={() => onSaved(null)} />}
      {onglet === 'commandes' && p.id && <BonsDeCommande prestataire={p} onChange={() => onSaved(null)} />}
    </Sheet>
  )
}

function Justificatifs({ prestataire, peutGerer, onChange }) {
  const [types, setTypes] = useState(null)
  const [docs, setDocs] = useState([])
  const [etat, setEtat] = useState({})
  const [depot, setDepot] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const [{ data: t }, { data: d }, { data: c }] = await Promise.all([
      supabase.from('subcontractor_doc_types').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('subcontractor_documents').select('*').eq('subcontractor_id', prestataire.id).order('issued_on', { ascending: false, nullsFirst: false }),
      supabase.from('v_subcontractor_compliance').select('doc_type_id, status').eq('subcontractor_id', prestataire.id),
    ])
    setTypes((t || []).filter((x) => x.applies_to === 'tous' || x.applies_to === prestataire.kind))
    setDocs(d || [])
    setEtat(Object.fromEntries((c || []).map((r) => [r.doc_type_id, r.status])))
  }
  useEffect(() => { load() }, [prestataire.id])

  const ouvrir = async (d) => {
    const { data, error } = await supabase.storage.from('prestataires').createSignedUrl(d.file_path, 300)
    if (error || !data?.signedUrl) return toast.error('Fichier introuvable')
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const deposer = async () => {
    if (!depot.file && !depot.issued_on) return toast.error('Choisissez un fichier ou une date')
    setBusy(true)
    let file_path = null
    if (depot.file) {
      if (depot.file.size > 10 * 1024 * 1024) { setBusy(false); return toast.error('Fichier trop lourd (10 Mo au plus)') }
      file_path = `${prestataire.company_id}/${prestataire.id}/${buildStorageFileName(depot.file.name)}`
      const { error: up } = await supabase.storage.from('prestataires').upload(file_path, depot.file, { contentType: depot.file.type })
      if (up) { setBusy(false); return toast.error(`Dépôt impossible : ${up.message}`) }
    }
    const { error } = await supabase.from('subcontractor_documents').insert({
      subcontractor_id: prestataire.id, doc_type_id: depot.type.id, label: depot.type.label,
      file_path, file_name: depot.file?.name || null, issued_on: depot.issued_on || null, valid_until: depot.valid_until || null,
    })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Justificatif enregistré')
    setDepot(null)
    load(); onChange()
  }

  const supprimer = async (d) => {
    if (!(await confirmer(`Supprimer ce justificatif (${d.label || 'document'}) ?`))) return
    if (d.file_path) await supabase.storage.from('prestataires').remove([d.file_path])
    const { error } = await supabase.from('subcontractor_documents').delete().eq('id', d.id)
    if (error) return toast.error(error.message)
    toast.success('Justificatif supprimé')
    load(); onChange()
  }

  if (types === null) return <Spinner />
  return (
    <div className="space-y-2">
      {types.map((t) => {
        const liste = docs.filter((d) => d.doc_type_id === t.id)
        const st = etat[t.id]
        return (
          <div key={t.id} className="border border-gray-200 rounded-lg p-3 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium text-gray-900">{t.label}{!t.required && <span className="text-gray-400 font-normal"> · facultatif</span>}</div>
                <div className="text-ui-sm text-gray-500">
                  {t.validity_months ? `Valable ${t.validity_months} mois` : 'Sans échéance'}{t.threshold_ht ? ` · exigé dès ${euros(t.threshold_ht)} HT de commandes sur 12 mois` : ''}
                </div>
                {t.legal_ref && <div className="text-ui-sm text-gray-400">{t.legal_ref}</div>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {st ? <StatusBadge tone={ETATS[st][0]}>{ETATS[st][1]}</StatusBadge> : <StatusBadge tone="neutral">Non exigé</StatusBadge>}
                {peutGerer && <button type="button" className="btn btn-sm btn-secondary" onClick={() => setDepot({ type: t, file: null, issued_on: new Date().toISOString().slice(0, 10), valid_until: '' })}><Upload className="w-3.5 h-3.5" /> Déposer</button>}
              </div>
            </div>
            {liste.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 text-ui-sm bg-gray-50 rounded px-2 py-1.5">
                <span className="min-w-0 truncate">
                  {d.file_name || 'Sans fichier'}{d.issued_on ? ` · du ${fr(d.issued_on)}` : ''}{d.valid_until ? ` · valable jusqu'au ${fr(d.valid_until)}` : ''}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  {d.file_path && <button type="button" className="btn btn-sm btn-ghost" onClick={() => ouvrir(d)} aria-label="Ouvrir le fichier"><FileText className="w-4 h-4" /></button>}
                  {peutGerer && <button type="button" className="btn btn-sm btn-ghost" onClick={() => supprimer(d)} aria-label="Supprimer"><Trash2 className="w-4 h-4" /></button>}
                </span>
              </div>
            ))}
          </div>
        )
      })}
      {depot && (
        <Sheet title={depot.type.label} onClose={() => setDepot(null)} layer="z-[160]"
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setDepot(null)}>Annuler</button>
            <button type="button" className="btn btn-primary" onClick={deposer} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer</button>
          </>}>
          <div>
            <label className="label" htmlFor="jd-file">Fichier (PDF ou image, 10 Mo au plus)</label>
            <input id="jd-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="input"
              onChange={(e) => setDepot((x) => ({ ...x, file: e.target.files?.[0] || null }))} />
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="jd-date">Date du document</label>
              <input id="jd-date" type="date" className="input" value={depot.issued_on} onChange={(e) => setDepot((x) => ({ ...x, issued_on: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="jd-fin">Valable jusqu'au</label>
              <input id="jd-fin" type="date" className="input" value={depot.valid_until} onChange={(e) => setDepot((x) => ({ ...x, valid_until: e.target.value }))} />
              {depot.type.validity_months && !depot.valid_until && <p className="text-ui-sm text-gray-400 mt-1">Vide : date du document + {depot.type.validity_months} mois.</p>}
            </div>
          </div>
        </Sheet>
      )}
    </div>
  )
}

function BonsDeCommande({ prestataire, onChange }) {
  const [cmds, setCmds] = useState(null)
  const [sessions, setSessions] = useState([])
  const [edition, setEdition] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const [{ data }, { data: s }] = await Promise.all([
      supabase.from('subcontract_orders').select('*, sessions(id, reference, start_date, end_date, location_name, location_city, courses(title))')
        .eq('subcontractor_id', prestataire.id).order('order_date', { ascending: false }),
      supabase.from('sessions').select('id, reference, start_date, end_date, courses(title)')
        .gte('start_date', new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)).order('start_date').limit(300),
    ])
    setCmds(data || [])
    setSessions(s || [])
  }
  useEffect(() => { load() }, [prestataire.id])

  const nouveau = () => setEdition({ session_id: '', object: '', start_date: '', end_date: '', days: '', daily_rate: prestataire.daily_rate ?? '', status: 'brouillon', notes: '' })
  const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')))

  const choisirSession = (id) => {
    const s = sessions.find((x) => x.id === id)
    setEdition((e) => ({
      ...e, session_id: id,
      ...(s ? { object: e.object || s.courses?.title || '', start_date: s.start_date || '', end_date: s.end_date || s.start_date || '' } : {}),
    }))
  }

  const enregistrer = async () => {
    const e = edition
    setBusy(true)
    const champs = {
      session_id: e.session_id || null, object: e.object || null, start_date: e.start_date || null, end_date: e.end_date || null,
      days: num(e.days), daily_rate: num(e.daily_rate), status: e.status, notes: e.notes || null,
      amount_ht: num(e.days) != null && num(e.daily_rate) != null ? Math.round(num(e.days) * num(e.daily_rate) * 100) / 100 : num(e.amount_ht),
    }
    const { error } = e.id
      ? await supabase.from('subcontract_orders').update(champs).eq('id', e.id)
      : await supabase.from('subcontract_orders').insert({ ...champs, subcontractor_id: prestataire.id })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Bon de commande enregistré')
    setEdition(null)
    load(); onChange()
  }

  const pdf = async (c) => {
    try {
      const ORG = await loadPdfOrg()
      const doc = buildBonCommandePDF(ORG, { order: c, subcontractor: prestataire, session: c.sessions || null })
      doc.save(`${c.reference || 'bon-de-commande'}.pdf`)
    } catch (err) {
      toast.error(`PDF impossible : ${err.message}`)
    }
  }

  if (cmds === null) return <Spinner />
  return (
    <div className="space-y-2">
      <div className="flex justify-end"><button type="button" className="btn btn-sm btn-secondary" onClick={nouveau}><Plus className="w-3.5 h-3.5" /> Nouveau bon de commande</button></div>
      {cmds.length === 0 ? <EmptyState icon={FileText} title="Aucun bon de commande" compact /> : cmds.map((c) => (
        <div key={c.id} className="border border-gray-200 rounded-lg p-3 flex items-start justify-between gap-2">
          <button type="button" className="text-left min-w-0" onClick={() => setEdition({ ...c, session_id: c.session_id || '', days: c.days ?? '', daily_rate: c.daily_rate ?? '' })}>
            <div className="font-medium text-gray-900">{c.reference} · {c.object || c.sessions?.courses?.title || 'Prestation'}</div>
            <div className="text-ui-sm text-gray-500">
              {c.start_date ? fr(c.start_date) : 'Dates à convenir'}{c.end_date && c.end_date !== c.start_date ? ` au ${fr(c.end_date)}` : ''}
              {c.sessions?.reference ? ` · ${c.sessions.reference}` : ''} · {euros(c.amount_ht)} HT
            </div>
          </button>
          <span className="flex items-center gap-2 shrink-0">
            <StatusBadge tone={c.status === 'annule' ? 'neutral' : ['signe', 'realise', 'facture', 'paye'].includes(c.status) ? 'success' : 'info'}>{STATUTS_BC[c.status]}</StatusBadge>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => pdf(c)} aria-label="Bon de commande en PDF"><FileDown className="w-4 h-4" /></button>
          </span>
        </div>
      ))}
      {edition && (
        <Sheet title={edition.id ? edition.reference : 'Nouveau bon de commande'} onClose={() => setEdition(null)} layer="z-[160]"
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setEdition(null)}>Annuler</button>
            <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer</button>
          </>}>
          <div>
            <label className="label" htmlFor="bc-ses">Session</label>
            <select id="bc-ses" className="input" value={edition.session_id} onChange={(e) => choisirSession(e.target.value)}>
              <option value="">Aucune (prestation hors session)</option>
              {sessions.map((s) => <option key={s.id} value={s.id}>{s.reference} · {s.courses?.title || ''} · {fr(s.start_date)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="bc-obj">Objet</label>
            <input id="bc-obj" className="input" value={edition.object || ''} onChange={(e) => setEdition((x) => ({ ...x, object: e.target.value }))} />
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="bc-deb">Début</label>
              <input id="bc-deb" type="date" className="input" value={edition.start_date || ''} onChange={(e) => setEdition((x) => ({ ...x, start_date: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="bc-fin">Fin</label>
              <input id="bc-fin" type="date" className="input" value={edition.end_date || ''} onChange={(e) => setEdition((x) => ({ ...x, end_date: e.target.value }))} />
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            <div>
              <label className="label" htmlFor="bc-j">Jours</label>
              <input id="bc-j" className="input" inputMode="decimal" value={edition.days} onChange={(e) => setEdition((x) => ({ ...x, days: e.target.value.replace(/[^\d,.]/g, '') }))} />
            </div>
            <div>
              <label className="label" htmlFor="bc-tj">Prix par jour HT (€)</label>
              <input id="bc-tj" className="input" inputMode="decimal" value={edition.daily_rate} onChange={(e) => setEdition((x) => ({ ...x, daily_rate: e.target.value.replace(/[^\d,.]/g, '') }))} />
            </div>
            <div>
              <label className="label" htmlFor="bc-st">Statut</label>
              <select id="bc-st" className="input" value={edition.status} onChange={(e) => setEdition((x) => ({ ...x, status: e.target.value }))}>
                {Object.entries(STATUTS_BC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          {num(edition.days) != null && num(edition.daily_rate) != null && (
            <p className="text-ui-sm text-gray-600">Montant : <strong>{euros(num(edition.days) * num(edition.daily_rate))} HT</strong>{num(edition.days) * num(edition.daily_rate) >= 5000 ? ' · attestation de vigilance exigée (au moins 5 000 € HT)' : ''}</p>
          )}
          <div>
            <label className="label" htmlFor="bc-notes">Conditions particulières</label>
            <textarea id="bc-notes" className="input min-h-[64px]" value={edition.notes || ''} onChange={(e) => setEdition((x) => ({ ...x, notes: e.target.value }))} />
          </div>
        </Sheet>
      )}
    </div>
  )
}
