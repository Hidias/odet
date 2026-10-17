import { useEffect, useMemo, useState, useCallback } from 'react'
import { useDataStore } from '../../../core/store'
import { supabase } from '../../../core/supabase'
import {
  Plus, Trash2, X, FileText, CheckCircle, Download, RefreshCw, Play, Zap, Eye, EyeOff,
  ClipboardCheck, Trophy, BookOpen, ChevronDown, ChevronUp, ListOrdered,
} from 'lucide-react'
import toast from 'react-hot-toast'
import QuizEngine, { parseOptions } from '../quiz/QuizEngine'

// Banque de questions par thème de formation.
// Une question sert au positionnement et/ou à l'évaluation (entraînement + évaluation des acquis).
// Le niveau de difficulté compose les quiz mais n'est jamais montré aux stagiaires.

const KINDS = [
  { value: 'single', label: 'QCM' },
  { value: 'truefalse', label: 'Vrai / Faux' },
  { value: 'order', label: "Remettre dans l'ordre" },
  { value: 'open', label: 'Question ouverte' },
  { value: 'survey', label: 'Auto-évaluation' },
]
const DIFFICULTIES = [
  { value: 'facile', label: 'Facile', xp: 10 },
  { value: 'moyen', label: 'Moyen', xp: 15 },
  { value: 'difficile', label: 'Difficile', xp: 25 },
]
const kindLabel = (k) => KINDS.find((x) => x.value === k)?.label || k

// Correspondance thème de formation -> jeu de questions de référence livré avec l'application
const findRefTheme = (theme) => {
  const name = (theme?.name || '').toLowerCase()
  if (name.includes('sst') || name.includes('secourisme')) return 'SEC-SST-INI'
  if (name.includes('incendie') || name.includes('epi') || name.includes('extincteur')) return 'INC-EPI-EXT-INI'
  if (name.includes('électr') || name.includes('habilitation')) return 'ELEC-HAB-INI'
  if (name.includes('ergo') || name.includes('prap') || name.includes('gestes')) return 'ERGO-GP-PRAPIBC-INI'
  if (name.includes('r485') || name.includes('gerbeur')) return 'COND-R485-INI'
  if (name.includes('r489') || name.includes('chariot')) return 'COND-R489-INI'
  if (name.includes('prévention') || name.includes('prevention') || name.includes('duerp')) return 'PREV-DUERP-INI'
  return null
}

const emptyForm = () => ({
  question_text: '', kind: 'single', difficulty: 'facile', options: ['', '', ''], correct_index: null,
  explanation: '', for_positioning: true, for_evaluation: true,
})

export default function TestsPositionnement() {
  const { themes, fetchThemes } = useDataStore()
  const [selectedTheme, setSelectedTheme] = useState(null)
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [refQuestions, setRefQuestions] = useState([])
  const [showImportModal, setShowImportModal] = useState(false)
  const [filter, setFilter] = useState('all') // all | positioning | evaluation | inactive
  const [expanded, setExpanded] = useState({})
  const [preview, setPreview] = useState(null) // { mode, questions }

  useEffect(() => { fetchThemes() }, [])
  useEffect(() => {
    if (selectedTheme) loadQuestions(selectedTheme.id)
    else setQuestions([])
  }, [selectedTheme])

  const loadQuestions = async (themeId) => {
    setLoading(true)
    const { data, error } = await supabase.from('theme_questions').select('*').eq('theme_id', themeId).order('position', { ascending: true })
    if (!error) {
      setQuestions((data || []).map((q) => ({
        ...q,
        kind: q.kind || (q.question_type === 'open' ? 'open' : 'single'),
        options: parseOptions(q.options),
        correct_order: Array.isArray(q.correct_order) ? q.correct_order : null,
      })))
    }
    setLoading(false)
  }

  const loadRefQuestions = async (refThemeId) => {
    const { data } = await supabase.from('positioning_questions_ref').select('*').eq('positioning_theme_id', refThemeId).order('position', { ascending: true })
    setRefQuestions((data || []).map((q) => ({ ...q, options: parseOptions(q.options) })))
  }

  // Enregistrement (débouncé par question)
  const persist = useCallback(async (questionId, q) => {
    setSaving(true)
    const payload = {
      question_text: q.question_text,
      question_type: q.kind === 'open' ? 'open' : 'single_choice',
      kind: q.kind,
      difficulty: q.difficulty,
      options: JSON.stringify(q.options || []),
      correct_index: q.kind === 'open' || q.kind === 'survey' || q.kind === 'order' ? null : q.correct_index,
      correct_order: q.kind === 'order' ? (q.correct_order || []) : null,
      explanation: q.explanation || null,
      xp: q.kind === 'open' || q.kind === 'survey' ? 0 : (DIFFICULTIES.find((d) => d.value === q.difficulty)?.xp || 10),
      for_positioning: !!q.for_positioning,
      for_evaluation: q.kind === 'open' || q.kind === 'survey' ? false : !!q.for_evaluation,
      is_active: q.is_active !== false,
      image_url: q.image_url || null,
      scoring_rubric: q.scoring_rubric || null,
      critical: !!q.critical,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('theme_questions').update(payload).eq('id', questionId)
    setSaving(false)
    if (error) {
      toast.error('Erreur de sauvegarde')
      console.error(error)
    }
  }, [])

  const timers = useMemo(() => ({}), [])
  const update = (questionId, patch) => {
    setQuestions((prev) => prev.map((q) => {
      if (q.id !== questionId) return q
      let next = { ...q, ...patch }
      if (patch.kind === 'truefalse' && !(q.options?.length === 2 && q.options[0] === 'Vrai')) next.options = ['Vrai', 'Faux']
      if (patch.kind === 'open') next = { ...next, for_evaluation: false }
      if (patch.kind === 'survey') next = { ...next, for_evaluation: false, correct_index: null }
      clearTimeout(timers[questionId])
      timers[questionId] = setTimeout(() => persist(questionId, next), 700)
      return next
    }))
  }

  const updateOption = (questionId, idx, value) => {
    const q = questions.find((x) => x.id === questionId)
    const options = [...(q.options || [])]
    options[idx] = value
    update(questionId, { options })
  }
  const addOption = (questionId) => {
    const q = questions.find((x) => x.id === questionId)
    update(questionId, { options: [...(q.options || []), ''] })
  }
  const removeOption = (questionId, idx) => {
    const q = questions.find((x) => x.id === questionId)
    const options = (q.options || []).filter((_, i) => i !== idx)
    let correct_index = q.correct_index
    if (correct_index === idx) correct_index = null
    else if (correct_index > idx) correct_index -= 1
    const correct_order = (q.correct_order || []).filter((i) => i !== idx).map((i) => (i > idx ? i - 1 : i))
    update(questionId, { options, correct_index, correct_order })
  }

  const createQuestion = async () => {
    if (!form.question_text.trim()) return toast.error('Le texte de la question est requis')
    if (!selectedTheme) return toast.error('Sélectionnez un thème')
    const options = form.kind === 'truefalse' ? ['Vrai', 'Faux'] : form.kind === 'open' ? [] : form.options.filter((o) => o.trim())
    const scored = !['open', 'survey'].includes(form.kind)
    const payload = {
      theme_id: selectedTheme.id,
      question_text: form.question_text.trim(),
      question_type: form.kind === 'open' ? 'open' : 'single_choice',
      kind: form.kind,
      difficulty: form.difficulty,
      options: JSON.stringify(options),
      correct_index: scored && form.kind !== 'order' ? form.correct_index : null,
      correct_order: form.kind === 'order' ? options.map((_, i) => i) : null,
      explanation: form.explanation || null,
      xp: scored ? (DIFFICULTIES.find((d) => d.value === form.difficulty)?.xp || 10) : 0,
      for_positioning: !!form.for_positioning,
      for_evaluation: scored && !!form.for_evaluation,
      is_active: true,
      score: 1,
      position: questions.length,
    }
    const { data, error } = await supabase.from('theme_questions').insert(payload).select().single()
    if (error) {
      toast.error('Erreur lors de la création')
      console.error(error)
      return
    }
    setQuestions((prev) => [...prev, { ...data, options: parseOptions(data.options) }])
    setExpanded((e) => ({ ...e, [data.id]: true }))
    toast.success('Question créée')
    setForm(emptyForm())
    setShowForm(false)
  }

  const deleteQuestion = async (questionId) => {
    if (!confirm('Supprimer cette question ? Les réponses déjà enregistrées sont conservées.')) return
    const { error } = await supabase.from('theme_questions').delete().eq('id', questionId)
    if (error) {
      // Des réponses y font référence : on la désactive plutôt
      update(questionId, { is_active: false })
      toast('Question désactivée (des réponses y font référence)')
      return
    }
    setQuestions((prev) => prev.filter((q) => q.id !== questionId))
    toast.success('Question supprimée')
  }

  const importRefQuestions = async () => {
    if (!selectedTheme || refQuestions.length === 0) return
    setLoading(true)
    let imported = 0
    for (const refQ of refQuestions) {
      const exists = questions.find((q) => q.question_text?.toLowerCase() === refQ.question_text?.toLowerCase())
      if (exists) continue
      const isOpen = refQ.question_type === 'open'
      const isSurvey = !isOpen && (refQ.correct_index === null || refQ.correct_index === undefined)
      const { error } = await supabase.from('theme_questions').insert({
        theme_id: selectedTheme.id,
        question_text: refQ.question_text,
        question_type: refQ.question_type,
        kind: isOpen ? 'open' : isSurvey ? 'survey' : 'single',
        difficulty: 'facile',
        options: JSON.stringify(refQ.options || []),
        correct_index: refQ.correct_index,
        score: refQ.score,
        critical: refQ.critical,
        scoring_rubric: refQ.scoring_rubric,
        xp: isOpen || isSurvey ? 0 : 10,
        for_positioning: true,
        for_evaluation: !(isOpen || isSurvey),
        position: questions.length + imported,
      })
      if (!error) imported++
    }
    await loadQuestions(selectedTheme.id)
    setLoading(false)
    setShowImportModal(false)
    toast.success(`${imported} question(s) importée(s)`)
  }

  // Aperçu du quiz tel que le verra le stagiaire (correction locale, rien n'est enregistré)
  const openPreview = (mode) => {
    const pool = questions.filter((q) => q.is_active !== false && (mode === 'positioning' ? q.for_positioning : q.for_evaluation))
    if (pool.length === 0) return toast.error('Aucune question pour cet aperçu')
    let list = pool
    if (mode !== 'positioning') {
      const pick = (d, n) => pool.filter((q) => q.difficulty === d).sort(() => Math.random() - 0.5).slice(0, n)
      list = [...pick('facile', 8), ...pick('moyen', 2), ...pick('difficile', 2)].sort(() => Math.random() - 0.5)
    }
    setPreview({ mode, questions: list.map((q) => ({ ...q, options: q.options })) })
  }
  const previewCheck = async (q, answer) => {
    const src = questions.find((x) => x.id === q.id)
    const ok = src.kind === 'order'
      ? JSON.stringify(answer.order) === JSON.stringify(src.correct_order || [])
      : answer.index === src.correct_index
    return { correct: ok, explanation: src.explanation, correct_index: src.correct_index, correct_order: src.correct_order, xp: ok ? src.xp : 0 }
  }

  const stats = useMemo(() => ({
    total: questions.length,
    positioning: questions.filter((q) => q.for_positioning && q.is_active !== false).length,
    evaluation: questions.filter((q) => q.for_evaluation && q.is_active !== false).length,
    byLevel: DIFFICULTIES.map((d) => ({ ...d, n: questions.filter((q) => q.for_evaluation && q.is_active !== false && q.difficulty === d.value).length })),
  }), [questions])

  const visible = questions.filter((q) => {
    if (filter === 'positioning') return q.for_positioning
    if (filter === 'evaluation') return q.for_evaluation
    if (filter === 'inactive') return q.is_active === false
    return true
  })

  if (preview) {
    const titles = { positioning: 'Aperçu du positionnement', training: "Aperçu de l'entraînement" }
    return (
      <QuizEngine
        questions={preview.questions}
        mode={preview.mode}
        title={titles[preview.mode]}
        onCheck={previewCheck}
        onFinish={async (answers, local) => ({ score: local?.correct ?? 0, max_score: preview.questions.length, xp: local?.xp ?? 0 })}
        onClose={() => setPreview(null)}
        closeLabel="Fermer l'aperçu"
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Tests et quiz</h1>
          <p className="muted mt-0.5">Banque de questions par thème : positionnement, entraînement et évaluation des acquis</p>
        </div>
        {saving && <div className="flex items-center gap-2 text-ui-sm text-gray-500"><RefreshCw className="w-4 h-4 animate-spin" /> Enregistrement</div>}
      </div>

      {/* Thèmes */}
      <div className="flex flex-wrap gap-2">
        {themes.map((t) => (
          <button key={t.id} type="button" onClick={() => setSelectedTheme(t)}
            className={`px-3 h-9 rounded-full border text-ui font-medium transition-colors ${selectedTheme?.id === t.id ? 'bg-primary-900 text-white border-primary-900' : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'}`}>
            {t.name}
          </button>
        ))}
        {themes.length === 0 && <p className="muted">Aucun thème de formation. Créez-en dans Formations.</p>}
      </div>

      {!selectedTheme && (
        <div className="card text-center py-12 text-gray-500">
          <ClipboardCheck className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p>Choisissez un thème pour gérer ses questions.</p>
        </div>
      )}

      {selectedTheme && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="card">
              <div className="text-ui-sm muted">Questions</div>
              <div className="font-display text-2xl font-bold text-gray-900">{stats.total}</div>
            </div>
            <div className="card">
              <div className="text-ui-sm muted flex items-center gap-1"><ClipboardCheck className="w-3.5 h-3.5" /> Positionnement</div>
              <div className="font-display text-2xl font-bold text-gray-900">{stats.positioning}</div>
            </div>
            <div className="card">
              <div className="text-ui-sm muted flex items-center gap-1"><Trophy className="w-3.5 h-3.5" /> Évaluation</div>
              <div className="font-display text-2xl font-bold text-gray-900">{stats.evaluation}</div>
            </div>
            <div className="card">
              <div className="text-ui-sm muted">Par niveau (évaluation)</div>
              <div className="flex gap-3 mt-1">
                {stats.byLevel.map((d) => (
                  <div key={d.value} className="text-center">
                    <div className="font-display text-lg font-bold text-gray-900">{d.n}</div>
                    <div className="text-ui-sm uppercase tracking-wide text-gray-500">{d.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowForm(true)} className="btn btn-primary"><Plus className="w-4 h-4" /> Nouvelle question</button>
            <button onClick={() => openPreview('positioning')} className="btn btn-secondary" disabled={stats.positioning === 0}><Play className="w-4 h-4" /> Aperçu positionnement</button>
            <button onClick={() => openPreview('training')} className="btn btn-secondary" disabled={stats.evaluation === 0}><BookOpen className="w-4 h-4" /> Aperçu entraînement</button>
            {findRefTheme(selectedTheme) && (
              <button onClick={() => { loadRefQuestions(findRefTheme(selectedTheme)); setShowImportModal(true) }} className="btn btn-ghost">
                <Download className="w-4 h-4" /> Importer les questions de référence
              </button>
            )}
            <div className="ml-auto flex gap-1">
              {[['all', 'Toutes'], ['positioning', 'Positionnement'], ['evaluation', 'Évaluation'], ['inactive', 'Désactivées']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setFilter(k)} className={`btn btn-sm ${filter === k ? 'bg-gray-900 text-white' : 'btn-ghost'}`}>{l}</button>
              ))}
            </div>
          </div>

          <p className="text-ui-sm muted">
            L'entraînement et l'évaluation des acquis tirent 8 questions faciles, 2 moyennes et 2 difficiles parmi les questions marquées « Évaluation ».
            Le niveau n'est jamais affiché aux stagiaires. L'explication s'affiche après chaque réponse.
          </p>

          {loading ? (
            <div className="card p-8 text-center"><RefreshCw className="w-6 h-6 animate-spin mx-auto text-gray-400" /></div>
          ) : visible.length === 0 ? (
            <div className="card p-8 text-center text-gray-500">
              <FileText className="w-10 h-10 mx-auto mb-3 text-gray-300" />
              <p>Aucune question{filter !== 'all' ? ' pour ce filtre' : ' pour ce thème'}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visible.map((q, idx) => {
                const open = expanded[q.id]
                const scored = !['open', 'survey'].includes(q.kind)
                return (
                  <div key={q.id} className={`card ${q.is_active === false ? 'opacity-60' : ''}`}>
                    <div className="flex items-start gap-3">
                      <span className="badge badge-neutral mt-0.5">{idx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <textarea value={q.question_text || ''} onChange={(e) => update(q.id, { question_text: e.target.value })}
                          className="textarea w-full font-medium resize-none" rows={open ? 2 : 1} placeholder="Texte de la question" />
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          <span className="badge badge-neutral">{kindLabel(q.kind)}</span>
                          {scored && <span className={`badge ${q.difficulty === 'difficile' ? 'badge-danger' : q.difficulty === 'moyen' ? 'badge-warning' : 'badge-success'}`}>{DIFFICULTIES.find((d) => d.value === q.difficulty)?.label || q.difficulty}</span>}
                          {q.for_positioning && <span className="badge badge-info"><ClipboardCheck className="w-3 h-3" /> Positionnement</span>}
                          {q.for_evaluation && <span className="badge badge-brand"><Trophy className="w-3 h-3" /> Évaluation</span>}
                          {scored && <span className="badge badge-neutral"><Zap className="w-3 h-3" /> {q.xp} XP</span>}
                          {scored && q.kind !== 'order' && q.correct_index === null && <span className="badge badge-danger">Bonne réponse manquante</span>}
                          {q.for_evaluation && !q.explanation && <span className="badge badge-warning">Sans explication</span>}
                          {q.is_active === false && <span className="badge badge-neutral">Désactivée</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => update(q.id, { is_active: q.is_active === false })} className="btn btn-ghost btn-icon" title={q.is_active === false ? 'Réactiver' : 'Désactiver'}>
                          {q.is_active === false ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                        <button type="button" onClick={() => deleteQuestion(q.id)} className="btn btn-ghost btn-icon text-[rgb(var(--c-danger))]" title="Supprimer"><Trash2 className="w-4 h-4" /></button>
                        <button type="button" onClick={() => setExpanded((e) => ({ ...e, [q.id]: !open }))} className="btn btn-ghost btn-icon">
                          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {open && (
                      <div className="mt-4 grid lg:grid-cols-[1fr_280px] gap-5">
                        <div className="space-y-4">
                          {(q.kind === 'single' || q.kind === 'survey' || q.kind === 'truefalse' || q.kind === 'image') && (
                            <div>
                              <div className="label">{q.kind === 'survey' ? 'Choix proposés (sans bonne réponse)' : 'Options (cochez la bonne réponse)'}</div>
                              <div className="space-y-2">
                                {(q.options || []).map((opt, i) => (
                                  <div key={i} className="flex items-center gap-2">
                                    {q.kind !== 'survey' && (
                                      <button type="button" onClick={() => update(q.id, { correct_index: i })}
                                        className={`w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${q.correct_index === i ? 'border-[rgb(var(--c-success))] bg-[rgb(var(--c-success))] text-white' : 'border-gray-300 hover:border-gray-400'}`}
                                        title="Bonne réponse">
                                        {q.correct_index === i && <CheckCircle className="w-4 h-4" />}
                                      </button>
                                    )}
                                    <input type="text" value={opt} onChange={(e) => updateOption(q.id, i, e.target.value)} className="input flex-1" placeholder={`Option ${i + 1}`} disabled={q.kind === 'truefalse'} />
                                    {q.kind !== 'truefalse' && (
                                      <button type="button" onClick={() => removeOption(q.id, i)} className="btn btn-ghost btn-icon text-gray-400"><X className="w-4 h-4" /></button>
                                    )}
                                  </div>
                                ))}
                              </div>
                              {q.kind !== 'truefalse' && (
                                <button type="button" onClick={() => addOption(q.id)} className="btn btn-ghost btn-sm mt-2"><Plus className="w-4 h-4" /> Ajouter une option</button>
                              )}
                            </div>
                          )}

                          {q.kind === 'order' && (
                            <div>
                              <div className="label">Éléments (saisis dans le bon ordre : ils seront mélangés pour le stagiaire)</div>
                              <div className="space-y-2">
                                {(q.options || []).map((opt, i) => (
                                  <div key={i} className="flex items-center gap-2">
                                    <span className="w-7 h-7 rounded-ui-sm bg-primary-900 text-white text-ui-sm font-bold flex items-center justify-center flex-shrink-0">{(q.correct_order || []).indexOf(i) + 1 || '?'}</span>
                                    <input type="text" value={opt} onChange={(e) => updateOption(q.id, i, e.target.value)} className="input flex-1" />
                                    <button type="button" onClick={() => removeOption(q.id, i)} className="btn btn-ghost btn-icon text-gray-400"><X className="w-4 h-4" /></button>
                                  </div>
                                ))}
                              </div>
                              <div className="flex gap-2 mt-2">
                                <button type="button" onClick={() => addOption(q.id)} className="btn btn-ghost btn-sm"><Plus className="w-4 h-4" /> Ajouter</button>
                                <button type="button" onClick={() => update(q.id, { correct_order: (q.options || []).map((_, i) => i) })} className="btn btn-ghost btn-sm"><ListOrdered className="w-4 h-4" /> L'ordre saisi est le bon ordre</button>
                              </div>
                            </div>
                          )}

                          {q.kind === 'open' && (
                            <div>
                              <div className="label">Critères de notation (pour le formateur)</div>
                              <textarea value={q.scoring_rubric || ''} onChange={(e) => update(q.id, { scoring_rubric: e.target.value })} className="textarea w-full" rows={2} placeholder="1 point si 2 exemples concrets et pertinents" />
                            </div>
                          )}

                          {scored && (
                            <div>
                              <div className="label">Explication affichée après la réponse</div>
                              <textarea value={q.explanation || ''} onChange={(e) => update(q.id, { explanation: e.target.value })} className="textarea w-full" rows={2} placeholder="Pourquoi c'est la bonne réponse, en une ou deux phrases" />
                            </div>
                          )}
                        </div>

                        <div className="space-y-3">
                          <div>
                            <div className="label">Type</div>
                            <select value={q.kind} onChange={(e) => update(q.id, { kind: e.target.value })} className="select">
                              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                            </select>
                          </div>
                          {scored && (
                            <div>
                              <div className="label">Niveau (jamais affiché)</div>
                              <div className="flex gap-1">
                                {DIFFICULTIES.map((d) => (
                                  <button key={d.value} type="button" onClick={() => update(q.id, { difficulty: d.value, xp: d.xp })}
                                    className={`flex-1 h-9 rounded-ui-sm border text-ui-sm font-medium ${q.difficulty === d.value ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200'}`}>
                                    {d.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          <div>
                            <div className="label">Utilisation</div>
                            <label className="flex items-center gap-2 text-ui py-1 cursor-pointer">
                              <input type="checkbox" checked={!!q.for_positioning} onChange={(e) => update(q.id, { for_positioning: e.target.checked })} className="w-4 h-4 accent-[rgb(var(--c-accent-500))]" /> Test de positionnement
                            </label>
                            <label className={`flex items-center gap-2 text-ui py-1 ${scored ? 'cursor-pointer' : 'opacity-50'}`}>
                              <input type="checkbox" checked={!!q.for_evaluation} disabled={!scored} onChange={(e) => update(q.id, { for_evaluation: e.target.checked })} className="w-4 h-4 accent-[rgb(var(--c-accent-500))]" /> Entraînement et évaluation des acquis
                            </label>
                          </div>
                          <div>
                            <div className="label">Image (URL, facultatif)</div>
                            <input type="url" value={q.image_url || ''} onChange={(e) => update(q.id, { image_url: e.target.value })} className="input" placeholder="https://" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Nouvelle question */}
      {showForm && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowForm(false)} />
          <div className="relative min-h-full flex items-center justify-center p-4">
            <div className="relative bg-white rounded-ui-lg shadow-md w-full max-w-lg">
              <div className="flex items-center justify-between p-4 border-b border-gray-100">
                <h2 className="section-title">Nouvelle question</h2>
                <button onClick={() => setShowForm(false)} className="btn btn-ghost btn-icon"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <label className="label">Question</label>
                  <textarea value={form.question_text} onChange={(e) => setForm({ ...form, question_text: e.target.value })} className="textarea w-full" rows={3} autoFocus />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Type</label>
                    <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, options: e.target.value === 'truefalse' ? ['Vrai', 'Faux'] : form.options })} className="select">
                      {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                    </select>
                  </div>
                  {!['open', 'survey'].includes(form.kind) && (
                    <div>
                      <label className="label">Niveau</label>
                      <select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })} className="select">
                        {DIFFICULTIES.map((d) => <option key={d.value} value={d.value}>{d.label} ({d.xp} XP)</option>)}
                      </select>
                    </div>
                  )}
                </div>

                {form.kind !== 'open' && (
                  <div>
                    <label className="label">{form.kind === 'order' ? 'Éléments, dans le bon ordre' : form.kind === 'survey' ? 'Choix proposés' : 'Options (cochez la bonne réponse)'}</label>
                    {form.options.map((opt, idx) => (
                      <div key={idx} className="flex items-center gap-2 mb-2">
                        {form.kind !== 'order' && form.kind !== 'survey' && (
                          <button type="button" onClick={() => setForm({ ...form, correct_index: idx })}
                            className={`w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${form.correct_index === idx ? 'border-[rgb(var(--c-success))] bg-[rgb(var(--c-success))] text-white' : 'border-gray-300'}`}>
                            {form.correct_index === idx && <CheckCircle className="w-4 h-4" />}
                          </button>
                        )}
                        {form.kind === 'order' && <span className="w-7 h-7 rounded-ui-sm bg-primary-900 text-white text-ui-sm font-bold flex items-center justify-center">{idx + 1}</span>}
                        <input type="text" value={opt} disabled={form.kind === 'truefalse'}
                          onChange={(e) => { const o = [...form.options]; o[idx] = e.target.value; setForm({ ...form, options: o }) }}
                          className="input flex-1" placeholder={`Option ${idx + 1}`} />
                      </div>
                    ))}
                    {form.kind !== 'truefalse' && (
                      <button type="button" onClick={() => setForm({ ...form, options: [...form.options, ''] })} className="btn btn-ghost btn-sm"><Plus className="w-4 h-4" /> Ajouter une option</button>
                    )}
                  </div>
                )}

                {!['open', 'survey'].includes(form.kind) && (
                  <div>
                    <label className="label">Explication (affichée après la réponse)</label>
                    <textarea value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} className="textarea w-full" rows={2} />
                  </div>
                )}

                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-ui cursor-pointer">
                    <input type="checkbox" checked={form.for_positioning} onChange={(e) => setForm({ ...form, for_positioning: e.target.checked })} className="w-4 h-4 accent-[rgb(var(--c-accent-500))]" /> Positionnement
                  </label>
                  {!['open', 'survey'].includes(form.kind) && (
                    <label className="flex items-center gap-2 text-ui cursor-pointer">
                      <input type="checkbox" checked={form.for_evaluation} onChange={(e) => setForm({ ...form, for_evaluation: e.target.checked })} className="w-4 h-4 accent-[rgb(var(--c-accent-500))]" /> Évaluation
                    </label>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2 p-4 border-t border-gray-100">
                <button onClick={() => setShowForm(false)} className="btn btn-secondary">Annuler</button>
                <button onClick={createQuestion} className="btn btn-primary"><Plus className="w-4 h-4" /> Créer</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import des questions de référence */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowImportModal(false)} />
          <div className="relative min-h-full flex items-center justify-center p-4">
            <div className="relative bg-white rounded-ui-lg shadow-md w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between p-4 border-b border-gray-100">
                <div>
                  <h2 className="section-title">Questions de référence</h2>
                  <p className="text-ui-sm muted">{refQuestions.length} questions livrées avec l'application pour ce thème</p>
                </div>
                <button onClick={() => setShowImportModal(false)} className="btn btn-ghost btn-icon"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 overflow-y-auto flex-1 space-y-2">
                {refQuestions.length === 0 && <p className="muted text-center py-8">Aucune question de référence trouvée</p>}
                {refQuestions.map((q, idx) => (
                  <div key={q.id} className="p-3 rounded-ui border border-gray-200">
                    <div className="flex items-start gap-2">
                      <span className="badge badge-neutral">{idx + 1}</span>
                      <div className="flex-1">
                        <p className="font-medium text-ui">{q.question_text}</p>
                        <div className="text-ui-sm muted mt-0.5">{q.question_type === 'open' ? 'Ouverte' : q.correct_index === null ? 'Auto-évaluation' : 'QCM'}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 p-4 border-t border-gray-100">
                <button onClick={() => setShowImportModal(false)} className="btn btn-secondary">Annuler</button>
                <button onClick={importRefQuestions} className="btn btn-primary" disabled={refQuestions.length === 0}><Download className="w-4 h-4" /> Importer les nouvelles</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
