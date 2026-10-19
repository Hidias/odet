// Module RH, socle (chantier 12, 0290) : annuaire, fiche du personnel (identité, contrats, rémunération journalisée),
// équipes et horaires de référence ; habilitations, santé au travail administrative et documents (0301). Chaque partie
// n'apparaît que si la base la permet (droits rh.*).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, Phone, Mail, Search, Users, Pencil, Eye, Archive, ArchiveRestore, Trash2, Clock } from 'lucide-react'
import { useAuthStore } from '../../../core/store'
import { supabase } from '../../../core/supabase'
import { PageHeader } from '../../../ui/PageHeader'
import { Tabs } from '../../../ui/Tabs'
import { EmptyState, Spinner } from '../../../ui/EmptyState'
import { Sheet } from '../../../ui/Sheet'
import { confirmer } from '../../../ui/Confirm'
import { useOuvrirSiDemande } from '../../../ui/useOuvrirSiDemande'
import {
  CONTRATS, STATUTS, PERIODES, JOURS, nomComplet, statutContrat, plagesVersTexte, texteVersPlages, heuresSemaine,
  chargerAnnuaire, chargerPersonne, chargerContrats, chargerEquipes, chargerHoraires, chargerEtablissements,
  chargerPersonnesChoix, enregistrerPersonne, archiverPersonne, enregistrerContrat, supprimerContrat,
  voirRemuneration, ajouterRemuneration, enregistrerEquipe, supprimerEquipe, enregistrerHoraire,
  chargerTypesAbsence, chargerSoldes, chargerMouvements, ajusterSolde,
  chargerFeries, marquerFerie, ajouterFerie, supprimerFerie, poserFeriesAnnee, suisResponsable,
} from '../lib/rhData'
import Absences, { DemandeSheet } from './Absences'
import Heures from './Heures'
import { DocumentsFiche, HabilitationsFiche, SanteFiche } from './DocumentsSante'
import MonEspace from './MonEspace'
import TableauRH from './TableauRH'
import RegistrePaie from './RegistrePaie'

const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const euros = (n) => Number(n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

function Champ({ label, children, className = '' }) {
  return <label className={`block ${className}`}><span className="label">{label}</span>{children}</label>
}

// ─── Annuaire ───
function Annuaire({ peutGerer }) {
  const navigate = useNavigate()
  const [liste, setListe] = useState(null)
  const [q, setQ] = useState('')
  const [equipe, setEquipe] = useState('')
  const [statut, setStatut] = useState('presents')
  const [creation, setCreation] = useState(false)
  useOuvrirSiDemande(() => setCreation(true))

  const charger = useCallback(() => { chargerAnnuaire().then(setListe).catch((e) => toast.error(e.message)) }, [])
  useEffect(() => { charger() }, [charger])

  const equipes = useMemo(() => [...new Set((liste || []).map((p) => p.team).filter(Boolean))].sort(), [liste])
  const visibles = useMemo(() => (liste || []).filter((p) => {
    if (statut === 'presents' && !['actif', 'a_venir'].includes(p.statut)) return false
    if (statut === 'partis' && p.statut !== 'termine') return false
    if (equipe && p.team !== equipe) return false
    if (q && !`${p.first_name} ${p.last_name} ${p.usage_name || ''} ${p.job_title || ''}`.toLowerCase().includes(q.toLowerCase())) return false
    return true
  }), [liste, q, equipe, statut])

  if (!liste) return <Spinner />
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input className="input pl-9" placeholder="Nom, emploi" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
        </div>
        {equipes.length > 0 && (
          <select className="select w-auto" value={equipe} onChange={(e) => setEquipe(e.target.value)} aria-label="Équipe">
            <option value="">Toutes les équipes</option>
            {equipes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <select className="select w-auto" value={statut} onChange={(e) => setStatut(e.target.value)} aria-label="Statut">
          <option value="presents">En poste et arrivées</option>
          <option value="partis">Partis</option>
          <option value="tous">Tout le monde</option>
        </select>
        {peutGerer && <button type="button" className="btn btn-primary" onClick={() => setCreation(true)}><Plus className="w-4 h-4" aria-hidden="true" />Ajouter une personne</button>}
      </div>

      {visibles.length === 0 ? (
        <EmptyState icon={Users} title={liste.length ? 'Personne ne correspond à ces filtres' : 'Aucune personne pour l\'instant'}
          action={peutGerer && !liste.length ? <button type="button" className="btn btn-primary" onClick={() => setCreation(true)}><Plus className="w-4 h-4" aria-hidden="true" />Ajouter la première personne</button> : null}>
          {liste.length ? 'Changez la recherche ou les filtres.' : 'L\'annuaire se remplit avec les fiches du personnel : nom, emploi, équipe, téléphone et email professionnels.'}
        </EmptyState>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {visibles.map((p) => {
            const st = STATUTS[p.statut] || STATUTS.sans_contrat
            return (
              <li key={p.id} className="card space-y-1">
                <div className="flex items-start gap-2">
                  <button type="button" className="flex-1 min-w-0 text-left" onClick={() => navigate(p.id)}>
                    <div className="font-semibold text-ui truncate">{nomComplet(p)}</div>
                    <div className="text-ui-sm text-gray-600 truncate">{[p.job_title, p.team].filter(Boolean).join(' · ') || 'Emploi non renseigné'}</div>
                  </button>
                  <span className={`badge ${st.badge} flex-none`}>{st.label}</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {p.work_phone && <a className="btn btn-secondary btn-sm" href={`tel:${p.work_phone}`}><Phone className="w-4 h-4" aria-hidden="true" />{p.work_phone}</a>}
                  {p.work_email && <a className="btn btn-ghost btn-sm" href={`mailto:${p.work_email}`}><Mail className="w-4 h-4" aria-hidden="true" />Email</a>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {creation && <FichePersonneSheet onClose={() => setCreation(false)} onSaved={(id) => { setCreation(false); charger(); navigate(id) }} />}
    </div>
  )
}

// ─── Fiche : identité ───
const VIDE = {
  first_name: '', last_name: '', usage_name: '', birth_date: '', work_phone: '', work_email: '', personal_phone: '',
  personal_email: '', personal_address: '', personal_postal_code: '', personal_city: '', emergency_name: '',
  emergency_relation: '', emergency_phone: '', notes: '', profile_id: '', nationality: '', gender: '',
  work_permit_type: '', work_permit_ref: '',
}
function FichePersonneSheet({ personne = null, onClose, onSaved }) {
  const [v, setV] = useState(() => ({ ...VIDE, ...Object.fromEntries(Object.entries(personne || {}).filter(([k]) => k in VIDE).map(([k, x]) => [k, x ?? ''])) }))
  const [plus, setPlus] = useState(!!personne)
  const [busy, setBusy] = useState(false)
  const [comptes, setComptes] = useState([])
  useEffect(() => {
    supabase.from('profiles').select('id, first_name, last_name, display_name, email, is_active').order('last_name')
      .then(({ data }) => setComptes((data || []).filter((c) => c.is_active !== false || c.id === personne?.profile_id)))
  }, [personne?.profile_id])
  const m = (k) => (e) => setV({ ...v, [k]: e.target.value })
  const enregistrer = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await enregistrerPersonne({ ...(personne?.id ? { id: personne.id } : {}), ...v, birth_date: v.birth_date || null })
      toast.success(personne ? 'Fiche enregistrée' : 'Personne ajoutée')
      onSaved(r.id)
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  return (
    <Sheet title={personne ? 'Modifier la fiche' : 'Ajouter une personne'} onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="submit" form="rh-fiche" className="btn btn-primary" disabled={busy}>Enregistrer</button></>}>
      <form id="rh-fiche" onSubmit={enregistrer} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ label="Prénom"><input className="input" required value={v.first_name} onChange={m('first_name')} /></Champ>
          <Champ label="Nom"><input className="input" required value={v.last_name} onChange={m('last_name')} /></Champ>
          <Champ label="Téléphone professionnel"><input className="input" type="tel" value={v.work_phone} onChange={m('work_phone')} /></Champ>
          <Champ label="Email professionnel"><input className="input" type="email" value={v.work_email} onChange={m('work_email')} /></Champ>
        </div>
        {comptes.length > 0 && (
          <Champ label="Compte de l'outil relié">
            <select className="select" value={v.profile_id} onChange={m('profile_id')}>
              <option value="">Aucun (la personne ne se connecte pas)</option>
              {comptes.map((c) => <option key={c.id} value={c.id}>{[c.first_name, c.last_name].filter(Boolean).join(' ') || c.display_name || c.email} · {c.email}</option>)}
            </select>
            <span className="block text-ui-sm muted mt-0.5">La personne retrouve alors ses congés, ses heures et ses documents dans « Mon espace ».</span>
          </Champ>
        )}
        {!plus && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlus(true)}>Coordonnées personnelles et contact d'urgence</button>}
        {plus && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Champ label="Nom d'usage"><input className="input" value={v.usage_name} onChange={m('usage_name')} /></Champ>
              <Champ label="Date de naissance"><input className="input" type="date" value={v.birth_date} onChange={m('birth_date')} /></Champ>
              <Champ label="Téléphone personnel"><input className="input" type="tel" value={v.personal_phone} onChange={m('personal_phone')} /></Champ>
              <Champ label="Email personnel"><input className="input" type="email" value={v.personal_email} onChange={m('personal_email')} /></Champ>
              <Champ label="Nationalité"><input className="input" value={v.nationality} onChange={m('nationality')} placeholder="Française" /></Champ>
              <Champ label="Sexe">
                <select className="select" value={v.gender} onChange={m('gender')}><option value="">Non renseigné</option><option value="F">Femme</option><option value="M">Homme</option></select>
              </Champ>
            </div>
            <details className="text-ui-sm">
              <summary className="cursor-pointer text-gray-600">Travailleur étranger soumis à autorisation de travail</summary>
              <div className="grid gap-3 sm:grid-cols-2 mt-2">
                <Champ label="Type d'autorisation"><input className="input" value={v.work_permit_type} onChange={m('work_permit_type')} placeholder="Titre de séjour salarié" /></Champ>
                <Champ label="Numéro"><input className="input" value={v.work_permit_ref} onChange={m('work_permit_ref')} /></Champ>
              </div>
            </details>
            <Champ label="Adresse"><input className="input" value={v.personal_address} onChange={m('personal_address')} /></Champ>
            <div className="grid gap-3 grid-cols-[8rem_1fr]">
              <Champ label="Code postal"><input className="input" value={v.personal_postal_code} onChange={m('personal_postal_code')} /></Champ>
              <Champ label="Ville"><input className="input" value={v.personal_city} onChange={m('personal_city')} /></Champ>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Champ label="Contact d'urgence"><input className="input" value={v.emergency_name} onChange={m('emergency_name')} /></Champ>
              <Champ label="Lien"><input className="input" value={v.emergency_relation} onChange={m('emergency_relation')} /></Champ>
              <Champ label="Téléphone"><input className="input" type="tel" value={v.emergency_phone} onChange={m('emergency_phone')} /></Champ>
            </div>
            <Champ label="Notes"><textarea className="input" rows={2} value={v.notes} onChange={m('notes')} /></Champ>
          </>
        )}
        <p className="text-ui-sm muted">Aucun numéro de sécurité sociale ni donnée de santé ici : ils restent chez le logiciel de paie et le service de santé au travail.</p>
      </form>
    </Sheet>
  )
}

// ─── Fiche : contrat ───
function ContratSheet({ personId, contrat = null, onClose, onSaved }) {
  const [v, setV] = useState(() => ({
    contract_type: 'cdi', start_on: new Date().toISOString().slice(0, 10), end_on: '', trial_end_on: '', end_reason: '',
    job_title: '', qualification: '', team_id: '', manager_person_id: '', weekly_hours: '35', days_per_year: '',
    schedule_id: '', establishment_id: '', job_description: '', agency_name: '', agency_address: '', authorization_on: '',
    ...Object.fromEntries(Object.entries(contrat || {}).map(([k, x]) => [k, x ?? ''])),
  }))
  const [listes, setListes] = useState({ equipes: [], horaires: [], etablissements: [], personnes: [] })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    Promise.all([chargerEquipes(), chargerHoraires(), chargerEtablissements(), chargerPersonnesChoix()])
      .then(([equipes, horaires, etablissements, personnes]) => setListes({ equipes, horaires, etablissements, personnes: personnes.filter((p) => p.id !== personId) }))
      .catch(() => {})
  }, [personId])
  const m = (k) => (e) => setV({ ...v, [k]: e.target.value })
  const enregistrer = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const nul = (x) => (x === '' ? null : x)
      await enregistrerContrat({
        ...(contrat?.id ? { id: contrat.id } : {}), person_id: personId, contract_type: v.contract_type, start_on: v.start_on,
        end_on: nul(v.end_on), trial_end_on: nul(v.trial_end_on), end_reason: v.end_reason, job_title: v.job_title,
        qualification: v.qualification, team_id: nul(v.team_id), manager_person_id: nul(v.manager_person_id),
        weekly_hours: v.weekly_hours, days_per_year: v.days_per_year, schedule_id: nul(v.schedule_id),
        establishment_id: nul(v.establishment_id), job_description: v.job_description,
        agency_name: v.agency_name, agency_address: v.agency_address, authorization_on: nul(v.authorization_on),
      })
      toast.success('Contrat enregistré')
      onSaved()
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  return (
    <Sheet title={contrat ? 'Modifier le contrat' : 'Ajouter un contrat'} onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="submit" form="rh-contrat" className="btn btn-primary" disabled={busy}>Enregistrer</button></>}>
      <form id="rh-contrat" onSubmit={enregistrer} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ label="Type de contrat">
            <select className="select" value={v.contract_type} onChange={m('contract_type')}>{Object.entries(CONTRATS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Champ>
          <Champ label="Emploi"><input className="input" value={v.job_title} onChange={m('job_title')} placeholder="Technicien, formateur…" /></Champ>
          <Champ label="Début"><input className="input" type="date" required value={v.start_on} onChange={m('start_on')} /></Champ>
          <Champ label="Fin (CDD, départ)"><input className="input" type="date" value={v.end_on} onChange={m('end_on')} /></Champ>
          <Champ label="Équipe">
            <select className="select" value={v.team_id} onChange={m('team_id')}><option value="">Aucune</option>{listes.equipes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </Champ>
          <Champ label="Responsable">
            <select className="select" value={v.manager_person_id} onChange={m('manager_person_id')}><option value="">Aucun</option>{listes.personnes.map((p) => <option key={p.id} value={p.id}>{nomComplet(p)}</option>)}</select>
          </Champ>
          <Champ label="Heures par semaine"><input className="input" inputMode="decimal" value={v.weekly_hours} onChange={m('weekly_hours')} /></Champ>
          <Champ label="Horaire de référence">
            <select className="select" value={v.schedule_id} onChange={m('schedule_id')}><option value="">Celui de la société</option>{listes.horaires.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
          </Champ>
          <Champ label="Fin de période d'essai"><input className="input" type="date" value={v.trial_end_on} onChange={m('trial_end_on')} /></Champ>
          <Champ label="Qualification, coefficient"><input className="input" value={v.qualification} onChange={m('qualification')} /></Champ>
          {listes.etablissements.length > 1 && (
            <Champ label="Établissement">
              <select className="select" value={v.establishment_id} onChange={m('establishment_id')}><option value="">Siège</option>{listes.etablissements.map((x) => <option key={x.id} value={x.id}>{x.name || x.city}</option>)}</select>
            </Champ>
          )}
          <Champ label="Forfait jours (par an)"><input className="input" inputMode="numeric" value={v.days_per_year} onChange={m('days_per_year')} placeholder="Si forfait" /></Champ>
        </div>
        {v.end_on && <Champ label="Motif de fin"><input className="input" value={v.end_reason} onChange={m('end_reason')} /></Champ>}
        {v.contract_type === 'interim' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Champ label="Entreprise de travail temporaire"><input className="input" value={v.agency_name} onChange={m('agency_name')} /></Champ>
            <Champ label="Son adresse"><input className="input" value={v.agency_address} onChange={m('agency_address')} /></Champ>
          </div>
        )}
        <Champ label="Fiche de poste (résumé)"><textarea className="input" rows={2} value={v.job_description} onChange={m('job_description')} /></Champ>
      </form>
    </Sheet>
  )
}

function Remuneration({ contrat, peutSaisir, peutVoir }) {
  const [lignes, setLignes] = useState(null)
  const [saisie, setSaisie] = useState(false)
  const [v, setV] = useState({ amount: '', period: 'mensuel', effective_on: new Date().toISOString().slice(0, 10), note: '' })
  const voir = async () => { try { setLignes(await voirRemuneration(contrat.id)) } catch (e) { toast.error(e.message) } }
  const ajouter = async (e) => {
    e.preventDefault()
    try { await ajouterRemuneration(contrat.id, v); toast.success('Rémunération enregistrée'); setSaisie(false); if (peutVoir) voir() } catch (err) { toast.error(err.message) }
  }
  if (!peutVoir && !peutSaisir) return null
  return (
    <div className="border-t hairline pt-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-ui-sm font-semibold">Rémunération</span>
        {peutVoir && lignes === null && <button type="button" className="btn btn-ghost btn-sm" onClick={voir}><Eye className="w-4 h-4" aria-hidden="true" />Afficher (consultation notée au journal)</button>}
        {peutSaisir && !saisie && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSaisie(true)}><Plus className="w-4 h-4" aria-hidden="true" />Nouvelle rémunération</button>}
      </div>
      {lignes && (lignes.length === 0
        ? <p className="text-ui-sm muted">Aucune rémunération saisie.</p>
        : <ul className="text-ui-sm space-y-1">{lignes.map((l) => <li key={l.id}>{euros(l.amount)} {PERIODES[l.period]}, depuis le {fr(l.effective_on)}{l.note ? ` (${l.note})` : ''}</li>)}</ul>)}
      {saisie && (
        <form onSubmit={ajouter} className="grid gap-2 sm:grid-cols-[8rem_9rem_10rem_1fr_auto] items-end">
          <Champ label="Montant brut"><input className="input" inputMode="decimal" required value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value.replace(',', '.') })} /></Champ>
          <Champ label="Période"><select className="select" value={v.period} onChange={(e) => setV({ ...v, period: e.target.value })}>{Object.entries(PERIODES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Champ>
          <Champ label="À partir du"><input className="input" type="date" required value={v.effective_on} onChange={(e) => setV({ ...v, effective_on: e.target.value })} /></Champ>
          <Champ label="Note"><input className="input" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Champ>
          <div className="flex gap-1"><button type="submit" className="btn btn-primary btn-sm">Enregistrer</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setSaisie(false)}>Annuler</button></div>
        </form>
      )}
    </div>
  )
}

// Soldes d'absence d'une personne : soldes calculés, mouvements, ajustement et saisie par la RH
function SoldesFiche({ personId, peutGerer }) {
  const [types, setTypes] = useState([])
  const [soldes, setSoldes] = useState([])
  const [mouv, setMouv] = useState([])
  const [ajust, setAjust] = useState(null)
  const [saisie, setSaisie] = useState(false)
  const charger = useCallback(() => {
    Promise.all([chargerTypesAbsence(), chargerSoldes(personId), chargerMouvements(personId)])
      .then(([t, s, m]) => { setTypes(t); setSoldes(s); setMouv(m) }).catch(() => {})
  }, [personId])
  useEffect(() => { charger() }, [charger])
  const avecSolde = types.filter((t) => t.counts_balance && t.is_active)
  const enregistrer = async (e) => {
    e.preventDefault()
    try { await ajusterSolde({ personId, ...ajust }); setAjust(null); charger() } catch (err) { toast.error(err.message) }
  }
  if (!avecSolde.length && !mouv.length && !peutGerer) return null
  const nom = Object.fromEntries(types.map((t) => [t.id, t.label]))
  return (
    <section className="card space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="section-title">Absences et soldes</h2>
        {peutGerer && (
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSaisie(true)}>Saisir une absence</button>
            {avecSolde.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAjust({ typeId: avecSolde[0].id, kind: 'acquisition', days: '', note: '', periodLabel: '' })}>Ajuster un solde</button>}
          </div>
        )}
      </div>
      <div className="flex gap-2 flex-wrap">
        {avecSolde.map((t) => {
          const s = soldes.find((x) => x.type_id === t.id)
          return <span key={t.id} className="badge badge-neutral" style={{ height: 28 }}>{t.label} : {String(s?.solde ?? 0).replace('.', ',')} j</span>
        })}
      </div>
      {ajust && (
        <form onSubmit={enregistrer} className="grid gap-2 sm:grid-cols-[1fr_9rem_7rem_1fr_auto] items-end">
          <Champ label="Type"><select className="select" value={ajust.typeId} onChange={(e) => setAjust({ ...ajust, typeId: e.target.value })}>{avecSolde.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Champ>
          <Champ label="Mouvement"><select className="select" value={ajust.kind} onChange={(e) => setAjust({ ...ajust, kind: e.target.value })}><option value="acquisition">Acquisition</option><option value="report">Report</option><option value="ajustement">Ajustement</option></select></Champ>
          <Champ label="Jours (+ ou −)"><input className="input" required inputMode="decimal" value={ajust.days} onChange={(e) => setAjust({ ...ajust, days: e.target.value.replace(',', '.') })} /></Champ>
          <Champ label="Période ou note"><input className="input" value={ajust.note} onChange={(e) => setAjust({ ...ajust, note: e.target.value })} placeholder="Octobre 2026" /></Champ>
          <div className="flex gap-1"><button type="submit" className="btn btn-primary btn-sm">Enregistrer</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setAjust(null)}>Annuler</button></div>
        </form>
      )}
      {mouv.length > 0 && (
        <details className="text-ui-sm">
          <summary className="cursor-pointer text-gray-600">Mouvements ({mouv.length})</summary>
          <ul className="mt-1 space-y-0.5">{mouv.slice(0, 30).map((m) => <li key={m.id}>{fr(m.created_at)} · {nom[m.type_id] || m.hr_absence_types?.label} · {m.days > 0 ? '+' : ''}{String(m.days).replace('.', ',')} j · {m.kind}{m.note ? ` · ${m.note}` : ''}</li>)}</ul>
        </details>
      )}
      {saisie && <DemandeSheet types={types} personId={personId} soldes={soldes} onClose={() => setSaisie(false)} onSaved={() => { setSaisie(false); charger() }} />}
    </section>
  )
}

function FichePersonne({ peutGerer, peutSalaires, peutRestreints }) {
  const { id } = useParams()
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [p, setP] = useState(undefined)
  const [contrats, setContrats] = useState([])
  const [edition, setEdition] = useState(false)
  const [contratEdite, setContratEdite] = useState(null)
  const charger = useCallback(async () => {
    try {
      const [pp, cc] = await Promise.all([chargerPersonne(id), chargerContrats(id)])
      setP(pp); setContrats(cc || [])
    } catch (e) { toast.error(e.message); setP(null) }
  }, [id])
  useEffect(() => { charger() }, [charger])

  if (p === undefined) return <Spinner />
  if (!p) return <EmptyState icon={Users} title="Fiche introuvable ou non accessible" action={<Link to="/collaborateurs" className="btn btn-secondary">Retour à l'annuaire</Link>}>Votre profil ne permet peut-être pas de voir les dossiers du personnel.</EmptyState>
  const ligne = (label, valeur) => valeur ? <div className="flex gap-2 text-ui"><span className="text-gray-500 w-44 flex-none">{label}</span><span className="min-w-0">{valeur}</span></div> : null

  const archiver = async () => {
    if (!(await confirmer(p.archived_at ? 'Remettre cette fiche dans l\'annuaire ?' : 'Archiver cette fiche ? Elle disparaît de l\'annuaire, rien n\'est effacé.'))) return
    try { await archiverPersonne(p.id, !p.archived_at); charger() } catch (e) { toast.error(e.message) }
  }
  const supprimerC = async (c) => {
    if (!(await confirmer('Supprimer ce contrat saisi par erreur ? Ses rémunérations sont supprimées avec lui.'))) return
    try { await supprimerContrat(c.id); charger() } catch (e) { toast.error(e.message) }
  }

  return (
    <div className="space-y-3">
      <PageHeader crumbs={[{ label: 'Personnel', to: '/collaborateurs' }, { label: nomComplet(p) }]} title={nomComplet(p)}
        meta={p.archived_at ? <span className="badge badge-neutral">Archivée le {fr(p.archived_at)}</span> : null}
        actions={peutGerer ? (
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setEdition(true)}><Pencil className="w-4 h-4" aria-hidden="true" />Modifier</button>
            <button type="button" className="btn btn-ghost" onClick={archiver}>{p.archived_at ? <ArchiveRestore className="w-4 h-4" aria-hidden="true" /> : <Archive className="w-4 h-4" aria-hidden="true" />}{p.archived_at ? 'Désarchiver' : 'Archiver'}</button>
          </div>
        ) : null} />

      <section className="card space-y-1">
        <h2 className="section-title mb-1">Identité et coordonnées</h2>
        {ligne('Nom d\'usage', p.usage_name)}
        {ligne('Né(e) le', fr(p.birth_date))}
        {ligne('Téléphone professionnel', p.work_phone && <a href={`tel:${p.work_phone}`}>{p.work_phone}</a>)}
        {ligne('Email professionnel', p.work_email && <a href={`mailto:${p.work_email}`}>{p.work_email}</a>)}
        {ligne('Téléphone personnel', p.personal_phone)}
        {ligne('Email personnel', p.personal_email)}
        {ligne('Adresse', [p.personal_address, [p.personal_postal_code, p.personal_city].filter(Boolean).join(' ')].filter(Boolean).join(', '))}
        {ligne('Contact d\'urgence', [p.emergency_name, p.emergency_relation, p.emergency_phone].filter(Boolean).join(' · '))}
        {ligne('Nationalité', p.nationality)}
        {ligne('Sexe', p.gender === 'F' ? 'Femme' : p.gender === 'M' ? 'Homme' : null)}
        {ligne('Autorisation de travail', [p.work_permit_type, p.work_permit_ref].filter(Boolean).join(' n° '))}
        {ligne('Notes', p.notes)}
        {ligne('Compte relié', p.profile_id ? 'Oui, la personne a son espace' : null)}
      </section>

      <section className="card space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-title">Contrats</h2>
          {peutGerer && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setContratEdite({})}><Plus className="w-4 h-4" aria-hidden="true" />Ajouter un contrat</button>}
        </div>
        {contrats.length === 0 && <p className="text-ui-sm muted">Aucun contrat saisi.</p>}
        {contrats.map((c) => {
          const st = STATUTS[statutContrat(c)]
          return (
            <div key={c.id} className="rounded-ui-sm border border-gray-200 p-3 space-y-1">
              <div className="flex items-start gap-2 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-ui">{CONTRATS[c.contract_type]}{c.job_title ? ` · ${c.job_title}` : ''}</div>
                  <div className="text-ui-sm text-gray-600">
                    Depuis le {fr(c.start_on)}{c.end_on ? `, jusqu'au ${fr(c.end_on)}` : ''}
                    {c.weekly_hours ? ` · ${String(c.weekly_hours).replace('.', ',')} h par semaine` : ''}{c.days_per_year ? ` · forfait ${c.days_per_year} jours` : ''}
                  </div>
                  <div className="text-ui-sm text-gray-600">{[c.hr_teams?.name && `Équipe ${c.hr_teams.name}`, c.manager && `Responsable : ${nomComplet(c.manager)}`, c.trial_end_on && `Essai jusqu'au ${fr(c.trial_end_on)}`].filter(Boolean).join(' · ')}</div>
                </div>
                <span className={`badge ${st.badge}`}>{st.label}</span>
                {peutGerer && <button type="button" className="btn btn-ghost btn-icon" aria-label="Modifier le contrat" onClick={() => setContratEdite(c)}><Pencil className="w-4 h-4" /></button>}
                {peutGerer && <button type="button" className="btn btn-ghost btn-icon" aria-label="Supprimer le contrat" onClick={() => supprimerC(c)}><Trash2 className="w-4 h-4" /></button>}
              </div>
              <Remuneration contrat={c} peutVoir={peutSalaires} peutSaisir={peutSalaires && peutGerer} />
            </div>
          )
        })}
      </section>

      <SoldesFiche personId={p.id} peutGerer={peutGerer} />

      <HabilitationsFiche companyId={p.company_id} personId={p.id} peutGerer={peutGerer} />
      <SanteFiche companyId={p.company_id} personId={p.id} peutGerer={peutGerer && peutRestreints} />
      <DocumentsFiche companyId={p.company_id} personId={p.id} peutGerer={peutGerer} peutRestreints={peutRestreints} estMoi={!!user?.id && p.profile_id === user.id} />

      {edition && <FichePersonneSheet personne={p} onClose={() => setEdition(false)} onSaved={() => { setEdition(false); charger() }} />}
      {contratEdite && <ContratSheet personId={p.id} contrat={contratEdite.id ? contratEdite : null} onClose={() => setContratEdite(null)} onSaved={() => { setContratEdite(null); charger() }} />}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/collaborateurs')}>Retour à l'annuaire</button>
    </div>
  )
}

// ─── Équipes ───
function Equipes({ peutGerer }) {
  const [liste, setListe] = useState(null)
  const [personnes, setPersonnes] = useState([])
  const [edite, setEdite] = useState(null)
  const charger = useCallback(() => {
    Promise.all([chargerEquipes(), chargerPersonnesChoix()]).then(([e, p]) => { setListe(e); setPersonnes(p) }).catch((err) => toast.error(err.message))
  }, [])
  useEffect(() => { charger() }, [charger])
  const enregistrer = async (e) => {
    e.preventDefault()
    try { await enregistrerEquipe({ ...edite, manager_person_id: edite.manager_person_id || null }); setEdite(null); charger() } catch (err) { toast.error(err.message) }
  }
  const supprimer = async (t) => {
    if (!(await confirmer(`Supprimer l'équipe « ${t.name} » ? Les contrats qui la citent restent, sans équipe.`))) return
    try { await supprimerEquipe(t.id); charger() } catch (err) { toast.error(err.message) }
  }
  if (!liste) return <Spinner />
  const nom = (id) => nomComplet(personnes.find((p) => p.id === id))
  return (
    <div className="space-y-3">
      {peutGerer && !edite && <button type="button" className="btn btn-secondary" onClick={() => setEdite({ name: '', manager_person_id: '' })}><Plus className="w-4 h-4" aria-hidden="true" />Ajouter une équipe</button>}
      {edite && (
        <form onSubmit={enregistrer} className="card grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end">
          <Champ label="Nom de l'équipe"><input className="input" required value={edite.name} onChange={(e) => setEdite({ ...edite, name: e.target.value })} /></Champ>
          <Champ label="Responsable">
            <select className="select" value={edite.manager_person_id || ''} onChange={(e) => setEdite({ ...edite, manager_person_id: e.target.value })}>
              <option value="">Aucun</option>{personnes.map((p) => <option key={p.id} value={p.id}>{nomComplet(p)}</option>)}
            </select>
          </Champ>
          <div className="flex gap-2"><button type="submit" className="btn btn-primary">Enregistrer</button><button type="button" className="btn btn-ghost" onClick={() => setEdite(null)}>Annuler</button></div>
        </form>
      )}
      {liste.length === 0 && !edite && <EmptyState icon={Users} title="Aucune équipe" compact>Une équipe regroupe des personnes et désigne leur responsable (il validera leurs absences et leurs heures).</EmptyState>}
      <ul className="divide-y divide-gray-100 card card-flush">
        {liste.map((t) => (
          <li key={t.id} className="px-4 py-3 flex items-center gap-3">
            <span className="flex-1 min-w-0"><span className="font-semibold text-ui">{t.name}</span>{t.manager_person_id && <span className="block text-ui-sm text-gray-600">Responsable : {nom(t.manager_person_id)}</span>}</span>
            {peutGerer && <button type="button" className="btn btn-ghost btn-icon" aria-label="Modifier l'équipe" onClick={() => setEdite(t)}><Pencil className="w-4 h-4" /></button>}
            {peutGerer && <button type="button" className="btn btn-ghost btn-icon" aria-label="Supprimer l'équipe" onClick={() => supprimer(t)}><Trash2 className="w-4 h-4" /></button>}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── Jours fériés (0311) ───
function JoursFeries({ peutConfigurer }) {
  const [annee, setAnnee] = useState(new Date().getFullYear())
  const [liste, setListe] = useState(null)
  const [ajout, setAjout] = useState(null)
  const charger = useCallback(() => { chargerFeries(annee).then(setListe) }, [annee])
  useEffect(() => { charger() }, [charger])
  const basculer = async (h) => { try { await marquerFerie(h.id, !h.is_worked); charger() } catch (e) { toast.error(e.message) } }
  const poser = async () => { try { const n = await poserFeriesAnnee(annee); toast.success(n ? `${n} jours fériés ajoutés` : 'Année déjà complète'); charger() } catch (e) { toast.error(e.message) } }
  const enregistrer = async (e) => {
    e.preventDefault()
    try { await ajouterFerie(ajout); setAjout(null); charger() } catch (err) { toast.error(err.message) }
  }
  const retirer = async (h) => {
    if (!(await confirmer(`Retirer « ${h.label} » du calendrier ?`))) return
    try { await supprimerFerie(h.id); charger() } catch (e) { toast.error(e.message) }
  }
  if (!liste) return <Spinner />
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">Jours fériés</h2>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAnnee(annee - 1)} aria-label="Année précédente">‹</button>
          <span className="font-semibold tabular-nums">{annee}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAnnee(annee + 1)} aria-label="Année suivante">›</button>
        </div>
      </div>
      <p className="text-ui-sm text-gray-600">Un jour férié ne compte pas dans les absences. Marquez « Travaillé » les jours où la société travaille (restaurant, journée de solidarité) : ils comptent alors comme des jours ouvrés.</p>
      {liste.length === 0 && (
        <EmptyState title={`Aucun jour férié pour ${annee}`} compact
          action={peutConfigurer ? <button type="button" className="btn btn-secondary" onClick={poser}><Plus className="w-4 h-4" aria-hidden="true" />Ajouter les jours fériés de {annee}</button> : null}>
          Les 11 jours fériés légaux se posent en un clic.
        </EmptyState>
      )}
      {liste.length > 0 && (
        <ul className="divide-y divide-gray-100 card card-flush">
          {liste.map((h) => (
            <li key={h.id} className="px-4 py-2 flex items-center gap-3">
              <span className="w-28 flex-none text-ui-sm text-gray-600 tabular-nums">{fr(h.day)}</span>
              <span className="flex-1 min-w-0 text-ui">{h.label}</span>
              {peutConfigurer ? (
                <label className="flex items-center gap-2 text-ui-sm min-h-[44px]">
                  <input type="checkbox" className="w-5 h-5" checked={h.is_worked} onChange={() => basculer(h)} />Travaillé
                </label>
              ) : (h.is_worked && <span className="badge badge-neutral">Travaillé</span>)}
              {peutConfigurer && <button type="button" className="btn btn-ghost btn-icon" aria-label={`Retirer ${h.label}`} onClick={() => retirer(h)}><Trash2 className="w-4 h-4" /></button>}
            </li>
          ))}
        </ul>
      )}
      {peutConfigurer && !ajout && liste.length > 0 && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAjout({ day: `${annee}-01-01`, label: '' })}><Plus className="w-4 h-4" aria-hidden="true" />Ajouter un jour non travaillé</button>
      )}
      {ajout && (
        <form onSubmit={enregistrer} className="card grid gap-3 sm:grid-cols-[10rem_1fr_auto] items-end">
          <Champ label="Date"><input className="input" type="date" required value={ajout.day} onChange={(e) => setAjout({ ...ajout, day: e.target.value })} /></Champ>
          <Champ label="Libellé"><input className="input" value={ajout.label} onChange={(e) => setAjout({ ...ajout, label: e.target.value })} placeholder="Pont, fermeture annuelle…" /></Champ>
          <div className="flex gap-2"><button type="submit" className="btn btn-primary">Ajouter</button><button type="button" className="btn btn-ghost" onClick={() => setAjout(null)}>Annuler</button></div>
        </form>
      )}
    </section>
  )
}

// ─── Horaires de référence ───
function Horaires({ peutConfigurer }) {
  const [liste, setListe] = useState(null)
  const [edite, setEdite] = useState(null) // { id?, name, textes: { lun: '08:30-12:30, ...' } }
  const charger = useCallback(() => { chargerHoraires().then(setListe).catch((e) => toast.error(e.message)) }, [])
  useEffect(() => { charger() }, [charger])
  const ouvrir = (h) => setEdite({ id: h?.id, name: h?.name || '', is_default: !!h?.is_default, textes: Object.fromEntries(JOURS.map(([k]) => [k, plagesVersTexte(h?.days?.[k])])) })
  const enregistrer = async (e) => {
    e.preventDefault()
    const days = {}
    for (const [k, label] of JOURS) {
      const p = texteVersPlages(edite.textes[k])
      if (p === null) { toast.error(`${label} : écrivez les plages ainsi : 08:30-12:30, 13:30-17:30`); return }
      if (p.length) days[k] = p
    }
    try { await enregistrerHoraire({ ...(edite.id ? { id: edite.id } : {}), name: edite.name, is_default: edite.is_default, days }); setEdite(null); charger() } catch (err) { toast.error(err.message) }
  }
  if (!liste) return <Spinner />
  return (
    <div className="space-y-3">
      <p className="text-ui-sm text-gray-600">L'horaire de référence sert aux heures et aux absences ; un contrat peut avoir le sien.</p>
      {peutConfigurer && !edite && <button type="button" className="btn btn-secondary" onClick={() => ouvrir(null)}><Plus className="w-4 h-4" aria-hidden="true" />Ajouter un horaire</button>}
      {edite && (
        <form onSubmit={enregistrer} className="card space-y-3">
          <Champ label="Nom"><input className="input" required value={edite.name} onChange={(e) => setEdite({ ...edite, name: e.target.value })} /></Champ>
          <div className="grid gap-2 sm:grid-cols-2">
            {JOURS.map(([k, label]) => (
              <Champ key={k} label={label}><input className="input" placeholder="Repos" value={edite.textes[k]} onChange={(e) => setEdite({ ...edite, textes: { ...edite.textes, [k]: e.target.value } })} /></Champ>
            ))}
          </div>
          <div className="flex gap-2"><button type="submit" className="btn btn-primary">Enregistrer</button><button type="button" className="btn btn-ghost" onClick={() => setEdite(null)}>Annuler</button></div>
        </form>
      )}
      <ul className="divide-y divide-gray-100 card card-flush">
        {liste.map((h) => (
          <li key={h.id} className="px-4 py-3 flex items-start gap-3">
            <Clock className="w-4 h-4 mt-1 text-gray-400 flex-none" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-ui">{h.name}{h.is_default && <span className="badge badge-neutral ml-2">Par défaut</span>}</div>
              <div className="text-ui-sm text-gray-600">{String(heuresSemaine(h.days)).replace('.', ',')} h par semaine · {JOURS.filter(([k]) => h.days?.[k]?.length).map(([, l]) => l.slice(0, 3).toLowerCase()).join(', ')}</div>
            </div>
            {peutConfigurer && <button type="button" className="btn btn-ghost btn-icon" aria-label="Modifier l'horaire" onClick={() => ouvrir(h)}><Pencil className="w-4 h-4" /></button>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Personnel() {
  const { can } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const peutGerer = can('rh.dossiers.gerer') === true
  const peutSalaires = can('rh.salaires.voir') === true
  const peutConfigurer = can('rh.parametres.gerer') === true
  const peutValider = can('rh.absences.valider') === true
  const peutVoirTout = can('rh.dossiers.voir') === true
  const peutRestreints = can('rh.documents.restreints') === true
  const chemin = location.pathname.replace(/^\/collaborateurs\/?/, '').split('/')[0]
  const [responsable, setResponsable] = useState(false)
  useEffect(() => { suisResponsable().then(setResponsable) }, [])
  // Responsable d'équipe (0312) : valide les absences et les semaines de son équipe, quel que soit son profil
  const peutValiderAbs = peutValider || responsable
  const peutValiderHeures = can('rh.heures.valider') === true || responsable
  const peutTableau = peutVoirTout || peutValiderAbs || peutValiderHeures
  const ONGLETS = ['tableau', 'mon-espace', 'absences', 'heures', 'equipes', 'horaires', 'registre']
  const onglet = ONGLETS.includes(chemin) ? chemin : 'annuaire'
  const enFiche = chemin && !ONGLETS.includes(chemin)
  const tabs = [
    ...(peutTableau ? [{ id: 'tableau', label: 'Tableau de bord' }] : []),
    { id: 'mon-espace', label: 'Mon espace' },
    { id: 'annuaire', label: 'Annuaire' }, { id: 'absences', label: 'Absences' }, { id: 'heures', label: 'Heures' },
    { id: 'equipes', label: 'Équipes' }, { id: 'horaires', label: 'Horaires' },
    ...(peutVoirTout ? [{ id: 'registre', label: 'Registre et paie' }] : []),
  ]

  return (
    <div className="space-y-4">
      {!enFiche && (
        <>
          <PageHeader eyebrow="Ressources humaines" title="Personnel" />
          <Tabs tabs={tabs}
            value={onglet} onChange={(id) => navigate(id === 'annuaire' ? '/collaborateurs' : `/collaborateurs/${id}`)} />
        </>
      )}
      <Routes>
        <Route index element={<Annuaire peutGerer={peutGerer} />} />
        {peutTableau && <Route path="tableau" element={<TableauRH peutValiderAbsences={peutValiderAbs} peutValiderHeures={peutValiderHeures} peutRestreints={peutRestreints} />} />}
        <Route path="mon-espace" element={<MonEspace />} />
        {peutVoirTout && <Route path="registre" element={<RegistrePaie />} />}
        <Route path="absences" element={<Absences peutValider={peutValiderAbs} peutVoirTout={peutVoirTout} peutConfigurer={peutConfigurer} />} />
        <Route path="heures" element={<Heures peutValider={peutValiderHeures} />} />
        <Route path="equipes" element={<Equipes peutGerer={peutGerer} />} />
        <Route path="horaires" element={<div className="space-y-6"><Horaires peutConfigurer={peutConfigurer} /><JoursFeries peutConfigurer={peutConfigurer} /></div>} />
        <Route path=":id" element={<FichePersonne peutGerer={peutGerer} peutSalaires={peutSalaires} peutRestreints={peutRestreints} />} />
      </Routes>
    </div>
  )
}
