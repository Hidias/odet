// Contrat écrit et avenants (0523), dans la carte d'un contrat de la fiche du personnel : générer le PDF depuis le
// modèle de la société, déposer le signé (scan, choix de H du 18/11), noter la remise au salarié.
// Modèle « projet » : PDF marqué PROJET, téléchargé seulement. Modèle validé par l'avocat : PDF rangé dans les documents.

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FileText, Upload, Plus, Trash2 } from 'lucide-react'
import { Sheet } from '../../../ui/Sheet'
import { confirmer } from '../../../ui/Confirm'
import { ouvrirDocument, TYPES_FICHIER } from '../lib/rhDocuments'
import { societeEnCours } from '../../../core/company/societes'
import {
  modelePour, preparer, generer, deposerSigne, marquerContratRemis, marquerAvenantRemis,
  chargerAvenants, enregistrerAvenant, supprimerAvenant, erreurAvenant,
} from '../lib/rhContrats'

const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const aujourdhui = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function Champ({ label, children }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>
}

/** Bouton « Déposer le … signé » : choix du fichier puis dépôt */
function DeposerSigne({ label, onFichier }) {
  const [busy, setBusy] = useState(false)
  return (
    <label className={`btn btn-ghost btn-sm min-h-[44px] ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
      <Upload className="w-4 h-4" aria-hidden="true" />{label}
      <input type="file" accept={TYPES_FICHIER} className="sr-only" onChange={async (e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file) return
        setBusy(true)
        try { await onFichier(file) } catch (er) { toast.error(er.message) }
        setBusy(false)
      }} />
    </label>
  )
}

/** Remis le : date notée, modifiable */
function RemisLe({ valeur, onEnregistrer, peutGerer, aide }) {
  const [v, setV] = useState(null)
  if (!peutGerer) return valeur ? <span>Remis le {fr(valeur)}</span> : null
  if (v !== null) {
    return (
      <span className="inline-flex items-end gap-1 flex-wrap">
        <Champ label="Remis au salarié le"><input className="input" type="date" value={v} max={aujourdhui()} onChange={(e) => setV(e.target.value)} /></Champ>
        <button type="button" className="btn btn-primary btn-sm min-h-[44px]" onClick={async () => {
          try { await onEnregistrer(v || null); setV(null) } catch (er) { toast.error(er.message) }
        }}>Enregistrer</button>
        <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" onClick={() => setV(null)}>Annuler</button>
      </span>
    )
  }
  return (
    <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" title={aide} onClick={() => setV(valeur || aujourdhui())}>
      {valeur ? `Remis le ${fr(valeur)}` : 'Noter la remise'}
    </button>
  )
}

/** Mentions à compléter avant de générer */
function Manques({ liste, onClose }) {
  return (
    <div className="rounded-ui-sm border border-amber-300 bg-amber-50 p-3 text-ui-sm space-y-1" role="alert">
      <div className="font-semibold">Mentions obligatoires à compléter avant de générer :</div>
      <ul className="list-disc pl-5">{liste.map((m) => <li key={m}>{m}</li>)}</ul>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Fermer</button>
    </div>
  )
}

function AvenantSheet({ contrat, avenant = null, onClose, onSaved }) {
  const [v, setV] = useState(() => ({
    effective_on: avenant?.effective_on || aujourdhui(), subject: avenant?.subject || '',
    changes: avenant?.changes?.length ? avenant.changes : [{ label: '', before: '', after: '' }],
  }))
  const [busy, setBusy] = useState(false)
  const ligne = (i, k) => (e) => setV({ ...v, changes: v.changes.map((c, j) => (j === i ? { ...c, [k]: e.target.value } : c)) })
  const enregistrer = async (e) => {
    e.preventDefault()
    const err = erreurAvenant(v)
    if (err) return toast.error(err)
    setBusy(true)
    try { await enregistrerAvenant({ ...v, id: avenant?.id, employment_id: contrat.id }); toast.success('Avenant enregistré'); onSaved() } catch (er) { toast.error(er.message) }
    setBusy(false)
  }
  return (
    <Sheet title={avenant ? 'Modifier l\'avenant' : 'Nouvel avenant'} onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="submit" form="rh-avenant" className="btn btn-primary" disabled={busy}>Enregistrer</button></>}>
      <form id="rh-avenant" onSubmit={enregistrer} className="space-y-3">
        <p className="text-ui-sm text-gray-600">L'avenant ne reprend que ce qui change. Une modification d'un élément essentiel (rémunération, durée du travail, qualification) demande l'accord du salarié.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ label="Date d'effet"><input className="input" type="date" required value={v.effective_on} onChange={(e) => setV({ ...v, effective_on: e.target.value })} /></Champ>
          <Champ label="Objet"><input className="input" required maxLength={500} value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} placeholder="Passage à 39 heures, changement de poste…" /></Champ>
        </div>
        {v.changes.map((c, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] items-end rounded-ui-sm border border-gray-200 p-2">
            <Champ label="Disposition"><input className="input" maxLength={200} value={c.label} onChange={ligne(i, 'label')} placeholder="Durée du travail" /></Champ>
            <Champ label="Avant"><input className="input" maxLength={1000} value={c.before} onChange={ligne(i, 'before')} /></Champ>
            <Champ label="Après"><input className="input" maxLength={1000} value={c.after} onChange={ligne(i, 'after')} /></Champ>
            <button type="button" className="btn btn-ghost btn-icon min-h-[44px]" aria-label="Retirer la ligne" disabled={v.changes.length === 1}
              onClick={() => setV({ ...v, changes: v.changes.filter((_, j) => j !== i) })}><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        {v.changes.length < 20 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setV({ ...v, changes: [...v.changes, { label: '', before: '', after: '' }] })}>
            <Plus className="w-4 h-4" aria-hidden="true" />Ajouter une ligne
          </button>
        )}
      </form>
    </Sheet>
  )
}

export default function ContratEcrit({ personne, contrat, peutGerer, peutContratsVoir, onChange }) {
  const [manque, setManque] = useState(null)
  const [busy, setBusy] = useState(false)
  const [avenants, setAvenants] = useState([])
  const [edite, setEdite] = useState(null)
  // Générer, déposer, tenir les avenants : « Voir les contrats de travail » (RH, Super administrateur, Direction)
  const peutContrats = peutGerer && peutContratsVoir
  const avecModele = !!modelePour(contrat.contract_type)
  const charger = useCallback(() => {
    if (!peutContratsVoir) return
    chargerAvenants(contrat.id).then(setAvenants).catch(() => setAvenants([]))
  }, [contrat.id, peutContratsVoir])
  useEffect(() => { charger() }, [charger])
  if (!peutGerer && !contrat.signed_document_id && !contrat.contract_handed_on) return null

  const lancer = async (avenant = null) => {
    setBusy(true)
    try {
      const prep = await preparer({ personne, contrat, avenant, societeEcran: societeEnCours() })
      if (prep.erreur) toast.error(prep.erreur)
      else if (prep.manque.length) setManque(prep.manque)
      else {
        const r = await generer({ personne, contrat, avenant, prep })
        toast.success(r.range ? 'PDF rangé dans les documents, à faire signer' : 'PDF « PROJET » téléchargé : modèle non validé par l\'avocat, ne pas le remettre au salarié')
        if (r.range) { onChange?.(); charger() }
      }
    } catch (er) { toast.error(er.message) }
    setBusy(false)
  }
  const deposer = (avenant = null) => async (file) => {
    await deposerSigne({ companyId: personne.company_id, personId: personne.id, contrat, avenant, file })
    toast.success('Document signé rangé')
    if (avenant) charger(); else onChange?.()
  }
  const supprimer = async (a) => {
    if (!(await confirmer('Supprimer cet avenant saisi par erreur ? Ses documents restent dans les documents RH.'))) return
    try { await supprimerAvenant(a.id); charger() } catch (er) { toast.error(er.message) }
  }

  return (
    <div className="border-t hairline pt-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-ui-sm">
        <span className="font-semibold">Contrat écrit</span>
        {contrat.signed_document_id
          ? <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" onClick={() => ouvrirDocument(contrat.signed_document_id).catch((e) => toast.error(e.message))}><FileText className="w-4 h-4" aria-hidden="true" />Contrat signé</button>
          : <span className="badge badge-warning">Signé : à déposer</span>}
        <RemisLe valeur={contrat.contract_handed_on} peutGerer={peutGerer}
          aide={contrat.contract_type === 'cdd' ? 'CDD : à remettre au plus tard dans les deux jours ouvrables suivant l\'embauche (L1242-13)' : 'Informations principales à remettre au plus tard le 7e jour suivant l\'embauche (R1221-35)'}
          onEnregistrer={async (jour) => { await marquerContratRemis(contrat.id, jour); onChange?.() }} />
        {peutContrats && avecModele && (
          <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" disabled={busy} onClick={() => lancer()}>
            <FileText className="w-4 h-4" aria-hidden="true" />Générer le contrat
          </button>
        )}
        {peutContrats && <DeposerSigne label="Déposer le contrat signé" onFichier={deposer()} />}
        {peutContrats && (
          <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" onClick={() => setEdite({})}><Plus className="w-4 h-4" aria-hidden="true" />Avenant</button>
        )}
      </div>
      {peutGerer && !avecModele && <p className="text-ui-sm muted">Pas de modèle pour ce type de contrat : déposez le contrat signé.</p>}
      {peutGerer && !peutContratsVoir && <p className="text-ui-sm muted">Générer, déposer un contrat et tenir les avenants demande le droit « Voir les contrats de travail » (ils contiennent la rémunération).</p>}
      {manque && <Manques liste={manque} onClose={() => setManque(null)} />}
      {avenants.length > 0 && (
        <ul className="space-y-1">
          {avenants.map((a) => (
            <li key={a.id} className="flex items-center gap-2 flex-wrap text-ui-sm rounded-ui-sm bg-gray-50 px-2 py-1">
              <span className="flex-1 min-w-[10rem]">Avenant du {fr(a.effective_on)} : {a.subject}</span>
              {a.signed_document_id
                ? <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" onClick={() => ouvrirDocument(a.signed_document_id).catch((e) => toast.error(e.message))}><FileText className="w-4 h-4" aria-hidden="true" />Signé</button>
                : <span className="badge badge-warning">À signer</span>}
              <RemisLe valeur={a.handed_on} peutGerer={peutContrats} aide="Avenant remis au salarié" onEnregistrer={async (jour) => { await marquerAvenantRemis(a.id, jour); charger() }} />
              {peutContrats && !a.signed_document_id && <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" onClick={() => setEdite(a)}>Modifier</button>}
              {peutContrats && !a.signed_document_id && <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" disabled={busy} onClick={() => lancer(a)}>Générer</button>}
              {peutContrats && !a.signed_document_id && <DeposerSigne label="Déposer le signé" onFichier={deposer(a)} />}
              {peutContrats && !a.signed_document_id && <button type="button" className="btn btn-ghost btn-icon min-h-[44px]" aria-label="Supprimer l'avenant" onClick={() => supprimer(a)}><Trash2 className="w-4 h-4" /></button>}
            </li>
          ))}
        </ul>
      )}
      {edite && <AvenantSheet contrat={contrat} avenant={edite.id ? edite : null} onClose={() => setEdite(null)} onSaved={() => { setEdite(null); charger() }} />}
    </div>
  )
}
