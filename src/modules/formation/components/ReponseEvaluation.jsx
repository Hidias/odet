// Réponses aux évaluations figées dès leur réception (0481) : la saisie d'une réponse papier se fait en une fois ;
// une réponse reçue ne se modifie plus, sauf correction par le super administrateur avec un motif (trace au journal).
import { useState } from 'react'
import { Lock, Pencil, Save, Trash2, X } from 'lucide-react'

export const CHAMPS_EVALUATION = {
  chaud: ['q_org_documents', 'q_org_accueil', 'q_org_locaux', 'q_org_materiel', 'q_contenu_organisation', 'q_contenu_supports',
    'q_contenu_duree', 'q_contenu_programme', 'q_formateur_pedagogie', 'q_formateur_expertise', 'q_formateur_progression',
    'q_formateur_moyens', 'q_global_adequation', 'q_global_competences', 'would_recommend', 'comment_general', 'comment_projet'],
  froid: ['skills_applied', 'objectives_met', 'knowledge_retained', 'job_impact', 'would_recommend'],
  formateur: ['group_motivation', 'group_level', 'material_conditions', 'organization', 'documentation', 'overall_score', 'comments'],
}

// Réponse reçue ? (mêmes critères que la base)
export function evaluationRecue(type, row) {
  if (!row) return false
  if (type === 'chaud') return !!row.questionnaire_submitted
  if (type === 'froid') return !!row.completed_at
  return !!row.submitted_at
}

// Réponses à envoyer : seules les clés du type, valeurs vides en null
export function reponsesDe(type, row) {
  const out = {}
  for (const k of CHAMPS_EVALUATION[type]) {
    const v = row?.[k]
    out[k] = v === undefined || v === '' ? null : v
  }
  return out
}

const dateCourte = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '')

// Mention de l'état d'une réponse : reçue (en ligne ou saisie), avec la date
export function EtatReponse({ type, row }) {
  if (!evaluationRecue(type, row)) return null
  const date = type === 'chaud' ? row.submitted_at || row.updated_at : type === 'froid' ? row.completed_at : row.submitted_at
  const mode = type === 'formateur' ? '' : row.saisi_par ? ', saisie sur papier' : type === 'chaud' && row.submitted_online ? ', en ligne' : ''
  return (
    <span className="inline-flex items-center gap-1 text-ui-sm text-gray-600" title="Réponse reçue : elle ne se modifie plus">
      <Lock className="w-3.5 h-3.5" />Reçue{date ? ` le ${dateCourte(date)}` : ''}{mode}
    </span>
  )
}

// Barre d'action sous une réponse en cours de saisie ou de correction
export function BarreReponse({ correction, onEnregistrer, onAnnuler, onSupprimer, enCours }) {
  const [motif, setMotif] = useState('')
  const motifOk = !correction || motif.trim().length >= 5
  return (
    <div className="flex flex-wrap items-center gap-2 mt-3">
      {correction && (
        <input className="input text-ui flex-1 min-w-[14rem]" value={motif} onChange={(e) => setMotif(e.target.value)}
          placeholder="Motif de la correction (obligatoire, gardé au journal)" maxLength={500} />
      )}
      <button type="button" className="btn btn-primary btn-sm flex items-center gap-1" disabled={!motifOk || enCours} onClick={() => onEnregistrer(correction ? motif.trim() : null)}>
        <Save className="w-4 h-4" />{correction ? 'Enregistrer la correction' : 'Enregistrer la réponse reçue'}
      </button>
      <button type="button" className="btn btn-secondary btn-sm flex items-center gap-1" disabled={enCours} onClick={onAnnuler}>
        <X className="w-4 h-4" />Annuler
      </button>
      {correction && onSupprimer && (
        <button type="button" className="btn btn-secondary btn-sm flex items-center gap-1 text-[rgb(var(--c-danger))]" disabled={!motifOk || enCours} onClick={() => onSupprimer(motif.trim())}>
          <Trash2 className="w-4 h-4" />Supprimer la réponse
        </button>
      )}
      {!correction && <span className="text-ui-sm text-gray-500">Une fois enregistrée, la réponse ne se modifie plus.</span>}
    </div>
  )
}

// Bouton d'ouverture : saisir une réponse reçue, ou corriger (super administrateur)
export function BoutonReponse({ recue, superAdmin, peutSaisir, onOuvrir }) {
  if (recue) {
    if (!superAdmin) return null
    return <button type="button" className="btn btn-secondary btn-sm flex items-center gap-1" onClick={onOuvrir}><Pencil className="w-4 h-4" />Corriger</button>
  }
  if (!peutSaisir) return null
  return <button type="button" className="btn btn-secondary btn-sm flex items-center gap-1" onClick={onOuvrir}><Pencil className="w-4 h-4" />Saisir la réponse reçue</button>
}
