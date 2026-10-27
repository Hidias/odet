// Contrats de maintenance : sites et types couverts, mois de visite, tarif ; génération des visites à planifier.
// 0460 (lot 1) : contrat préparé à la signature d'un devis de maintenance, validé en un clic ; durée, reconduction,
// préavis et facturation ; contrat PDF envoyé à signer dans l'espace client, ou contrat signé à la main déposé.

import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Loader2, Plus, CalendarPlus, Pencil, CheckCircle, FileText, Send, Upload } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { callApi } from '../../../core/api'
import { versBase64 } from '../../../core/portail/documentsClient'
import { confirmer } from '../../../ui/Confirm'
import { loadContracts, saveContract, generateContractVisits, loadClientsLight, loadSites, loadEquipmentForClient } from '../lib/itvData'
import { MONTHS, monthLabel, frShort } from '../lib/schedule'
import { DUREES, PERIODICITES, phraseConditions, dateFr, limiteRefus, echeanceInitiale, STATUTS_CONTRAT } from '../lib/contrat'
import { buildContratPDF, MESSAGE_CGV_MANQUANTE } from '../pdf/contratPDF'
import { Sheet, Empty } from '../components/ui'
import SearchSelect, { clientOptions } from '../../../ui/SearchSelect'

const condsDe = (c) => ({ duree_ans: c.duration_years || 1, reconduction: !!c.tacit_renewal, reconduction_ans: c.renewal_years || 1, preavis_mois: c.notice_months ?? 0, periodicite: c.billing_period || 'annuel' })

async function preparerPDF(c, types) {
  const [{ data: client }, sites, parc, { data: q }] = await Promise.all([
    supabase.from('clients').select('id, name, address, postal_code, city, siret, client_type').eq('id', c.client_id).single(),
    loadSites(c.client_id),
    loadEquipmentForClient(c.client_id),
    c.quote_id ? supabase.from('quotes').select('reference').eq('id', c.quote_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const couverts = (parc || []).filter((e) => (!(c.site_ids || []).length || c.site_ids.includes(e.site_id)) && (!(c.type_ids || []).length || c.type_ids.includes(e.type_id)))
    .map((e) => ({ type_name: e.itv_equipment_types?.name }))
  return buildContratPDF({ contract: c, client, sites: sites || [], types, parc: couverts, quoteRef: q?.reference || null })
}

export default function Contrats({ types }) {
  const [contracts, setContracts] = useState(null)
  const [edit, setEdit] = useState(null)
  const [busy, setBusy] = useState(null)
  const [papier, setPapier] = useState(null)
  const [params] = useSearchParams()
  const year = new Date().getFullYear()

  const load = async () => setContracts(await loadContracts())
  useEffect(() => { load().catch((e) => toast.error(e.message)) }, [])
  // Lien d'une notification « Contrat à valider » : la fiche s'ouvre
  useEffect(() => {
    const id = params.get('contrat')
    if (id && contracts) { const c = contracts.find((x) => x.id === id); if (c) setEdit(c) }
  }, [params, contracts])

  const run = async (id, fn) => { setBusy(id); try { await fn() } catch (e) { toast.error(e.message) } finally { setBusy(null) } }
  const generate = (c, y) => run(c.id, async () => {
    const n = await generateContractVisits(c.id, y)
    toast.success(n ? `${n} visite${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} à planifier pour ${y}` : `Les visites ${y} existent déjà`)
  })
  const valider = (c) => run(c.id, async () => {
    const { data, error } = await supabase.rpc('contrat_valider', { p_contract: c.id })
    if (error) throw error
    toast.success(`Contrat validé${data?.term_on ? `, échéance le ${dateFr(data.term_on)}` : ''}`)
    await load()
  })
  const apercu = (c) => run(c.id, async () => {
    const { base64, cgv } = await preparerPDF(c, types)
    if (!cgv) toast(MESSAGE_CGV_MANQUANTE, { duration: 8000 })
    const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), (x) => x.charCodeAt(0))], { type: 'application/pdf' }))
    window.open(url, '_blank', 'noopener')
  })
  const envoyer = (c) => run(c.id, async () => {
    const { base64, cgv } = await preparerPDF(c, types)
    if (!cgv) { toast.error(MESSAGE_CGV_MANQUANTE, { duration: 8000 }); return }
    if (!(await confirmer(`Mettre le contrat de ${c.clients?.name || 'ce client'} à signer dans son espace client ?`))) return
    await callApi('/api/documents-client', { action: 'publier', object_type: 'itv_contract', object_id: c.id, kind: 'contrat', label: `${c.label || 'Contrat de maintenance'}${c.reference ? ` ${c.reference}` : ''}`, pdf_base64: base64 })
    toast.success('Contrat à signer dans l\'espace client du client (Accès entreprise pour lui envoyer le lien)')
  })

  if (!contracts) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  const actifs = contracts.filter((c) => c.status === 'actif')
  const total = actifs.reduce((s, c) => s + Number(c.annual_price_ht || 0), 0)
  const ordre = { a_valider: 0, actif: 1, suspendu: 2, termine: 3 }
  const liste = [...contracts].sort((a, b) => (ordre[a.status] ?? 9) - (ordre[b.status] ?? 9))
  const aValider = contracts.filter((c) => c.status === 'a_valider').length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="muted text-ui-sm flex-1">{actifs.length} contrats actifs, {total.toLocaleString('fr-FR')} € HT par an.{aValider ? ` ${aValider} à valider.` : ''}</p>
        <button type="button" className="btn btn-primary" onClick={() => setEdit({})}><Plus className="w-4 h-4" />Nouveau contrat</button>
      </div>
      {contracts.length === 0 ? <Empty title="Aucun contrat">Un contrat est préparé tout seul quand un devis de maintenance est signé. Il fixe les mois de visite : les visites de l'année s'ajoutent à la liste « À planifier » en un clic.</Empty> : (
        <div className="card card-flush">
          {liste.map((c) => {
            const [badge, libelle] = STATUTS_CONTRAT[c.status] || STATUTS_CONTRAT.termine
            const limite = c.tacit_renewal && c.term_on ? limiteRefus(c.term_on, c.notice_months) : null
            return (
              <div key={c.id} className={`flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100 last:border-b-0 ${c.status === 'a_valider' ? 'bg-[rgb(var(--c-warning)/0.06)]' : ''}`}>
                <div className="flex-1 min-w-[220px]">
                  <Link to={`/interventions/parc/${c.client_id}`} className="font-semibold">{c.clients?.name}</Link>
                  <div className="text-ui-sm text-gray-500">{c.label}{c.reference ? ` (${c.reference})` : ''}. Visites en {(c.visit_months || []).map(monthLabel).join(' et ') || '?'}. {Number(c.annual_price_ht || 0).toLocaleString('fr-FR')} € HT par an.</div>
                  {c.duration_years && <div className="text-ui-sm text-gray-500">{phraseConditions(condsDe(c))}{c.term_on ? ` Échéance le ${dateFr(c.term_on)}${limite ? `, refus possible jusqu'au ${dateFr(limite)}` : ''}.` : ''}</div>}
                  <div className="text-ui-sm">{c.signed_at ? <span className="text-[rgb(var(--c-success))]">Signé le {dateFr(c.signed_at)}{c.signed_name ? ` par ${c.signed_name}` : ''}{c.signed_on_paper ? ' (papier)' : ''}</span> : c.status === 'actif' ? <span className="text-gray-500">Contrat pas encore signé</span> : null}</div>
                </div>
                <span className={`badge ${badge}`}>{libelle}</span>
                {c.status === 'a_valider' && <button type="button" className="btn btn-primary btn-sm" onClick={() => valider(c)} disabled={busy === c.id}><CheckCircle className="w-4 h-4" />Valider</button>}
                {c.status === 'actif' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => generate(c, year)} disabled={busy === c.id}><CalendarPlus className="w-4 h-4" />Visites {year}</button>}
                {c.status === 'actif' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => generate(c, year + 1)} disabled={busy === c.id}>{year + 1}</button>}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => apercu(c)} disabled={busy === c.id}><FileText className="w-4 h-4" />PDF</button>
                {c.status === 'actif' && !c.signed_at && <button type="button" className="btn btn-ghost btn-sm" onClick={() => envoyer(c)} disabled={busy === c.id}><Send className="w-4 h-4" />À signer</button>}
                {c.status === 'actif' && !c.signed_at && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPapier(c)}><Upload className="w-4 h-4" />Signé à la main</button>}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(c)}><Pencil className="w-4 h-4" />Modifier</button>
              </div>
            )
          })}
        </div>
      )}
      <p className="muted text-ui-sm">La facture d'une visite sous contrat se prépare depuis la visite terminée, dans les Factures existantes.</p>
      {edit && <ContractForm contract={edit} types={types} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
      {papier && <SignePapier contract={papier} onClose={() => setPapier(null)} onSaved={() => { setPapier(null); load() }} />}
    </div>
  )
}

// Contrat signé à la main (mairie, papier) : le scan rejoint l'espace client, le contrat est noté signé
function SignePapier({ contract, onClose, onSaved }) {
  const [fichier, setFichier] = useState(null)
  const [nom, setNom] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const ok = fichier && nom.trim().length >= 2 && date
  const enregistrer = async () => {
    if (fichier.type !== 'application/pdf') { toast.error('Le contrat signé doit être un PDF'); return }
    setBusy(true)
    try {
      const pub = await callApi('/api/documents-client', { action: 'publier', object_type: 'itv_contract', object_id: contract.id, kind: 'contrat', label: `${contract.label || 'Contrat de maintenance'} signé`, pdf_base64: versBase64(await fichier.arrayBuffer()) })
      if (!pub?.id) throw new Error('Dépôt du contrat impossible')
      const { error } = await supabase.rpc('contrat_signe_papier', { p_contract: contract.id, p_document: pub.id, p_nom: nom.trim(), p_date: date })
      if (error) throw error
      toast.success('Contrat noté signé'); onSaved()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  return (
    <Sheet title="Contrat signé à la main" onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn btn-primary" onClick={enregistrer} disabled={!ok || busy}>Enregistrer</button></>}>
      <p className="text-ui-sm text-gray-600">Le contrat signé rejoint l'espace client de {contract.clients?.name || 'ce client'}. Ses conditions ne changeront plus que par un avenant.</p>
      <div><label className="label" htmlFor="sp-fichier">Contrat signé (PDF)</label><input id="sp-fichier" type="file" accept="application/pdf" className="input" onChange={(e) => setFichier(e.target.files?.[0] || null)} /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className="label" htmlFor="sp-nom">Signé par</label><input id="sp-nom" className="input" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom et fonction" /></div>
        <div><label className="label" htmlFor="sp-date">Le</label><input id="sp-date" type="date" className="input" max={new Date().toISOString().slice(0, 10)} value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
    </Sheet>
  )
}

export function ContractForm({ contract, sites: sitesIn = null, types, onClose, onSaved }) {
  const [clients, setClients] = useState([])
  const [sites, setSites] = useState(sitesIn || [])
  const [busy, setBusy] = useState(false)
  const signe = !!contract.signed_at
  const [f, setF] = useState(() => ({
    client_id: contract.client_id || '', label: contract.label || 'Contrat de maintenance', reference: contract.reference || '',
    start_on: contract.start_on || new Date().toISOString().slice(0, 10), end_on: contract.end_on || '',
    annual_price_ht: contract.annual_price_ht ?? '', visit_months: contract.visit_months || [], site_ids: contract.site_ids || [],
    type_ids: contract.type_ids || [], status: contract.status || 'actif', notes: contract.notes || '',
    duration_years: contract.duration_years || 1, tacit_renewal: contract.id ? !!contract.tacit_renewal : true, renewal_years: contract.renewal_years || 1,
    notice_months: contract.notice_months ?? 3, billing_period: contract.billing_period || 'annuel',
  }))
  useEffect(() => { if (!contract.client_id) loadClientsLight().then(setClients) }, [contract.client_id])
  useEffect(() => { if (f.client_id && !sitesIn) loadSites(f.client_id).then((s) => setSites(s || [])) }, [f.client_id, sitesIn])

  const toggle = (key, v) => setF((x) => ({ ...x, [key]: x[key].includes(v) ? x[key].filter((y) => y !== v) : [...x[key], v].sort((a, b) => (typeof a === 'number' ? a - b : 0)) }))
  const save = async () => {
    if (!f.client_id) { toast.error('Choisissez le client'); return }
    if (!f.visit_months.length) { toast.error('Choisissez au moins un mois de visite'); return }
    if (f.status === 'a_valider' && contract.status !== 'a_valider') { toast.error('Statut invalide'); return }
    setBusy(true)
    try {
      const row = { ...(contract.id ? { id: contract.id } : {}), ...f, end_on: f.end_on || null, annual_price_ht: Number(f.annual_price_ht || 0), reference: f.reference || null, notes: f.notes || null,
        site_ids: f.site_ids.length ? f.site_ids : null, type_ids: f.type_ids.length ? f.type_ids : null,
        duration_years: Number(f.duration_years), renewal_years: Number(f.renewal_years), notice_months: Number(f.notice_months) }
      // Contrat saisi à la main ou actif sans échéance : échéance calculée comme à la validation (contrat_valider)
      if (row.status === 'actif' && !signe && (!contract.id || !contract.term_on || ['start_on', 'duration_years', 'tacit_renewal'].some((k) => row[k] !== contract[k]))) {
        row.term_on = echeanceInitiale(row.start_on, row.duration_years)
        if (!row.tacit_renewal && !row.end_on) row.end_on = row.term_on
        if (!contract.validated_at) row.validated_at = new Date().toISOString()
      }
      // Contrat signé : ses conditions ne se modifient plus (avenant) ; seuls les visites, sites, notes et statut changent
      if (signe) for (const k of ['annual_price_ht', 'duration_years', 'tacit_renewal', 'renewal_years', 'notice_months', 'billing_period', 'start_on', 'client_id']) delete row[k]
      await saveContract(row)
      toast.success('Contrat enregistré'); onSaved()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  const c = f

  return (
    <Sheet title={contract.id ? (contract.status === 'a_valider' ? 'Contrat à valider' : 'Modifier le contrat') : 'Nouveau contrat de maintenance'} onClose={onClose} wide
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn btn-primary" onClick={save} disabled={busy}>Enregistrer</button></>}>
      {contract.status === 'a_valider' && <p className="text-ui-sm text-gray-600">Préparé depuis le devis signé : vérifiez les mois de visite et les sites, enregistrez, puis « Valider » dans la liste.</p>}
      {signe && <p className="text-ui-sm text-gray-600">Contrat signé le {dateFr(contract.signed_at)} : prix, durée, reconduction, préavis et facturation ne changent plus que par un avenant.</p>}
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
        <div><label className="label" htmlFor="ct-start">Prise d'effet</label><input id="ct-start" type="date" className="input" disabled={signe} value={f.start_on} onChange={(e) => setF({ ...f, start_on: e.target.value })} /></div>
        <div><label className="label" htmlFor="ct-price">Prix annuel HT</label><input id="ct-price" className="input" inputMode="decimal" disabled={signe} value={f.annual_price_ht} onChange={(e) => setF({ ...f, annual_price_ht: e.target.value.replace(',', '.') })} /></div>
        <div><label className="label" htmlFor="ct-duree">Durée</label>
          <select id="ct-duree" className="select" disabled={signe} value={f.duration_years} onChange={(e) => setF({ ...f, duration_years: Number(e.target.value) })}>{DUREES.map((d) => <option key={d} value={d}>{d} an{d > 1 ? 's' : ''}</option>)}</select></div>
        <div><label className="label" htmlFor="ct-fact">Facturation</label>
          <select id="ct-fact" className="select" disabled={signe} value={f.billing_period} onChange={(e) => setF({ ...f, billing_period: e.target.value })}>{PERIODICITES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div><label className="label" htmlFor="ct-reco">À l'échéance</label>
          <select id="ct-reco" className="select" disabled={signe} value={f.tacit_renewal ? `oui-${f.renewal_years}` : 'non'} onChange={(e) => { const v = e.target.value; setF({ ...f, tacit_renewal: v !== 'non', renewal_years: v === 'non' ? f.renewal_years : Number(v.split('-')[1]) }) }}>
            {[1, 3, 5].map((n) => <option key={n} value={`oui-${n}`}>Reconduit {n} an{n > 1 ? 's' : ''}</option>)}<option value="non">Prend fin</option>
          </select></div>
        <div><label className="label" htmlFor="ct-preavis">Préavis (mois)</label><input id="ct-preavis" type="number" min={0} max={12} className="input" disabled={signe || !f.tacit_renewal} value={f.notice_months} onChange={(e) => setF({ ...f, notice_months: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })} /></div>
        <div><label className="label" htmlFor="ct-end">Fin (facultatif)</label><input id="ct-end" type="date" className="input" value={f.end_on} onChange={(e) => setF({ ...f, end_on: e.target.value })} /></div>
        <div><label className="label" htmlFor="ct-status">Statut</label>
          <select id="ct-status" className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            {contract.status === 'a_valider' && <option value="a_valider">À valider</option>}
            <option value="actif" disabled={contract.status === 'a_valider'}>Actif</option><option value="suspendu">Suspendu</option><option value="termine">Terminé</option>
          </select></div>
      </div>
      <p className="text-ui-sm text-gray-500">{phraseConditions({ duree_ans: c.duration_years, reconduction: c.tacit_renewal, reconduction_ans: c.renewal_years, preavis_mois: c.notice_months, periodicite: c.billing_period })}</p>
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
