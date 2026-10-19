// Absences (chantier 12, 0294) : mes absences et mon solde, demandes à valider (circuit commun), toutes les absences,
// types d'absence. Chaque bloc n'apparaît que si la base le permet ; les écritures passent par des fonctions.

import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { CalendarPlus, Check, X, Pencil, Plus } from 'lucide-react'
import { EmptyState, Spinner } from '../../../ui/EmptyState'
import { Sheet } from '../../../ui/Sheet'
import { confirmer, demander } from '../../../ui/Confirm'
import {
  STATUTS_ABSENCE, CATEGORIES_ABSENCE, joursOuvres, nomComplet, chargerTypesAbsence, chargerMaFiche, chargerDemandes,
  chargerSoldes, demanderAbsence, annulerAbsence, deciderAbsence, enregistrerTypeAbsence,
} from '../lib/rhData'

const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : '')
const jours = (n) => `${String(n).replace('.', ',')} jour${Number(n) > 1 ? 's' : ''}`
const periode = (r) => `${fr(r.start_on)}${r.start_half ? ' (après-midi)' : ''}${r.end_on !== r.start_on || r.end_half ? ` au ${fr(r.end_on)}${r.end_half ? ' (matin)' : ''}` : ''}`

export function DemandeSheet({ types, personId = null, soldes = [], onClose, onSaved }) {
  const demandables = types.filter((t) => t.is_active && (personId || t.employee_can_request))
  const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const [v, setV] = useState({ typeId: demandables[0]?.id || '', debut: demain, fin: demain, debutApresMidi: false, finMatin: false, commentaire: '' })
  const [busy, setBusy] = useState(false)
  const type = types.find((t) => t.id === v.typeId)
  const n = joursOuvres(v.debut, v.debutApresMidi, v.fin, v.finMatin)
  const solde = soldes.find((s) => s.type_id === v.typeId)
  const envoyer = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await demanderAbsence({ ...v, personId })
      toast.success('Demande envoyée')
      onSaved()
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  return (
    <Sheet title="Demander une absence" onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="submit" form="rh-absence" className="btn btn-primary" disabled={busy || !n}>Envoyer la demande</button></>}>
      <form id="rh-absence" onSubmit={envoyer} className="space-y-3">
        <label className="block"><span className="label">Type</span>
          <select className="select" value={v.typeId} onChange={(e) => setV({ ...v, typeId: e.target.value })}>
            {demandables.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <div className="grid gap-3 grid-cols-2">
          <label className="block"><span className="label">Du</span><input className="input" type="date" required value={v.debut} onChange={(e) => setV({ ...v, debut: e.target.value, fin: v.fin < e.target.value ? e.target.value : v.fin })} /></label>
          <label className="block"><span className="label">Au</span><input className="input" type="date" required min={v.debut} value={v.fin} onChange={(e) => setV({ ...v, fin: e.target.value })} /></label>
        </div>
        {type?.half_days && (
          <div className="flex gap-4 flex-wrap">
            <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" className="w-5 h-5" checked={v.debutApresMidi} onChange={(e) => setV({ ...v, debutApresMidi: e.target.checked })} /><span className="text-ui">Commence l'après-midi</span></label>
            <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" className="w-5 h-5" checked={v.finMatin} onChange={(e) => setV({ ...v, finMatin: e.target.checked })} /><span className="text-ui">Finit le matin</span></label>
          </div>
        )}
        <p className="text-ui font-semibold">{n ? jours(n) : 'Aucun jour ouvré sur ces dates'}{type?.counts_balance && solde ? ` · solde ${String(solde.solde).replace('.', ',')} j, restera ${String(solde.solde - n).replace('.', ',')} j` : ''}</p>
        {type?.requires_proof && <p className="text-ui-sm text-[rgb(var(--c-warning))]">Ce type demande un justificatif : remettez-le à la RH (le dépôt dans l'outil arrive avec les documents RH).</p>}
        <label className="block"><span className="label">Commentaire (facultatif)</span><input className="input" value={v.commentaire} onChange={(e) => setV({ ...v, commentaire: e.target.value })} /></label>
      </form>
    </Sheet>
  )
}

function Ligne({ r, avecNom, actions }) {
  const st = STATUTS_ABSENCE[r.status]
  return (
    <li className="px-4 py-3 flex items-start gap-3 flex-wrap">
      <div className="flex-1 min-w-[12rem]">
        <div className="font-semibold text-ui">{avecNom ? `${nomComplet(r.hr_people)} · ` : ''}{r.hr_absence_types?.label}</div>
        <div className="text-ui-sm text-gray-600">{periode(r)} · {jours(r.days)}{r.comment ? ` · ${r.comment}` : ''}</div>
        {r.status === 'refusee' && r.refusal_reason && <div className="text-ui-sm text-[rgb(var(--c-danger))]">Motif du refus : {r.refusal_reason}</div>}
      </div>
      <span className={`badge ${st.badge}`}>{st.label}</span>
      {actions}
    </li>
  )
}

function Types({ types, peutConfigurer, recharger }) {
  const [edite, setEdite] = useState(null)
  const enregistrer = async (e) => {
    e.preventDefault()
    try { await enregistrerTypeAbsence({ ...edite, to_confirm: false }); setEdite(null); recharger() } catch (err) { toast.error(err.message) }
  }
  return (
    <section className="card card-flush">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="section-title">Types d'absence</h2>
        {peutConfigurer && !edite && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdite({ code: '', label: '', category: 'autre', half_days: true, requires_proof: false, counts_balance: false, employee_can_request: true, is_active: true, position: 50 })}><Plus className="w-4 h-4" aria-hidden="true" />Ajouter</button>}
      </div>
      {types.some((t) => t.to_confirm) && <p className="px-4 pb-2 text-ui-sm text-[rgb(var(--c-warning))]">Liste de départ à confirmer par la RH ou l'expert-comptable (convention collective).</p>}
      {edite && (
        <form onSubmit={enregistrer} className="px-4 pb-3 grid gap-2 sm:grid-cols-2">
          <label className="block"><span className="label">Libellé</span><input className="input" required value={edite.label} onChange={(e) => setEdite({ ...edite, label: e.target.value })} /></label>
          <label className="block"><span className="label">Code</span><input className="input" required maxLength={20} value={edite.code} onChange={(e) => setEdite({ ...edite, code: e.target.value.toUpperCase() })} /></label>
          <label className="block"><span className="label">Catégorie</span><select className="select" value={edite.category} onChange={(e) => setEdite({ ...edite, category: e.target.value })}>{Object.entries(CATEGORIES_ABSENCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <div className="grid gap-1">
            {[['half_days', 'Demi-journées possibles'], ['counts_balance', 'Décompte un solde'], ['requires_proof', 'Justificatif demandé'], ['employee_can_request', 'Demandé par le salarié'], ['is_active', 'Actif']].map(([k, l]) => (
              <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={!!edite[k]} onChange={(e) => setEdite({ ...edite, [k]: e.target.checked })} /><span className="text-ui-sm">{l}</span></label>
            ))}
          </div>
          <div className="flex gap-2 sm:col-span-2"><button type="submit" className="btn btn-primary btn-sm">Enregistrer</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdite(null)}>Annuler</button></div>
        </form>
      )}
      <ul className="divide-y divide-gray-100">
        {types.map((t) => (
          <li key={t.id} className="px-4 py-2 flex items-center gap-3">
            <span className={`flex-1 text-ui ${t.is_active ? '' : 'text-gray-400 line-through'}`}>{t.label}</span>
            <span className="text-ui-sm muted">{[t.counts_balance && 'solde', t.requires_proof && 'justificatif', !t.employee_can_request && 'saisi par la RH'].filter(Boolean).join(' · ')}</span>
            {peutConfigurer && <button type="button" className="btn btn-ghost btn-icon" aria-label={`Modifier ${t.label}`} onClick={() => setEdite(t)}><Pencil className="w-4 h-4" /></button>}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function Absences({ peutValider, peutVoirTout, peutConfigurer }) {
  const [types, setTypes] = useState(null)
  const [maFiche, setMaFiche] = useState(undefined)
  const [mes, setMes] = useState([])
  const [soldes, setSoldes] = useState([])
  const [aValider, setAValider] = useState([])
  const [toutes, setToutes] = useState([])
  const [demande, setDemande] = useState(false)

  const charger = useCallback(async () => {
    try {
      const [t, fiche] = await Promise.all([chargerTypesAbsence(), chargerMaFiche()])
      setTypes(t); setMaFiche(fiche)
      const [m, s, v, all] = await Promise.all([
        fiche ? chargerDemandes({ personId: fiche.id }) : [],
        fiche ? chargerSoldes(fiche.id) : [],
        peutValider ? chargerDemandes({ statut: 'demandee' }) : [],
        peutVoirTout ? chargerDemandes() : [],
      ])
      setMes(m); setSoldes(s); setAValider(v.filter((r) => r.person_id !== fiche?.id)); setToutes(all)
    } catch (e) { toast.error(e.message) }
  }, [peutValider, peutVoirTout])
  useEffect(() => { charger() }, [charger])

  const nomType = useMemo(() => Object.fromEntries((types || []).map((t) => [t.id, t.label])), [types])
  if (!types || maFiche === undefined) return <Spinner />

  const decider = async (r, decision) => {
    let motif = null
    if (decision === 'rejected') {
      motif = await demander('Motif du refus (obligatoire)', { title: 'Refuser la demande', placeholder: 'Par exemple : chevauche une période déjà validée' })
      if (!motif || motif.trim().length < 3) return
    }
    try { await deciderAbsence(r.approval_id, decision, motif); toast.success(decision === 'approved' ? 'Demande validée' : 'Demande refusée'); charger() } catch (e) { toast.error(e.message) }
  }
  const annuler = async (r) => {
    if (!(await confirmer('Annuler cette demande d\'absence ?'))) return
    try { await annulerAbsence(r.id); charger() } catch (e) { toast.error(e.message) }
  }
  const aujourdhui = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-3">
      {maFiche && (
        <section className="card space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="section-title">Mes absences</h2>
            <button type="button" className="btn btn-primary" onClick={() => setDemande(true)}><CalendarPlus className="w-4 h-4" aria-hidden="true" />Demander une absence</button>
          </div>
          {soldes.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {soldes.map((s) => <span key={s.type_id} className="badge badge-neutral" style={{ height: 28 }}>{nomType[s.type_id]} : {String(s.solde).replace('.', ',')} j</span>)}
            </div>
          )}
          {mes.length === 0 ? <p className="text-ui-sm muted">Aucune demande pour l'instant.</p> : (
            <ul className="divide-y divide-gray-100 -mx-4">
              {mes.slice(0, 20).map((r) => (
                <Ligne key={r.id} r={r} actions={(r.status === 'demandee' || (r.status === 'validee' && r.start_on > aujourdhui)) && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => annuler(r)}>Annuler</button>
                )} />
              ))}
            </ul>
          )}
        </section>
      )}

      {peutValider && (
        <section className="card card-flush">
          <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
            <h2 className="section-title">À valider</h2>
            <span className="text-ui-sm muted">{aValider.length} demande{aValider.length > 1 ? 's' : ''}</span>
          </div>
          {aValider.length === 0 ? <p className="px-4 pb-4 text-ui-sm muted">Aucune demande en attente.</p> : (
            <ul className="divide-y divide-gray-100">
              {aValider.map((r) => (
                <Ligne key={r.id} r={r} avecNom actions={r.approval_id && (
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-success btn-sm" onClick={() => decider(r, 'approved')}><Check className="w-4 h-4" aria-hidden="true" />Valider</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => decider(r, 'rejected')}><X className="w-4 h-4" aria-hidden="true" />Refuser</button>
                  </div>
                )} />
              ))}
            </ul>
          )}
        </section>
      )}

      {peutVoirTout && (
        <section className="card card-flush">
          <h2 className="section-title px-4 pt-3 pb-2">Toutes les absences</h2>
          {toutes.length === 0 ? <p className="px-4 pb-4 text-ui-sm muted">Aucune absence saisie.</p> : (
            <ul className="divide-y divide-gray-100">
              {toutes.slice(0, 50).map((r) => (
                <Ligne key={r.id} r={r} avecNom actions={(r.status === 'demandee' || r.status === 'validee') && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => annuler(r)}>Annuler</button>
                )} />
              ))}
            </ul>
          )}
        </section>
      )}

      {!maFiche && !peutValider && !peutVoirTout && (
        <EmptyState title="Aucune fiche du personnel reliée à votre compte" compact>Demandez à la RH de relier votre compte à votre fiche pour demander vos absences.</EmptyState>
      )}

      {(peutConfigurer || peutVoirTout) && <Types types={types} peutConfigurer={peutConfigurer} recharger={charger} />}

      {demande && <DemandeSheet types={types} soldes={soldes} onClose={() => setDemande(false)} onSaved={() => { setDemande(false); charger() }} />}
    </div>
  )
}
