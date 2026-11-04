// Évaluation à froid (0482) : questionnaire du stagiaire (portail, lien de la session et code personnel) et de
// l'employeur (espace entreprise). Une réponse envoyée est figée : elle ne se modifie plus.
import { useEffect, useState } from 'react'
import { CheckCircle, Clock, Loader2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { reponsesCompletes } from '../../qualite/lib/froid'

const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '')

export function QuestionnaireFroid({ questions, onEnvoyer, onAnnuler, busy, erreur }) {
  const [rep, setRep] = useState({})
  const complet = reponsesCompletes(questions, rep)
  return (
    <div className="space-y-4">
      {(questions || []).map((q) => (
        <div key={q.cle}>
          <p className="font-medium text-gray-900 mb-2">{q.libelle}{q.type === 'texte' ? <span className="text-gray-400 font-normal"> (facultatif)</span> : null}</p>
          {q.type === 'oui_non' && (
            <div className="flex gap-2">
              {[[true, 'Oui'], [false, 'Non']].map(([v, l]) => (
                <button key={l} type="button" onClick={() => setRep((r) => ({ ...r, [q.cle]: v }))}
                  className={`flex-1 py-3 rounded-ui font-medium border-2 ${rep[q.cle] === v ? 'border-accent-500 bg-accent-50 text-accent-800' : 'border-gray-100 bg-white text-gray-700'}`}>{l}</button>
              ))}
            </div>
          )}
          {q.type === 'note' && (
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setRep((r) => ({ ...r, [q.cle]: n }))}
                  className={`flex-1 py-3 rounded-ui font-medium border-2 ${rep[q.cle] === n ? 'border-accent-500 bg-accent-50 text-accent-800' : 'border-gray-100 bg-white text-gray-700'}`}>{n}</button>
              ))}
            </div>
          )}
          {q.type === 'texte' && (
            <textarea className="input" rows={3} maxLength={2000} value={rep[q.cle] || ''} onChange={(e) => setRep((r) => ({ ...r, [q.cle]: e.target.value }))} />
          )}
        </div>
      ))}
      {erreur && <p className="text-ui-sm text-[rgb(var(--c-danger))]">{erreur}</p>}
      <div className="flex gap-2">
        {onAnnuler && <button type="button" className="btn btn-secondary flex-1" onClick={onAnnuler} disabled={busy}>Retour</button>}
        <button type="button" className="btn btn-primary flex-1 flex items-center justify-center gap-2" disabled={!complet || busy}
          onClick={() => onEnvoyer(Object.fromEntries(Object.entries(rep).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v])))}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}Envoyer mes réponses
        </button>
      </div>
      <p className="text-ui-sm text-gray-500">Une fois envoyées, vos réponses ne se modifient plus.</p>
    </div>
  )
}

// Carte du portail stagiaire : visible dès que le questionnaire est ouvert (délai après la formation, ou mail reçu)
export default function EvaluationFroidPortail({ token, traineeId, ticket, Carte }) {
  const [etat, setEtat] = useState(null)
  const [ouvert, setOuvert] = useState(false)
  const [busy, setBusy] = useState(false)
  const [erreur, setErreur] = useState('')
  useEffect(() => {
    if (!token || !traineeId) return
    let actif = true
    supabase.rpc('portail_froid', { p_token: token, p_trainee_id: traineeId, p_ticket: ticket || null }).then(({ data, error }) => {
      if (actif && !error) setEtat(data)
    })
    return () => { actif = false }
  }, [token, traineeId, ticket])
  if (!etat || (!etat.ouvert && !etat.recue)) return null
  const envoyer = async (reponses) => {
    setBusy(true); setErreur('')
    const { data, error } = await supabase.rpc('portail_froid_repondre', { p_token: token, p_trainee_id: traineeId, p_ticket: ticket || null, p_reponses: reponses })
    setBusy(false)
    if (error) { setErreur(error.message || 'Vos réponses n\'ont pas pu être enregistrées. Réessayez dans un instant.'); return }
    setEtat((e) => ({ ...e, recue: true, recue_le: data?.recue_le }))
    setOuvert(false)
  }
  if (!ouvert || etat.recue) {
    return <Carte icon={etat.recue ? CheckCircle : Clock} title="Évaluation à froid" tone={etat.recue ? 'done' : 'accent'}
      subtitle={etat.recue ? null : 'Ce que vous avez retenu et mis en pratique depuis la formation'}
      status={etat.recue ? `Envoyée${etat.recue_le ? ` le ${dateFr(etat.recue_le)}` : ''}, merci` : 'À compléter'}
      disabled={etat.recue} onClick={() => setOuvert(true)} />
  }
  return (
    <div className="rounded-ui-lg border-2 border-gray-100 bg-white p-4 space-y-3">
      <div>
        <h2 className="font-display text-lg font-bold text-gray-900">Évaluation à froid</h2>
        <p className="text-ui-sm text-gray-500">{etat.formation ? `Formation « ${etat.formation} ». ` : ''}Quelques questions sur ce que vous avez retenu et mis en pratique.</p>
      </div>
      <QuestionnaireFroid questions={etat.questions} onEnvoyer={envoyer} onAnnuler={() => setOuvert(false)} busy={busy} erreur={erreur} />
    </div>
  )
}
