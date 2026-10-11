import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Check, ChevronRight, Zap, RotateCcw, Trophy, Target, Loader2, ArrowUp, ArrowDown, Flame } from 'lucide-react'

// Moteur de quiz du portail stagiaire : une question à la fois, plein écran, pensé pour le téléphone.
//   mode 'positioning' : pas de correction affichée, on enregistre les réponses (questions ouvertes acceptées)
//   mode 'training'    : correction immédiate avec explication, rejouable
//   mode 'final'       : correction immédiate, une seule tentative (notée côté serveur)
// Le niveau de difficulté des questions n'est jamais affiché.

const styles = `
  @keyframes quizSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
  @keyframes quizPop { 0% { transform: scale(1); } 40% { transform: scale(1.06); } 100% { transform: scale(1); } }
  @keyframes quizShake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }
  @keyframes quizFade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes quizXp { 0% { opacity: 0; transform: translateY(6px) scale(0.9); } 30% { opacity: 1; transform: translateY(0) scale(1.1); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
  .quiz-feedback { animation: quizSlideUp 0.28s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; }
  .quiz-pop { animation: quizPop 0.35s ease-out; }
  .quiz-shake { animation: quizShake 0.4s ease-in-out; }
  .quiz-fade { animation: quizFade 0.3s ease-out forwards; }
  .quiz-xp { animation: quizXp 0.5s ease-out forwards; }
`

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

export function parseOptions(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function sameOrder(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

export default function QuizEngine({ questions, mode = 'training', title, onCheck, onFinish, onClose, closeLabel = 'Quitter' }) {
  const graded = mode !== 'positioning'
  const list = useMemo(() => (questions || []).map((q) => ({
    ...q,
    kind: q.kind || (q.question_type === 'open' ? 'open' : 'single'),
    optionList: parseOptions(q.options),
  })), [questions])

  const [idx, setIdx] = useState(0)
  const [selected, setSelected] = useState(null)        // index, tableau d'ordre ou texte
  const [feedback, setFeedback] = useState(null)        // résultat de onCheck
  const [checking, setChecking] = useState(false)
  const [answers, setAnswers] = useState([])
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [xp, setXp] = useState(0)
  const [correctCount, setCorrectCount] = useState(0)
  const [finished, setFinished] = useState(false)
  const [result, setResult] = useState(null)
  const [finishing, setFinishing] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [shake, setShake] = useState(false)
  const scrollRef = useRef(null)

  const q = list[idx]
  const total = list.length
  const isLast = idx === total - 1

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [idx])

  const answered = (() => {
    if (!q) return false
    if (q.kind === 'open') return typeof selected === 'string' && selected.trim().length > 0
    if (q.kind === 'order') return Array.isArray(selected) && selected.length === q.optionList.length
    return typeof selected === 'number'
  })()

  const buildAnswer = () => {
    if (q.kind === 'open') return { question_id: q.id, text: selected }
    if (q.kind === 'order') return { question_id: q.id, order: selected }
    return { question_id: q.id, index: selected }
  }

  const handleCheck = async () => {
    if (!answered || checking) return
    const answer = buildAnswer()
    if (!graded || q.kind === 'survey' || q.kind === 'open') {
      // Positionnement : on enregistre et on avance, sans correction
      setAnswers((a) => [...a, answer])
      goNext([...answers, answer])
      return
    }
    setChecking(true)
    try {
      const res = await onCheck(q, answer)
      const ok = !!res?.correct
      setFeedback({ ...res, correct: ok })
      setAnswers((a) => [...a, answer])
      if (ok) {
        setStreak((s) => {
          const n = s + 1
          setBestStreak((b) => Math.max(b, n))
          return n
        })
        setXp((v) => v + (res?.xp || 0))
        setCorrectCount((c) => c + 1)
      } else {
        setStreak(0)
        setShake(true)
        setTimeout(() => setShake(false), 450)
      }
    } catch (err) {
      console.error('Vérification impossible :', err)
      alert('Impossible de vérifier la réponse. Vérifiez votre connexion.')
    } finally {
      setChecking(false)
    }
  }

  const goNext = async (allAnswers) => {
    const next = allAnswers || answers
    if (isLast) {
      setFinishing(true)
      try {
        const res = await onFinish(next, { xp, correct: correctCount, bestStreak })
        setResult(res || null)
        setFinished(true)
      } catch (err) {
        console.error('Enregistrement impossible :', err)
        alert("Impossible d'enregistrer le quiz. Réessayez.")
      } finally {
        setFinishing(false)
      }
      return
    }
    setIdx(idx + 1)
    setSelected(null)
    setFeedback(null)
  }

  const handleContinue = () => goNext()

  const restart = () => {
    setIdx(0); setSelected(null); setFeedback(null); setAnswers([]); setStreak(0); setBestStreak(0)
    setXp(0); setCorrectCount(0); setFinished(false); setResult(null)
  }

  // ---- Écran de fin ----
  if (finished) {
    const score = result?.score ?? correctCount
    const max = result?.max_score ?? total
    const pct = max > 0 ? Math.round((100 * score) / max) : 0
    const earned = result?.xp ?? xp
    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <style>{styles}</style>
        <div className="flex-1 overflow-y-auto px-5 py-8 max-w-lg w-full mx-auto quiz-fade">
          {graded ? (
            <>
              <div className="text-center">
                <div className="relative w-36 h-36 mx-auto mb-5">
                  <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                    <circle cx="60" cy="60" r="52" fill="none" stroke="rgb(var(--c-primary-100))" strokeWidth="10" />
                    <circle cx="60" cy="60" r="52" fill="none" stroke={pct >= 70 ? 'rgb(var(--c-success))' : 'rgb(var(--c-accent-500))'} strokeWidth="10" strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 52}`} strokeDashoffset={`${2 * Math.PI * 52 * (1 - pct / 100)}`}
                      style={{ transition: 'stroke-dashoffset 0.9s ease-out' }} />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-display text-4xl font-bold text-gray-900">{pct}%</span>
                    <span className="text-ui-sm text-gray-500">{score} / {max}</span>
                  </div>
                </div>
                <h2 className="font-display text-2xl font-bold text-gray-900">
                  {pct >= 90 ? 'Excellent' : pct >= 70 ? 'Bien joué' : pct >= 50 ? 'Pas mal' : 'Continuez à vous entraîner'}
                </h2>
                <p className="text-gray-500 mt-1">
                  {mode === 'final' ? 'Votre évaluation est enregistrée.' : 'Vous pouvez recommencer autant de fois que vous le souhaitez.'}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 mt-7">
                <Stat icon={Zap} label="XP gagnés" value={`+${earned}`} tone="highlight" />
                <Stat icon={Target} label="Bonnes réponses" value={score} tone="success" />
                <Stat icon={Flame} label="Meilleure série" value={bestStreak} tone="accent" />
              </div>

              {result?.by_objective && Object.keys(result.by_objective).length > 1 && (
                <div className="mt-7">
                  <h3 className="font-display font-semibold text-gray-900 mb-2">Par objectif</h3>
                  <div className="space-y-2">
                    {Object.entries(result.by_objective).map(([key, v]) => {
                      const p = v.total ? Math.round((100 * v.correct) / v.total) : 0
                      return (
                        <div key={key}>
                          <div className="flex justify-between text-ui-sm text-gray-600 mb-1">
                            <span>{key === 'general' ? 'Général' : `Objectif ${Number(key) + 1}`}</span>
                            <span>{v.correct}/{v.total}</span>
                          </div>
                          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                            <div className="h-full rounded-full bg-accent-500" style={{ width: `${p}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-6">
              <div className="w-20 h-20 rounded-full bg-primary-50 text-primary-700 flex items-center justify-center mx-auto mb-5 quiz-pop">
                <Check className="w-10 h-10" strokeWidth={2.5} />
              </div>
              <h2 className="font-display text-2xl font-bold text-gray-900">Merci</h2>
              <p className="text-gray-500 mt-2">Vos réponses sont enregistrées. Elles aident le formateur à adapter la formation à votre niveau.</p>
            </div>
          )}
        </div>
        <div className="border-t border-gray-100 p-4 max-w-lg w-full mx-auto space-y-2">
          {mode === 'training' && (
            <button type="button" onClick={restart} className="w-full h-12 rounded-ui-lg border-2 border-primary-200 text-primary-800 font-semibold flex items-center justify-center gap-2">
              <RotateCcw className="w-5 h-5" /> Rejouer
            </button>
          )}
          <button type="button" onClick={() => onClose(result)} className="w-full h-12 rounded-ui-lg bg-accent-500 text-accent-fg font-semibold flex items-center justify-center gap-2">
            Continuer <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    )
  }

  if (!q) return null

  const showFeedback = graded && feedback !== null
  const ok = showFeedback && feedback.correct

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <style>{styles}</style>

      {/* Barre haute : fermer, progression, XP */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-2 max-w-lg w-full mx-auto">
        <button type="button" onClick={() => setConfirmClose(true)} className="w-10 h-10 -ml-2 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100" aria-label={closeLabel}>
          <X className="w-6 h-6" />
        </button>
        <div className="flex-1 h-3 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full rounded-full bg-accent-500 transition-all duration-500" style={{ width: `${((idx + (showFeedback ? 1 : 0)) / total) * 100}%` }} />
        </div>
        {graded ? (
          <div className="flex items-center gap-1 text-highlight-700 font-semibold text-ui-sm min-w-[56px] justify-end">
            <Zap className="w-4 h-4" /> {xp}
          </div>
        ) : (
          <div className="text-ui-sm text-gray-500 min-w-[56px] text-right">{idx + 1} / {total}</div>
        )}
      </div>

      {/* Question */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 pb-40 max-w-lg w-full mx-auto">
        {title && <div className="text-ui-sm uppercase tracking-wide text-gray-400 font-semibold mt-2">{title}</div>}
        {graded && streak >= 3 && !showFeedback && (
          <div className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full bg-highlight-50 text-highlight-800 text-ui-sm font-semibold quiz-pop">
            <Flame className="w-3.5 h-3.5" /> {streak} d'affilée
          </div>
        )}
        <h2 key={q.id} className="font-display text-xl font-bold text-gray-900 mt-3 mb-5 leading-snug quiz-fade">{q.question_text}</h2>

        {q.image_url && (
          <img src={q.image_url} alt="" className="w-full rounded-ui-lg border border-gray-100 mb-5 object-cover max-h-60" />
        )}

        <div className={shake ? 'quiz-shake' : ''}>
          {(q.kind === 'single' || q.kind === 'survey' || q.kind === 'image' || !q.kind) && (
            <OptionList q={q} selected={selected} onSelect={(i) => !showFeedback && setSelected(i)} feedback={showFeedback ? feedback : null} />
          )}
          {q.kind === 'truefalse' && (
            <div className="grid grid-cols-2 gap-3">
              {q.optionList.map((opt, i) => (
                <OptionButton key={i} big label={opt} selected={selected === i} state={optionState(i, selected, showFeedback ? feedback : null)} onClick={() => !showFeedback && setSelected(i)} />
              ))}
            </div>
          )}
          {q.kind === 'order' && (
            <OrderPicker q={q} value={selected} onChange={(v) => !showFeedback && setSelected(v)} feedback={showFeedback ? feedback : null} />
          )}
          {q.kind === 'open' && (
            <textarea
              value={selected || ''}
              onChange={(e) => setSelected(e.target.value)}
              rows={5}
              placeholder="Votre réponse"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-ui-lg focus:border-accent-400 focus:ring-0 text-base"
            />
          )}
        </div>
      </div>

      {/* Barre basse : vérifier / continuer, avec le retour */}
      <div
        className={`fixed left-0 right-0 bottom-0 border-t transition-colors ${
          showFeedback ? (ok ? 'bg-[rgb(var(--c-success-bg))] border-transparent' : 'bg-[rgb(var(--c-danger-bg))] border-transparent') : 'bg-white border-gray-100'
        }`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="max-w-lg mx-auto px-5 py-4">
          {showFeedback && (
            <div className="quiz-feedback mb-3">
              <div className={`flex items-center gap-2 font-display font-bold text-lg ${ok ? 'text-[rgb(var(--c-success))]' : 'text-[rgb(var(--c-danger))]'}`}>
                <span className={`w-8 h-8 rounded-full flex items-center justify-center ${ok ? 'bg-[rgb(var(--c-success))] text-white quiz-pop' : 'bg-[rgb(var(--c-danger))] text-white'}`}>
                  {ok ? <Check className="w-5 h-5" strokeWidth={3} /> : <X className="w-5 h-5" strokeWidth={3} />}
                </span>
                {ok ? 'Bonne réponse' : 'Pas tout à fait'}
                {ok && feedback.xp > 0 && <span className="ml-auto text-highlight-700 text-ui-sm font-semibold quiz-xp flex items-center gap-1"><Zap className="w-4 h-4" />+{feedback.xp} XP</span>}
              </div>
              {!ok && q.kind !== 'order' && typeof feedback.correct_index === 'number' && q.optionList[feedback.correct_index] && (
                <p className="text-ui-sm text-gray-700 mt-1">Bonne réponse : <strong>{q.optionList[feedback.correct_index]}</strong></p>
              )}
              {!ok && q.kind === 'order' && Array.isArray(feedback.correct_order) && (
                <p className="text-ui-sm text-gray-700 mt-1">Bon ordre : <strong>{feedback.correct_order.map((i) => q.optionList[i]).join(', ')}</strong></p>
              )}
              {feedback.explanation && <p className="text-ui text-gray-700 mt-1.5 leading-relaxed">{feedback.explanation}</p>}
            </div>
          )}
          {showFeedback ? (
            <button type="button" onClick={handleContinue} disabled={finishing}
              className={`w-full py-3.5 rounded-ui-lg font-bold text-base flex items-center justify-center gap-2 text-white ${ok ? 'bg-[rgb(var(--c-success))]' : 'bg-[rgb(var(--c-danger))]'} disabled:opacity-60`}>
              {finishing ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              {isLast ? 'Voir mon résultat' : 'Continuer'}
            </button>
          ) : (
            <button type="button" onClick={handleCheck} disabled={!answered || checking || finishing}
              className="w-full py-3.5 rounded-ui-lg font-bold text-base flex items-center justify-center gap-2 bg-accent-500 text-accent-fg disabled:bg-gray-200 disabled:text-gray-400 transition-colors">
              {(checking || finishing) ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              {graded && q.kind !== 'open' && q.kind !== 'survey' ? 'Vérifier' : isLast ? 'Terminer' : 'Continuer'}
            </button>
          )}
        </div>
      </div>

      {confirmClose && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={() => setConfirmClose(false)}>
          <div className="bg-white rounded-ui-lg p-5 w-full max-w-sm quiz-fade" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-bold text-lg text-gray-900">Quitter le quiz ?</h3>
            <p className="text-gray-500 mt-1 text-ui">
              {mode === 'final' ? "Votre évaluation ne sera pas enregistrée tant qu'elle n'est pas terminée." : 'Votre progression sur ce quiz sera perdue.'}
            </p>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setConfirmClose(false)} className="flex-1 h-11 rounded-ui border border-gray-200 font-medium">Rester</button>
              <button type="button" onClick={() => onClose(null)} className="flex-1 h-11 rounded-ui bg-accent-500 text-accent-fg font-medium">{closeLabel}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function optionState(i, selected, feedback) {
  if (!feedback) return selected === i ? 'selected' : 'idle'
  if (typeof feedback.correct_index === 'number' && feedback.correct_index === i) return 'correct'
  if (selected === i) return feedback.correct ? 'correct' : 'wrong'
  return 'muted'
}

function OptionList({ q, selected, onSelect, feedback }) {
  const images = parseOptions(q.option_images)
  const hasImages = q.kind === 'image' && images.length === q.optionList.length
  return (
    <div className={hasImages ? 'grid grid-cols-2 gap-3' : 'space-y-3'}>
      {q.optionList.map((opt, i) => (
        <OptionButton key={i} letter={LETTERS[i]} label={opt} image={hasImages ? images[i] : null} selected={selected === i} state={optionState(i, selected, feedback)} onClick={() => onSelect(i)} />
      ))}
    </div>
  )
}

function OptionButton({ letter, label, image, state, onClick, big }) {
  const base = 'w-full text-left rounded-ui-lg border-2 transition-all duration-150 active:scale-[0.99] select-none'
  const look = {
    idle: 'border-gray-200 bg-white hover:border-gray-300',
    selected: 'border-accent-500 bg-accent-50 shadow-[0_0_0_3px_rgb(var(--c-accent-500)/0.12)]',
    correct: 'border-[rgb(var(--c-success))] bg-[rgb(var(--c-success-bg))]',
    wrong: 'border-[rgb(var(--c-danger))] bg-[rgb(var(--c-danger-bg))]',
    muted: 'border-gray-100 bg-white opacity-60',
  }[state]
  return (
    <button type="button" onClick={onClick} className={`${base} ${look} ${big ? 'py-6 text-center' : 'px-4 py-3.5'}`}>
      {image && <img src={image} alt="" className="w-full aspect-square object-cover rounded-ui mb-2" />}
      <div className={`flex items-center gap-3 ${big ? 'justify-center' : ''}`}>
        {letter && !big && (
          <span className={`w-7 h-7 rounded-md flex items-center justify-center text-ui-sm font-bold flex-shrink-0 ${
            state === 'selected' ? 'bg-accent-500 text-accent-fg' : state === 'correct' ? 'bg-[rgb(var(--c-success))] text-white' : state === 'wrong' ? 'bg-[rgb(var(--c-danger))] text-white' : 'bg-gray-100 text-gray-500'
          }`}>{letter}</span>
        )}
        <span className={`${big ? 'font-display text-xl font-bold' : 'text-base'} text-gray-900`}>{label}</span>
      </div>
    </button>
  )
}

// Mélange stable (par question) des éléments à remettre dans l'ordre
function shuffledIndexes(q) {
  const seed = (q.id || '').split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
  let x = seed || 1
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 }
  const idx = q.optionList.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]] }
  // Si le mélange tombe sur le bon ordre, on décale d'un cran
  if (Array.isArray(q.correct_order) && idx.every((v, i) => v === q.correct_order[i]) && idx.length > 1) idx.push(idx.shift())
  return idx
}

function OrderPicker({ q, value, onChange, feedback }) {
  const order = Array.isArray(value) ? value : []
  const display = useMemo(() => (Array.isArray(q.display_order) && q.display_order.length === q.optionList.length ? q.display_order : shuffledIndexes(q)), [q])
  const remaining = display.filter((i) => !order.includes(i))
  const move = (pos, dir) => {
    const next = [...order]
    const target = pos + dir
    if (target < 0 || target >= next.length) return
    ;[next[pos], next[target]] = [next[target], next[pos]]
    onChange(next)
  }
  return (
    <div className="space-y-4">
      <div>
        <div className="text-ui-sm text-gray-500 mb-2">Touchez les éléments dans le bon ordre</div>
        <div className="flex flex-wrap gap-2">
          {remaining.map((i) => (
            <button key={i} type="button" onClick={() => onChange([...order, i])} className="px-3 py-2 rounded-ui border-2 border-gray-200 bg-white text-gray-900 font-medium active:scale-95">
              {q.optionList[i]}
            </button>
          ))}
          {remaining.length === 0 && <span className="text-ui-sm text-gray-400">Tous les éléments sont placés</span>}
        </div>
      </div>
      <div className="rounded-ui-lg border-2 border-dashed border-gray-200 p-3 min-h-[120px] space-y-2">
        {order.length === 0 && <div className="text-ui-sm text-gray-400 text-center py-6">Votre ordre apparaîtra ici</div>}
        {order.map((i, pos) => {
          const good = feedback && Array.isArray(feedback.correct_order) ? feedback.correct_order[pos] === i : null
          return (
            <div key={i} className={`flex items-center gap-2 rounded-ui px-3 py-2 border-2 ${
              good === null ? 'border-accent-200 bg-accent-50' : good ? 'border-[rgb(var(--c-success))] bg-[rgb(var(--c-success-bg))]' : 'border-[rgb(var(--c-danger))] bg-[rgb(var(--c-danger-bg))]'
            }`}>
              <span className="w-6 h-6 rounded-md bg-primary-900 text-white text-ui-sm font-bold flex items-center justify-center">{pos + 1}</span>
              <span className="flex-1 text-gray-900 font-medium">{q.optionList[i]}</span>
              {!feedback && (
                <>
                  <button type="button" onClick={() => move(pos, -1)} className="w-8 h-8 rounded-md text-gray-500 hover:bg-white" aria-label="Monter"><ArrowUp className="w-4 h-4 mx-auto" /></button>
                  <button type="button" onClick={() => move(pos, 1)} className="w-8 h-8 rounded-md text-gray-500 hover:bg-white" aria-label="Descendre"><ArrowDown className="w-4 h-4 mx-auto" /></button>
                  <button type="button" onClick={() => onChange(order.filter((x) => x !== i))} className="w-8 h-8 rounded-md text-gray-400 hover:bg-white" aria-label="Retirer"><X className="w-4 h-4 mx-auto" /></button>
                </>
              )}
            </div>
          )
        })}
      </div>
      {!feedback && order.length > 0 && (
        <button type="button" onClick={() => onChange([])} className="text-ui-sm text-gray-500 underline">Recommencer</button>
      )}
    </div>
  )
}

function Stat({ icon: Icon, label, value, tone }) {
  const tones = {
    highlight: 'bg-highlight-50 text-highlight-800',
    success: 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]',
    accent: 'bg-accent-50 text-accent-700',
  }
  return (
    <div className={`rounded-ui-lg p-3 text-center ${tones[tone]}`}>
      <Icon className="w-5 h-5 mx-auto mb-1" />
      <div className="font-display text-xl font-bold">{value}</div>
      <div className="text-[11px] uppercase tracking-wide opacity-80">{label}</div>
    </div>
  )
}

export { sameOrder }
