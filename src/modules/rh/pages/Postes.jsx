// Postes et titres exigés (0513, idée n° 3 reprise d'Odoo, choix de H du 08/11) : chaque poste porte la liste des titres
// qu'il exige ; le poste se choisit sur le contrat. Chaque nuit, une action de l'équipe est préparée pour chaque titre qui
// manque ou finit dans moins de 3 mois, confiée au compte choisi ici. Rien n'est envoyé.

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { BadgeCheck, Pencil, Plus, Trash2, UserRound } from 'lucide-react'
import { EmptyState, Spinner } from '../../../ui/EmptyState'
import { confirmer } from '../../../ui/Confirm'
import { chargerEquipe, nomProfil } from '../../../core/point/actions'
import { TYPES_HABILITATION, SYMBOLES_HABILITATION, CATEGORIES_CONDUITE } from '../lib/rhDocuments'
import {
  libelleExigence, erreurNomPoste, chargerPostes, enregistrerPoste, supprimerPoste, ajouterExigence, modifierExigence, supprimerExigence,
  chargerResponsableTitres, enregistrerResponsableTitres,
} from '../lib/rhPostes'
import { MESURES_ISOLE, erreurTravailIsole, enregistrerTravailIsole, resumeTravailIsole } from '../lib/rhSecurite'

const SYMBOLES = { habilitation_electrique: SYMBOLES_HABILITATION, autorisation_conduite: CATEGORIES_CONDUITE }

function Champ({ label, children, className = '' }) {
  return <label className={`block ${className}`}><span className="label">{label}</span>{children}</label>
}

function AjoutExigence({ poste, exigence = null, onAjoute, onAnnule }) {
  const [v, setV] = useState(() => exigence
    ? { kind: exigence.required_kind, symboles: exigence.required_symbols || [], label: exigence.label }
    : { kind: 'habilitation_electrique', symboles: [], label: '' })
  const [busy, setBusy] = useState(false)
  const choix = SYMBOLES[v.kind] || []
  const basculer = (s) => setV({ ...v, symboles: v.symboles.includes(s) ? v.symboles.filter((x) => x !== s) : [...v.symboles, s] })
  const enregistrer = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (exigence) await modifierExigence({ id: exigence.id, kind: v.kind, symboles: v.symboles, label: v.label })
      else await ajouterExigence({ jobId: poste.id, kind: v.kind, symboles: v.symboles, label: v.label })
      onAjoute()
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  return (
    <form onSubmit={enregistrer} className="space-y-3 border-t border-gray-100 pt-3">
      <Champ label="Type de titre">
        <select className="select" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value, symboles: [] })}>
          {Object.entries(TYPES_HABILITATION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Champ>
      {choix.length > 0 && (
        <fieldset>
          <legend className="text-ui-sm text-gray-700 mb-1">{v.kind === 'autorisation_conduite' ? 'Catégories acceptées' : 'Symboles acceptés'} (un seul suffit ; aucun coché : tout titre de ce type)</legend>
          <div className="flex flex-wrap gap-2">
            {choix.map((s) => (
              <button key={s} type="button" aria-pressed={v.symboles.includes(s)} onClick={() => basculer(s)}
                className={`btn btn-sm min-h-[44px] ${v.symboles.includes(s) ? 'btn-primary' : 'btn-secondary'}`}>{s}</button>
            ))}
          </div>
        </fieldset>
      )}
      <Champ label="Libellé">
        <input className="input" value={v.label} maxLength={200} onChange={(e) => setV({ ...v, label: e.target.value })} placeholder={libelleExigence(v.kind, v.symboles)} />
      </Champ>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy}>{exigence ? 'Enregistrer' : 'Ajouter ce titre'}</button>
        <button type="button" className="btn btn-ghost" onClick={onAnnule}>Annuler</button>
      </div>
    </form>
  )
}

// Travail isolé du poste (0522, choix de H du 18/11 : saisi sur le poste). Code du travail L4121-1 et R4512-13.
function TravailIsole({ poste, peutConfigurer, onChange }) {
  const [v, setV] = useState(null)
  const [busy, setBusy] = useState(false)
  const ouvrir = () => setV({
    lone_work: !!poste.lone_work, lone_work_measures: poste.lone_work_measures || [],
    lone_work_note: poste.lone_work_note || '', lone_work_duerp_ref: poste.lone_work_duerp_ref || '',
  })
  const basculer = (k) => setV({ ...v, lone_work_measures: v.lone_work_measures.includes(k) ? v.lone_work_measures.filter((x) => x !== k) : [...v.lone_work_measures, k] })
  const enregistrer = async (e) => {
    e.preventDefault()
    const err = erreurTravailIsole(v)
    if (err) return toast.error(err)
    setBusy(true)
    try { await enregistrerTravailIsole(poste.id, v); setV(null); onChange() } catch (er) { toast.error(er.message) }
    setBusy(false)
  }
  const sansMesure = poste.lone_work && !(poste.lone_work_measures || []).length
  if (!v) {
    return (
      <div className="flex items-start gap-2 border-t border-gray-100 pt-2">
        <UserRound className="w-4 h-4 mt-0.5 text-gray-400 flex-none" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <span className={`text-ui-sm ${sansMesure ? 'text-[rgb(var(--c-danger))] font-medium' : 'text-gray-700'}`}>{resumeTravailIsole(poste)}</span>
          {poste.lone_work && poste.lone_work_duerp_ref && <span className="block text-ui-sm muted">Document unique : {poste.lone_work_duerp_ref}</span>}
        </div>
        {peutConfigurer && <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" aria-label={`Travail isolé du poste ${poste.name}`} onClick={ouvrir}>Travail isolé</button>}
      </div>
    )
  }
  return (
    <form onSubmit={enregistrer} className="space-y-3 border-t border-gray-100 pt-3">
      <label className="flex items-center gap-2 min-h-[44px]">
        <input type="checkbox" className="w-5 h-5" checked={v.lone_work} onChange={(e) => setV({ ...v, lone_work: e.target.checked })} />
        <span className="text-ui">Ce poste peut travailler seul (hors de vue ou de portée de voix d'autres personnes)</span>
      </label>
      {v.lone_work && (
        <>
          <fieldset>
            <legend className="text-ui-sm text-gray-700 mb-1">Mesures retenues pour pouvoir donner l'alerte et être secouru</legend>
            {Object.entries(MESURES_ISOLE).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 min-h-[44px]">
                <input type="checkbox" className="w-5 h-5" checked={v.lone_work_measures.includes(k)} onChange={() => basculer(k)} />
                <span className="text-ui">{l}</span>
              </label>
            ))}
          </fieldset>
          <Champ label={v.lone_work_measures.includes('autre') ? 'Précision (obligatoire pour « autre »)' : 'Précision (facultatif)'}>
            <textarea className="input" rows={2} maxLength={1000} value={v.lone_work_note} onChange={(e) => setV({ ...v, lone_work_note: e.target.value })} />
          </Champ>
          <Champ label="Ligne du document unique (facultatif)">
            <input className="input" maxLength={200} value={v.lone_work_duerp_ref} onChange={(e) => setV({ ...v, lone_work_duerp_ref: e.target.value })} placeholder="Unité de travail, risque" />
          </Champ>
          {v.lone_work_measures.includes('dati') && <p className="text-ui-sm muted">Le DATI se remet par « Remettre un EPI » sur la fiche de la personne (article du stock marqué DATI).</p>}
        </>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary min-h-[44px]" disabled={busy}>Enregistrer</button>
        <button type="button" className="btn btn-ghost min-h-[44px]" onClick={() => setV(null)}>Annuler</button>
      </div>
    </form>
  )
}

function CartePoste({ poste, postes, peutConfigurer, onChange }) {
  const [nom, setNom] = useState(null)
  const [ajout, setAjout] = useState(false)
  const [modifiee, setModifiee] = useState(null)
  const exigences = [...(poste.hr_job_requirements || [])].sort((a, b) => a.label.localeCompare(b.label, 'fr'))
  const renommer = async (e) => {
    e.preventDefault()
    const err = erreurNomPoste(nom, postes, poste.id)
    if (err) return toast.error(err)
    try { await enregistrerPoste({ id: poste.id, name: nom }); setNom(null); onChange() } catch (er) { toast.error(er.message) }
  }
  const supprimer = async () => {
    if (!(await confirmer(`Supprimer le poste « ${poste.name} » et ses titres exigés ? Les contrats qui le citent restent, sans poste, et la nuit ne préparera plus d'action pour lui.`))) return
    try { await supprimerPoste(poste.id); onChange() } catch (er) { toast.error(er.message) }
  }
  const retirer = async (x) => {
    if (!(await confirmer(`Ne plus exiger « ${x.label} » pour le poste « ${poste.name} » ? Pour changer seulement le libellé, utilisez plutôt « Modifier » : retirer puis remettre un titre fait revenir les actions déjà traitées.`))) return
    try { await supprimerExigence(x.id); onChange() } catch (er) { toast.error(er.message) }
  }
  return (
    <li className="card space-y-2">
      {nom === null ? (
        <div className="flex items-center gap-2">
          <h3 className="flex-1 min-w-0 font-semibold text-ui">{poste.name}</h3>
          {peutConfigurer && <button type="button" className="btn btn-ghost btn-icon" aria-label={`Renommer le poste ${poste.name}`} onClick={() => setNom(poste.name)}><Pencil className="w-4 h-4" /></button>}
          {peutConfigurer && <button type="button" className="btn btn-ghost btn-icon" aria-label={`Supprimer le poste ${poste.name}`} onClick={supprimer}><Trash2 className="w-4 h-4" /></button>}
        </div>
      ) : (
        <form onSubmit={renommer} className="flex flex-wrap items-end gap-2">
          <Champ label="Nom du poste" className="flex-1 min-w-[12rem]"><input className="input" required maxLength={100} value={nom} onChange={(e) => setNom(e.target.value)} /></Champ>
          <button type="submit" className="btn btn-primary">Enregistrer</button>
          <button type="button" className="btn btn-ghost" onClick={() => setNom(null)}>Annuler</button>
        </form>
      )}
      {exigences.length === 0
        ? <p className="text-ui-sm text-gray-600">Aucun titre exigé pour ce poste.</p>
        : (
          <ul className="divide-y divide-gray-100">
            {exigences.map((x) => (modifiee === x.id ? (
              <li key={x.id} className="py-2">
                <AjoutExigence poste={poste} exigence={x} onAjoute={() => { setModifiee(null); onChange() }} onAnnule={() => setModifiee(null)} />
              </li>
            ) : (
              <li key={x.id} className="py-2 flex items-center gap-2">
                <BadgeCheck className="w-4 h-4 text-gray-400 flex-none" aria-hidden="true" />
                <span className="flex-1 min-w-0 text-ui">{x.label}</span>
                {peutConfigurer && <button type="button" className="btn btn-ghost btn-icon" aria-label={`Modifier ${x.label}`} onClick={() => { setAjout(false); setModifiee(x.id) }}><Pencil className="w-4 h-4" /></button>}
                {peutConfigurer && <button type="button" className="btn btn-ghost btn-icon" aria-label={`Ne plus exiger ${x.label}`} onClick={() => retirer(x)}><Trash2 className="w-4 h-4" /></button>}
              </li>
            )))}
          </ul>
        )}
      <TravailIsole poste={poste} peutConfigurer={peutConfigurer} onChange={onChange} />
      {peutConfigurer && !ajout && <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => setAjout(true)}><Plus className="w-4 h-4" aria-hidden="true" />Exiger un titre</button>}
      {ajout && <AjoutExigence poste={poste} onAjoute={() => { setAjout(false); onChange() }} onAnnule={() => setAjout(false)} />}
    </li>
  )
}

export default function Postes({ peutConfigurer }) {
  const [postes, setPostes] = useState(null)
  const [equipe, setEquipe] = useState([])
  const [responsable, setResponsable] = useState('')
  const [nouveau, setNouveau] = useState(null)
  const charger = useCallback(() => {
    chargerPostes().then(setPostes).catch((e) => { setPostes([]); toast.error(e.message) })
  }, [])
  useEffect(() => {
    charger()
    chargerEquipe().then(setEquipe).catch(() => {})
    chargerResponsableTitres().then((id) => setResponsable(id || '')).catch(() => {})
  }, [charger])
  const changerResponsable = async (id) => {
    const avant = responsable
    setResponsable(id)
    try { await enregistrerResponsableTitres(id); toast.success(id ? 'Responsable enregistré' : 'Plus de responsable désigné') } catch (e) { setResponsable(avant); toast.error(e.message) }
  }
  const creer = async (e) => {
    e.preventDefault()
    const err = erreurNomPoste(nouveau, postes)
    if (err) return toast.error(err)
    try { await enregistrerPoste({ name: nouveau }); setNouveau(null); charger() } catch (er) { toast.error(er.message) }
  }
  if (!postes) return <Spinner />
  const nomResponsable = nomProfil(equipe.find((p) => p.id === responsable))
  return (
    <div className="space-y-4">
      <p className="text-ui-sm text-gray-600">
        Indiquez pour chaque poste (technicien, formateur…) les titres qu'il exige, puis choisissez le poste sur le contrat de chaque personne.
        Chaque nuit, une action est ajoutée aux actions de l'équipe pour chaque titre qui manque ou se termine dans moins de 3 mois. Rien n'est envoyé.
      </p>
      <section className="card space-y-2">
        <h2 className="section-title">À qui confier ces actions</h2>
        {peutConfigurer ? (
          <Champ label="Responsable des titres">
            <select className="select" value={responsable} onChange={(e) => changerResponsable(e.target.value)}>
              <option value="">Personne en particulier</option>
              {equipe.map((p) => <option key={p.id} value={p.id}>{nomProfil(p)}</option>)}
            </select>
          </Champ>
        ) : <p className="text-ui">{responsable ? nomResponsable || 'Membre de l\'équipe' : 'Personne en particulier'}</p>}
      </section>
      {peutConfigurer && nouveau === null && <button type="button" className="btn btn-secondary" onClick={() => setNouveau('')}><Plus className="w-4 h-4" aria-hidden="true" />Ajouter un poste</button>}
      {nouveau !== null && (
        <form onSubmit={creer} className="card flex flex-wrap items-end gap-2">
          <Champ label="Nom du poste" className="flex-1 min-w-[12rem]"><input className="input" required maxLength={100} value={nouveau} onChange={(e) => setNouveau(e.target.value)} placeholder="Technicien de maintenance, formateur…" /></Champ>
          <button type="submit" className="btn btn-primary">Ajouter</button>
          <button type="button" className="btn btn-ghost" onClick={() => setNouveau(null)}>Annuler</button>
        </form>
      )}
      {postes.length === 0 && nouveau === null && (
        <EmptyState icon={BadgeCheck} title="Aucun poste" compact>Créez vos postes (par exemple technicien et formateur) et les titres que chacun exige : habilitation électrique, SST, autorisation de conduite…</EmptyState>
      )}
      <ul className="space-y-3">
        {postes.map((p) => <CartePoste key={p.id} poste={p} postes={postes} peutConfigurer={peutConfigurer} onChange={charger} />)}
      </ul>
    </div>
  )
}
