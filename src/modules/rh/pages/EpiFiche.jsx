// Bloc « EPI remis » de la fiche du personnel et de Mon espace (0394) : liste, état de renouvellement, remise signée.

import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, HardHat, Undo2, Trash2, FileText } from 'lucide-react'
import { Sheet } from '../../../ui/Sheet'
import { supabase } from '../../../core/supabase'
import PadSimple from '../../../ui/signature/PadSimple'
import { confirmer } from '../../../ui/Confirm'
import { useAuthStore } from '../../../core/store'
import { deposerDocument } from '../lib/rhDocuments'
import {
  chargerEpiPersonne, chargerArticlesEpi, chargerEmplacementsActifs, remettreEpi, marquerRendu, annulerRemise,
  etatRemise, ETATS_REMISE, renouvellementPropose, genererFicheRemisePDF,
} from '../lib/rhEpi'

const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const aujourdhui = () => new Date().toISOString().slice(0, 10)
const KIND = { depot: 'Dépôt', technicien: 'Stock de', vehicule: 'Véhicule', chantier: 'Chantier' }

function Champ({ label, aide, children }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {aide && <span className="block text-ui-sm muted mt-0.5">{aide}</span>}
    </label>
  )
}

function RemiseSheet({ companyId, personId, onClose, onSaved }) {
  const profile = useAuthStore((s) => s.profile)
  const [articles, setArticles] = useState(null)
  const [lieux, setLieux] = useState([])
  const [v, setV] = useState({ itemId: '', quantity: '1', size: '', fromLocationId: '', handedOn: aujourdhui(), renewOn: '', notes: '' })
  const [signature, setSignature] = useState(null)
  const [surPapier, setSurPapier] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    chargerArticlesEpi().then(setArticles).catch(() => setArticles([]))
    chargerEmplacementsActifs().then((l) => { setLieux(l); const d = l.find((x) => x.kind === 'depot'); if (d) setV((o) => ({ ...o, fromLocationId: d.id })) }).catch(() => setLieux([]))
  }, [])
  const article = (articles || []).find((a) => a.id === v.itemId)
  const maj = (k) => (e) => setV((o) => {
    const n = { ...o, [k]: e.target.value }
    if (k === 'itemId' || k === 'handedOn') {
      const a = (articles || []).find((x) => x.id === n.itemId)
      n.renewOn = renouvellementPropose(n.handedOn, a?.ppe_renew_months) || ''
    }
    return n
  })

  const enregistrer = async () => {
    if (!v.itemId) return toast.error('Choisissez l\'équipement remis')
    if (!(Number(v.quantity) > 0)) return toast.error('Quantité à préciser')
    if (!surPapier && !signature) return toast.error('Faites signer le salarié, ou cochez « sur papier »')
    setBusy(true)
    try {
      const r = await remettreEpi({ ...v, personId, signature: surPapier ? null : signature })
      // Fiche de remise rangée dans les documents de la personne (si l'enregistrement échoue, la remise reste)
      try {
        const [{ data: person }, { data: emp }] = await Promise.all([
          supabase.from('hr_people').select('first_name, last_name').eq('id', personId).maybeSingle(),
          supabase.from('hr_employments').select('job_title, start_on').eq('person_id', personId).order('start_on', { ascending: false }).limit(1),
        ])
        const blob = await genererFicheRemisePDF({
          person, jobTitle: emp?.[0]?.job_title || '', handedOn: v.handedOn,
          remisPar: [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.display_name || '',
          employeeSignature: surPapier ? null : signature,
          lignes: [{ label: article?.label, reference: article?.reference, quantity: v.quantity, unit: article?.unit, size: v.size, renew_on: r.renew_on }],
        })
        const nom = `Remise-EPI-${person?.last_name || 'salarie'}-${v.handedOn}.pdf`
        await deposerDocument({ companyId, personId, file: new File([blob], nom, { type: 'application/pdf' }), category: 'attestation', confidentiality: 'normal', title: `Remise d'EPI du ${fr(v.handedOn)} : ${article?.label || ''}`, docDate: v.handedOn })
        if (surPapier) window.open(URL.createObjectURL(blob), '_blank', 'noopener')
        toast.success(surPapier ? 'EPI remis : fiche à imprimer et faire signer, rangée dans les documents' : 'EPI remis, fiche signée rangée dans les documents')
      } catch { toast.success('EPI remis (fiche de remise non rangée : vérifiez vos droits sur les documents)') }
      onSaved()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  return (
    <Sheet title="Remettre un EPI" onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn btn-primary" onClick={enregistrer} disabled={busy || !articles?.length}>Enregistrer la remise</button></>}>
      <div className="space-y-3 text-ui">
        {articles?.length === 0 && (
          <p className="rounded-ui-sm bg-[rgb(var(--c-warning-bg))] p-3 text-ui-sm">
            Aucun article marqué « EPI » dans le stock. Ouvrez Stock, Articles, puis cochez « EPI remis au personnel » sur les gants, casques, chaussures…
          </p>
        )}
        <Champ label="Équipement">
          <select className="select" value={v.itemId} onChange={maj('itemId')}>
            <option value="">Choisir</option>
            {(articles || []).map((a) => <option key={a.id} value={a.id}>{a.label}{a.reference ? ` (${a.reference})` : ''}</option>)}
          </select>
        </Champ>
        <div className="grid gap-3 grid-cols-2">
          <Champ label="Quantité"><input className="input" inputMode="decimal" value={v.quantity} onChange={maj('quantity')} /></Champ>
          <Champ label="Taille ou pointure"><input className="input" maxLength={30} value={v.size} onChange={maj('size')} placeholder="9, L, 43…" /></Champ>
          <Champ label="Remis le"><input className="input" type="date" value={v.handedOn} onChange={maj('handedOn')} /></Champ>
          <Champ label="À renouveler le" aide={article?.ppe_renew_months ? `Proposé : ${article.ppe_renew_months} mois` : 'Facultatif'}>
            <input className="input" type="date" value={v.renewOn} onChange={maj('renewOn')} />
          </Champ>
        </div>
        <Champ label="Sorti de" aide="L'article sort de cet emplacement à l'enregistrement.">
          <select className="select" value={v.fromLocationId} onChange={maj('fromLocationId')}>
            <option value="">Ne pas sortir du stock</option>
            {lieux.map((l) => <option key={l.id} value={l.id}>{KIND[l.kind] ? `${KIND[l.kind]} : ` : ''}{l.name}</option>)}
          </select>
        </Champ>
        <Champ label="Remarque"><input className="input" maxLength={300} value={v.notes} onChange={maj('notes')} /></Champ>
        <div className="space-y-2">
          <div className="label">Signature du salarié</div>
          <label className="flex items-center gap-2 text-ui-sm"><input type="checkbox" checked={surPapier} onChange={(e) => setSurPapier(e.target.checked)} />Il signera sur papier (fiche imprimée)</label>
          {!surPapier && <PadSimple onChange={setSignature} label="Le salarié signe dans le cadre" />}
        </div>
      </div>
    </Sheet>
  )
}

/** EPI remis à une personne. peutGerer : remettre, marquer rendu, annuler. */
export default function EpiFiche({ companyId, personId, peutGerer = false, titre = 'EPI remis' }) {
  const [liste, setListe] = useState(null)
  const [remise, setRemise] = useState(false)
  const charger = useCallback(() => { chargerEpiPersonne(personId).then(setListe).catch(() => setListe([])) }, [personId])
  useEffect(() => { charger() }, [charger])
  const enCours = useMemo(() => (liste || []).filter((r) => !r.returned_on), [liste])
  const rendus = useMemo(() => (liste || []).filter((r) => r.returned_on), [liste])

  if (liste === null) return null
  if (!peutGerer && !liste.length) return null

  const rendre = async (r) => {
    try { await marquerRendu(r.id, aujourdhui()); charger() } catch (e) { toast.error(e.message) }
  }
  const annuler = async (r) => {
    if (!(await confirmer(`Annuler la remise de « ${r.stock_items?.label || 'EPI'} » ? L'article revient à son emplacement de stock.`))) return
    try { await annulerRemise(r.id); toast.success('Remise annulée, article revenu en stock'); charger() } catch (e) { toast.error(e.message) }
  }
  const ligne = (r) => {
    const e = ETATS_REMISE[etatRemise(r)]
    return (
      <li key={r.id} className="py-2 flex items-start gap-3 border-t border-gray-100 first:border-t-0">
        <HardHat className="w-4 h-4 mt-1 text-gray-400 flex-none" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-ui">{r.stock_items?.label || 'Équipement'}{r.size ? `, taille ${r.size}` : ''}</div>
          <div className="text-ui-sm text-gray-600">
            {[`${String(r.quantity).replace('.', ',')} ${r.stock_items?.unit || ''}`.trim(), `remis le ${fr(r.handed_on)}`,
              r.returned_on ? `rendu le ${fr(r.returned_on)}` : r.renew_on ? `à renouveler le ${fr(r.renew_on)}` : null,
              r.signed_at ? 'signé' : 'signature sur papier'].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-none">
          <span className={`badge ${e.badge}`}>{e.label}</span>
          {peutGerer && !r.returned_on && (
            <div className="flex gap-1">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => rendre(r)} title="L'équipement a été rendu"><Undo2 className="w-4 h-4" />Rendu</button>
              <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => annuler(r)} aria-label="Annuler la remise"><Trash2 className="w-4 h-4" /></button>
            </div>
          )}
        </div>
      </li>
    )
  }

  return (
    <section className="card space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="section-title">{titre}</h2>
        {peutGerer && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRemise(true)}><Plus className="w-4 h-4" />Remettre un EPI</button>}
      </div>
      {!liste.length && <p className="text-ui-sm muted">Aucun EPI remis. La remise sort l'article du stock et range une fiche signée dans les documents.</p>}
      {enCours.length > 0 && <ul>{enCours.map(ligne)}</ul>}
      {rendus.length > 0 && (
        <details className="text-ui-sm">
          <summary className="cursor-pointer text-gray-600 inline-flex items-center gap-1"><FileText className="w-4 h-4" aria-hidden="true" />{rendus.length} rendu{rendus.length > 1 ? 's' : ''}</summary>
          <ul className="mt-1">{rendus.map(ligne)}</ul>
        </details>
      )}
      {remise && <RemiseSheet companyId={companyId} personId={personId} onClose={() => setRemise(false)} onSaved={() => { setRemise(false); charger() }} />}
    </section>
  )
}
