// Formation mixte (0452) : modules en ligne d'une formation (fiche du catalogue) et suivi des stagiaires (session).

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { MonitorPlay, Plus, Pencil, Trash2, ArrowUp, ArrowDown, Loader2, CheckCircle } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { confirmer } from '../../../ui/Confirm'

const TYPES = { texte: 'Texte', video: 'Vidéo (YouTube, Vimeo ou lien)', lien: 'Lien vers un contenu' }
const vide = () => ({ title: '', kind: 'texte', body: '', url: '', duration_minutes: '', required: true, pass_percent: 70, questions: [] })

/** Lignes « Question ? / * bonne réponse / autre réponse » ↔ questions [{ q, choix, bonne }] */
export function questionsDepuisTexte(texte) {
  const blocs = String(texte || '').split(/\n\s*\n/).map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean)).filter((b) => b.length)
  return blocs.map((lignes) => {
    const [q, ...choix] = lignes
    const bonne = choix.findIndex((c) => c.startsWith('*'))
    return { q: q.replace(/^\d+[.)]\s*/, ''), choix: choix.map((c) => c.replace(/^[*-]\s*/, '')), bonne }
  })
}
export const questionsVersTexte = (qs) => (qs || []).map((q) => [q.q, ...q.choix.map((c, i) => `${i === q.bonne ? '* ' : '- '}${c}`)].join('\n')).join('\n\n')
export function motifQuestions(qs) {
  for (const [i, q] of (qs || []).entries()) {
    if (!q.q || q.q.length < 3) return `Question ${i + 1} : énoncé manquant`
    if (q.choix.length < 2 || q.choix.length > 6) return `Question ${i + 1} : 2 à 6 réponses`
    if (q.bonne < 0) return `Question ${i + 1} : marquez la bonne réponse par une étoile (*)`
  }
  return null
}

export function ModulesEnLigne({ courseId, peutGerer }) {
  const [l, setL] = useState(null)
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState(false)
  const charger = useCallback(() => supabase.from('course_modules').select('*').eq('course_id', courseId).is('archived_at', null).order('position').order('created_at')
    .then(({ data, error }) => setL(error ? [] : data || [])), [courseId])
  useEffect(() => { charger() }, [charger])
  if (!l) return null
  const enregistrer = async () => {
    const questions = questionsDepuisTexte(f.questionsTexte)
    const motif = motifQuestions(questions)
    if (motif) { toast.error(motif); return }
    if (f.kind !== 'texte' && !/^https:\/\//.test(f.url || '')) { toast.error('Adresse en https:// nécessaire'); return }
    setBusy(true)
    const ligne = {
      course_id: courseId, title: f.title.trim(), kind: f.kind, body: f.body?.trim() || null, url: f.kind === 'texte' ? (f.url?.trim() || null) : f.url.trim(),
      duration_minutes: f.duration_minutes ? Number(f.duration_minutes) : null, required: !!f.required, pass_percent: Number(f.pass_percent) || 0, questions,
      ...(f.id ? {} : { position: (l.at(-1)?.position ?? 0) + 1 }),
    }
    const { error } = f.id ? await supabase.from('course_modules').update(ligne).eq('id', f.id) : await supabase.from('course_modules').insert(ligne)
    setBusy(false)
    if (error) { toast.error(error.message); return }
    setF(null); charger()
  }
  const deplacer = async (i, d) => {
    const a = l[i]; const b = l[i + d]
    if (!a || !b) return
    await supabase.from('course_modules').update({ position: b.position }).eq('id', a.id)
    await supabase.from('course_modules').update({ position: a.position === b.position ? a.position + d : a.position }).eq('id', b.id)
    charger()
  }
  return (
    <div className="p-4 border-t space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-ui flex-1 flex items-center gap-2"><MonitorPlay className="w-4 h-4 text-gray-400" aria-hidden="true" />Modules en ligne (formation mixte)</h3>
        {peutGerer && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setF({ ...vide(), questionsTexte: '' })}><Plus className="w-4 h-4" aria-hidden="true" />Module</button>}
      </div>
      <p className="text-ui-sm text-gray-500">Suivis par les stagiaires sur leur portail avant la session : temps passé et validation notés tout seuls.</p>
      {l.length > 0 && (
        <ul className="divide-y divide-gray-100 text-ui-sm">
          {l.map((m, i) => (
            <li key={m.id} className="py-1.5 flex flex-wrap items-center gap-x-2">
              <span className="w-5 text-gray-400">{i + 1}.</span>
              <span className="font-medium flex-1 min-w-[10rem]">{m.title}</span>
              <span className="text-gray-500">{TYPES[m.kind]?.split(' ')[0]}{m.duration_minutes ? `, ${m.duration_minutes} min` : ''}{m.questions?.length ? `, ${m.questions.length} question${m.questions.length > 1 ? 's' : ''}` : ''}{m.required ? '' : ', facultatif'}</span>
              {peutGerer && <>
                <button type="button" className="btn btn-ghost btn-icon" aria-label="Monter" disabled={i === 0} onClick={() => deplacer(i, -1)}><ArrowUp className="w-4 h-4" /></button>
                <button type="button" className="btn btn-ghost btn-icon" aria-label="Descendre" disabled={i === l.length - 1} onClick={() => deplacer(i, 1)}><ArrowDown className="w-4 h-4" /></button>
                <button type="button" className="btn btn-ghost btn-icon" aria-label={`Modifier ${m.title}`} onClick={() => setF({ ...m, duration_minutes: m.duration_minutes ?? '', url: m.url || '', body: m.body || '', questionsTexte: questionsVersTexte(m.questions) })}><Pencil className="w-4 h-4" /></button>
                <button type="button" className="btn btn-ghost btn-icon" aria-label={`Retirer ${m.title}`} onClick={async () => {
                  if (!(await confirmer(`Retirer le module « ${m.title} » ? Le suivi déjà fait reste gardé.`))) return
                  const { error } = await supabase.from('course_modules').update({ archived_at: new Date().toISOString() }).eq('id', m.id)
                  if (error) toast.error(error.message); else charger()
                }}><Trash2 className="w-4 h-4" /></button>
              </>}
            </li>
          ))}
        </ul>
      )}
      {f && (
        <div className="card space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block sm:col-span-2"><span className="label">Titre</span><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
            <label className="block"><span className="label">Type</span><select className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(TYPES).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></label>
          </div>
          <label className="block"><span className="label">Texte du module</span><textarea className="input min-h-[6rem]" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
          {f.kind !== 'texte' && <label className="block"><span className="label">Adresse (https://…)</span><input className="input" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></label>}
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block"><span className="label">Durée prévue (min)</span><input className="input" inputMode="numeric" value={f.duration_minutes} onChange={(e) => setF({ ...f, duration_minutes: e.target.value.replace(/\D/g, '') })} /></label>
            <label className="block"><span className="label">Seuil de validation (%)</span><input className="input" inputMode="numeric" value={f.pass_percent} onChange={(e) => setF({ ...f, pass_percent: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></label>
            <label className="flex items-center gap-2 self-end min-h-[44px]"><input type="checkbox" checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} /><span className="text-ui">Obligatoire</span></label>
          </div>
          <label className="block"><span className="label">Questions de validation (facultatif)</span>
            <textarea className="input min-h-[6rem] font-mono text-ui-sm" value={f.questionsTexte} placeholder={'Un feu de papier est de classe…\n* A\n- B\n- C\n\n(une ligne vide entre deux questions, * devant la bonne réponse)'} onChange={(e) => setF({ ...f, questionsTexte: e.target.value })} />
          </label>
          <div className="flex gap-2"><button type="button" className="btn btn-primary btn-sm" onClick={enregistrer} disabled={busy || f.title.trim().length < 2}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setF(null)}>Annuler</button></div>
        </div>
      )}
    </div>
  )
}

/** Suivi des modules par stagiaire, sur la session */
export function SuiviModules({ session, inscrits = [] }) {
  const [d, setD] = useState(null)
  useEffect(() => {
    if (!session?.course_id) return
    Promise.all([
      supabase.from('course_modules').select('id, title, required').eq('course_id', session.course_id).is('archived_at', null).order('position'),
      supabase.from('course_module_progress').select('trainee_id, module_id, seconds_spent, completed_at, score_percent').eq('session_id', session.id),
    ]).then(([m, p]) => setD({ modules: m.data || [], suivi: p.data || [] }))
  }, [session?.id, session?.course_id])
  if (!d || !d.modules.length) return null
  const de = (t, m) => d.suivi.find((x) => x.trainee_id === t && x.module_id === m)
  const requis = d.modules.filter((m) => m.required)
  return (
    <div className="card space-y-2">
      <h3 className="font-semibold flex items-center gap-2"><MonitorPlay className="w-5 h-5 text-gray-400" aria-hidden="true" />Modules en ligne avant la session</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-ui-sm">
          <thead><tr className="text-left text-gray-500"><th className="py-1 pr-3 font-medium">Stagiaire</th><th className="py-1 pr-3 font-medium">Validés</th><th className="py-1 font-medium">Temps passé</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {inscrits.map((st) => {
              const t = st.id
              const faits = requis.filter((m) => de(t, m.id)?.completed_at).length
              const sec = d.modules.reduce((x, m) => x + (de(t, m.id)?.seconds_spent || 0), 0)
              return (
                <tr key={t}>
                  <td className="py-1.5 pr-3">{[st.first_name, st.last_name].filter(Boolean).join(' ')}</td>
                  <td className="py-1.5 pr-3">{faits === requis.length ? <span className="inline-flex items-center gap-1 text-[rgb(var(--c-success))]"><CheckCircle className="w-4 h-4" aria-hidden="true" />{faits} / {requis.length}</span> : `${faits} / ${requis.length}`}</td>
                  <td className="py-1.5">{sec ? `${Math.round(sec / 60)} min` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
