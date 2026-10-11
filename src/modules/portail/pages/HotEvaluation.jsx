import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../../core/supabase'
import { User, Star, MessageSquare, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

const ratingLabels = ['Mauvais', 'Passable', 'Moyen', 'Satisfaisant', 'Très satisfaisant']

const questions = {
  organisation: [
    { key: 'q_org_documents', label: 'Communication des documents avant la formation' },
    { key: 'q_org_accueil', label: 'Accueil sur le lieu de la formation' },
    { key: 'q_org_locaux', label: 'Qualité des locaux (salles, signalétique)' },
    { key: 'q_org_materiel', label: 'Adéquation des moyens matériels' },
  ],
  contenu: [
    { key: 'q_contenu_organisation', label: 'Organisation et déroulement' },
    { key: 'q_contenu_supports', label: 'Qualité des supports pédagogiques' },
    { key: 'q_contenu_duree', label: 'Durée de la formation' },
    { key: 'q_contenu_programme', label: 'Respect du programme de formation' },
  ],
  formateur: [
    { key: 'q_formateur_pedagogie', label: 'La pédagogie du formateur' },
    { key: 'q_formateur_expertise', label: 'L\'expertise du formateur (maîtrise du sujet)' },
    { key: 'q_formateur_progression', label: 'Progression de la formation (rythme)' },
    { key: 'q_formateur_moyens', label: 'Adéquation des moyens mis à disposition' },
  ],
  global: [
    { key: 'q_global_adequation', label: 'Adéquation formation / métier ou secteur' },
    { key: 'q_global_competences', label: 'Amélioration de vos connaissances' },
  ]
}

export default function HotEvaluation() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  
  const [session, setSession] = useState(null)
  const [trainees, setTrainees] = useState([])
  const [selectedTrainee, setSelectedTrainee] = useState(null)
  const [step, setStep] = useState(1) // 1: choix stagiaire, 2: vérif infos, 3: évaluation
  
  const [traineeInfo, setTraineeInfo] = useState(null)
  
  // Valeurs par défaut à 5
  const [formData, setFormData] = useState({
    q_org_documents: 5,
    q_org_accueil: 5,
    q_org_locaux: 5,
    q_org_materiel: 5,
    q_contenu_organisation: 5,
    q_contenu_supports: 5,
    q_contenu_duree: 5,
    q_contenu_programme: 5,
    q_formateur_pedagogie: 5,
    q_formateur_expertise: 5,
    q_formateur_progression: 5,
    q_formateur_moyens: 5,
    q_global_adequation: 5,
    q_global_competences: 5,
    would_recommend: true,
    comment_general: '',
    comment_projet: '',
  })

  useEffect(() => {
    loadSession()
  }, [token])

  const loadSession = async () => {
    try {
      // Trouver la session par attendance_token (réutilisé pour éval)
      const { data: sessionData, error: sessionError } = await supabase
        .from('sessions')
        .select(`
          *,
          courses(title, duration_hours),
          clients(name),
          session_trainees(
            trainee_id,
            trainees(id, first_name, last_name, email, phone)
          )
        `)
        .eq('attendance_token', token)
        .single()

      if (sessionError || !sessionData) {
        setError('Session non trouvée ou lien invalide')
        setLoading(false)
        return
      }

      setSession(sessionData)
      const traineesList = sessionData.session_trainees?.map(st => st.trainees).filter(Boolean) || []
      setTrainees(traineesList)
      setLoading(false)
    } catch (err) {
      console.error('Erreur:', err)
      setError('Erreur lors du chargement')
      setLoading(false)
    }
  }

  const handleSelectTrainee = async (trainee) => {
    setSelectedTrainee(trainee)
    
    // Charger les infos existantes du stagiaire
    const { data: infoSheet } = await supabase
      .from('trainee_info_sheets')
      .select('*')
      .eq('session_id', session.id)
      .eq('trainee_id', trainee.id)
      .single()
    
    setTraineeInfo(infoSheet || null)
    
    // Charger l'évaluation existante
    const { data: existingEval } = await supabase
      .from('trainee_evaluations')
      .select('*')
      .eq('session_id', session.id)
      .eq('trainee_id', trainee.id)
      .single()
    
    if (existingEval) {
      setFormData({
        q_org_documents: existingEval.q_org_documents ?? 5,
        q_org_accueil: existingEval.q_org_accueil ?? 5,
        q_org_locaux: existingEval.q_org_locaux ?? 5,
        q_org_materiel: existingEval.q_org_materiel ?? 5,
        q_contenu_organisation: existingEval.q_contenu_organisation ?? 5,
        q_contenu_supports: existingEval.q_contenu_supports ?? 5,
        q_contenu_duree: existingEval.q_contenu_duree ?? 5,
        q_contenu_programme: existingEval.q_contenu_programme ?? 5,
        q_formateur_pedagogie: existingEval.q_formateur_pedagogie ?? 5,
        q_formateur_expertise: existingEval.q_formateur_expertise ?? 5,
        q_formateur_progression: existingEval.q_formateur_progression ?? 5,
        q_formateur_moyens: existingEval.q_formateur_moyens ?? 5,
        q_global_adequation: existingEval.q_global_adequation ?? 5,
        q_global_competences: existingEval.q_global_competences ?? 5,
        would_recommend: existingEval.would_recommend ?? true,
        comment_general: existingEval.comment_general || '',
        comment_projet: existingEval.comment_projet || '',
      })
    }
    
    setStep(2)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    
    try {
      // Sauvegarder l'évaluation
      const { error: upsertError } = await supabase
        .from('trainee_evaluations')
        .upsert({
          session_id: session.id,
          trainee_id: selectedTrainee.id,
          ...formData,
          questionnaire_submitted: true,
          submitted_at: new Date().toISOString(),
          submitted_online: true,
        }, { onConflict: 'session_id,trainee_id' })

      if (upsertError) throw upsertError
      
      setSuccess(true)
    } catch (err) {
      console.error('Erreur soumission:', err)
      alert('Erreur lors de l\'enregistrement. Veuillez réessayer.')
    } finally {
      setSubmitting(false)
    }
  }

  const setRating = (key, value) => {
    setFormData({...formData, [key]: value})
  }

  // 0 = Non concerné
  const RatingButtons = ({ questionKey, currentValue }) => (
    <div className="flex flex-wrap gap-1">
      <button
        type="button"
        onClick={() => setRating(questionKey, 0)}
        className={`px-2 py-1 text-xs rounded border transition-colors ${
          currentValue === 0
            ? 'bg-gray-600 text-white border-gray-600'
            : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-100'
        }`}
      >
        N/C
      </button>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => setRating(questionKey, n)}
          className={`w-10 h-10 rounded border transition-colors ${
            currentValue === n
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-blue-50'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  )

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-orange-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Erreur</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Merci !</h1>
          <p className="text-gray-600 mb-4">
            Votre évaluation a été enregistrée avec succès.
          </p>
          <p className="text-sm text-gray-500">
            Vous pouvez fermer cette page.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* En-tête */}
        <div className="bg-gradient-to-r from-orange-500 to-orange-600 rounded-t-xl p-6 text-white">
          <h1 className="text-xl font-bold">Évaluation à chaud</h1>
          <p className="text-orange-100 mt-1">{session?.courses?.title || 'Formation'}</p>
          <p className="text-sm text-orange-200 mt-2">
            {session?.clients?.name} • {session?.start_date ? new Date(session.start_date).toLocaleDateString('fr-FR') : ''}
          </p>
        </div>

        <div className="bg-white rounded-b-xl shadow-lg p-6">
          {/* Étape 1 : Choix du stagiaire */}
          {step === 1 && (
            <div>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <User className="w-5 h-5 text-orange-600" />
                Sélectionnez votre nom
              </h2>
              
              <div className="space-y-2">
                {trainees.map(t => (
                  <button
                    key={t.id}
                    onClick={() => handleSelectTrainee(t)}
                    className="w-full p-4 border rounded-lg hover:bg-orange-50 hover:border-orange-300 transition-colors text-left"
                  >
                    <p className="font-medium">{t.first_name} {t.last_name?.toUpperCase()}</p>
                    <p className="text-sm text-gray-500">{t.email}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Étape 2 : Vérification infos */}
          {step === 2 && selectedTrainee && (
            <div>
              <h2 className="text-lg font-semibold mb-4">Vérifiez vos informations</h2>
              
              <div className="bg-gray-50 p-4 rounded-lg mb-6 space-y-2">
                <p><strong>Nom :</strong> {selectedTrainee.last_name?.toUpperCase()}</p>
                <p><strong>Prénom :</strong> {selectedTrainee.first_name}</p>
                <p><strong>Email :</strong> {selectedTrainee.email || '-'}</p>
                <p><strong>Téléphone :</strong> {selectedTrainee.phone || '-'}</p>
                {traineeInfo && (
                  <>
                    <p><strong>Poste :</strong> {traineeInfo.job_title || '-'}</p>
                    <p><strong>Entreprise :</strong> {traineeInfo.company_address || '-'}</p>
                  </>
                )}
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 py-2 border rounded-lg hover:bg-gray-50"
                >
                  ← Changer
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="flex-1 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
                >
                  Continuer →
                </button>
              </div>
            </div>
          )}

          {/* Étape 3 : Évaluation */}
          {step === 3 && selectedTrainee && (
            <form onSubmit={handleSubmit} className="space-y-6">
              <p className="text-sm text-gray-500 mb-4">
                Échelle : 1 (Mauvais) → 5 (Très satisfaisant) • N/C = Non concerné
              </p>

              {/* Organisation */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 pb-2 border-b">
                  📋 Organisation de la formation
                </h3>
                <div className="space-y-4">
                  {questions.organisation.map(q => (
                    <div key={q.key} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <span className="text-sm text-gray-700">{q.label}</span>
                      <RatingButtons questionKey={q.key} currentValue={formData[q.key]} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Contenu */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 pb-2 border-b">
                  📚 Le contenu de la formation
                </h3>
                <div className="space-y-4">
                  {questions.contenu.map(q => (
                    <div key={q.key} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <span className="text-sm text-gray-700">{q.label}</span>
                      <RatingButtons questionKey={q.key} currentValue={formData[q.key]} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Formateur */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 pb-2 border-b">
                  👨‍🏫 L'intervention du formateur
                </h3>
                <div className="space-y-4">
                  {questions.formateur.map(q => (
                    <div key={q.key} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <span className="text-sm text-gray-700">{q.label}</span>
                      <RatingButtons questionKey={q.key} currentValue={formData[q.key]} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Global */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 pb-2 border-b">
                  ⭐ Perception globale
                </h3>
                <div className="space-y-4">
                  {questions.global.map(q => (
                    <div key={q.key} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <span className="text-sm text-gray-700">{q.label}</span>
                      <RatingButtons questionKey={q.key} currentValue={formData[q.key]} />
                    </div>
                  ))}
                  
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <span className="text-sm text-gray-700">Recommanderiez-vous cette formation ?</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setFormData({...formData, would_recommend: true})}
                        className={`px-6 py-2 rounded-lg border ${
                          formData.would_recommend === true
                            ? 'bg-green-600 text-white border-green-600'
                            : 'bg-white text-gray-700 border-gray-300 hover:bg-green-50'
                        }`}
                      >
                        Oui
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({...formData, would_recommend: false})}
                        className={`px-6 py-2 rounded-lg border ${
                          formData.would_recommend === false
                            ? 'bg-red-600 text-white border-red-600'
                            : 'bg-white text-gray-700 border-gray-300 hover:bg-red-50'
                        }`}
                      >
                        Non
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Commentaires */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 pb-2 border-b flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  Commentaires
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Commentaire général (remarques, suggestions)
                    </label>
                    <textarea
                      value={formData.comment_general}
                      onChange={(e) => setFormData({...formData, comment_general: e.target.value})}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                      rows={3}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Projet de formation (besoins futurs)
                    </label>
                    <textarea
                      value={formData.comment_projet}
                      onChange={(e) => setFormData({...formData, comment_projet: e.target.value})}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500"
                      rows={3}
                    />
                  </div>
                </div>
              </div>

              {/* Boutons */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="flex-1 py-3 border rounded-lg hover:bg-gray-50"
                >
                  ← Retour
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-3 bg-orange-600 text-white font-semibold rounded-lg hover:bg-orange-700 disabled:bg-gray-400 flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Envoi...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-5 h-5" />
                      Envoyer mon évaluation
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Access Formation • Indicateur Qualiopi 30
        </p>
      </div>
    </div>
  )
}
