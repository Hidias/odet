// Heures (chantier 12, 0297) : ma semaine (lignes proposées depuis mes visites et sessions, saisie rapide, totaux,
// heures supplémentaires, soumission) et semaines à valider (circuit commun). Dépassements signalés, jamais bloqués.

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ChevronLeft, ChevronRight, Plus, Trash2, Send, Wand2, Check, X, AlertTriangle } from 'lucide-react'
import { EmptyState, Spinner } from '../../../ui/EmptyState'
import { confirmer, demander } from '../../../ui/Confirm'
import {
  STATUTS_SEMAINE, LIMITES, lundiDe, ajouterJours, minutesLigne, heures, totauxSemaine, nomComplet, chargerMaFiche,
  chargerLignes, chargerSemaine, chargerSemainesAValider, chargerContratEnCours, enregistrerLigne, supprimerLigne,
  preparerSemaine, soumettreSemaine, deciderAbsence,
} from '../lib/rhData'

const jourCourt = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })
const ORIGINES = { visite: 'visite', session: 'session', import: 'import' }

function MaSemaine({ fiche }) {
  const [lundi, setLundi] = useState(lundiDe(new Date().toISOString().slice(0, 10)))
  const [lignes, setLignes] = useState(null)
  const [semaine, setSemaine] = useState(null)
  const [contrat, setContrat] = useState(null)
  const [nouvelle, setNouvelle] = useState(null)
  const [busy, setBusy] = useState(false)
  const charger = useCallback(async () => {
    try {
      const [l, s, c] = await Promise.all([chargerLignes(fiche.id, lundi), chargerSemaine(fiche.id, lundi), chargerContratEnCours(fiche.id, lundi)])
      setLignes(l); setSemaine(s); setContrat(c)
    } catch (e) { toast.error(e.message) }
  }, [fiche.id, lundi])
  useEffect(() => { setLignes(null); charger() }, [charger])

  if (!lignes) return <Spinner />
  const fige = semaine && ['soumise', 'validee'].includes(semaine.status)
  const contratMin = Math.round((Number(contrat?.weekly_hours) || 35) * 60)
  const t = totauxSemaine(lignes, contratMin)
  const st = STATUTS_SEMAINE[semaine?.status || 'ouverte']

  const ajouter = async (e) => {
    e.preventDefault()
    try { await enregistrerLigne({ person_id: fiche.id, ...nouvelle, break_minutes: Number(nouvelle.break_minutes || 0) }); setNouvelle(null); charger() } catch (err) { toast.error(err.message) }
  }
  const supprimer = async (l) => {
    if (!(await confirmer('Supprimer cette ligne ?'))) return
    try { await supprimerLigne(l.id); charger() } catch (err) { toast.error(err.message) }
  }
  const preparer = async () => {
    setBusy(true)
    try { const n = await preparerSemaine(lundi); toast.success(n ? `${n} ligne${n > 1 ? 's' : ''} proposée${n > 1 ? 's' : ''} : vérifiez-les` : 'Aucune visite ni session à reprendre'); charger() } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  const soumettre = async () => {
    if (!(await confirmer(`Soumettre la semaine (${heures(t.total)}) ? Les lignes ne se modifient plus ensuite.`))) return
    setBusy(true)
    try { await soumettreSemaine(lundi); toast.success('Semaine soumise'); charger() } catch (err) { toast.error(err.message) }
    setBusy(false)
  }

  return (
    <section className="card space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Semaine précédente" onClick={() => setLundi(ajouterJours(lundi, -7))}><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="section-title flex-1 text-center">Semaine du {jourCourt(lundi)}</h2>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Semaine suivante" onClick={() => setLundi(ajouterJours(lundi, 7))}><ChevronRight className="w-5 h-5" /></button>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`badge ${st.badge}`}>{st.label}</span>
        <span className="text-ui font-semibold">{heures(t.total)}</span>
        <span className="text-ui-sm text-gray-600">sur {heures(contratMin)} au contrat{t.sup ? ` · ${heures(t.sup)} supplémentaires (${heures(t.sup25)} à 25 %${t.sup50 ? `, ${heures(t.sup50)} à 50 %` : ''})` : ''}</span>
      </div>
      {semaine?.status === 'rejetee' && semaine.reject_reason && <p className="text-ui-sm text-[rgb(var(--c-danger))]">À reprendre : {semaine.reject_reason}</p>}
      {(t.joursLongs.length > 0 || t.semaineLongue) && (
        <p className="text-ui-sm text-[rgb(var(--c-warning))] flex items-start gap-2"><AlertTriangle className="w-4 h-4 flex-none mt-0.5" aria-hidden="true" />
          {[t.joursLongs.length && `plus de ${LIMITES.jourMinutes / 60} h le ${t.joursLongs.map(jourCourt).join(', ')}`, t.semaineLongue && `plus de ${LIMITES.semaineMinutes / 60} h sur la semaine`].filter(Boolean).join(' ; ')} (durées maximales du Code du travail, à confirmer selon la convention).
        </p>
      )}

      {lignes.length === 0 && <p className="text-ui-sm muted">Aucune heure cette semaine.{!fige ? ' Reprenez vos visites et sessions, ou ajoutez une ligne.' : ''}</p>}
      <ul className="divide-y divide-gray-100 -mx-4">
        {lignes.map((l) => (
          <li key={l.id} className="px-4 py-2 flex items-center gap-3 flex-wrap">
            <span className="w-40 text-ui-sm text-gray-600 first-letter:uppercase">{jourCourt(l.work_date)}</span>
            <span className="text-ui font-semibold tabular-nums">{l.start_time.slice(0, 5)} – {l.end_time.slice(0, 5)}</span>
            {l.break_minutes > 0 && <span className="text-ui-sm muted">pause {l.break_minutes} min</span>}
            <span className="text-ui tabular-nums">{heures(minutesLigne(l.start_time, l.end_time, l.break_minutes))}</span>
            <span className="flex-1 min-w-0 text-ui-sm text-gray-600 truncate">{[l.clients?.name, l.observation, ORIGINES[l.origin] && `depuis une ${ORIGINES[l.origin]}`].filter(Boolean).join(' · ')}</span>
            {!fige && <button type="button" className="btn btn-ghost btn-icon" aria-label="Supprimer la ligne" onClick={() => supprimer(l)}><Trash2 className="w-4 h-4" /></button>}
          </li>
        ))}
      </ul>

      {!fige && nouvelle && (
        <form onSubmit={ajouter} className="grid gap-2 grid-cols-2 sm:grid-cols-[10rem_7rem_7rem_6rem_1fr_auto] items-end">
          <label className="block col-span-2 sm:col-span-1"><span className="label">Jour</span>
            <select className="select" value={nouvelle.work_date} onChange={(e) => setNouvelle({ ...nouvelle, work_date: e.target.value })}>
              {[0, 1, 2, 3, 4, 5, 6].map((i) => <option key={i} value={ajouterJours(lundi, i)}>{jourCourt(ajouterJours(lundi, i))}</option>)}
            </select></label>
          <label className="block"><span className="label">Début</span><input className="input" type="time" required value={nouvelle.start_time} onChange={(e) => setNouvelle({ ...nouvelle, start_time: e.target.value })} /></label>
          <label className="block"><span className="label">Fin</span><input className="input" type="time" required value={nouvelle.end_time} onChange={(e) => setNouvelle({ ...nouvelle, end_time: e.target.value })} /></label>
          <label className="block"><span className="label">Pause (min)</span><input className="input" inputMode="numeric" value={nouvelle.break_minutes} onChange={(e) => setNouvelle({ ...nouvelle, break_minutes: e.target.value.replace(/\D/g, '') })} /></label>
          <label className="block col-span-2 sm:col-span-1"><span className="label">Observation</span><input className="input" value={nouvelle.observation} onChange={(e) => setNouvelle({ ...nouvelle, observation: e.target.value })} /></label>
          <div className="flex gap-1 col-span-2 sm:col-span-1"><button type="submit" className="btn btn-primary btn-sm">Ajouter</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setNouvelle(null)}>Annuler</button></div>
        </form>
      )}

      {!fige && (
        <div className="flex gap-2 flex-wrap">
          {!nouvelle && <button type="button" className="btn btn-secondary" onClick={() => setNouvelle({ work_date: lignes.length ? lignes[lignes.length - 1].work_date : lundi, start_time: '08:30', end_time: '12:30', break_minutes: '0', observation: '' })}><Plus className="w-4 h-4" aria-hidden="true" />Ajouter une ligne</button>}
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={preparer}><Wand2 className="w-4 h-4" aria-hidden="true" />Reprendre mes visites et sessions</button>
          <button type="button" className="btn btn-primary ml-auto" disabled={busy || !t.total} onClick={soumettre}><Send className="w-4 h-4" aria-hidden="true" />Soumettre la semaine</button>
        </div>
      )}
    </section>
  )
}

function AValider() {
  const [liste, setListe] = useState(null)
  const charger = useCallback(() => { chargerSemainesAValider().then(setListe).catch((e) => toast.error(e.message)) }, [])
  useEffect(() => { charger() }, [charger])
  const decider = async (s, decision) => {
    let motif = null
    if (decision === 'rejected') {
      motif = await demander('Ce qui est à reprendre (obligatoire)', { title: 'Renvoyer la semaine' })
      if (!motif || motif.trim().length < 3) return
    }
    try { await deciderAbsence(s.approval_id, decision, motif); toast.success(decision === 'approved' ? 'Semaine validée' : 'Semaine renvoyée'); charger() } catch (e) { toast.error(e.message) }
  }
  if (!liste) return <Spinner />
  return (
    <section className="card card-flush">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="section-title">Semaines à valider</h2>
        <span className="text-ui-sm muted">{liste.length}</span>
      </div>
      {liste.length === 0 ? <p className="px-4 pb-4 text-ui-sm muted">Aucune semaine en attente.</p> : (
        <ul className="divide-y divide-gray-100">
          {liste.map((s) => (
            <li key={s.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[12rem]">
                <div className="font-semibold text-ui">{nomComplet(s.hr_people)}</div>
                <div className="text-ui-sm text-gray-600">Semaine du {jourCourt(s.week_start)} · {heures(s.total_minutes)} sur {heures(s.contract_minutes)}{s.overtime_minutes ? ` · ${heures(s.overtime_minutes)} supplémentaires` : ''}</div>
              </div>
              {s.approval_id && (
                <div className="flex gap-2">
                  <button type="button" className="btn btn-success btn-sm" onClick={() => decider(s, 'approved')}><Check className="w-4 h-4" aria-hidden="true" />Valider</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => decider(s, 'rejected')}><X className="w-4 h-4" aria-hidden="true" />Renvoyer</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function Heures({ peutValider }) {
  const [fiche, setFiche] = useState(undefined)
  useEffect(() => { chargerMaFiche().then(setFiche).catch(() => setFiche(null)) }, [])
  if (fiche === undefined) return <Spinner />
  return (
    <div className="space-y-3">
      {fiche ? <MaSemaine fiche={fiche} /> : !peutValider && (
        <EmptyState title="Aucune fiche du personnel reliée à votre compte" compact>Demandez à la RH de relier votre compte à votre fiche pour saisir vos heures.</EmptyState>
      )}
      {peutValider && <AValider />}
    </div>
  )
}
