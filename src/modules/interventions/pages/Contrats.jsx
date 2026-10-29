// Contrats de maintenance : sites et types couverts, mois de visite, tarif ; génération des visites à planifier.
// 0460 (lot 1) : contrat préparé à la signature d'un devis de maintenance, validé en un clic ; durée, reconduction,
// préavis et facturation ; contrat PDF envoyé à signer dans l'espace client, ou contrat signé à la main déposé.

import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Loader2, Plus, CalendarPlus, Pencil, CheckCircle, FileText, Send, Upload, Receipt, Calculator } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { callApi } from '../../../core/api'
import { versBase64 } from '../../../core/portail/documentsClient'
import { confirmer } from '../../../ui/Confirm'
import { loadContracts, saveContract, generateContractVisits, loadClientsLight, loadSites, loadEquipmentForClient } from '../lib/itvData'
import { MONTHS, monthLabel, frShort } from '../lib/schedule'
import { DUREES, PERIODICITES, phraseConditions, dateFr, limiteRefus, echeanceInitiale, STATUTS_CONTRAT } from '../lib/contrat'
import { buildContratPDF, MESSAGE_CGV_MANQUANTE } from '../pdf/contratPDF'
import { buildRevisionPDF } from '../pdf/revisionPDF'
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
  const [ouvert, setOuvert] = useState(null)
  const [prixParc, setPrixParc] = useState(null)
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
                  {c.emergency_hours && <SuiviUrgences contract={c} />}
                  {c.termination_requested_at && <div className="text-ui-sm text-[rgb(var(--c-warning))]">Résiliation demandée en ligne le {dateFr(c.termination_requested_at)} (accusé {c.termination_receipt}) : date d'effet à confirmer au client.</div>}
                  <div className="text-ui-sm">{c.signed_at ? <span className="text-[rgb(var(--c-success))]">Signé le {dateFr(c.signed_at)}{c.signed_name ? ` par ${c.signed_name}` : ''}{c.signed_on_paper ? ' (papier)' : ''}</span> : c.status === 'actif' ? <span className="text-gray-500">Contrat pas encore signé</span> : null}</div>
                </div>
                <span className={`badge ${badge}`}>{libelle}</span>
                {c.status === 'a_valider' && <button type="button" className="btn btn-primary btn-sm" onClick={() => valider(c)} disabled={busy === c.id}><CheckCircle className="w-4 h-4" />Valider</button>}
                {c.status === 'actif' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => generate(c, year)} disabled={busy === c.id}><CalendarPlus className="w-4 h-4" />Visites {year}</button>}
                {c.status === 'actif' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => generate(c, year + 1)} disabled={busy === c.id}>{year + 1}</button>}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => apercu(c)} disabled={busy === c.id}><FileText className="w-4 h-4" />PDF</button>
                {c.status === 'actif' && !c.signed_at && <button type="button" className="btn btn-ghost btn-sm" onClick={() => envoyer(c)} disabled={busy === c.id}><Send className="w-4 h-4" />À signer</button>}
                {c.status === 'actif' && !c.signed_at && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPapier(c)}><Upload className="w-4 h-4" />Signé à la main</button>}
                {c.status === 'actif' && (['mensuel', 'trimestriel', 'annuel'].includes(c.billing_period) || c.index_base_value) && <button type="button" className="btn btn-ghost btn-sm" aria-expanded={ouvert === c.id} onClick={() => setOuvert(ouvert === c.id ? null : c.id)}><Receipt className="w-4 h-4" />Échéancier</button>}
                {['a_valider', 'actif'].includes(c.status) && <button type="button" className="btn btn-ghost btn-sm" aria-expanded={prixParc === c.id} onClick={() => setPrixParc(prixParc === c.id ? null : c.id)}><Calculator className="w-4 h-4" />Prix d'après le parc</button>}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(c)}><Pencil className="w-4 h-4" />Modifier</button>
                {prixParc === c.id && <div className="basis-full"><PrixParc contract={c} onChange={load} /></div>}
                {ouvert === c.id && <div className="basis-full"><RevisionsContrat contract={c} onChange={load} /><EcheancierContrat contract={c} /></div>}
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

// Dépannages urgents (0465) : délai promis au contrat, tenu ou non sur les 12 derniers mois
function SuiviUrgences({ contract }) {
  const [r, setR] = useState(null)
  useEffect(() => { supabase.rpc('contrat_urgences', { p_contract: contract.id }).then(({ data }) => setR(data || null), () => setR(null)) }, [contract.id])
  if (!r) return null
  return (
    <div className="text-ui-sm text-gray-500">Dépannage urgent sous {r.delai_h} h.{r.urgences ? ` Sur 12 mois : ${r.urgences} urgence${r.urgences > 1 ? 's' : ''}, ${r.respectees} dans le délai` : ' Aucune urgence sur 12 mois'}
      {r.en_retard > 0 && <span className="text-[rgb(var(--c-danger))]">, {r.en_retard} hors délai</span>}{r.en_attente > 0 ? `, ${r.en_attente} en attente` : ''}{r.urgences ? '.' : ''}</div>
  )
}

// Prix d'après le parc (0463) : appareils couverts par type × prix par appareil et par an (tarif du client, sinon prix
// de la société). Contrat non signé : le prix s'applique en un clic. Contrat signé : l'avenant se prépare depuis le devis.
const eur = (n) => `${Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
function PrixParc({ contract, onChange }) {
  const [r, setR] = useState(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  useEffect(() => {
    supabase.rpc('contrat_prix_parc', { p_contract: contract.id }).then(({ data, error }) => setR(error ? { erreur: error.message } : data), () => setR({ erreur: 'Calcul impossible' }))
  }, [contract.id])
  if (!r) return <p className="text-ui-sm text-gray-500 py-2">Calcul…</p>
  if (r.erreur) return <p className="text-ui-sm text-gray-500 py-2">{r.erreur}</p>
  if (!r.appareils) return <p className="text-ui-sm text-gray-500 py-2">Aucun appareil couvert au parc : faites l'inventaire (fiche du client, « Visite d'inventaire »), le prix se calcule ensuite.</p>
  const ecart = Math.round((Number(r.total) - Number(r.prix_actuel || 0)) * 100) / 100
  const appliquer = async () => {
    if (!(await confirmer(`Prix annuel du contrat : ${eur(r.total)} HT au lieu de ${eur(r.prix_actuel)} HT ?`))) return
    setBusy(true)
    const { error } = await supabase.from('itv_contracts').update({ annual_price_ht: r.total }).eq('id', contract.id)
    const { error: errEch } = error ? { error: null } : await supabase.rpc('contrat_echeancier_generer', { p_contract: contract.id })
    setBusy(false)
    if (error) return toast.error(error.message)
    onChange?.()
    // Prix enregistré mais échéancier non recalculé : le dire, les échéances à venir gardent l'ancien montant
    if (errEch) return toast.error(`Prix enregistré, mais l'échéancier n'a pas été recalculé (${errEch.message}). Ouvrez le contrat et enregistrez-le pour le recalculer.`, { duration: 10000 })
    toast.success('Prix du contrat mis à jour, échéancier recalculé')
  }
  const avenant = async () => {
    setBusy(true)
    const motif = `Parc constaté : ${r.appareils} appareil${r.appareils > 1 ? 's' : ''} couvert${r.appareils > 1 ? 's' : ''}, ${eur(r.total)} HT par an d'après les tarifs, contre ${eur(r.prix_actuel)} HT au contrat.`
    const { data, error } = await supabase.rpc('devis_avenant', { p_quote: contract.quote_id, p_motif: motif })
    setBusy(false)
    if (error || !data) return toast.error(error?.message || 'Avenant impossible')
    toast.success(`Avenant préparé : saisissez l'écart de ${eur(ecart)} HT, puis envoyez-le.`)
    navigate(`/devis?open=${data}`)
  }
  return (
    <div className="mt-2 rounded-ui-sm border border-gray-200 overflow-x-auto">
      <table className="w-full text-ui-sm">
        <thead><tr><th className="text-left">Matériel</th><th className="text-right">Nombre</th><th className="text-right">Prix par an</th><th className="text-right">Total HT</th></tr></thead>
        <tbody>
          {r.lignes.map((l) => (
            <tr key={l.type_id}>
              <td>{l.type}{l.source === 'client' && <span className="badge badge-blue ml-1">tarif client</span>}</td>
              <td className="text-right">{l.nb}</td>
              <td className="text-right">{l.prix == null ? <span className="text-[rgb(var(--c-danger))]">sans prix</span> : eur(l.prix)}</td>
              <td className="text-right">{l.total == null ? '' : eur(l.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td className="font-semibold">Total</td><td className="text-right font-semibold">{r.appareils}</td><td /><td className="text-right font-semibold">{eur(r.total)}</td></tr></tfoot>
      </table>
      <div className="px-2 py-2 text-ui-sm space-y-1">
        {r.manquants.length > 0 && <p className="text-[rgb(var(--c-warning))]">Sans prix : {r.manquants.join(', ')}. Réglez-les dans Réglages › Facturation › Contrats (ou un tarif propre au client) avant d'appliquer.</p>}
        <p className="text-gray-600">Prix actuel du contrat : {eur(r.prix_actuel)} HT par an{ecart ? ` (écart ${ecart > 0 ? '+' : ''}${eur(ecart)})` : ', identique'}.</p>
        {ecart !== 0 && !r.signe && <button type="button" className="btn btn-primary btn-sm" disabled={busy || r.manquants.length > 0} onClick={appliquer}>Appliquer ce prix</button>}
        {ecart !== 0 && r.signe && (contract.quote_id
          ? <button type="button" className="btn btn-primary btn-sm" disabled={busy || r.manquants.length > 0} onClick={avenant}>Préparer l'avenant</button>
          : <p className="text-gray-500">Contrat signé sans devis d'origine : le nouveau prix passe par un nouveau devis signé par le client.</p>)}
      </div>
    </div>
  )
}

// Révisions annuelles du prix (0462) : valeur de l'indice saisie, prix calculé, validé ou écarté, courrier au client
function RevisionsContrat({ contract, onChange }) {
  const [lignes, setLignes] = useState([])
  const [saisie, setSaisie] = useState({})
  const [busy, setBusy] = useState(false)
  const charger = () => supabase.from('itv_contract_revisions').select('*').eq('contract_id', contract.id).order('anniversary', { ascending: false })
    .then(({ data }) => setLignes(data || []), () => setLignes([]))
  useEffect(() => { charger() }, [contract.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!lignes.length) return null
  const decider = async (r, valider) => {
    const v = Number(String(saisie[r.id]?.valeur || '').replace(',', '.'))
    if (valider && !(v > 0)) { toast.error('Saisissez la nouvelle valeur de l\'indice'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('contrat_revision_decider', { p_revision: r.id, p_valeur: valider ? v : null, p_mois: saisie[r.id]?.mois || null, p_valider: valider, p_note: null })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(valider ? `Nouveau prix : ${Number(data.prix).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT` : 'Révision écartée')
    charger(); onChange?.()
  }
  const courrier = async (r) => {
    const [{ data: client }, { data: k }] = await Promise.all([
      supabase.from('clients').select('name, address, postal_code, city').eq('id', contract.client_id).single(),
      supabase.from('itv_contracts').select('*').eq('id', contract.id).single(),
    ])
    const { base64, filename } = await buildRevisionPDF({ contract: k, client, revision: r })
    const a = document.createElement('a'); a.href = `data:application/pdf;base64,${base64}`; a.download = filename
    document.body.appendChild(a); a.click(); a.remove()
  }
  return (
    <div className="mt-2 space-y-2">
      {lignes.map((r) => (
        <div key={r.id} className="rounded-ui-sm border border-gray-200 p-2 text-ui-sm flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]"><span className="font-semibold">Révision au {dateFr(r.anniversary)}</span> · prix actuel {Number(r.price_before).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT
            {r.status === 'validee' && <span> · nouveau prix {Number(r.price_after).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT (indice {r.new_value})</span>}
            {r.status === 'ecartee' && <span> · écartée</span>}</div>
          {r.status === 'a_saisir' && <>
            <label className="block"><span className="text-gray-500">Nouvelle valeur (I)</span><input className="input w-28" inputMode="decimal" value={saisie[r.id]?.valeur || ''} onChange={(e) => setSaisie({ ...saisie, [r.id]: { ...saisie[r.id], valeur: e.target.value } })} /></label>
            <label className="block"><span className="text-gray-500">Mois de l'indice</span><input type="month" className="input w-40" onChange={(e) => setSaisie({ ...saisie, [r.id]: { ...saisie[r.id], mois: e.target.value ? `${e.target.value}-01` : null } })} /></label>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => decider(r, true)}>Valider</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => decider(r, false)}>Écarter</button>
          </>}
          {r.status === 'validee' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => courrier(r).catch((e) => toast.error(e.message))}><FileText className="w-4 h-4" />Courrier au client</button>}
        </div>
      ))}
    </div>
  )
}

// Échéancier du contrat (0461) : une facture brouillon par échéance, préparée la nuit à la date d'échéance ou ici
function EcheancierContrat({ contract }) {
  const [lignes, setLignes] = useState(null)
  const [busy, setBusy] = useState(null)
  const navigate = useNavigate()
  const charger = () => supabase.from('itv_contract_installments').select('id, period_start, period_end, due_on, amount_ht, status, invoice_id, invoices(reference, status)')
    .eq('contract_id', contract.id).order('period_start').then(({ data }) => setLignes(data || []), () => setLignes([]))
  useEffect(() => { charger() }, [contract.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const preparer = async (e) => {
    setBusy(e.id)
    const { data, error } = await supabase.rpc('contrat_echeance_facturer', { p_installment: e.id })
    setBusy(null)
    if (error) return toast.error(error.message)
    toast.success('Facture préparée en brouillon')
    navigate(`/factures?open=${data}`)
  }
  if (!lignes) return <p className="text-ui-sm text-gray-500 py-2">Chargement…</p>
  if (!lignes.length) return <p className="text-ui-sm text-gray-500 py-2">Aucune échéance : enregistrez le contrat (prix, durée, facturation) pour la calculer.</p>
  const total = lignes.filter((e) => e.status !== 'annulee').reduce((t, e) => t + Number(e.amount_ht || 0), 0)
  return (
    <div className="mt-2 rounded-ui-sm border border-gray-200 overflow-x-auto">
      <table className="w-full text-ui-sm">
        <thead><tr><th className="text-left">Période</th><th className="text-left">Facture le</th><th className="text-right">Montant HT</th><th className="text-left">Facture</th></tr></thead>
        <tbody>
          {lignes.map((e) => (
            <tr key={e.id}>
              <td>{dateFr(e.period_start)} au {dateFr(e.period_end)}</td>
              <td>{dateFr(e.due_on)}</td>
              <td className="text-right">{Number(e.amount_ht).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</td>
              <td>{e.invoice_id
                ? <Link to={`/factures?open=${e.invoice_id}`} className="text-primary-600 hover:underline">{e.invoices?.status === 'draft' ? 'Brouillon à émettre' : e.invoices?.reference || 'Facture'}</Link>
                : e.status === 'a_facturer' ? <button type="button" className="btn btn-ghost btn-sm" disabled={busy === e.id} onClick={() => preparer(e)}>Préparer maintenant</button> : 'Annulée'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={2} className="font-semibold">Total</td><td className="text-right font-semibold">{total.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</td><td /></tr></tfoot>
      </table>
      <p className="text-ui-sm text-gray-500 px-2 py-1">Chaque facture est préparée en brouillon la nuit de son échéance et signalée dans « Relances à valider » : rien n'est émis ni envoyé seul.</p>
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
    billing_term: contract.billing_term || '', includes: contract.includes || {}, purchase_order_ref: contract.purchase_order_ref || '',
    index_label: contract.index_label || '', index_series: contract.index_series || '', index_base_value: contract.index_base_value ?? '', index_base_month: contract.index_base_month || '',
    emergency_hours: contract.emergency_hours ?? '',
  }))
  // Client public (0461) : terme échu par défaut, engagement de l'exercice, bon de commande
  const [clientType, setClientType] = useState(null)
  const [engagement, setEngagement] = useState({ year: new Date().getFullYear(), number: '', id: null })
  useEffect(() => {
    if (!f.client_id) return
    supabase.from('clients').select('client_type').eq('id', f.client_id).maybeSingle().then(({ data }) => setClientType(data?.client_type || null))
    const y = new Date().getFullYear()
    supabase.from('client_engagements').select('id, number').eq('client_id', f.client_id).eq('year', y).maybeSingle()
      .then(({ data }) => setEngagement({ year: y, number: data?.number || '', id: data?.id || null }), () => {})
  }, [f.client_id])
  const publicClient = clientType === 'public'
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
        duration_years: Number(f.duration_years), renewal_years: Number(f.renewal_years), notice_months: Number(f.notice_months),
        billing_term: f.billing_term || null, purchase_order_ref: (f.purchase_order_ref || '').trim() || null,
        index_label: f.index_label.trim() || null, index_series: f.index_series.trim() || null,
        index_base_value: f.index_base_value === '' ? null : Number(String(f.index_base_value).replace(',', '.')), index_base_month: f.index_base_month || null,
        emergency_hours: f.emergency_hours === '' || f.emergency_hours == null ? null : Math.max(1, Math.min(720, Number(f.emergency_hours) || 0)) || null }
      // Contrat saisi à la main ou actif sans échéance : échéance calculée comme à la validation (contrat_valider)
      if (row.status === 'actif' && !signe && (!contract.id || !contract.term_on || ['start_on', 'duration_years', 'tacit_renewal'].some((k) => row[k] !== contract[k]))) {
        row.term_on = echeanceInitiale(row.start_on, row.duration_years)
        if (!row.tacit_renewal && !row.end_on) row.end_on = row.term_on
        if (!contract.validated_at) row.validated_at = new Date().toISOString()
      }
      // Contrat signé : ses conditions ne se modifient plus (avenant) ; seuls les visites, sites, notes et statut changent
      if (signe) for (const k of ['annual_price_ht', 'duration_years', 'tacit_renewal', 'renewal_years', 'notice_months', 'billing_period', 'start_on', 'client_id', 'index_base_value', 'index_series', 'emergency_hours', 'includes']) delete row[k]
      const saved = await saveContract(row)
      // Engagement de l'exercice (client public) : une saisie par an, reprise sur chaque facture de l'année
      if (publicClient && engagement.number.trim()) {
        const { error: eg } = await supabase.from('client_engagements').upsert({ client_id: f.client_id, year: engagement.year, number: engagement.number.trim() }, { onConflict: 'client_id,year' })
        if (eg) toast.error(`Engagement non enregistré : ${eg.message}`)
      }
      // Échéancier recalculé (échéances déjà facturées inchangées)
      if ((saved?.status || row.status) === 'actif') {
        const { error: ee } = await supabase.rpc('contrat_echeancier_generer', { p_contract: saved?.id || contract.id })
        if (ee) toast.error(`Échéancier : ${ee.message}`)
      }
      toast.success('Contrat enregistré'); onSaved()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  const c = f

  return (
    <Sheet title={contract.id ? (contract.status === 'a_valider' ? 'Contrat à valider' : 'Modifier le contrat') : 'Nouveau contrat de maintenance'} onClose={onClose} wide
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn btn-primary" onClick={save} disabled={busy}>Enregistrer</button></>}>
      {contract.status === 'a_valider' && <p className="text-ui-sm text-gray-600">Préparé depuis le devis signé : vérifiez les mois de visite et les sites, enregistrez, puis « Valider » dans la liste.</p>}
      {signe && <p className="text-ui-sm text-gray-600">Contrat signé le {dateFr(contract.signed_at)} : prix, durée, reconduction, préavis, facturation, ce qui est compris et délai de dépannage ne changent plus que par un avenant.</p>}
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
      {f.billing_period !== 'visite' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="label" htmlFor="ct-terme">Facture émise</label>
            <select id="ct-terme" className="select" value={f.billing_term} onChange={(e) => setF({ ...f, billing_term: e.target.value })}>
              <option value="">{publicClient ? 'Après la période (client public)' : 'En début de période'}</option>
              <option value="echoir">En début de période</option><option value="echu">Après la période</option>
            </select></div>
          <fieldset><legend className="label">Compris au contrat (0 € sur la visite)</legend>
            <div className="flex flex-wrap gap-3 pt-1">{[['pieces', 'Pièces'], ['recharges', 'Recharges'], ['deplacement', 'Déplacement'], ['depannage', 'Main-d\'œuvre de dépannage']].map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-ui"><input type="checkbox" disabled={signe} checked={f.includes?.[k] === true} onChange={(e) => setF({ ...f, includes: { ...(f.includes || {}), [k]: e.target.checked } })} />{l}</label>
            ))}</div>
          </fieldset>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className="label" htmlFor="ct-urg">Dépannage urgent : arrivée promise sous (heures)</label><input id="ct-urg" className="input" type="number" min={1} max={720} disabled={signe} value={f.emergency_hours} onChange={(e) => setF({ ...f, emergency_hours: e.target.value })} placeholder="Vide : aucun engagement" /></div>
        <div><label className="label" htmlFor="ct-bc">N° de bon de commande</label><input id="ct-bc" className="input" maxLength={60} value={f.purchase_order_ref} onChange={(e) => setF({ ...f, purchase_order_ref: e.target.value })} placeholder="Repris sur chaque facture" /></div>
        {publicClient && <div><label className="label" htmlFor="ct-eng">N° d'engagement {engagement.year}</label><input id="ct-eng" className="input" maxLength={60} value={engagement.number} onChange={(e) => setEngagement({ ...engagement, number: e.target.value })} placeholder="Obligatoire pour émettre sur Chorus Pro" /></div>}
      </div>
      <fieldset>
        <legend className="label">Révision annuelle du prix (P = P0 × I / I0)</legend>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2"><label className="text-ui-sm text-gray-500" htmlFor="ct-ind">Indice</label><input id="ct-ind" className="input" maxLength={200} value={f.index_label} onChange={(e) => setF({ ...f, index_label: e.target.value })} placeholder="Ex. : ICHTrev-TS, activité à préciser (insee.fr)" /></div>
          <div><label className="text-ui-sm text-gray-500" htmlFor="ct-ser">Identifiant de série</label><input id="ct-ser" className="input" maxLength={40} disabled={signe} value={f.index_series} onChange={(e) => setF({ ...f, index_series: e.target.value })} /></div>
          <div><label className="text-ui-sm text-gray-500" htmlFor="ct-i0">Valeur de référence (I0)</label><input id="ct-i0" className="input" inputMode="decimal" disabled={signe} value={f.index_base_value} onChange={(e) => setF({ ...f, index_base_value: e.target.value })} /></div>
        </div>
        <p className="text-ui-sm text-gray-500 mt-1">Sans valeur de référence, aucune révision n'est proposée. Valeurs officielles : insee.fr.</p>
      </fieldset>
      <div><label className="label" htmlFor="ct-notes">Notes</label><textarea id="ct-notes" className="textarea" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      {contract.start_on && <p className="muted text-ui-sm">En vigueur depuis le {frShort(contract.start_on)}.</p>}
    </Sheet>
  )
}
