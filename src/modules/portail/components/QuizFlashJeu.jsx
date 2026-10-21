import { useCallback, useEffect, useRef, useState } from 'react'
import { Zap, X, Settings2, Trophy, Loader2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import {
  COULEURS, NOMS_FORMES, Forme, resteSecondes, decalageServeur, bip, lireAVoixHaute, confettis, lireReglages, garderReglages,
} from '../lib/quizFlash'

// Quiz flash sur le portail du stagiaire (0425) : quand le formateur lance un quiz, un bandeau propose de jouer ; le
// jeu s'ouvre en plein écran. Le stagiaire apparaît sous un surnom ; les points sont calculés par la base. Réglages
// d'accessibilité sur le téléphone : sans chrono, lecture à voix haute, sons, texte agrandi.

const rangTexte = (r) => (r === 1 ? '1er' : `${r}e`)

export default function QuizFlashJeu({ token, traineeId, ticket }) {
  const [etat, setEtat] = useState(null)
  const [ouvert, setOuvert] = useState(false)
  const [busy, setBusy] = useState(false)
  const [retour, setRetour] = useState(null) // réponse que je viens de donner
  const [erreur, setErreur] = useState('')
  const [reglages, setReglages] = useState(lireReglages)
  const [voirReglages, setVoirReglages] = useState(false)
  const [, setTic] = useState(0)
  const decalage = useRef(0)
  const derniereQ = useRef(null)
  const passe = useRef(null)

  const charger = useCallback(async () => {
    const { data, error } = await supabase.rpc('portal_quiz_flash', { p_token: token, p_trainee_id: traineeId, p_ticket: ticket || null })
    if (error) return
    decalage.current = decalageServeur(data)
    setEtat(data)
  }, [token, traineeId, ticket])

  // Lecture : toutes les 10 s sans jeu ouvert, toutes les 1,2 s pendant le jeu
  useEffect(() => {
    if (!traineeId) return undefined
    charger()
    const id = setInterval(charger, ouvert ? 1200 : 10000)
    return () => clearInterval(id)
  }, [charger, ouvert, traineeId])
  useEffect(() => { if (!ouvert) return undefined; const id = setInterval(() => setTic((n) => n + 1), 250); return () => clearInterval(id) }, [ouvert])

  const qCle = etat?.partie && etat.q_index != null ? `${etat.partie}-${etat.q_index}` : null
  useEffect(() => {
    if (qCle && qCle !== derniereQ.current) {
      derniereQ.current = qCle
      setRetour(null); setErreur('')
      if (ouvert && etat?.question) lireAVoixHaute(`${etat.question.texte}. ${(etat.question.choix || []).map((c, k) => `${NOMS_FORMES[k]} : ${c}`).join('. ')}`, reglages.voix)
    }
  }, [qCle, ouvert]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (etat?.phase === 'fini' && ouvert) { confettis(120); bip([523, 659, 784, 1047], reglages.sons) } }, [etat?.phase === 'fini', ouvert]) // eslint-disable-line react-hooks/exhaustive-deps

  const regler = (cle) => { const r = { ...reglages, [cle]: !reglages[cle] }; setReglages(r); garderReglages(r) }

  const repondre = async (choix) => {
    if (busy || !etat?.partie || etat.q_index == null) return
    setBusy(true); setErreur('')
    const { data, error } = await supabase.rpc('portal_quiz_flash_repondre', {
      p_token: token, p_trainee_id: traineeId, p_ticket: ticket || null, p_partie: etat.partie, p_index: etat.q_index, p_choix: choix, p_sans_chrono: !!reglages.sansChrono,
    })
    setBusy(false)
    if (error) { setErreur(error.message || 'Réponse non enregistrée'); charger(); return }
    setRetour({ ...data, choix })
    if (choix >= 0) {
      bip(data.juste ? [659, 784, 988] : [330, 247], reglages.sons)
      if (data.juste) confettis(40)
    }
    charger()
  }

  // Mode autonome : temps écoulé sans réponse, on passe (aucun point)
  const reste = etat ? resteSecondes(etat, decalage.current) : 20
  const aRepondu = !!(retour || etat?.ma_reponse)
  useEffect(() => {
    if (!ouvert || !etat || etat.mode !== 'autonome' || etat.phase !== 'question' || aRepondu || reglages.sansChrono) return
    if (reste <= 0 && passe.current !== qCle) { passe.current = qCle; repondre(-1) }
  }) // eslint-disable-line react-hooks/exhaustive-deps

  if (!etat?.partie) return null

  if (!ouvert) {
    return (
      <button type="button" onClick={() => { setOuvert(true); bip([523, 659], reglages.sons) }}
        className="w-full mb-3 rounded-ui-lg bg-accent-500 text-accent-fg px-4 py-3 flex items-center gap-3 font-semibold text-left shadow-md animate-pulse motion-reduce:animate-none">
        <Zap className="w-6 h-6 shrink-0" aria-hidden="true" />
        <span className="flex-1">{etat.phase === 'fini' ? 'Quiz flash terminé : voir mon résultat' : 'Quiz flash en cours : jouer'}</span>
      </button>
    )
  }

  const q = etat.question
  const mr = retour || etat.ma_reponse
  const bonne = q?.bonne ?? retour?.bonne
  const grand = reglages.grand ? 'text-xl' : 'text-base'

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-primary-900 text-white" role="dialog" aria-modal="true" aria-label="Quiz flash">
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="vitrine-halo w-72 h-72 -top-16 -left-10 bg-accent-500" />
        <div className="vitrine-halo w-72 h-72 bottom-0 -right-24 bg-highlight-500" style={{ animationDelay: '-5s' }} />
      </div>
      <div className={`relative max-w-md mx-auto min-h-full flex flex-col gap-4 px-4 py-4 ${grand}`} style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-highlight-400" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <div className="font-bold truncate">{etat.moi?.surnom}</div>
            <div className="text-sm text-white/70">{etat.moi?.points || 0} points{etat.theme ? ` · ${etat.theme}` : ''}</div>
          </div>
          <button type="button" className="p-2 rounded-ui hover:bg-white/10" aria-label="Réglages d'accessibilité" onClick={() => setVoirReglages((v) => !v)}><Settings2 className="w-5 h-5" /></button>
          <button type="button" className="p-2 rounded-ui hover:bg-white/10" aria-label="Fermer le quiz" onClick={() => setOuvert(false)}><X className="w-5 h-5" /></button>
        </div>

        {voirReglages && (
          <div className="rounded-ui-lg bg-white/10 border border-white/15 p-3 grid grid-cols-2 gap-2 text-sm">
            {[['sansChrono', 'Sans chrono'], ['voix', 'Lire les questions'], ['sons', 'Sons'], ['grand', 'Texte agrandi']].map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 min-h-[40px]"><input type="checkbox" className="w-5 h-5" checked={!!reglages[k]} onChange={() => regler(k)} />{l}</label>
            ))}
            <p className="col-span-2 text-white/70 text-xs">Sans chrono : vous répondez à votre rythme, chaque bonne réponse rapporte 700 points.</p>
          </div>
        )}

        {etat.phase === 'attente' && (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
            <p className="text-white/80">Vous jouez sous le nom</p>
            <p className="text-3xl font-bold vitrine-monte">{etat.moi?.surnom}</p>
            <p className="text-white/70">{etat.moi?.joueurs || 1} joueur{(etat.moi?.joueurs || 1) > 1 ? 's' : ''} connecté{(etat.moi?.joueurs || 1) > 1 ? 's' : ''}. Le formateur va lancer la première question.</p>
            <Loader2 className="w-6 h-6 animate-spin text-white/60" aria-hidden="true" />
          </div>
        )}

        {(etat.phase === 'question' || etat.phase === 'correction') && q && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-sm text-white/70">
              <span>Question {etat.q_index + 1} / {etat.nb}</span>
              {etat.phase === 'question' && !mr && !reglages.sansChrono && <span className="text-2xl font-bold text-white tabular-nums" aria-live="off">{reste}</span>}
            </div>
            {etat.phase === 'question' && !mr && !reglages.sansChrono && (
              <div className="h-2 rounded-full bg-white/10 overflow-hidden" aria-hidden="true"><div className="h-full bg-accent-500 transition-all duration-200" style={{ width: `${(reste / (etat.duree || 20)) * 100}%` }} /></div>
            )}
            <h2 className="text-xl font-bold leading-snug">{q.texte}</h2>
            <div className="grid gap-2.5">
              {(q.choix || []).map((c, k) => {
                const choisi = mr?.choix === k
                const estBonne = bonne === k
                const etei = (mr || etat.phase === 'correction') && !choisi && !estBonne
                return (
                  <button key={k} type="button" disabled={!!mr || etat.phase !== 'question' || busy}
                    onClick={() => repondre(k)} aria-label={`Réponse ${NOMS_FORMES[k]} : ${c}`}
                    className={`flex items-center gap-3 rounded-ui-lg px-4 py-3.5 min-h-[60px] text-left font-semibold transition-all active:scale-[.97] ${etei ? 'opacity-35' : ''} ${estBonne && (mr || etat.phase === 'correction') ? 'ring-4 ring-[rgb(var(--c-success))]' : ''}`}
                    style={{ background: COULEURS[k] }}>
                    <Forme i={k} /><span>{c}</span>
                  </button>
                )
              })}
            </div>
            {erreur && <p className="text-sm text-red-200" role="alert">{erreur}</p>}
            {mr && mr.choix >= 0 && (
              <div className={`rounded-ui-lg p-3 border-2 vitrine-monte ${mr.juste ? 'border-[rgb(var(--c-success))] bg-[rgb(var(--c-success))]/15' : 'border-red-400 bg-red-500/15'}`} role="status">
                <div className="font-bold">{mr.juste ? `Bonne réponse : +${mr.points}` : 'Pas cette fois'}</div>
                {retour?.serie >= 2 && <div className="text-highlight-300 font-semibold">Série de {retour.serie} bonnes réponses</div>}
                {(retour?.explication || q.explication) && <p className="text-sm text-white/85 mt-1">{retour?.explication || q.explication}</p>}
              </div>
            )}
            {mr && mr.choix === -1 && <p className="text-white/80" role="status">Temps écoulé : question suivante.</p>}
            {etat.phase === 'question' && !mr && reste <= 0 && !reglages.sansChrono && etat.mode === 'direct' && <p className="text-white/80" role="status">Temps écoulé.</p>}
            {mr && etat.mode === 'direct' && <p className="text-sm text-white/60">En attente de la suite, sur l'écran du formateur.</p>}
            {mr && etat.mode === 'autonome' && <button type="button" className="btn btn-primary h-12" onClick={() => { setRetour(null); charger() }}>Question suivante</button>}
          </div>
        )}

        {etat.phase === 'fini' && (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
            <Trophy className="w-14 h-14 text-highlight-400" aria-hidden="true" />
            <p className="text-2xl font-bold">Vous finissez {rangTexte(etat.moi?.rang || 1)} sur {etat.moi?.joueurs || 1}</p>
            <p className="text-white/80">{etat.moi?.points || 0} points. Merci d'avoir joué : vos réponses aident le formateur à adapter la suite.</p>
            {Array.isArray(etat.podium) && etat.podium.length > 0 && (
              <ol className="w-full grid gap-2">
                {etat.podium.map((p, i) => (
                  <li key={i} className="flex items-center gap-3 rounded-ui bg-white/10 px-3 py-2"><b className="w-6">{i + 1}</b><span className="flex-1 text-left">{p.surnom}</span><b className="tabular-nums">{p.points}</b></li>
                ))}
              </ol>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => setOuvert(false)}>Fermer</button>
          </div>
        )}
      </div>
    </div>
  )
}
