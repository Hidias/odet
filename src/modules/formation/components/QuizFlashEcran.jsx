import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import toast from 'react-hot-toast'
import { X, Maximize2, Play, CheckCircle2, ChevronRight, Trophy, Loader2, Square } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { publicBaseUrl } from '../../../core/org/orgUtils'
import { COULEURS, Forme, resteSecondes, decalageServeur, confettis } from '../../portail/lib/quizFlash'

// Écran du quiz flash (0425), à projeter. Mode « direct » : QR code, puis questions pilotées par le formateur
// (chrono, réponses en direct, correction, classement, podium). Mode « autonome » : QR code et suivi des réponses,
// chacun joue à son rythme. Aucun vrai nom : seulement les surnoms tirés au hasard.

export default function QuizFlashEcran({ partieId, session, onFermer }) {
  const [e, setE] = useState(null)
  const [qr, setQr] = useState('')
  const [busy, setBusy] = useState(false)
  const [, setTic] = useState(0)
  const decalage = useRef(0)
  const auto = useRef(null)
  const boite = useRef(null)
  const lien = session?.attendance_token ? `${publicBaseUrl()}/#/portail/${session.attendance_token}` : ''

  const charger = useCallback(async () => {
    const { data, error } = await supabase.rpc('quiz_flash_ecran', { p_partie: partieId })
    if (error) return
    decalage.current = decalageServeur(data)
    setE(data)
  }, [partieId])
  useEffect(() => { charger(); const id = setInterval(charger, 1000); return () => clearInterval(id) }, [charger])
  useEffect(() => { const id = setInterval(() => setTic((n) => n + 1), 250); return () => clearInterval(id) }, [])
  useEffect(() => { if (lien) QRCode.toDataURL(lien, { width: 640, margin: 1 }).then(setQr).catch(() => setQr('')) }, [lien])
  useEffect(() => { if (e?.phase === 'fini') confettis(160) }, [e?.phase === 'fini']) // eslint-disable-line react-hooks/exhaustive-deps

  const piloter = async (action) => {
    setBusy(true)
    const { data, error } = await supabase.rpc('quiz_flash_piloter', { p_partie: partieId, p_action: action })
    setBusy(false)
    if (error) return toast.error(error.message)
    decalage.current = decalageServeur(data)
    setE(data)
  }

  // Direct : correction automatique quand le temps est écoulé ou que tout le monde a répondu
  const reste = e ? resteSecondes(e, decalage.current) : 20
  useEffect(() => {
    if (!e || e.mode !== 'direct' || e.phase !== 'question' || busy) return
    const tous = e.joueurs > 0 && (e.question?.reponses || 0) >= e.joueurs
    const cle = `${e.id}-${e.q_index}`
    if ((reste <= 0 || tous) && auto.current !== cle) { auto.current = cle; piloter('corriger') }
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const pleinEcran = () => { try { boite.current?.requestFullscreen?.() } catch { /* indisponible */ } }

  const q = e?.question
  const total = (q?.compte || []).reduce((a, b) => a + b, 0) || 0
  const pcJuste = q && q.bonne != null && total ? Math.round(((q.compte || [])[q.bonne] || 0) / total * 100) : null

  const QrBloc = ({ grand = true }) => (
    <div className="flex flex-col items-center gap-3 text-center">
      {qr ? <img src={qr} alt="QR code du portail stagiaire" className={`${grand ? 'w-64 h-64 sm:w-80 sm:h-80' : 'w-40 h-40'} bg-white rounded-ui-lg p-3`} /> : <div className="w-64 h-64 grid place-items-center"><Loader2 className="w-8 h-8 animate-spin" /></div>}
      <p className={`${grand ? 'text-3xl' : 'text-xl'} font-bold`}>Scannez pour jouer</p>
      <p className="text-white/70 text-sm break-all max-w-md">{lien}</p>
    </div>
  )

  return (
    <div ref={boite} className="fixed inset-0 z-[70] overflow-y-auto bg-primary-900 text-white" role="dialog" aria-modal="true" aria-label="Quiz flash">
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="vitrine-halo w-96 h-96 -top-24 -left-16 bg-accent-500" />
        <div className="vitrine-halo w-96 h-96 bottom-0 -right-24 bg-highlight-500" style={{ animationDelay: '-5s' }} />
        <div className="absolute inset-0 vitrine-grain" />
      </div>
      <div className="relative max-w-6xl mx-auto min-h-full flex flex-col gap-5 px-5 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-white/10 border border-white/15 px-3 py-1 text-sm font-semibold">Quiz flash{e?.theme ? ` · ${e.theme}` : ''}</span>
          {e && e.phase !== 'attente' && e.mode === 'direct' && e.phase !== 'fini' && <span className="text-white/70 text-sm">Question {e.q_index + 1} / {e.nb}</span>}
          <span className="text-white/70 text-sm">{e?.joueurs || 0} joueur{(e?.joueurs || 0) > 1 ? 's' : ''}</span>
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn btn-ghost btn-sm text-white hover:bg-white/10" onClick={pleinEcran}><Maximize2 className="w-4 h-4" />Plein écran</button>
            {e && e.phase !== 'fini' && <button type="button" className="btn btn-ghost btn-sm text-white hover:bg-white/10" onClick={() => piloter('terminer')}><Square className="w-4 h-4" />Terminer</button>}
            <button type="button" className="btn btn-ghost btn-sm text-white hover:bg-white/10" aria-label="Fermer l'écran du quiz" onClick={onFermer}><X className="w-5 h-5" /></button>
          </div>
        </div>

        {!e && <div className="flex-1 grid place-items-center"><Loader2 className="w-8 h-8 animate-spin" /></div>}

        {/* Salle d'attente (direct) */}
        {e?.mode === 'direct' && e.phase === 'attente' && (
          <div className="flex-1 grid gap-8 lg:grid-cols-2 items-center">
            <QrBloc />
            <div className="flex flex-col gap-4">
              <p className="text-white/80">{e.nb} questions · {e.duree} secondes chacune · des points pour la rapidité</p>
              <div className="flex flex-wrap gap-2 min-h-[3rem]" aria-live="polite">
                {(e.surnoms || []).map((s) => <span key={s} className="vitrine-monte rounded-full bg-white/10 border border-white/15 px-3 py-1.5 text-sm">{s}</span>)}
                {(e.surnoms || []).length === 0 && <span className="text-white/60">En attente des premiers joueurs…</span>}
              </div>
              <button type="button" className="btn btn-primary h-14 text-lg self-start" disabled={busy} onClick={() => piloter('demarrer')}><Play className="w-5 h-5" />Lancer la première question</button>
            </div>
          </div>
        )}

        {/* Question et correction (direct) */}
        {e?.mode === 'direct' && (e.phase === 'question' || e.phase === 'correction') && q && (
          <div className="flex flex-col gap-5">
            {e.phase === 'question' && (
              <div className="flex items-center gap-4">
                <div className="flex-1 h-3 rounded-full bg-white/10 overflow-hidden" aria-hidden="true"><div className="h-full bg-accent-500 transition-all duration-200" style={{ width: `${(reste / (e.duree || 20)) * 100}%` }} /></div>
                <span className="text-5xl font-bold tabular-nums w-20 text-right">{reste}</span>
              </div>
            )}
            <h2 className="text-3xl sm:text-4xl font-bold leading-tight text-balance">{q.texte}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {(q.choix || []).map((c, k) => {
                const bon = e.phase === 'correction' && q.bonne === k
                const eteint = e.phase === 'correction' && q.bonne !== k
                return (
                  <div key={k} className={`flex items-center gap-3 rounded-ui-lg px-4 py-4 text-lg font-semibold transition-opacity ${eteint ? 'opacity-40' : ''} ${bon ? 'ring-4 ring-white' : ''}`} style={{ background: COULEURS[k] }}>
                    <Forme i={k} taille={30} /><span className="flex-1">{c}</span>
                    <span className="text-2xl font-bold tabular-nums">{(q.compte || [])[k] || 0}</span>
                    {bon && <CheckCircle2 className="w-7 h-7" aria-label="Bonne réponse" />}
                  </div>
                )
              })}
            </div>
            <p className="text-white/70">{q.reponses || 0} réponse{(q.reponses || 0) > 1 ? 's' : ''} sur {e.joueurs} joueur{e.joueurs > 1 ? 's' : ''}</p>
            {e.phase === 'correction' && (
              <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,360px)]">
                <div className="rounded-ui-lg bg-white/10 border border-white/15 p-4">
                  {pcJuste != null && <p className="text-2xl font-bold">{pcJuste} % de bonnes réponses</p>}
                  <p className="text-white/80">{pcJuste != null && pcJuste < 60 ? 'Point à reprendre avec le groupe.' : 'Le groupe maîtrise ce point.'}</p>
                  {q.explication && <p className="mt-2 text-white/90">{q.explication}</p>}
                </div>
                <ol className="grid gap-1.5" aria-label="Classement">
                  {(e.classement || []).slice(0, 5).map((p, i) => <li key={p.surnom} className="flex items-center gap-3 rounded-ui bg-white/10 px-3 py-2"><b className="w-5">{i + 1}</b><span className="flex-1">{p.surnom}</span><b className="tabular-nums">{p.points}</b></li>)}
                </ol>
              </div>
            )}
            <div className="flex gap-3">
              {e.phase === 'question' && <button type="button" className="btn btn-secondary h-12" disabled={busy} onClick={() => piloter('corriger')}>Corriger maintenant</button>}
              {e.phase === 'correction' && <button type="button" className="btn btn-primary h-12 text-lg" disabled={busy} onClick={() => piloter('suivante')}>{e.q_index + 1 < e.nb ? 'Question suivante' : 'Voir le podium'}<ChevronRight className="w-5 h-5" /></button>}
            </div>
          </div>
        )}

        {/* Autonome : QR et suivi */}
        {e?.mode === 'autonome' && e.phase !== 'fini' && (
          <div className="flex-1 grid gap-8 lg:grid-cols-2 items-start">
            <QrBloc />
            <div className="flex flex-col gap-3">
              <p className="text-white/80">Chacun joue à son rythme : {e.nb} questions, {e.duree} secondes chacune.</p>
              <ul className="grid gap-2">
                {(e.stats || []).map((s) => <li key={s.index} className="rounded-ui bg-white/10 px-3 py-2"><div className="text-sm text-white/70">Question {s.index + 1}</div><div className="font-semibold">{s.texte}</div><div className="text-sm">{s.reponses} réponse{s.reponses > 1 ? 's' : ''}{s.reponses ? ` · ${Math.round(s.justes / s.reponses * 100)} % justes` : ''}</div></li>)}
              </ul>
              <button type="button" className="btn btn-primary self-start h-12" disabled={busy} onClick={() => piloter('terminer')}>Terminer et voir le podium</button>
            </div>
          </div>
        )}

        {/* Fin : podium et bilan */}
        {e?.phase === 'fini' && (
          <div className="flex flex-col gap-6">
            <h2 className="text-4xl font-bold text-center">Bravo à tous !</h2>
            <div className="grid grid-cols-3 items-end gap-3 max-w-2xl mx-auto w-full min-h-[260px]">
              {[1, 0, 2].map((r, k) => {
                const p = (e.classement || [])[r]
                if (!p) return <div key={k} />
                return (
                  <div key={k} className="flex flex-col items-center gap-2 text-center">
                    <span className="font-bold">{p.surnom}</span><span className="text-white/70 tabular-nums">{p.points} pts</span>
                    <div className="w-full rounded-t-ui-lg grid place-items-center text-4xl font-bold text-gray-900 vitrine-monte"
                      style={{ height: [180, 130, 100][r === 0 ? 0 : r === 1 ? 1 : 2], background: ['#C9993A', '#A9B0BC', '#B87333'][r], '--delai': `${[600, 300, 0][r]}ms` }}>
                      {r === 0 ? <Trophy className="w-10 h-10" aria-label="1er" /> : r + 1}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="rounded-ui-lg bg-white/10 border border-white/15 p-4 max-w-3xl mx-auto w-full">
              <p className="font-semibold mb-2">Bilan pour le formateur (évaluation en cours de formation, non certificative)</p>
              <ul className="grid gap-1.5">
                {(e.stats || []).map((s) => {
                  const pc = s.reponses ? Math.round(s.justes / s.reponses * 100) : null
                  return <li key={s.index} className="flex gap-3"><span className="flex-1">{s.index + 1}. {s.texte}</span><b className={pc != null && pc < 60 ? 'text-red-300' : ''}>{pc == null ? 'aucune réponse' : `${pc} %`}{pc != null && pc < 60 ? ' · à reprendre' : ''}</b></li>
                })}
              </ul>
            </div>
            <button type="button" className="btn btn-secondary self-center" onClick={onFermer}>Fermer</button>
          </div>
        )}
      </div>
    </div>
  )
}
