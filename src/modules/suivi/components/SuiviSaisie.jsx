// Saisie du suivi formatif, pensée pour le téléphone du formateur en salle (fonctionne aussi sur PC).
// Le formateur note le groupe d'un geste, puis seulement les exceptions et le rôle tenu dans la mise en situation.
// Chaque geste part dans une file locale, envoyée dès que le réseau le permet (pastille d'état en haut).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, X, Check, AlertTriangle, ChevronLeft, ClipboardCheck, RotateCcw, Loader2, Wifi, WifiOff, UploadCloud } from 'lucide-react'
import toast from 'react-hot-toast'
import SpeechToTextButton from '../../../ui/SpeechToTextButton'
import { STATUSES, statusOf, effectiveStatus, indexEvaluations, computeCoverage, hasRoles, principalRole, isPresentFor } from '../lib/sfData'
import { modalityLabel } from '../lib/sequenceTemplates'
import { readQueue, enqueue, flush, applyQueue } from '../lib/queue'

const QUICK_REMARKS = ['Geste à reprendre', 'À refaire en binôme', 'Oubli de la surveillance', 'Très bonne intervention']
const fullName = (t) => `${t.first_name} ${t.last_name}`.trim()

function StatusButton({ st, active, fromGroup, onClick, disabled, label }) {
  const style = !active
    ? { background: '#FFFFFF', color: '#4B5250', border: '1px solid #D8D8D3' }
    : fromGroup
      ? { background: st.tint, color: st.ink, border: `1px dashed ${st.solid}` }
      : { background: st.solid, color: '#FFFFFF', border: `1px solid ${st.solid}` }
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active && !fromGroup}
      className="min-h-[44px] rounded-ui-sm text-ui font-semibold disabled:opacity-60" style={style}>
      {st.code}
    </button>
  )
}

export default function SuiviSaisie({ data, canWrite, onReload, compact = false }) {
  const sessionId = data.session.id
  const [queue, setQueue] = useState(() => readQueue(sessionId))
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [lastError, setLastError] = useState(null)
  const [current, setCurrent] = useState(null)
  const [sheet, setSheet] = useState(null) // { trainee, role, indicators, remark }
  const [view, setView] = useState('saisie') // saisie | epreuve
  const timer = useRef(null)

  const merged = useMemo(() => applyQueue(data.sequences, data.evaluations, queue), [data, queue])
  const sequences = merged.sequences
  const idx = useMemo(() => indexEvaluations(merged.evaluations), [merged])

  useEffect(() => {
    if (current) return
    const firstOpen = sequences.find((s) => !s.closed_at) || sequences[sequences.length - 1]
    if (firstOpen) setCurrent(firstOpen.id)
  }, [sequences, current])

  const seq = sequences.find((s) => s.id === current) || null
  const seqIndex = sequences.findIndex((s) => s.id === current)
  const trainees = useMemo(() => data.trainees.filter((t) => !seq || isPresentFor(t, seq)), [data.trainees, seq])
  const coverage = useMemo(() => computeCoverage(sequences, merged.evaluations, data.trainees), [sequences, merged, data.trainees])

  // ── Envoi ─────────────────────────────────────────────────────────────
  const doFlush = useCallback(async () => {
    if (!readQueue(sessionId).length) return
    setSyncing(true)
    const r = await flush(sessionId)
    setSyncing(false)
    setQueue(readQueue(sessionId))
    setLastError(r.ok ? null : r.error)
    if (r.ok && r.sent) onReload?.({ silent: true })
  }, [sessionId, onReload])

  const schedule = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(doFlush, 700)
  }, [doFlush])

  useEffect(() => {
    const up = () => { setOnline(true); doFlush() }
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    const iv = setInterval(doFlush, 20000)
    doFlush()
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); clearInterval(iv); clearTimeout(timer.current) }
  }, [doFlush])

  const push = (item) => {
    if (!canWrite) return
    setQueue(enqueue(sessionId, item))
    schedule()
  }

  // ── Gestes ────────────────────────────────────────────────────────────
  const setGroup = (key) => {
    if (!seq) return
    push({ type: 'group', session_sequence_id: seq.id, group_status: seq.group_status === key ? null : key, group_remark: seq.group_remark || null })
  }

  const writeTrainee = (t, patch) => {
    const row = idx.get(`${seq.id}|${t.id}`) || {}
    const next = {
      status: row.status || null, role: row.role || null,
      indicators_met: row.indicators_met || [], remark: row.remark || null, ...patch,
    }
    const empty = !next.status && !next.role && !(next.indicators_met || []).length && !next.remark
    push({ type: 'trainee', session_sequence_id: seq.id, trainee_id: t.id, ...next, clear: empty })
  }

  const setStatus = (t, key) => {
    const row = idx.get(`${seq.id}|${t.id}`)
    writeTrainee(t, { status: row?.status === key ? null : key })
  }

  const cycleRole = (t) => {
    const roles = ['', ...(seq.roles || [])]
    const cur = idx.get(`${seq.id}|${t.id}`)?.role || ''
    const next = roles[(roles.indexOf(cur) + 1) % roles.length]
    writeTrainee(t, { role: next || null })
  }

  const openSheet = (t) => {
    const row = idx.get(`${seq.id}|${t.id}`) || {}
    setSheet({ trainee: t, role: row.role || '', indicators: row.indicators_met || [], remark: row.remark || '' })
  }

  const saveSheet = () => {
    writeTrainee(sheet.trainee, { role: sheet.role || null, indicators_met: sheet.indicators, remark: sheet.remark.trim() || null })
    setSheet(null)
  }

  const toggleClose = () => {
    if (!seq) return
    const closing = !seq.closed_at
    push({ type: 'close', session_sequence_id: seq.id, closed: closing })
    if (closing) {
      const nextSeq = sequences.slice(seqIndex + 1).find((s) => !s.closed_at)
      if (nextSeq) setCurrent(nextSeq.id)
      toast.success('Séquence terminée')
    }
  }

  // ── Affichage ─────────────────────────────────────────────────────────
  const pill = !online
    ? { icon: WifiOff, text: queue.length ? `Hors ligne · ${queue.length} en attente` : 'Hors ligne', color: '#FCA5A5' }
    : syncing || queue.length
      ? { icon: UploadCloud, text: `${queue.length} en attente`, color: '#FCD34D' }
      : { icon: Wifi, text: 'Enregistré', color: '#86EFAC' }

  const adjusted = seq ? trainees.filter((t) => idx.get(`${seq.id}|${t.id}`)?.status).length : 0
  const neverNames = coverage.neverPrincipal.map(fullName)
  const remaining = sequences.slice(Math.max(seqIndex, 0)).filter((s) => hasRoles(s) && !s.closed_at).length

  if (!sequences.length) return null

  if (view === 'epreuve') {
    return <AvantEpreuve coverage={coverage} onBack={() => setView('saisie')} principal={principalRole(sequences.find(hasRoles))} />
  }

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex items-center justify-between gap-2 px-4 py-2 bg-nav text-nav-fg text-ui-sm">
        <span className="flex items-center gap-1.5" style={{ color: pill.color }}>
          <pill.icon className="w-3.5 h-3.5" aria-hidden="true" />{pill.text}
        </span>
        <div className="flex items-center gap-3">
          {lastError && online && <span className="text-[rgb(var(--c-danger)/0.6)]">Envoi refusé, nouvel essai</span>}
          <button type="button" onClick={() => setView('epreuve')} className="underline underline-offset-2 min-h-[32px]">Avant l'épreuve</button>
        </div>
      </div>

      <nav aria-label="Séquences" className="flex gap-2 px-4 py-3 overflow-x-auto bg-white border-b border-gray-200">
        {sequences.map((s, i) => {
          const isCur = s.id === current
          return (
            <button key={s.id} type="button" onClick={() => setCurrent(s.id)}
              aria-label={`Séquence ${i + 1}${s.closed_at ? ', terminée' : ''}${isCur ? ', affichée' : ''}`}
              className={`shrink-0 min-h-[36px] px-3 rounded-full text-[13px] font-semibold border ${isCur ? 'bg-nav text-nav-fg border-transparent' : s.closed_at ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))] border-[rgb(var(--c-success)/0.3)]' : 'bg-white text-gray-600 border-gray-300'}`}>
              {s.closed_at ? '✓ ' : ''}S{i + 1}
            </button>
          )
        })}
      </nav>

      {seq && (
        <section className="px-4 py-3 bg-white border-b border-gray-200 space-y-2.5">
          <div className="font-display font-semibold text-base leading-snug">S{seqIndex + 1} · {seq.title}</div>
          <div className="flex flex-wrap gap-1.5 text-ui-sm">
            <span className="px-2 py-1 rounded-ui-sm bg-nav text-nav-fg">{modalityLabel(seq.modality)}</span>
            {(seq.competences || []).length > 0 && <span className="px-2 py-1 rounded-ui-sm bg-gray-100">{seq.competences.join(' · ')}</span>}
            {seq.closed_at && <span className="px-2 py-1 rounded-ui-sm bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]">Terminée</span>}
          </div>
          <div className="rounded-ui bg-gray-50 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-ui">Tout le groupe</span>
              <div className="flex gap-1.5">
                {STATUSES.map((st) => {
                  const active = seq.group_status === st.key
                  return (
                    <button key={st.key} type="button" onClick={() => setGroup(st.key)} disabled={!canWrite} aria-pressed={active}
                      aria-label={`Tout le groupe : ${st.label}`}
                      className="w-11 h-11 rounded-ui-sm text-[13px] font-semibold disabled:opacity-60"
                      style={active ? { background: st.solid, color: '#fff', border: `1px solid ${st.solid}` } : { background: '#fff', color: '#4B5250', border: '1px solid #D8D8D3' }}>
                      {st.code}
                    </button>
                  )
                })}
              </div>
            </div>
            <p className="text-ui-sm text-gray-600">
              {seq.group_status ? `Groupe : ${statusOf(seq.group_status).label} · ajusté pour ${adjusted} stagiaire${adjusted > 1 ? 's' : ''} (fond plein)` : 'Pas de note de groupe : touchez un statut pour tout le groupe, puis ajustez les exceptions.'}
            </p>
          </div>
        </section>
      )}

      {seq && (
        <ul className="flex-1 bg-white px-4 divide-y divide-gray-100">
          {trainees.map((t) => {
            const row = idx.get(`${seq.id}|${t.id}`)
            const eff = effectiveStatus(seq, row)
            const count = coverage.principalCount[t.id] || 0
            const p = principalRole(seq)
            return (
              <li key={t.id} className="py-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-[15px] truncate">{fullName(t)}</div>
                    {coverage.hasRoleSequences && (
                      <div className={`text-ui-sm ${count ? 'text-gray-500' : 'text-[rgb(var(--c-warning))] font-medium'}`}>
                        {count ? `${principalRole(sequences.find(hasRoles))} ${count} fois` : `Jamais ${String(principalRole(sequences.find(hasRoles)) || 'rôle principal').toLowerCase()}`}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {hasRoles(seq) && (
                      <button type="button" onClick={() => cycleRole(t)} disabled={!canWrite}
                        aria-label={`Rôle de ${fullName(t)} : ${row?.role || 'aucun'}, toucher pour changer`}
                        className={`min-h-[44px] px-2.5 rounded-ui-sm text-ui-sm font-semibold border ${row?.role === p ? 'bg-nav text-nav-fg border-transparent' : row?.role ? 'bg-gray-100 border-gray-100' : 'bg-white text-gray-500 border-gray-300'}`}>
                        {row?.role || 'Rôle'}
                      </button>
                    )}
                    <button type="button" onClick={() => openSheet(t)} disabled={!canWrite} aria-label={`Remarque pour ${fullName(t)}`}
                      className="relative w-11 h-11 rounded-ui-sm border border-gray-300 bg-white flex items-center justify-center">
                      <MessageSquare className="w-[18px] h-[18px]" aria-hidden="true" />
                      {(row?.remark || (row?.indicators_met || []).length > 0) && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent-500" />}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {STATUSES.map((st) => (
                    <StatusButton key={st.key} st={st} active={eff.key === st.key} fromGroup={eff.source === 'groupe'}
                      onClick={() => setStatus(t, st.key)} disabled={!canWrite} label={`${fullName(t)} : ${st.label}`} />
                  ))}
                </div>
                {row?.remark && !compact && <p className="text-ui-sm text-gray-600">« {row.remark} »</p>}
              </li>
            )
          })}
          {trainees.length === 0 && <li className="py-8 text-center text-ui text-gray-500">Aucun stagiaire présent pour cette séquence</li>}
        </ul>
      )}

      <footer className="sticky bottom-0 bg-white border-t border-gray-200 px-4 pt-2.5 pb-4 space-y-2">
        {coverage.hasRoleSequences && neverNames.length > 0 && (
          <div className="flex items-start gap-2 text-[13px] px-2.5 py-2 rounded-ui-sm bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>Jamais {String(principalRole(sequences.find(hasRoles)) || 'en rôle principal').toLowerCase()} : {neverNames.join(', ')}. {remaining} séquence{remaining > 1 ? 's' : ''} pratique{remaining > 1 ? 's' : ''} restante{remaining > 1 ? 's' : ''}.</span>
          </div>
        )}
        {canWrite ? (
          <button type="button" onClick={toggleClose}
            className={`w-full min-h-[48px] rounded-ui font-semibold text-[15px] flex items-center justify-center gap-2 ${seq?.closed_at ? 'bg-white border border-gray-300 text-gray-800' : 'bg-accent-500 text-white'}`}>
            {seq?.closed_at ? <><RotateCcw className="w-4 h-4" aria-hidden="true" />Rouvrir la séquence</> : <><Check className="w-4 h-4" aria-hidden="true" />Séquence terminée</>}
          </button>
        ) : (
          <p className="text-center text-ui text-gray-500">Lecture seule</p>
        )}
      </footer>

      {sheet && seq && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setSheet(null)}>
          <section role="dialog" aria-label={`${fullName(sheet.trainee)}, séquence ${seqIndex + 1}`} onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-white rounded-t-2xl px-4 pt-2.5 pb-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="w-10 h-1 rounded bg-gray-300 mx-auto" />
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-display font-semibold text-lg">{fullName(sheet.trainee)}</h2>
                <p className="text-ui text-gray-500">S{seqIndex + 1} · {seq.title}</p>
              </div>
              <button type="button" onClick={() => setSheet(null)} aria-label="Fermer" className="w-11 h-11 rounded-ui-sm border border-gray-300 flex items-center justify-center"><X className="w-[18px] h-[18px]" /></button>
            </div>

            {hasRoles(seq) && (
              <fieldset>
                <legend className="text-[13px] font-semibold text-gray-600 mb-2">Rôle tenu dans la mise en situation</legend>
                <div className="grid grid-cols-2 gap-2">
                  {['', ...seq.roles].map((r) => (
                    <label key={r || 'aucun'} className={`min-h-[44px] flex items-center gap-2 px-3 rounded-ui-sm border text-ui ${sheet.role === r ? 'bg-nav text-nav-fg border-transparent font-semibold' : 'border-gray-300'}`}>
                      <input type="radio" name="sf-role" checked={sheet.role === r} onChange={() => setSheet({ ...sheet, role: r })} />
                      {r || 'Aucun'}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {(seq.success_indicators || []).length > 0 && (
              <fieldset>
                <legend className="text-[13px] font-semibold text-gray-600 mb-1">Indicateurs de réussite</legend>
                {seq.success_indicators.map((ind) => (
                  <label key={ind} className="min-h-[44px] flex items-center gap-2.5 text-ui">
                    <input type="checkbox" className="w-5 h-5" checked={sheet.indicators.includes(ind)}
                      onChange={(e) => setSheet({ ...sheet, indicators: e.target.checked ? [...sheet.indicators, ind] : sheet.indicators.filter((x) => x !== ind) })} />
                    {ind}
                  </label>
                ))}
              </fieldset>
            )}

            <div className="space-y-2">
              <label htmlFor="sf-remark" className="text-[13px] font-semibold text-gray-600">Remarque (facultative)</label>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_REMARKS.map((q) => (
                  <button key={q} type="button" onClick={() => setSheet({ ...sheet, remark: sheet.remark ? `${sheet.remark.replace(/\s+$/, '')} ${q}.` : `${q}.` })}
                    className="min-h-[36px] px-2.5 rounded-full border border-gray-300 text-[13px]">{q}</button>
                ))}
              </div>
              <div className="flex gap-2 items-start">
                <textarea id="sf-remark" rows={2} value={sheet.remark} onChange={(e) => setSheet({ ...sheet, remark: e.target.value })}
                  className="input flex-1 resize-none text-ui" />
                <SpeechToTextButton compact onTranscript={(txt) => setSheet((s) => ({ ...s, remark: s.remark ? `${s.remark} ${txt}` : txt }))} />
              </div>
            </div>

            <button type="button" onClick={saveSheet} className="w-full min-h-[48px] rounded-ui bg-nav text-nav-fg font-semibold">Enregistrer</button>
          </section>
        </div>
      )}
    </div>
  )
}

function AvantEpreuve({ coverage, onBack, principal }) {
  const name = (t) => `${t.first_name} ${t.last_name}`.trim()
  const missing = coverage.byCompetence.filter((c) => c.missing.length)
  const complete = coverage.byCompetence.filter((c) => !c.missing.length)
  return (
    <div className="flex flex-col min-h-full bg-gray-50">
      <div className="px-4 py-3 bg-white border-b border-gray-200">
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-ui min-h-[40px]"><ChevronLeft className="w-4 h-4" aria-hidden="true" />Saisie</button>
        <h2 className="font-display font-semibold text-lg">Avant l'épreuve</h2>
        <p className="text-ui text-gray-500">Qui n'a pas encore été vu, compétence par compétence</p>
      </div>
      <div className="p-4 space-y-3">
        {!coverage.hasRoleSequences && <p className="text-ui text-gray-600">Aucune séquence avec rôles dans cette session.</p>}
        {missing.map((c) => (
          <section key={c.code} className="bg-white rounded-ui p-3.5 space-y-2">
            <div className="flex justify-between items-baseline">
              <h3 className="font-semibold text-[15px]">{c.code} · en {String(c.principal || principal || 'rôle principal').toLowerCase()}</h3>
              <span className="font-display font-semibold text-[rgb(var(--c-warning))]">{c.seen} / {c.total}</span>
            </div>
            <div className="h-2 rounded bg-gray-100 overflow-hidden"><div className="h-2 bg-[rgb(var(--c-warning))]" style={{ width: `${c.total ? Math.round((c.seen / c.total) * 100) : 0}%` }} /></div>
            <p className="text-ui">Pas encore : <strong>{c.missing.map(name).join(', ')}</strong></p>
          </section>
        ))}
        <section className="bg-white rounded-ui p-3.5 space-y-2">
          <div className="flex justify-between items-baseline">
            <h3 className="font-semibold text-[15px]">À revoir, pas encore repris</h3>
            <span className="font-display font-semibold text-[rgb(var(--c-danger))]">{coverage.pending.length}</span>
          </div>
          {coverage.pending.map((x, i) => (
            <p key={i} className="text-ui"><strong>{name(x.trainee)}</strong> · {x.sequence.title}{x.remark ? ` · « ${x.remark} »` : ''}</p>
          ))}
        </section>
        {complete.length > 0 && (
          <section className="bg-white rounded-ui p-3.5 space-y-1.5">
            <h3 className="font-semibold text-[15px] mb-1 flex items-center gap-1.5"><ClipboardCheck className="w-4 h-4 text-[rgb(var(--c-success))]" aria-hidden="true" />Toutes vues</h3>
            {complete.map((c) => (
              <div key={c.code} className="flex justify-between text-ui"><span>{c.code}</span><span className="font-semibold text-[rgb(var(--c-success))]">{c.seen} / {c.total}</span></div>
            ))}
          </section>
        )}
        <p className="text-ui-sm text-gray-500">Simple rappel : rien n'empêche de passer à l'épreuve. La grille de certification reste celle de l'onglet de certification.</p>
      </div>
    </div>
  )
}

export function SuiviLoader() {
  return <div className="py-16 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-gray-400" /></div>
}
