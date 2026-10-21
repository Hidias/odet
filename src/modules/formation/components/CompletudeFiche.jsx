import { CheckCircle2, Sparkles, AlertTriangle } from 'lucide-react'

// Fiche formation complète pour la convention, le programme et la déclaration d'activité (article D6353-1 : intitulé,
// objectifs, contenu, moyens, durée, modalités de suivi et d'évaluation ; DREETS : contenu, organisation, moyens
// techniques et pédagogiques). Pour chaque champ vide, une proposition à utiliser (0434) : celle préparée pour cette
// formation, sinon le texte type de son thème. Rien n'est appliqué sans un clic, et l'on garde la main sur le texte.

export const CHAMPS_FICHE = [
  ['objectives', 'Objectifs'],
  ['content', 'Contenu (programme)'],
  ['duration', 'Durée'],
  ['target_audience', 'Public visé'],
  ['prerequisites', 'Prérequis'],
  ['methods', 'Moyens pédagogiques'],
  ['trainer_equipment', 'Moyens techniques'],
  ['material', 'À prévoir par le stagiaire'],
  ['evaluation_methods', "Modalités d'évaluation"],
]

const vide = (v) => v === null || v === undefined || String(v).trim() === ''

/** Champs vides d'une fiche (clés du formulaire ou de la base : content et program sont le même champ) */
export function champsManquants(f) {
  return CHAMPS_FICHE.filter(([k]) => vide(k === 'content' ? (f.content ?? f.program) : k === 'duration' ? (f.duration ?? f.duration_hours) : f[k])).map(([k]) => k)
}

export default function CompletudeFiche({ form, setForm, propositions, modele }) {
  const manquants = champsManquants(form)
  const proposition = (k) => (propositions && !vide(propositions[k]) ? propositions[k] : modele && !vide(modele[k]) ? modele[k] : null)
  const avecProposition = manquants.filter((k) => proposition(k))
  const alerte = propositions?.alerte

  if (!manquants.length && !alerte) {
    return (
      <p className="text-ui-sm text-[rgb(var(--c-success))] flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" aria-hidden="true" />
        Fiche complète pour la convention, le programme et la déclaration d'activité.</p>
    )
  }
  return (
    <div className="rounded-ui border border-[rgb(var(--c-warning)/0.4)] bg-[rgb(var(--c-warning-bg))] p-3 space-y-2">
      <p className="text-ui font-medium text-gray-900 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-[rgb(var(--c-warning))]" aria-hidden="true" />
        {manquants.length ? `À compléter pour la convention et la déclaration d'activité : ${manquants.map((k) => CHAMPS_FICHE.find(([c]) => c === k)[1].toLowerCase()).join(', ')}.` : 'Point à vérifier.'}</p>
      {alerte && <p className="text-ui-sm text-gray-700">{alerte}</p>}
      {avecProposition.map((k) => (
        <div key={k} className="rounded-ui-sm bg-white border border-gray-200 p-2 text-ui-sm">
          <p className="font-medium text-gray-800 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-accent-600" aria-hidden="true" />Proposition : {CHAMPS_FICHE.find(([c]) => c === k)[1]}</p>
          <p className="text-gray-600 whitespace-pre-line mt-0.5">{proposition(k)}</p>
          <button type="button" className="btn btn-secondary btn-sm mt-1.5" onClick={() => setForm((f) => ({ ...f, [k]: proposition(k) }))}>Utiliser ce texte</button>
        </div>
      ))}
      {avecProposition.length > 1 && (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setForm((f) => ({ ...f, ...Object.fromEntries(avecProposition.map((k) => [k, proposition(k)])) }))}>Utiliser toutes les propositions</button>
      )}
      <p className="text-ui-sm text-gray-500">Relisez et adaptez avant d'enregistrer : le texte apparaît tel quel sur la convention et le programme.</p>
    </div>
  )
}
