// Module RH, tableau de bord (chantier 12, spec RH § 3.1) : validations en attente (absences et semaines d'heures,
// Valider ou Refuser en un geste), absents du jour, congés des 30 prochains jours, échéances (habilitations, visites,
// fins de CDD et d'essai), heures supplémentaires en attente. Chaque bloc suit les droits de la personne connectée :
// la base ne renvoie que ce qu'elle peut voir. Une absence pour maladie ou accident du travail s'affiche « Absent »
// pour qui n'a pas « Voir les documents restreints » (spec § 5, données de santé).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, X, CalendarClock, UserX, Plane, Hourglass } from 'lucide-react'
import { Spinner } from '../../../ui/EmptyState'
import { demander } from '../../../ui/Confirm'
import {
  nomComplet, heures, ajouterJours, chargerAnnuaire, chargerDemandes, chargerSemainesAValider, chargerAbsencesPeriode,
  chargerMaFiche, deciderAbsence,
} from '../lib/rhData'
import { etatEcheance, chargerEcheances, chargerVigilance } from '../lib/rhDocuments'

const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : '')
const jours = (n) => `${String(n).replace('.', ',')} j`
const SANTE = ['maladie', 'accident_travail']

function Bloc({ titre, icone: Icone, compte = null, children }) {
  return (
    <section className="card card-flush">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="section-title flex items-center gap-2">{Icone && <Icone className="w-4 h-4 text-gray-400" aria-hidden="true" />}{titre}</h2>
        {compte !== null && <span className="badge badge-neutral">{compte}</span>}
      </div>
      {children}
    </section>
  )
}

function Chiffre({ label, valeur, aide }) {
  return (
    <div className="card">
      <div className="text-ui-sm text-gray-600">{label}</div>
      <div className="page-title leading-tight">{valeur}</div>
      {aide && <div className="text-ui-sm muted">{aide}</div>}
    </div>
  )
}

export default function TableauRH({ peutValiderAbsences, peutValiderHeures, peutRestreints }) {
  const navigate = useNavigate()
  const [d, setD] = useState(null)
  const aujourdhui = new Date().toISOString().slice(0, 10)
  const dans30 = ajouterJours(aujourdhui, 30)
  const dans60 = ajouterJours(aujourdhui, 60)

  const charger = useCallback(async () => {
    try {
      const [annuaire, fiche, demandes, semaines, absences, echeances, vigilance] = await Promise.all([
        chargerAnnuaire().catch(() => []),
        chargerMaFiche().catch(() => null),
        peutValiderAbsences ? chargerDemandes({ statut: 'demandee' }).catch(() => []) : [],
        peutValiderHeures ? chargerSemainesAValider().catch(() => []) : [],
        chargerAbsencesPeriode(aujourdhui, dans30).catch(() => []),
        chargerEcheances({ jusquAu: dans60 }).catch(() => []),
        peutRestreints ? chargerVigilance() : [],
      ])
      setD({
        annuaire,
        demandes: demandes.filter((r) => r.person_id !== fiche?.id),
        semaines: semaines.filter((s) => s.person_id !== fiche?.id),
        absences,
        echeances: echeances.filter((e) => e.kind !== 'fin_essai' || e.due_on >= aujourdhui),
        vigilance: vigilance || [],
      })
    } catch (e) { toast.error(e.message) }
  }, [peutValiderAbsences, peutValiderHeures, peutRestreints, aujourdhui, dans30, dans60])
  useEffect(() => { charger() }, [charger])

  const noms = useMemo(() => Object.fromEntries((d?.annuaire || []).map((p) => [p.id, nomComplet(p)])), [d])
  if (!d) return <Spinner />

  const enPoste = d.annuaire.filter((p) => p.statut === 'actif')
  const absentsAujourdhui = d.absences.filter((a) => a.start_on <= aujourdhui && a.end_on >= aujourdhui)
  const aVenir = d.absences.filter((a) => a.start_on > aujourdhui)
  const supEnAttente = d.semaines.reduce((t, s) => t + (s.overtime_minutes || 0), 0)
  const motifAbsence = (a) => (SANTE.includes(a.hr_absence_types?.category) && !peutRestreints ? 'Absent' : a.hr_absence_types?.label || 'Absent')

  const decider = async (approvalId, decision, quoi) => {
    let motif = null
    if (decision === 'rejected') {
      motif = await demander(quoi === 'semaine' ? 'Ce qui est à reprendre (obligatoire)' : 'Motif du refus (obligatoire)', { title: quoi === 'semaine' ? 'Renvoyer la semaine' : 'Refuser la demande' })
      if (!motif || motif.trim().length < 3) return
    }
    try {
      await deciderAbsence(approvalId, decision, motif)
      toast.success(decision === 'approved' ? 'Validé' : quoi === 'semaine' ? 'Semaine renvoyée' : 'Demande refusée')
      charger()
    } catch (e) { toast.error(e.message) }
  }
  const boutons = (approvalId, quoi) => approvalId && (
    <div className="flex gap-2">
      <button type="button" className="btn btn-success btn-sm" onClick={() => decider(approvalId, 'approved', quoi)}><Check className="w-4 h-4" aria-hidden="true" />Valider</button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => decider(approvalId, 'rejected', quoi)}><X className="w-4 h-4" aria-hidden="true" />{quoi === 'semaine' ? 'Renvoyer' : 'Refuser'}</button>
    </div>
  )
  const nbValidations = d.demandes.length + d.semaines.length

  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        <Chiffre label="En poste" valeur={enPoste.length} aide={absentsAujourdhui.length ? `${absentsAujourdhui.length} absent${absentsAujourdhui.length > 1 ? 's' : ''} aujourd'hui` : 'Personne d\'absent aujourd\'hui'} />
        {(peutValiderAbsences || peutValiderHeures) && <Chiffre label="À valider" valeur={nbValidations} aide={[d.demandes.length && `${d.demandes.length} absence${d.demandes.length > 1 ? 's' : ''}`, d.semaines.length && `${d.semaines.length} semaine${d.semaines.length > 1 ? 's' : ''}`].filter(Boolean).join(', ') || 'Rien en attente'} />}
        <Chiffre label="Congés à venir" valeur={aVenir.length} aide="30 prochains jours" />
        <Chiffre label="Échéances" valeur={d.echeances.length} aide="dépassées ou à 60 jours" />
      </div>

      {d.vigilance.length > 0 && (
        <Bloc titre="Vigilance : inaptitudes et visites de reprise" icone={Hourglass} compte={d.vigilance.length}>
          <ul className="divide-y divide-gray-100">
            {d.vigilance.map((v) => (
              <li key={`${v.kind}-${v.person_id}-${v.depuis}`} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[12rem]">
                  <div className="font-semibold text-ui">{noms[v.person_id] || 'Personne'} · {v.kind === 'inaptitude' ? 'Avis d\'inaptitude' : 'Visite de reprise'}</div>
                  <div className="text-ui-sm text-gray-600">{v.libelle} : avant le {fr(v.echeance)}</div>
                </div>
                <span className={`badge ${v.echeance < aujourdhui ? 'badge-danger' : 'badge-warning'}`}>{v.echeance < aujourdhui ? 'Dépassé' : 'À faire'}</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`/collaborateurs/${v.person_id}`)}>Fiche</button>
              </li>
            ))}
          </ul>
        </Bloc>
      )}

      {(peutValiderAbsences || peutValiderHeures) && (
        <Bloc titre="Validations en attente" icone={Hourglass} compte={nbValidations}>
          {nbValidations === 0 ? <p className="px-4 pb-4 text-ui-sm muted">Aucune demande ni semaine en attente.</p> : (
            <ul className="divide-y divide-gray-100">
              {d.demandes.map((r) => (
                <li key={r.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[12rem]">
                    <div className="font-semibold text-ui">{nomComplet(r.hr_people) || noms[r.person_id]} · {motifAbsence(r)}</div>
                    <div className="text-ui-sm text-gray-600">{fr(r.start_on)}{r.end_on !== r.start_on ? ` au ${fr(r.end_on)}` : ''} · {jours(r.days)}{r.comment ? ` · ${r.comment}` : ''}</div>
                  </div>
                  {boutons(r.approval_id, 'absence')}
                </li>
              ))}
              {d.semaines.map((s) => (
                <li key={s.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[12rem]">
                    <div className="font-semibold text-ui">{nomComplet(s.hr_people)} · heures</div>
                    <div className="text-ui-sm text-gray-600">Semaine du {fr(s.week_start)} · {heures(s.total_minutes)}{s.contract_minutes ? ` sur ${heures(s.contract_minutes)}` : ''}{s.overtime_minutes ? ` · ${heures(s.overtime_minutes)} supplémentaires` : ''}</div>
                  </div>
                  {boutons(s.approval_id, 'semaine')}
                </li>
              ))}
            </ul>
          )}
          {supEnAttente > 0 && <p className="px-4 pb-3 text-ui-sm text-gray-600">Heures supplémentaires en attente de validation : {heures(supEnAttente)}</p>}
        </Bloc>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <Bloc titre="Absents aujourd'hui" icone={UserX} compte={absentsAujourdhui.length}>
          {absentsAujourdhui.length === 0 ? <p className="px-4 pb-4 text-ui-sm muted">Tout le monde est là.</p> : (
            <ul className="divide-y divide-gray-100">
              {absentsAujourdhui.map((a) => (
                <li key={a.id} className="px-4 py-2 flex items-center gap-2">
                  <span className="flex-1 min-w-0 text-ui font-semibold">{nomComplet(a.hr_people)}</span>
                  <span className="text-ui-sm text-gray-600">{motifAbsence(a)}, jusqu'au {fr(a.end_on)}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>

        <Bloc titre="Congés des 30 prochains jours" icone={Plane} compte={aVenir.length}>
          {aVenir.length === 0 ? <p className="px-4 pb-4 text-ui-sm muted">Aucune absence validée à venir.</p> : (
            <ul className="divide-y divide-gray-100">
              {aVenir.map((a) => (
                <li key={a.id} className="px-4 py-2 flex items-center gap-2 flex-wrap">
                  <span className="flex-1 min-w-[8rem] text-ui font-semibold">{nomComplet(a.hr_people)}</span>
                  <span className="text-ui-sm text-gray-600">{motifAbsence(a)} · {fr(a.start_on)}{a.end_on !== a.start_on ? ` au ${fr(a.end_on)}` : ''} · {jours(a.days)}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>
      </div>

      <Bloc titre="Échéances" icone={CalendarClock} compte={d.echeances.length}>
        {d.echeances.length === 0 ? <p className="px-4 pb-4 text-ui-sm muted">Aucune échéance dépassée ni dans les 60 prochains jours.</p> : (
          <ul className="divide-y divide-gray-100">
            {d.echeances.map((e) => {
              const et = etatEcheance(e.due_on)
              return (
                <li key={`${e.kind}-${e.source_id}`}>
                  <button type="button" className="w-full text-left px-4 py-2 flex items-center gap-2 flex-wrap" onClick={() => navigate(`/collaborateurs/${e.person_id}`)}>
                    <span className="flex-1 min-w-[10rem]">
                      <span className="block text-ui font-semibold">{noms[e.person_id] || 'Personne'}</span>
                      <span className="block text-ui-sm text-gray-600">{e.label} · {fr(e.due_on)}</span>
                    </span>
                    {et && <span className={`badge ${et.badge}`}>{et.label}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Bloc>
    </div>
  )
}
