// Formation mixte (0452) : modules en ligne de la formation sur le portail du stagiaire, avant la session. Le temps
// passé est noté par tranches tant que le module est ouvert et visible ; les questions sont corrigées par la base.

import { useCallback, useEffect, useRef, useState } from 'react'
import { MonitorPlay, CheckCircle, ChevronLeft, ExternalLink, Loader2, Clock, X } from 'lucide-react'
import { supabase } from '../../../core/supabase'

const PAS = 30 // secondes entre deux notes du temps passé

/** Adresse intégrable d'une vidéo YouTube ou Vimeo, sinon null (la vidéo s'ouvre alors dans un nouvel onglet) */
export function videoIntegrable(url) {
  const u = String(url || '')
  let m = u.match(/^https:\/\/(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{6,})/) || u.match(/^https:\/\/youtu\.be\/([A-Za-z0-9_-]{6,})/)
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`
  m = u.match(/^https:\/\/(?:www\.)?vimeo\.com\/(\d+)/)
  if (m) return `https://player.vimeo.com/video/${m[1]}`
  return null
}

export const resumeModules = (modules = []) => {
  const requis = modules.filter((m) => m.required)
  return { total: requis.length, faits: requis.filter((m) => m.suivi?.completed_at).length, minutes: Math.round(modules.reduce((t, m) => t + (m.suivi?.seconds || 0), 0) / 60) }
}

function Module({ m, suivre, onRetour }) {
  const [rep, setRep] = useState(() => (m.questions || []).map(() => null))
  const [busy, setBusy] = useState(false)
  const [resultat, setResultat] = useState(null)
  const [erreur, setErreur] = useState('')
  const embed = m.kind === 'video' ? videoIntegrable(m.url) : null
  // Temps passé : une note toutes les 30 s tant que la page est visible
  useEffect(() => {
    suivre(m.id, 'ouvrir').catch(() => {})
    const t = setInterval(() => { if (document.visibilityState === 'visible') suivre(m.id, 'temps', PAS).catch(() => {}) }, PAS * 1000)
    return () => clearInterval(t)
  }, [m.id, suivre])
  const terminer = async () => {
    if ((m.questions || []).length && rep.some((x) => x === null)) { setErreur('Répondez à toutes les questions'); return }
    setBusy(true); setErreur('')
    try { setResultat(await suivre(m.id, 'terminer', 0, (m.questions || []).length ? rep : null)) } catch (e) { setErreur(e.message) }
    setBusy(false)
  }
  const fait = resultat?.reussi || m.suivi?.completed_at
  return (
    <div className="space-y-4">
      <button type="button" onClick={onRetour} className="inline-flex items-center gap-1 text-ui-sm text-gray-600"><ChevronLeft className="w-4 h-4" aria-hidden="true" />Modules</button>
      <h3 className="font-display text-lg font-bold text-gray-900">{m.title}</h3>
      {m.duration_minutes && <p className="text-ui-sm text-gray-500 flex items-center gap-1"><Clock className="w-4 h-4" aria-hidden="true" />Environ {m.duration_minutes} min</p>}
      {m.body && <div className="text-ui text-gray-800 whitespace-pre-line leading-relaxed">{m.body}</div>}
      {embed && <div className="aspect-video rounded-ui overflow-hidden bg-black"><iframe src={embed} title={m.title} className="w-full h-full" allow="encrypted-media; picture-in-picture" allowFullScreen /></div>}
      {m.url && !embed && <a href={m.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary"><ExternalLink className="w-4 h-4" aria-hidden="true" />{m.kind === 'video' ? 'Voir la vidéo' : 'Ouvrir le contenu'}</a>}
      {(m.questions || []).length > 0 && !fait && (
        <section className="space-y-3">
          <h4 className="font-semibold text-gray-900">Pour valider ce module</h4>
          {m.questions.map((q, i) => (
            <fieldset key={i} className="space-y-1.5">
              <legend className="text-ui font-medium text-gray-900">{i + 1}. {q.q}</legend>
              {q.choix.map((c, k) => (
                <label key={k} className={`flex items-center gap-2 rounded-ui border px-3 py-2 min-h-[44px] ${rep[i] === k ? 'border-accent-500 bg-accent-50' : 'border-gray-200'}`}>
                  <input type="radio" name={`q${i}`} checked={rep[i] === k} onChange={() => setRep(rep.map((x, j) => (j === i ? k : x)))} />
                  <span className="text-ui">{c}</span>
                </label>
              ))}
            </fieldset>
          ))}
        </section>
      )}
      {resultat && !resultat.reussi && <p className="text-ui-sm text-[rgb(var(--c-danger))]">{resultat.score} % de bonnes réponses ({m.pass_percent} % demandés) : relisez le module et réessayez.</p>}
      {erreur && <p className="text-ui-sm text-[rgb(var(--c-danger))]">{erreur}</p>}
      {fait
        ? <p className="text-ui text-[rgb(var(--c-success))] flex items-center gap-2"><CheckCircle className="w-5 h-5" aria-hidden="true" />Module validé{resultat?.score != null || m.suivi?.score != null ? ` (${resultat?.score ?? m.suivi?.score} %)` : ''}</p>
        : <button type="button" className="btn btn-primary w-full" onClick={terminer} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{(m.questions || []).length ? 'Valider mes réponses' : 'J\'ai terminé ce module'}</button>}
    </div>
  )
}

/** Carte « Modules en ligne » du portail ; rien s'il n'y a pas de module (ou avant la migration 0452) */
export default function ModulesFormation({ token, traineeId, ticket, Carte }) {
  const [modules, setModules] = useState(null)
  const [ouvert, setOuvert] = useState(false)
  const [courant, setCourant] = useState(null)
  const vivant = useRef(true)
  const charger = useCallback(async () => {
    const { data, error } = await supabase.rpc('portal_modules', { p_token: token, p_trainee_id: traineeId, p_ticket: ticket || null })
    if (vivant.current) setModules(error || !Array.isArray(data) ? [] : data)
  }, [token, traineeId, ticket])
  useEffect(() => { vivant.current = true; charger(); return () => { vivant.current = false } }, [charger])
  const suivre = useCallback(async (moduleId, action, secondes = 0, reponses = null) => {
    const { data, error } = await supabase.rpc('portal_module_suivre', { p_token: token, p_trainee_id: traineeId, p_ticket: ticket || null,
      p_module: moduleId, p_action: action, p_seconds: secondes, p_reponses: reponses })
    if (error) throw new Error(error.message?.includes('Répondez') ? 'Répondez à toutes les questions' : 'Enregistrement impossible pour le moment')
    return data
  }, [token, traineeId, ticket])
  if (!modules || modules.length === 0) return null
  const r = resumeModules(modules)
  const fini = r.total > 0 && r.faits === r.total
  const fermer = () => { setOuvert(false); setCourant(null); charger() }
  return (
    <>
      <Carte icon={MonitorPlay} title="Modules en ligne" tone={fini ? 'done' : 'accent'} primary={!fini}
        subtitle="À suivre avant la formation, à votre rythme"
        status={fini ? `Terminés (${r.minutes} min)` : `${r.faits} / ${r.total} module${r.total > 1 ? 's' : ''} validé${r.faits > 1 ? 's' : ''}`}
        onClick={() => setOuvert(true)} />
      {ouvert && (
        <div className="fixed inset-0 z-50 bg-white overflow-y-auto" role="dialog" aria-modal="true" aria-label="Modules en ligne">
          <div className="max-w-2xl mx-auto px-4 py-5" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="font-display text-xl font-bold flex-1">Modules en ligne</h2>
              <button type="button" className="btn btn-ghost btn-icon" aria-label="Fermer" onClick={fermer}><X className="w-5 h-5" /></button>
            </div>
            {courant ? (
              <Module m={courant} suivre={suivre} onRetour={() => { setCourant(null); charger() }} />
            ) : (
              <ul className="space-y-2">
                {modules.map((m, i) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => setCourant(m)} className="w-full text-left rounded-ui-lg border-2 border-gray-100 hover:border-gray-200 p-4 flex items-center gap-3 min-h-[56px]">
                      <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${m.suivi?.completed_at ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : 'bg-gray-100 text-gray-600'}`}>
                        {m.suivi?.completed_at ? <CheckCircle className="w-5 h-5" aria-hidden="true" /> : i + 1}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-medium text-gray-900">{m.title}</span>
                        <span className="block text-ui-sm text-gray-500">{[m.duration_minutes && `${m.duration_minutes} min`, !m.required && 'facultatif', m.suivi?.completed_at && 'validé'].filter(Boolean).join(' · ')}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  )
}
