import { useEffect, useState } from 'react'
import { Smile, CheckCircle, Loader2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'

// Ressenti au fil de la formation (0414) : chaque jour de formation, le stagiaire note sa journée de 1 à 5 et peut
// signaler une difficulté ou poser une question. Le formateur le voit le jour même (onglet Évaluations de la session).
// Modifiable le jour même ; rien à faire en dehors des jours de formation.

export const NOTES = [
  [1, 'Difficile'], [2, 'Moyen'], [3, 'Correct'], [4, 'Bien'], [5, 'Très bien'],
]

export default function RessentiJour({ token, traineeId, ticket }) {
  const [etat, setEtat] = useState(null)
  const [ouvert, setOuvert] = useState(false)
  const [note, setNote] = useState(null)
  const [commentaire, setCommentaire] = useState('')
  const [busy, setBusy] = useState(false)
  const [erreur, setErreur] = useState('')

  useEffect(() => {
    if (!token || !traineeId) return
    let actif = true
    supabase.rpc('portal_ressenti', { p_token: token, p_trainee_id: traineeId, p_ticket: ticket || null }).then(({ data, error }) => {
      if (!actif || error || !data) return
      setEtat(data)
      setNote(data.note || null)
      setCommentaire(data.commentaire || '')
    })
    return () => { actif = false }
  }, [token, traineeId, ticket])

  // Avant la migration 0414, ou hors des jours de formation : rien
  if (!etat?.ouvert) return null

  const envoyer = async () => {
    if (!note) return
    setBusy(true)
    setErreur('')
    const { data, error } = await supabase.rpc('portal_ressenti', {
      p_token: token, p_trainee_id: traineeId, p_ticket: ticket || null, p_note: note, p_commentaire: commentaire || null,
    })
    setBusy(false)
    if (error) { setErreur("Votre ressenti n'a pas pu être enregistré. Réessayez dans un instant."); return }
    setEtat(data)
    setOuvert(false)
  }

  const donne = !!etat.note
  if (!ouvert) {
    return (
      <button type="button" onClick={() => setOuvert(true)}
        className="w-full text-left rounded-ui-lg border-2 border-gray-100 bg-white hover:border-gray-200 p-4 transition-all flex items-center gap-4 active:scale-[0.99]">
        <div className={`w-12 h-12 rounded-ui flex items-center justify-center flex-shrink-0 ${donne ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : 'bg-accent-50 text-accent-700'}`}>
          {donne ? <CheckCircle className="w-6 h-6" /> : <Smile className="w-6 h-6" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900">Ma journée</div>
          <div className="text-ui-sm text-gray-500">
            {donne ? `Ressenti donné : ${NOTES.find(([n]) => n === etat.note)?.[1] || etat.note}, modifiable aujourd'hui` : 'Votre ressenti sur la journée, en 10 secondes'}
          </div>
        </div>
      </button>
    )
  }

  return (
    <div className="rounded-ui-lg border-2 border-accent-500 bg-white p-4 space-y-3">
      <div className="font-semibold text-gray-900">Comment s'est passée votre journée ?</div>
      <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Ressenti de la journée">
        {NOTES.map(([n, l]) => (
          <button key={n} type="button" role="radio" aria-checked={note === n} onClick={() => setNote(n)}
            className={`rounded-ui border py-2 px-1 text-center transition-all ${note === n ? 'bg-accent-500 text-accent-fg border-accent-500' : 'bg-white text-gray-700 border-gray-200'}`}>
            <div className="text-lg font-bold leading-none">{n}</div>
            <div className="text-[11px] mt-1 leading-tight">{l}</div>
          </button>
        ))}
      </div>
      <textarea className="w-full rounded-ui border border-gray-200 p-2 text-ui" rows={2} maxLength={1000}
        placeholder="Une difficulté, une question pour le formateur ? (facultatif)"
        value={commentaire} onChange={(e) => setCommentaire(e.target.value)} />
      {erreur && <p className="text-ui-sm text-[rgb(var(--c-danger))]">{erreur}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOuvert(false)} className="flex-1 py-2.5 rounded-ui bg-gray-100 text-gray-700 font-medium">Plus tard</button>
        <button type="button" onClick={envoyer} disabled={!note || busy}
          className="flex-1 py-2.5 rounded-ui bg-accent-500 text-accent-fg font-semibold disabled:bg-gray-200 disabled:text-gray-400 flex items-center justify-center gap-2">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}Envoyer
        </button>
      </div>
    </div>
  )
}
