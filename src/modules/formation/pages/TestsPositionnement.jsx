import { useEffect, useState, useCallback } from 'react'
import { useDataStore } from '../../../core/store'
import { supabase } from '../../../core/supabase'
import { 
  Plus, Save, Edit, Trash2, X, ChevronDown, ChevronUp, 
  FileText, AlertTriangle, CheckCircle, Download, RefreshCw,
  GripVertical, Copy
} from 'lucide-react'
import toast from 'react-hot-toast'

// Thèmes prédéfinis avec leurs codes
const PREDEFINED_THEMES = [
  { id: 'SEC-SST-INI', name: 'Secourisme - SST (initial)', category: 'Secourisme' },
  { id: 'INC-EPI-EXT-INI', name: 'Incendie - EPI + extincteur (initial)', category: 'Incendie' },
  { id: 'ELEC-HAB-INI', name: 'Habilitation électrique - B0H0/BS/BE (initial)', category: 'Électricité' },
  { id: 'ERGO-GP-PRAPIBC-INI', name: 'Ergonomie - Gestes & postures + PRAP (initial)', category: 'Ergonomie' },
  { id: 'COND-R485-INI', name: 'Conduite - R485 Gerbeurs accompagnant (initial)', category: 'Conduite' },
  { id: 'COND-R489-INI', name: 'Conduite - R489 Chariots portés (initial)', category: 'Conduite' },
  { id: 'PREV-DUERP-INI', name: 'Prévention - DUERP (initial)', category: 'Prévention' },
]

export default function TestsPositionnement() {
  const { themes, fetchThemes } = useDataStore()
  
  const [selectedTheme, setSelectedTheme] = useState(null)
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [refQuestions, setRefQuestions] = useState([])
  const [showImportModal, setShowImportModal] = useState(false)
  
  // Formulaire pour nouvelle question
  const [form, setForm] = useState({
    question_text: '',
    question_type: 'single_choice',
    options: ['', '', ''],
    correct_index: null,
    score: 1,
    critical: false,
    scoring_rubric: ''
  })

  useEffect(() => {
    fetchThemes()
  }, [])

  // Charger les questions du thème sélectionné
  useEffect(() => {
    if (selectedTheme) {
      loadQuestions(selectedTheme.id)
    } else {
      setQuestions([])
    }
  }, [selectedTheme])

  const loadQuestions = async (themeId) => {
    setLoading(true)
    const { data, error } = await supabase
      .from('theme_questions')
      .select('*')
      .eq('theme_id', themeId)
      .order('position', { ascending: true })
    
    if (!error) {
      // Parser les options JSON si nécessaire
      const parsed = (data || []).map(q => ({
        ...q,
        options: typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || [])
      }))
      setQuestions(parsed)
    }
    setLoading(false)
  }

  // Charger les questions de référence pour l'import
  const loadRefQuestions = async (positioningThemeId) => {
    const { data } = await supabase
      .from('positioning_questions_ref')
      .select('*')
      .eq('positioning_theme_id', positioningThemeId)
      .order('position', { ascending: true })
    
    if (data) {
      setRefQuestions(data.map(q => ({
        ...q,
        options: typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || [])
      })))
    }
  }

  // AUTO-SAVE : Sauvegarder une question après modification
  const saveQuestion = useCallback(async (questionId, updates) => {
    setSaving(true)
    
    // Préparer les données
    const data = {
      ...updates,
      options: JSON.stringify(updates.options || []),
      updated_at: new Date().toISOString()
    }
    
    // Supprimer les champs internes
    delete data._saveTimeout
    delete data.id
    delete data.created_at
    
    const { error } = await supabase
      .from('theme_questions')
      .update(data)
      .eq('id', questionId)
    
    setSaving(false)
    
    if (error) {
      toast.error('Erreur de sauvegarde')
      console.error(error)
    } else {
      // Toast discret pour l'auto-save
      toast.success('Sauvegardé', { duration: 1000, icon: '✓' })
    }
  }, [])

  // Modifier une question inline avec auto-save
  const updateQuestionField = (questionId, field, value) => {
    setQuestions(prev => prev.map(q => {
      if (q.id === questionId) {
        const updated = { ...q, [field]: value }
        // Déclencher l'auto-save après 800ms de debounce
        clearTimeout(q._saveTimeout)
        updated._saveTimeout = setTimeout(() => {
          saveQuestion(questionId, updated)
        }, 800)
        return updated
      }
      return q
    }))
  }

  // Modifier une option spécifique
  const updateOption = (questionId, optionIndex, value) => {
    setQuestions(prev => prev.map(q => {
      if (q.id === questionId) {
        const newOptions = [...(q.options || [])]
        newOptions[optionIndex] = value
        const updated = { ...q, options: newOptions }
        clearTimeout(q._saveTimeout)
        updated._saveTimeout = setTimeout(() => {
          saveQuestion(questionId, updated)
        }, 800)
        return updated
      }
      return q
    }))
  }

  // Ajouter une option
  const addOption = (questionId) => {
    setQuestions(prev => prev.map(q => {
      if (q.id === questionId) {
        const newOptions = [...(q.options || []), '']
        const updated = { ...q, options: newOptions }
        saveQuestion(questionId, updated)
        return updated
      }
      return q
    }))
  }

  // Supprimer une option
  const removeOption = (questionId, optionIndex) => {
    setQuestions(prev => prev.map(q => {
      if (q.id === questionId) {
        const newOptions = (q.options || []).filter((_, i) => i !== optionIndex)
        // Ajuster correct_index si nécessaire
        let newCorrectIndex = q.correct_index
        if (q.correct_index === optionIndex) newCorrectIndex = null
        else if (q.correct_index > optionIndex) newCorrectIndex = q.correct_index - 1
        
        const updated = { ...q, options: newOptions, correct_index: newCorrectIndex }
        saveQuestion(questionId, updated)
        return updated
      }
      return q
    }))
  }

  // Créer une nouvelle question
  const createQuestion = async () => {
    if (!form.question_text) return toast.error('Question requise')
    if (!selectedTheme) return toast.error('Sélectionnez un thème')

    const newQuestion = {
      theme_id: selectedTheme.id,
      question_text: form.question_text,
      question_type: form.question_type,
      options: JSON.stringify(form.options.filter(o => o.trim())),
      correct_index: form.correct_index,
      score: form.score,
      critical: form.critical,
      scoring_rubric: form.scoring_rubric || null,
      position: questions.length
    }

    const { data, error } = await supabase
      .from('theme_questions')
      .insert(newQuestion)
      .select()
      .single()

    if (error) {
      toast.error('Erreur lors de la création')
      console.error(error)
    } else {
      const parsed = {
        ...data,
        options: typeof data.options === 'string' ? JSON.parse(data.options) : data.options
      }
      setQuestions(prev => [...prev, parsed])
      toast.success('Question créée ✓')
      resetForm()
    }
  }

  // Supprimer une question
  const deleteQuestion = async (questionId) => {
    if (!confirm('Supprimer cette question ?')) return

    const { error } = await supabase
      .from('theme_questions')
      .delete()
      .eq('id', questionId)

    if (!error) {
      setQuestions(prev => prev.filter(q => q.id !== questionId))
      toast.success('Question supprimée')
    }
  }

  // Importer les questions prédéfinies
  const importRefQuestions = async () => {
    if (!selectedTheme || refQuestions.length === 0) return

    setLoading(true)
    let imported = 0

    for (const refQ of refQuestions) {
      // Vérifier si la question existe déjà (par texte similaire)
      const exists = questions.find(q => 
        q.question_text?.toLowerCase() === refQ.question_text?.toLowerCase()
      )
      
      if (!exists) {
        const newQ = {
          theme_id: selectedTheme.id,
          question_text: refQ.question_text,
          question_type: refQ.question_type,
          options: JSON.stringify(refQ.options || []),
          correct_index: refQ.correct_index,
          score: refQ.score,
          critical: refQ.critical,
          scoring_rubric: refQ.scoring_rubric,
          position: questions.length + imported
        }

        const { error } = await supabase
          .from('theme_questions')
          .insert(newQ)

        if (!error) imported++
      }
    }

    await loadQuestions(selectedTheme.id)
    setLoading(false)
    setShowImportModal(false)
    toast.success(`${imported} question(s) importée(s)`)
  }

  const resetForm = () => {
    setForm({
      question_text: '',
      question_type: 'single_choice',
      options: ['', '', ''],
      correct_index: null,
      score: 1,
      critical: false,
      scoring_rubric: ''
    })
    setShowForm(false)
  }

  // Trouver le thème prédéfini correspondant
  const findMatchingPredefinedTheme = (theme) => {
    if (!theme) return null
    const name = theme.name?.toLowerCase() || ''
    
    if (name.includes('sst') || name.includes('secourisme')) return 'SEC-SST-INI'
    if (name.includes('incendie') || name.includes('epi') || name.includes('extincteur')) return 'INC-EPI-EXT-INI'
    if (name.includes('électr') || name.includes('habilitation')) return 'ELEC-HAB-INI'
    if (name.includes('ergo') || name.includes('prap') || name.includes('gestes')) return 'ERGO-GP-PRAPIBC-INI'
    if (name.includes('r485') || name.includes('gerbeur')) return 'COND-R485-INI'
    if (name.includes('r489') || name.includes('chariot')) return 'COND-R489-INI'
    if (name.includes('prévention') || name.includes('prevention') || name.includes('duerp')) return 'PREV-DUERP-INI'
    
    return null
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tests de Positionnement</h1>
          <p className="text-gray-500 mt-1">Gérez les questions par thème de formation</p>
        </div>
        {saving && (
          <div className="flex items-center gap-2 text-blue-600 text-sm">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Sauvegarde...
          </div>
        )}
      </div>

      {/* Sélection du thème */}
      <div className="card">
        <label className="label">Sélectionner un thème de formation</label>
        <select
          value={selectedTheme?.id || ''}
          onChange={(e) => {
            const theme = themes.find(t => t.id === e.target.value)
            setSelectedTheme(theme || null)
          }}
          className="input"
        >
          <option value="">-- Choisir un thème --</option>
          {themes.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      {selectedTheme && (
        <>
          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setShowForm(true)} className="btn btn-primary">
              <Plus className="w-4 h-4 mr-2" />Nouvelle question
            </button>
            
            {findMatchingPredefinedTheme(selectedTheme) && (
              <button 
                onClick={() => {
                  loadRefQuestions(findMatchingPredefinedTheme(selectedTheme))
                  setShowImportModal(true)
                }}
                className="btn btn-secondary"
              >
                <Download className="w-4 h-4 mr-2" />Importer questions prédéfinies
              </button>
            )}
          </div>

          {/* Statistiques */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="card bg-blue-50 border-blue-200">
              <p className="text-2xl font-bold text-blue-700">{questions.length}</p>
              <p className="text-sm text-blue-600">Questions</p>
            </div>
            <div className="card bg-red-50 border-red-200">
              <p className="text-2xl font-bold text-red-700">{questions.filter(q => q.critical).length}</p>
              <p className="text-sm text-red-600">Critiques</p>
            </div>
            <div className="card bg-green-50 border-green-200">
              <p className="text-2xl font-bold text-green-700">{questions.reduce((sum, q) => sum + (q.score || 0), 0)}</p>
              <p className="text-sm text-green-600">Score max</p>
            </div>
            <div className="card bg-purple-50 border-purple-200">
              <p className="text-2xl font-bold text-purple-700">{questions.filter(q => q.question_type === 'open').length}</p>
              <p className="text-sm text-purple-600">Ouvertes</p>
            </div>
          </div>

          {/* Liste des questions */}
          {loading ? (
            <div className="card p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            </div>
          ) : questions.length === 0 ? (
            <div className="card p-8 text-center text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>Aucune question pour ce thème</p>
              <p className="text-sm mt-2">Créez-en une ou importez les questions prédéfinies</p>
            </div>
          ) : (
            <div className="space-y-4">
              {questions.map((question, idx) => (
                <div 
                  key={question.id} 
                  className={`card border-l-4 ${question.critical ? 'border-l-red-500 bg-red-50/30' : 'border-l-blue-500'}`}
                >
                  {/* En-tête de la question */}
                  <div className="flex items-start gap-3 mb-3">
                    <span className="bg-gray-200 text-gray-700 text-sm font-medium px-2 py-1 rounded">
                      Q{idx + 1}
                    </span>
                    
                    <div className="flex-1">
                      <textarea
                        value={question.question_text || ''}
                        onChange={(e) => updateQuestionField(question.id, 'question_text', e.target.value)}
                        className="input w-full font-medium resize-none"
                        rows={2}
                        placeholder="Texte de la question..."
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      {question.critical && (
                        <span className="text-red-600" title="Question critique">
                          <AlertTriangle className="w-5 h-5" />
                        </span>
                      )}
                      <button 
                        onClick={() => deleteQuestion(question.id)}
                        className="text-red-500 hover:text-red-700 p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Paramètres */}
                  <div className="flex flex-wrap gap-4 mb-3 text-sm">
                    <label className="flex items-center gap-2">
                      <span className="text-gray-600">Type:</span>
                      <select
                        value={question.question_type || 'single_choice'}
                        onChange={(e) => updateQuestionField(question.id, 'question_type', e.target.value)}
                        className="input py-1 text-sm"
                      >
                        <option value="single_choice">QCM</option>
                        <option value="open">Question ouverte</option>
                      </select>
                    </label>

                    <label className="flex items-center gap-2">
                      <span className="text-gray-600">Score:</span>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={question.score || 0}
                        onChange={(e) => updateQuestionField(question.id, 'score', parseInt(e.target.value) || 0)}
                        className="input w-16 py-1 text-sm text-center"
                      />
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={question.critical || false}
                        onChange={(e) => updateQuestionField(question.id, 'critical', e.target.checked)}
                        className="w-4 h-4 text-red-600 rounded"
                      />
                      <span className="text-red-600 font-medium">Critique</span>
                    </label>
                  </div>

                  {/* Options pour QCM */}
                  {question.question_type === 'single_choice' && (
                    <div className="space-y-2 mt-3 pl-4 border-l-2 border-gray-200">
                      <p className="text-xs text-gray-500 font-medium">OPTIONS (cliquez sur ● pour définir la bonne réponse)</p>
                      {(question.options || []).map((option, optIdx) => (
                        <div key={optIdx} className="flex items-center gap-2">
                          <button
                            onClick={() => updateQuestionField(question.id, 'correct_index', optIdx)}
                            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                              question.correct_index === optIdx 
                                ? 'border-green-500 bg-green-500 text-white' 
                                : 'border-gray-300 hover:border-green-400'
                            }`}
                            title={question.correct_index === optIdx ? 'Bonne réponse' : 'Définir comme bonne réponse'}
                          >
                            {question.correct_index === optIdx && <CheckCircle className="w-4 h-4" />}
                          </button>
                          <input
                            type="text"
                            value={option}
                            onChange={(e) => updateOption(question.id, optIdx, e.target.value)}
                            className="input flex-1 py-1 text-sm"
                            placeholder={`Option ${optIdx + 1}`}
                          />
                          <button
                            onClick={() => removeOption(question.id, optIdx)}
                            className="text-gray-400 hover:text-red-500 p-1"
                            title="Supprimer cette option"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => addOption(question.id)}
                        className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                      >
                        <Plus className="w-4 h-4" />Ajouter une option
                      </button>
                    </div>
                  )}

                  {/* Rubrique de notation pour questions ouvertes */}
                  {question.question_type === 'open' && (
                    <div className="mt-3 pl-4 border-l-2 border-purple-200">
                      <label className="text-xs text-gray-500 font-medium block mb-1">
                        CRITÈRES DE NOTATION
                      </label>
                      <textarea
                        value={question.scoring_rubric || ''}
                        onChange={(e) => updateQuestionField(question.id, 'scoring_rubric', e.target.value)}
                        className="input w-full text-sm resize-none"
                        rows={2}
                        placeholder="Ex: 1 point si 2 exemples concrets et pertinents"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal nouvelle question */}
      {showForm && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={resetForm} />
          <div className="relative min-h-full flex items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg">
              <div className="flex items-center justify-between p-4 border-b">
                <h2 className="text-lg font-semibold">Nouvelle question</h2>
                <button onClick={resetForm}><X className="w-5 h-5" /></button>
              </div>

              <div className="p-4 space-y-4">
                <div>
                  <label className="label">Question *</label>
                  <textarea
                    value={form.question_text}
                    onChange={(e) => setForm({ ...form, question_text: e.target.value })}
                    className="input w-full"
                    rows={3}
                    placeholder="Texte de la question..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Type</label>
                    <select
                      value={form.question_type}
                      onChange={(e) => setForm({ ...form, question_type: e.target.value })}
                      className="input"
                    >
                      <option value="single_choice">QCM</option>
                      <option value="open">Question ouverte</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Score</label>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      value={form.score}
                      onChange={(e) => setForm({ ...form, score: parseInt(e.target.value) || 0 })}
                      className="input"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.critical}
                    onChange={(e) => setForm({ ...form, critical: e.target.checked })}
                    className="w-4 h-4 text-red-600 rounded"
                  />
                  <span className="text-red-600 font-medium">Question critique (NOK si erreur)</span>
                </label>

                {form.question_type === 'single_choice' && (
                  <div>
                    <label className="label">Options</label>
                    {form.options.map((opt, idx) => (
                      <div key={idx} className="flex items-center gap-2 mb-2">
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, correct_index: idx })}
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                            form.correct_index === idx ? 'border-green-500 bg-green-500 text-white' : 'border-gray-300'
                          }`}
                        >
                          {form.correct_index === idx && <CheckCircle className="w-4 h-4" />}
                        </button>
                        <input
                          type="text"
                          value={opt}
                          onChange={(e) => {
                            const newOpts = [...form.options]
                            newOpts[idx] = e.target.value
                            setForm({ ...form, options: newOpts })
                          }}
                          className="input flex-1"
                          placeholder={`Option ${idx + 1}`}
                        />
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, options: [...form.options, ''] })}
                      className="text-sm text-blue-600"
                    >
                      + Ajouter une option
                    </button>
                  </div>
                )}

                {form.question_type === 'open' && (
                  <div>
                    <label className="label">Critères de notation</label>
                    <textarea
                      value={form.scoring_rubric}
                      onChange={(e) => setForm({ ...form, scoring_rubric: e.target.value })}
                      className="input w-full"
                      rows={2}
                      placeholder="Ex: 1 point si 2 exemples concrets"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 p-4 border-t">
                <button onClick={resetForm} className="btn btn-secondary">Annuler</button>
                <button onClick={createQuestion} className="btn btn-primary">
                  <Plus className="w-4 h-4 mr-2" />Créer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal import questions prédéfinies */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowImportModal(false)} />
          <div className="relative min-h-full flex items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b bg-green-50">
                <div>
                  <h2 className="text-lg font-semibold">Importer les questions prédéfinies</h2>
                  <p className="text-sm text-gray-600">{refQuestions.length} questions disponibles</p>
                </div>
                <button onClick={() => setShowImportModal(false)}><X className="w-5 h-5" /></button>
              </div>

              <div className="p-4 overflow-y-auto max-h-[60vh]">
                {refQuestions.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">Aucune question de référence trouvée</p>
                ) : (
                  <div className="space-y-3">
                    {refQuestions.map((q, idx) => (
                      <div 
                        key={q.id} 
                        className={`p-3 rounded-lg border ${q.critical ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-xs bg-gray-200 px-2 py-1 rounded">Q{idx + 1}</span>
                          <div className="flex-1">
                            <p className="font-medium text-sm">{q.question_text}</p>
                            <div className="flex gap-2 mt-1 text-xs text-gray-500">
                              <span>{q.question_type === 'open' ? 'Ouverte' : 'QCM'}</span>
                              <span>•</span>
                              <span>{q.score} pt{q.score > 1 ? 's' : ''}</span>
                              {q.critical && (
                                <>
                                  <span>•</span>
                                  <span className="text-red-600 font-medium">Critique</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 p-4 border-t bg-gray-50">
                <button onClick={() => setShowImportModal(false)} className="btn btn-secondary">
                  Annuler
                </button>
                <button onClick={importRefQuestions} className="btn btn-primary" disabled={refQuestions.length === 0}>
                  <Download className="w-4 h-4 mr-2" />
                  Importer {refQuestions.length} questions
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
