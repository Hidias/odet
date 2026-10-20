// Module RH, « Mon espace » (chantier 12, spec RH § 3.6) : sur téléphone d'abord, tout ce qui concerne la personne
// connectée, depuis sa fiche du personnel reliée à son compte : soldes et demandes d'absence, semaine d'heures,
// échéances, habilitations, suivi de santé (lecture), documents (dont bulletins) et dépôt de ses justificatifs.
// Aucune donnée nouvelle : tout vient des tables RH, lues avec les droits de la personne.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { CalendarPlus, Clock, ChevronRight, CalendarClock } from 'lucide-react'
import { EmptyState, Spinner } from '../../../ui/EmptyState'
import { confirmer } from '../../../ui/Confirm'
import {
  CONTRATS, STATUTS_ABSENCE, STATUTS_SEMAINE, nomComplet, statutContrat, lundiDe, heures, chargerMaFiche, chargerContrats,
  chargerTypesAbsence, chargerSoldes, chargerDemandes, chargerSemaine, chargerLignes, totauxSemaine, annulerAbsence,
} from '../lib/rhData'
import { etatEcheance, chargerEcheances } from '../lib/rhDocuments'
import { DemandeSheet } from './Absences'
import { DocumentsFiche, HabilitationsFiche, SanteFiche } from './DocumentsSante'
import MaSignature from '../../../core/signatures/MaSignature'
import { EntretiensFiche } from './EntretiensListes'

const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : '')
const frLong = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '')
const jours = (n) => `${String(n).replace('.', ',')} j`

export default function MonEspace() {
  const navigate = useNavigate()
  const [fiche, setFiche] = useState(undefined)
  const [contrat, setContrat] = useState(null)
  const [types, setTypes] = useState([])
  const [soldes, setSoldes] = useState([])
  const [demandes, setDemandes] = useState([])
  const [semaine, setSemaine] = useState(null)
  const [minutesSemaine, setMinutesSemaine] = useState(0)
  const [echeances, setEcheances] = useState([])
  const [demande, setDemande] = useState(false)
  const lundi = lundiDe(new Date().toISOString().slice(0, 10))
  const aujourdhui = new Date().toISOString().slice(0, 10)

  const charger = useCallback(async () => {
    try {
      const f = await chargerMaFiche()
      setFiche(f)
      if (!f) return
      const [c, t, s, d, sem, ech, lignes] = await Promise.all([
        chargerContrats(f.id).catch(() => []), chargerTypesAbsence().catch(() => []), chargerSoldes(f.id).catch(() => []),
        chargerDemandes({ personId: f.id }).catch(() => []), chargerSemaine(f.id, lundi).catch(() => null),
        chargerEcheances({ personId: f.id }).catch(() => []), chargerLignes(f.id, lundi).catch(() => []),
      ])
      setContrat((c || []).find((x) => statutContrat(x) === 'actif') || (c || [])[0] || null)
      setTypes(t); setSoldes(s); setDemandes(d); setSemaine(sem); setEcheances(ech)
      // Total calculé depuis les lignes saisies : la semaine n'a de total enregistré qu'une fois soumise
      setMinutesSemaine(totauxSemaine(lignes || []).total)
    } catch (e) { toast.error(e.message); setFiche(null) }
  }, [lundi])
  useEffect(() => { charger() }, [charger])

  const nomType = useMemo(() => Object.fromEntries(types.map((t) => [t.id, t.label])), [types])
  const aVenir = demandes.filter((r) => (r.status === 'demandee' || r.status === 'validee') && r.end_on >= aujourdhui)
    .sort((a, b) => a.start_on.localeCompare(b.start_on)).slice(0, 5)
  const prochainesEcheances = echeances.filter((e) => e.kind !== 'fin_essai' || e.due_on >= aujourdhui).slice(0, 6)

  if (fiche === undefined) return <Spinner />
  if (!fiche) {
    return (
      <EmptyState title="Aucune fiche du personnel reliée à votre compte" compact>
        Demandez à la RH de relier votre compte à votre fiche : vous retrouverez ici vos congés, vos heures, vos documents et vos habilitations.
      </EmptyState>
    )
  }

  const annuler = async (r) => {
    if (!(await confirmer('Annuler cette demande d\'absence ?'))) return
    try { await annulerAbsence(r.id); charger() } catch (e) { toast.error(e.message) }
  }
  const stSem = STATUTS_SEMAINE[semaine?.status || 'ouverte']

  return (
    <div className="space-y-3">
      <section className="card space-y-1">
        <h2 className="section-title">{nomComplet(fiche)}</h2>
        {contrat
          ? <p className="text-ui-sm text-gray-600">{[CONTRATS[contrat.contract_type], contrat.job_title, contrat.hr_teams?.name && `équipe ${contrat.hr_teams.name}`].filter(Boolean).join(' · ')}{contrat.end_on ? `, jusqu'au ${frLong(contrat.end_on)}` : ''}</p>
          : <p className="text-ui-sm muted">Aucun contrat enregistré.</p>}
        {contrat?.manager && <p className="text-ui-sm text-gray-600">Responsable : {nomComplet(contrat.manager)}</p>}
      </section>

      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="section-title">Mes congés</h2>
          <button type="button" className="btn btn-primary" onClick={() => setDemande(true)}><CalendarPlus className="w-4 h-4" aria-hidden="true" />Demander une absence</button>
        </div>
        {soldes.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {soldes.map((s) => <span key={s.type_id} className="badge badge-neutral" style={{ height: 28 }}>{nomType[s.type_id] || 'Solde'} : {jours(s.solde)}</span>)}
          </div>
        )}
        {aVenir.length === 0 ? <p className="text-ui-sm muted">Aucune absence en attente ou à venir.</p> : (
          <ul className="divide-y divide-gray-100">
            {aVenir.map((r) => {
              const st = STATUTS_ABSENCE[r.status]
              return (
                <li key={r.id} className="py-2 flex items-center gap-2 flex-wrap">
                  <div className="flex-1 min-w-[10rem]">
                    <div className="font-semibold text-ui">{r.hr_absence_types?.label}</div>
                    <div className="text-ui-sm text-gray-600">{fr(r.start_on)}{r.end_on !== r.start_on ? ` au ${fr(r.end_on)}` : ''} · {jours(r.days)}</div>
                  </div>
                  <span className={`badge ${st.badge}`}>{st.label}</span>
                  {(r.status === 'demandee' || r.start_on > aujourdhui) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => annuler(r)}>Annuler</button>}
                </li>
              )
            })}
          </ul>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/collaborateurs/absences')}>Toutes mes demandes<ChevronRight className="w-4 h-4" aria-hidden="true" /></button>
      </section>

      <button type="button" className="card w-full text-left flex items-center gap-3" onClick={() => navigate('/collaborateurs/heures')}>
        <Clock className="w-5 h-5 text-gray-400 flex-none" aria-hidden="true" />
        <span className="flex-1 min-w-0">
          <span className="block section-title">Mes heures</span>
          <span className="block text-ui-sm text-gray-600">Semaine du {fr(lundi)}{(semaine?.total_minutes || minutesSemaine) ? ` · ${heures(semaine?.status === 'soumise' || semaine?.status === 'validee' ? semaine.total_minutes : minutesSemaine)} saisies` : ' · rien de saisi'}</span>
        </span>
        <span className={`badge ${stSem.badge}`}>{stSem.label}</span>
        <ChevronRight className="w-4 h-4 text-gray-400" aria-hidden="true" />
      </button>

      {prochainesEcheances.length > 0 && (
        <section className="card space-y-2">
          <h2 className="section-title flex items-center gap-2"><CalendarClock className="w-4 h-4 text-gray-400" aria-hidden="true" />Mes échéances</h2>
          <ul className="divide-y divide-gray-100">
            {prochainesEcheances.map((e) => {
              const et = etatEcheance(e.due_on)
              return (
                <li key={`${e.kind}-${e.source_id}`} className="py-2 flex items-center gap-2">
                  <span className="flex-1 min-w-0 text-ui">{e.label}<span className="block text-ui-sm text-gray-600">{frLong(e.due_on)}</span></span>
                  {et && <span className={`badge ${et.badge}`}>{et.label}</span>}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <EntretiensFiche companyId={fiche.company_id} personId={fiche.id} />
      <HabilitationsFiche companyId={fiche.company_id} personId={fiche.id} />
      <MaSignature companyId={fiche.company_id} />
      <SanteFiche companyId={fiche.company_id} personId={fiche.id} />
      <DocumentsFiche companyId={fiche.company_id} personId={fiche.id} estMoi titre="Mes documents" />

      {demande && <DemandeSheet types={types} soldes={soldes} onClose={() => setDemande(false)} onSaved={() => { setDemande(false); charger() }} />}
    </div>
  )
}
