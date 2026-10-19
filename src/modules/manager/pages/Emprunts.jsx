// Manager, emprunts et crédits (0220) : liste avec totaux et courbe du capital restant dû, fiche d'un emprunt
// (caractéristiques, échéancier, courbe, événements, import du tableau de la banque, rapprochement bancaire).
// Une seule source pour l'échéancier : le tableau de la banque, sinon le calcul marqué « calculé ».

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Pencil, Landmark, Upload, Calculator, Trash2, Link2, AlertTriangle } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useAuthStore } from '../../../core/store'
import { PageHeader } from '../../../ui/PageHeader'
import { Sheet } from '../../../ui/Sheet'
import { DataTable } from '../../../ui/DataTable'
import { EmptyState, Spinner } from '../../../ui/EmptyState'
import { confirmer } from '../../../ui/Confirm'
import {
  NATURES, PERIODICITES, DIFFERES, STATUTS, EVENEMENTS, euros, chargerEmprunts, chargerSyntheses, chargerEcheancier,
  chargerToutesEcheances, chargerEvenements, enregistrerEmprunt, supprimerEmprunt, calculer, importer, propositions,
  rapprocher, ajouterEvenement, supprimerEvenement, lireTableauBanque, courbeRestant,
} from '../lib/empruntsData'

const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '')
const pct = (n) => `${Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} %`

function Champ({ label, children, aide = null, className = '' }) {
  return <label className={`block ${className}`}><span className="label">{label}</span>{children}{aide && <span className="block text-ui-sm muted mt-0.5">{aide}</span>}</label>
}

function Courbe({ points, hauteur = 220 }) {
  if (!points?.length) return null
  return (
    <div style={{ height: hauteur }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--c-border, 229 231 235))" />
          <XAxis dataKey="mois" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tick={{ fontSize: 11 }} width={64} tickFormatter={(v) => `${Math.round(v / 1000)} k€`} />
          <Tooltip formatter={(v, n) => [euros(v), n === 'restant' ? 'Capital restant dû' : 'Intérêts payés (cumul)']} />
          <Area type="monotone" dataKey="restant" stroke="rgb(var(--c-brand, 196 30 58))" fill="rgb(var(--c-brand, 196 30 58))" fillOpacity={0.12} />
          {points[0]?.interets != null && <Area type="monotone" dataKey="interets" stroke="#6b7280" fill="#6b7280" fillOpacity={0.08} />}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function EmpruntSheet({ emprunt, onClose, onSaved }) {
  const [v, setV] = useState(() => ({
    lender_name: '', label: '', nature: 'amortissable', purpose: '', principal: '', rate_nominal: '', rate_kind: 'fixe', taeg: '',
    duration_months: '', disbursed_on: '', first_due_on: '', periodicity: 'mensuelle', deferral_months: '0', deferral_kind: 'aucun',
    insurance_per_term: '0', fees: '', guarantees: '', bank_account: '', status: 'en_cours', notes: '', ...(emprunt || {}),
  }))
  const [busy, setBusy] = useState(false)
  const m = (k) => (e) => setV({ ...v, [k]: e.target.value })
  const enregistrer = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await enregistrerEmprunt(v)
      if (r.schedule_source !== 'banque') await calculer(r.id)
      toast.success(r.schedule_source === 'banque' ? 'Emprunt enregistré' : 'Emprunt enregistré, échéancier calculé')
      onSaved(r.id)
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  return (
    <Sheet title={emprunt?.id ? 'Modifier l\'emprunt' : 'Nouvel emprunt'} onClose={onClose} size="lg"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="submit" form="emprunt" className="btn btn-primary" disabled={busy}>Enregistrer</button></>}>
      <form id="emprunt" onSubmit={enregistrer} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ label="Prêteur"><input className="input" required value={v.lender_name} onChange={m('lender_name')} placeholder="Banque, organisme" /></Champ>
          <Champ label="Libellé"><input className="input" required value={v.label} onChange={m('label')} placeholder="Prêt camionnette, trésorerie…" /></Champ>
          <Champ label="Nature"><select className="select" value={v.nature} onChange={m('nature')}>{Object.entries(NATURES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Champ>
          <Champ label="Objet (facultatif)"><input className="input" value={v.purpose || ''} onChange={m('purpose')} placeholder="Véhicule, matériel, fonds de commerce" /></Champ>
          <Champ label="Capital emprunté (€)"><input className="input" required inputMode="decimal" value={v.principal} onChange={m('principal')} /></Champ>
          <Champ label="Taux nominal annuel (%)"><input className="input" required inputMode="decimal" value={v.rate_nominal} onChange={m('rate_nominal')} /></Champ>
          <Champ label="Type de taux"><select className="select" value={v.rate_kind} onChange={m('rate_kind')}><option value="fixe">Fixe</option><option value="variable">Variable</option></select></Champ>
          <Champ label="TAEG (%) si connu"><input className="input" inputMode="decimal" value={v.taeg ?? ''} onChange={m('taeg')} /></Champ>
          <Champ label="Durée (mois)"><input className="input" required inputMode="numeric" value={v.duration_months} onChange={m('duration_months')} /></Champ>
          <Champ label="Périodicité"><select className="select" value={v.periodicity} onChange={m('periodicity')}>{Object.entries(PERIODICITES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Champ>
          <Champ label="Déblocage des fonds"><input className="input" type="date" value={v.disbursed_on || ''} onChange={m('disbursed_on')} /></Champ>
          <Champ label="Première échéance"><input className="input" type="date" required value={v.first_due_on || ''} onChange={m('first_due_on')} /></Champ>
          <Champ label="Différé (mois)"><input className="input" inputMode="numeric" value={v.deferral_months} onChange={m('deferral_months')} /></Champ>
          <Champ label="Type de différé"><select className="select" value={v.deferral_kind} onChange={m('deferral_kind')}>{Object.entries(DIFFERES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Champ>
          <Champ label="Assurance par échéance (€)"><input className="input" inputMode="decimal" value={v.insurance_per_term} onChange={m('insurance_per_term')} /></Champ>
          <Champ label="Frais de dossier (€)"><input className="input" inputMode="decimal" value={v.fees ?? ''} onChange={m('fees')} /></Champ>
          <Champ label="Compte prélevé"><input className="input" value={v.bank_account || ''} onChange={m('bank_account')} /></Champ>
          <Champ label="Statut"><select className="select" value={v.status} onChange={m('status')}>{Object.entries(STATUTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Champ>
        </div>
        <Champ label="Garanties"><input className="input" value={v.guarantees || ''} onChange={m('guarantees')} placeholder="Caution, nantissement…" /></Champ>
        <Champ label="Notes"><textarea className="input min-h-[4rem]" value={v.notes || ''} onChange={m('notes')} /></Champ>
        <p className="text-ui-sm muted">L'échéancier est calculé à partir de ces caractéristiques et marqué « calculé ». Importez ensuite le tableau d'amortissement de la banque : il fait foi.</p>
      </form>
    </Sheet>
  )
}

function ImportSheet({ emprunt, onClose, onDone }) {
  const [lu, setLu] = useState(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  const lire = async (f) => {
    if (!f) return
    try { setLu(await lireTableauBanque(f)) } catch (e) { toast.error(e.message); setLu(null) }
  }
  const total = lu ? lu.lignes.reduce((t, l) => t + Number(l.principal || 0), 0) : 0
  const valider = async () => {
    setBusy(true)
    try { const n = await importer(emprunt.id, lu.lignes); toast.success(`${n} échéances importées : le tableau de la banque fait foi`); onDone() } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  return (
    <Sheet title="Importer le tableau de la banque" onClose={onClose} size="lg"
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn btn-primary" disabled={!lu || busy} onClick={valider}>Enregistrer ce tableau</button></>}>
      <div className="space-y-3">
        <p className="text-ui">Fichier Excel ou CSV du tableau d'amortissement : une ligne par échéance, avec au moins la date et le capital restant dû (ou le montant de l'échéance). Relisez avant d'enregistrer : le tableau remplace l'échéancier calculé.</p>
        <input ref={ref} type="file" accept=".xlsx,.xls,.csv,.ods" className="hidden" onChange={(e) => lire(e.target.files?.[0])} />
        <button type="button" className="btn btn-secondary" onClick={() => ref.current?.click()}><Upload className="w-4 h-4" aria-hidden="true" />Choisir le fichier</button>
        {lu && (
          <>
            {lu.alertes.map((a) => <p key={a} className="text-ui-sm text-[rgb(var(--c-warning,180_83_9))] flex gap-1"><AlertTriangle className="w-4 h-4 flex-none" aria-hidden="true" />{a}</p>)}
            <p className="text-ui-sm text-gray-600">{lu.lignes.length} échéances, du {dateFr(lu.lignes[0].due_on)} au {dateFr(lu.lignes[lu.lignes.length - 1].due_on)} ; capital remboursé au total : {euros(total)} (capital emprunté : {euros(emprunt.principal)}).</p>
            <div className="overflow-x-auto max-h-80 border border-gray-100 rounded">
              <table className="w-full text-ui-sm tabular-nums">
                <thead className="bg-gray-50 sticky top-0"><tr><th className="p-1.5 text-left">N°</th><th className="p-1.5 text-left">Date</th><th className="p-1.5 text-right">Échéance</th><th className="p-1.5 text-right">Intérêts</th><th className="p-1.5 text-right">Capital</th><th className="p-1.5 text-right">Assurance</th><th className="p-1.5 text-right">Restant dû</th></tr></thead>
                <tbody>{lu.lignes.map((l) => <tr key={l.number} className="border-t border-gray-100"><td className="p-1.5">{l.number}</td><td className="p-1.5">{dateFr(l.due_on)}</td><td className="p-1.5 text-right">{euros(l.payment)}</td><td className="p-1.5 text-right">{euros(l.interest)}</td><td className="p-1.5 text-right">{euros(l.principal)}</td><td className="p-1.5 text-right">{euros(l.insurance)}</td><td className="p-1.5 text-right">{euros(l.remaining)}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}

function FicheEmprunt({ emprunt, synthese, onClose, onChange }) {
  const [lignes, setLignes] = useState(null)
  const [evs, setEvs] = useState([])
  const [props, setProps] = useState([])
  const [edite, setEdite] = useState(false)
  const [imp, setImp] = useState(false)
  const [ev, setEv] = useState(null)
  const [voirTout, setVoirTout] = useState(false)
  const e = emprunt
  const charger = useCallback(async () => {
    try {
      const [l, x] = await Promise.all([chargerEcheancier(e.id), chargerEvenements(e.id)])
      setLignes(l); setEvs(x)
      propositions(e.id).then(setProps).catch(() => setProps([]))
    } catch (err) { toast.error(err.message); setLignes([]) }
  }, [e.id])
  useEffect(() => { charger() }, [charger])
  const auj = new Date().toISOString().slice(0, 10)
  const points = useMemo(() => {
    let cumul = 0
    return (lignes || []).map((l) => { cumul += Number(l.interest); return { mois: new Date(l.due_on).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }), restant: Number(l.remaining), interets: Math.round(cumul) } })
  }, [lignes])
  const prochaines = (lignes || []).filter((l) => l.due_on > auj)
  const visibles = voirTout ? (lignes || []) : [...(lignes || []).filter((l) => l.due_on <= auj).slice(-3), ...prochaines.slice(0, 6)]
  const recalc = async () => { try { await calculer(e.id); toast.success('Échéancier recalculé'); await charger(); onChange() } catch (err) { toast.error(err.message) } }
  const enregistrerEv = async (x) => {
    x.preventDefault()
    try {
      await ajouterEvenement({ loan_id: e.id, kind: ev.kind, happened_on: ev.happened_on, amount: ev.amount, new_rate: ev.new_rate, note: ev.note })
      if (e.schedule_source !== 'banque') await calculer(e.id)
      toast.success(e.schedule_source === 'banque' ? 'Événement noté : importez le nouveau tableau de la banque' : 'Événement noté, échéancier recalculé')
      setEv(null); await charger(); onChange()
    } catch (err) { toast.error(err.message) }
  }
  const pctRembourse = synthese?.remaining_today != null ? Math.round((1 - Number(synthese.remaining_today) / Number(e.principal)) * 100) : null
  return (
    <Sheet title={e.label} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-ui">
          <span className="badge badge-neutral">{STATUTS[e.status]}</span>
          <span className="font-semibold">{e.lender_name}</span>
          <span className="text-gray-600">· {NATURES[e.nature]} · {euros(e.principal)} à {pct(e.rate_nominal)} ({e.rate_kind}) sur {e.duration_months} mois</span>
          <button type="button" className="btn btn-ghost btn-icon ml-auto" aria-label="Modifier l'emprunt" onClick={() => setEdite(true)}><Pencil className="w-4 h-4" /></button>
        </div>
        {e.schedule_source === 'calcule' && <p className="text-ui-sm text-[rgb(var(--c-warning,180_83_9))] flex gap-1"><AlertTriangle className="w-4 h-4 flex-none" aria-hidden="true" />Échéancier calculé, à rapprocher du tableau de la banque : importez-le pour qu'il fasse foi.</p>}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <div className="card p-3"><div className="text-ui-sm text-gray-600">Capital restant dû</div><div className="font-semibold text-ui tabular-nums">{euros(synthese?.remaining_today)}</div></div>
          <div className="card p-3"><div className="text-ui-sm text-gray-600">Prochaine échéance</div><div className="font-semibold text-ui tabular-nums">{synthese?.next_due_on ? `${euros(synthese.next_payment)} le ${dateFr(synthese.next_due_on)}` : 'aucune'}</div></div>
          <div className="card p-3"><div className="text-ui-sm text-gray-600">Fin du prêt</div><div className="font-semibold text-ui">{dateFr(synthese?.end_on)}</div></div>
          <div className="card p-3"><div className="text-ui-sm text-gray-600">Intérêts payés</div><div className="font-semibold text-ui tabular-nums">{euros(synthese?.interest_paid)} <span className="text-ui-sm text-gray-500 font-normal">sur {euros(synthese?.interest_total)}</span></div></div>
        </div>
        {pctRembourse != null && <div><div className="h-2 rounded bg-gray-100 overflow-hidden"><div className="h-full bg-[rgb(var(--c-brand,196_30_58))]" style={{ width: `${Math.max(0, Math.min(100, pctRembourse))}%` }} /></div><p className="text-ui-sm text-gray-600 mt-1">{pctRembourse} % du capital remboursé</p></div>}
        <Courbe points={points} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => setImp(true)}><Upload className="w-4 h-4" aria-hidden="true" />Importer le tableau de la banque</button>
          {e.schedule_source !== 'banque' && <button type="button" className="btn btn-secondary" onClick={recalc}><Calculator className="w-4 h-4" aria-hidden="true" />Recalculer</button>}
          <button type="button" className="btn btn-secondary" onClick={() => setEv({ kind: 'remboursement_anticipe', happened_on: auj, amount: '', new_rate: '', note: '' })}><Plus className="w-4 h-4" aria-hidden="true" />Événement</button>
        </div>

        {ev && (
          <form onSubmit={enregistrerEv} className="card grid gap-2 sm:grid-cols-2">
            <Champ label="Événement"><select className="select" value={ev.kind} onChange={(x) => setEv({ ...ev, kind: x.target.value })}>{Object.entries(EVENEMENTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Champ>
            <Champ label="Date"><input className="input" type="date" required value={ev.happened_on} onChange={(x) => setEv({ ...ev, happened_on: x.target.value })} /></Champ>
            {ev.kind === 'remboursement_anticipe' && <Champ label="Montant remboursé (€)"><input className="input" inputMode="decimal" required value={ev.amount} onChange={(x) => setEv({ ...ev, amount: x.target.value })} /></Champ>}
            {['taux', 'renegociation'].includes(ev.kind) && <Champ label="Nouveau taux (%)"><input className="input" inputMode="decimal" value={ev.new_rate} onChange={(x) => setEv({ ...ev, new_rate: x.target.value })} /></Champ>}
            <Champ label="Note"><input className="input" value={ev.note} onChange={(x) => setEv({ ...ev, note: x.target.value })} /></Champ>
            <div className="flex gap-2 sm:col-span-2"><button type="submit" className="btn btn-primary btn-sm">Enregistrer</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEv(null)}>Annuler</button></div>
          </form>
        )}
        {evs.length > 0 && (
          <section className="space-y-1">
            <h3 className="font-semibold text-ui">Événements</h3>
            <ul className="text-ui-sm divide-y divide-gray-100">
              {evs.map((x) => (
                <li key={x.id} className="py-1.5 flex flex-wrap items-center gap-x-3">
                  <span className="w-24 text-gray-500">{dateFr(x.happened_on)}</span>
                  <span className="font-medium">{EVENEMENTS[x.kind]}</span>
                  {x.amount != null && <span>{euros(x.amount)}</span>}
                  {x.new_rate != null && <span>nouveau taux {pct(x.new_rate)}</span>}
                  {x.note && <span className="text-gray-500">{x.note}</span>}
                  <button type="button" className="btn btn-ghost btn-icon ml-auto" aria-label="Retirer l'événement" onClick={async () => { if (!(await confirmer('Retirer cet événement ?'))) return; try { await supprimerEvenement(x.id); if (e.schedule_source !== 'banque') await calculer(e.id); await charger(); onChange() } catch (err) { toast.error(err.message) } }}><Trash2 className="w-4 h-4" /></button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {props.length > 0 && (
          <section className="space-y-1">
            <h3 className="font-semibold text-ui flex items-center gap-2"><Link2 className="w-4 h-4 text-gray-400" aria-hidden="true" />Prélèvements à rapprocher</h3>
            <ul className="text-ui-sm divide-y divide-gray-100">
              {props.map((p) => (
                <li key={`${p.line_id}-${p.transaction_id}`} className="py-1.5 flex flex-wrap items-center gap-x-3">
                  <span>Échéance n° {p.number} du {dateFr(p.due_on)} ({euros(p.payment)})</span>
                  <span className="text-gray-600">↔ {dateFr(p.tx_date)} {p.tx_label} ({euros(p.tx_amount)})</span>
                  <button type="button" className="btn btn-secondary btn-sm ml-auto" onClick={async () => { try { await rapprocher(p.line_id, p.transaction_id, Math.round((Number(p.tx_amount) - Number(p.payment)) * 100) / 100); toast.success('Rapproché'); await charger(); onChange() } catch (err) { toast.error(err.message) } }}>Rapprocher</button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-ui flex-1">Échéancier {e.schedule_source === 'banque' ? '(tableau de la banque)' : e.schedule_source === 'calcule' ? '(calculé)' : ''}</h3>
            {lignes?.length > 9 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVoirTout(!voirTout)}>{voirTout ? 'Voir moins' : `Voir les ${lignes.length} échéances`}</button>}
          </div>
          {lignes === null ? <Spinner /> : lignes.length === 0 ? <p className="text-ui-sm muted">Pas encore d'échéancier.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-ui-sm tabular-nums">
                <thead><tr className="text-gray-500"><th className="p-1.5 text-left">N°</th><th className="p-1.5 text-left">Date</th><th className="p-1.5 text-right">Échéance</th><th className="p-1.5 text-right">Intérêts</th><th className="p-1.5 text-right">Capital</th><th className="p-1.5 text-right">Assurance</th><th className="p-1.5 text-right">Restant dû</th><th className="p-1.5 text-left">Banque</th></tr></thead>
                <tbody>
                  {visibles.map((l) => (
                    <tr key={l.id} className={`border-t border-gray-100 ${l.due_on <= auj ? 'text-gray-500' : ''}`}>
                      <td className="p-1.5">{l.number}</td><td className="p-1.5">{dateFr(l.due_on)}</td><td className="p-1.5 text-right">{euros(l.payment)}</td>
                      <td className="p-1.5 text-right">{euros(l.interest)}</td><td className="p-1.5 text-right">{euros(l.principal_part)}</td><td className="p-1.5 text-right">{euros(l.insurance)}</td>
                      <td className="p-1.5 text-right">{euros(l.remaining)}</td>
                      <td className="p-1.5">{l.transaction_id ? (Number(l.gap) ? <span className="text-[rgb(var(--c-danger))]">écart {euros(l.gap)}</span> : 'rapprochée') : (l.due_on <= auj ? <span className="text-gray-400">non rapprochée</span> : '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <div className="pt-2 border-t border-gray-100">
          <button type="button" className="btn btn-ghost" onClick={async () => {
            if (!(await confirmer('Supprimer cet emprunt et son échéancier ?'))) return
            try { await supprimerEmprunt(e.id); toast.success('Emprunt supprimé'); onChange(); onClose() } catch (err) { toast.error(err.message) }
          }}><Trash2 className="w-4 h-4" aria-hidden="true" />Supprimer l'emprunt</button>
        </div>
      </div>
      {edite && <EmpruntSheet emprunt={e} onClose={() => setEdite(false)} onSaved={async () => { setEdite(false); await charger(); onChange() }} />}
      {imp && <ImportSheet emprunt={e} onClose={() => setImp(false)} onDone={async () => { setImp(false); await charger(); onChange() }} />}
    </Sheet>
  )
}

export default function Emprunts() {
  const { can } = useAuthStore()
  const [d, setD] = useState(null)
  const [nouveau, setNouveau] = useState(false)
  const [fiche, setFiche] = useState(null)
  const charger = useCallback(async () => {
    try {
      const [emprunts, syntheses, echeances] = await Promise.all([chargerEmprunts(), chargerSyntheses(), chargerToutesEcheances()])
      const parId = Object.fromEntries(syntheses.map((x) => [x.loan_id, x]))
      setD({ emprunts, parId, echeances })
      return emprunts
    } catch (e) { toast.error(e.message); setD({ emprunts: [], parId: {}, echeances: [] }); return [] }
  }, [])
  useEffect(() => { charger() }, [charger])
  const courbe = useMemo(() => (d ? courbeRestant(d.emprunts.filter((x) => x.status === 'en_cours'), d.echeances) : []), [d])
  if (can('manager.emprunts.gerer') !== true) return <EmptyState icon={Landmark} title="Emprunts non accessibles" compact>Votre profil ne donne pas accès aux emprunts.</EmptyState>
  if (!d) return <Spinner />
  const enCours = d.emprunts.filter((x) => x.status === 'en_cours')
  const restant = enCours.reduce((t, x) => t + Number(d.parId[x.id]?.remaining_today || 0), 0)
  const debutMois = new Date(); debutMois.setDate(1)
  const finMois = new Date(debutMois.getFullYear(), debutMois.getMonth() + 1, 0)
  const ech = d.echeances.filter((l) => l.due_on >= debutMois.toISOString().slice(0, 10) && l.due_on <= finMois.toISOString().slice(0, 10))
  const chargeMois = ech.reduce((t, l) => t + Number(l.payment), 0)
  const calcules = enCours.filter((x) => x.schedule_source !== 'banque').length
  const prochaineFin = enCours.map((x) => d.parId[x.id]?.end_on).filter(Boolean).sort()[0]
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Entreprise" title="Emprunts et crédits"
        meta={<span>Capital restant dû, échéancier et évolution de chaque emprunt de la société.</span>}
        actions={<button type="button" className="btn btn-primary" onClick={() => setNouveau(true)}><Plus className="w-4 h-4" aria-hidden="true" />Nouvel emprunt</button>} />
      {d.emprunts.length === 0 ? (
        <EmptyState icon={Landmark} title="Aucun emprunt">Saisissez vos emprunts et crédits en cours : l'échéancier se calcule, puis importez le tableau d'amortissement de la banque pour qu'il fasse foi.</EmptyState>
      ) : (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <div className="card p-3"><div className="text-ui-sm text-gray-600">Capital restant dû</div><div className="text-xl font-semibold tabular-nums">{euros(restant)}</div></div>
            <div className="card p-3"><div className="text-ui-sm text-gray-600">Échéances du mois</div><div className="text-xl font-semibold tabular-nums">{euros(chargeMois)}</div><div className="text-ui-sm text-gray-500">{ech.length} prélèvement{ech.length > 1 ? 's' : ''}, assurance comprise</div></div>
            <div className="card p-3"><div className="text-ui-sm text-gray-600">Emprunts en cours</div><div className="text-xl font-semibold">{enCours.length}</div></div>
            <div className="card p-3"><div className="text-ui-sm text-gray-600">Prochaine fin de prêt</div><div className="text-xl font-semibold">{dateFr(prochaineFin) || '—'}</div></div>
          </div>
          {calcules > 0 && <p className="text-ui-sm text-[rgb(var(--c-warning,180_83_9))] flex gap-1"><AlertTriangle className="w-4 h-4 flex-none" aria-hidden="true" />{calcules} échéancier{calcules > 1 ? 's' : ''} calculé{calcules > 1 ? 's' : ''}, à rapprocher du tableau de la banque.</p>}
          {courbe.length > 1 && <section className="card space-y-2"><h2 className="section-title">Évolution du capital restant dû</h2><Courbe points={courbe} /></section>}
          <DataTable rows={d.emprunts} onRowClick={setFiche} columns={[
            { key: 'label', label: 'Emprunt', mobile: 'title', render: (x) => x.label },
            { key: 'preteur', label: 'Prêteur', mobile: 'subtitle', render: (x) => x.lender_name },
            { key: 'restant', label: 'Restant dû', align: 'right', mobile: 'aside', render: (x) => euros(d.parId[x.id]?.remaining_today) },
            { key: 'echeance', label: 'Prochaine échéance', render: (x) => (d.parId[x.id]?.next_due_on ? `${euros(d.parId[x.id].next_payment)} le ${dateFr(d.parId[x.id].next_due_on)}` : '') },
            { key: 'taux', label: 'Taux', align: 'right', render: (x) => pct(x.rate_nominal) },
            { key: 'fin', label: 'Fin', render: (x) => dateFr(d.parId[x.id]?.end_on) },
            { key: 'source', label: 'Échéancier', render: (x) => (x.schedule_source === 'banque' ? 'banque' : x.schedule_source === 'calcule' ? <span className="text-[rgb(var(--c-warning,180_83_9))]">calculé</span> : '') },
          ]} />
        </>
      )}
      {nouveau && <EmpruntSheet onClose={() => setNouveau(false)} onSaved={async (id) => { setNouveau(false); const l = await charger(); setFiche(l.find((x) => x.id === id) || null) }} />}
      {fiche && <FicheEmprunt key={fiche.id} emprunt={d.emprunts.find((x) => x.id === fiche.id) || fiche} synthese={d.parId[fiche.id]} onClose={() => setFiche(null)} onChange={charger} />}
    </div>
  )
}
