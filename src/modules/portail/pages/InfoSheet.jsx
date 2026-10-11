import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../../core/supabase'
import { User, Briefcase, GraduationCap, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

const knowledgeLevels = [
  { value: 1, label: 'Aucune' },
  { value: 2, label: 'Faible' },
  { value: 3, label: 'Moyen' },
  { value: 4, label: 'Bon' },
  { value: 5, label: 'Expert' },
]

export default function InfoSheet() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  
  const [session, setSession] = useState(null)
  const [trainees, setTrainees] = useState([])
  const [selectedTrainee, setSelectedTrainee] = useState(null)
  const [step, setStep] = useState(1) // 1: choix stagiaire, 2: formulaire
  
  const [formData, setFormData] = useState({
    job_title: '',
    job_since: '',
    knowledge_level: 1,
    company_address: '',
    last_training_year: '',
    highest_diploma: '',
    training_expectations: '',
    rgpd_consent: false,
  })

  useEffect(() => {
    loadSession()
  }, [token])

  const loadSession = async () => {
    try {
      // Trouver la session par token
      const { data: sessionData, error: sessionError } = await supabase
        .from('sessions')
        .select(`
          *,
          courses(title, duration_hours),
          clients(name),
          session_trainees(
            trainee_id,
            trainees(id, first_name, last_name, email)
          )
        `)
        .eq('info_sheet_token', token)
        .single()

      if (sessionError || !sessionData) {
        setError('Session non trouvée ou lien invalide')
        setLoading(false)
        return
      }

      setSession(sessionData)
      
      // Extraire les stagiaires
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
    
    // Vérifier si déjà rempli
    const { data: existing } = await supabase
      .from('trainee_info_sheets')
      .select('*')
      .eq('session_id', session.id)
      .eq('trainee_id', trainee.id)
      .single()
    
    if (existing?.filled_at) {
      setFormData({
        job_title: existing.job_title || '',
        job_since: existing.job_since || '',
        knowledge_level: existing.knowledge_level || 1,
        company_address: existing.company_address || '',
        last_training_year: existing.last_training_year || '',
        highest_diploma: existing.highest_diploma || '',
        training_expectations: existing.training_expectations || '',
        rgpd_consent: existing.rgpd_consent || false,
      })
    }
    
    setStep(2)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.rgpd_consent) {
      alert('Veuillez accepter les conditions RGPD pour continuer.')
      return
    }
    
    setSubmitting(true)
    
    try {
      // Sauvegarder la fiche
      const { error: upsertError } = await supabase
        .from('trainee_info_sheets')
        .upsert({
          session_id: session.id,
          trainee_id: selectedTrainee.id,
          ...formData,
          last_training_year: formData.last_training_year ? parseInt(formData.last_training_year) : null,
          rgpd_consent_date: new Date().toISOString(),
          signature_checked: true,
          presence_validated: true,
          filled_at: new Date().toISOString(),
          filled_online: true,
        }, { onConflict: 'session_id,trainee_id' })

      if (upsertError) throw upsertError

      // Marquer présence première demi-journée
      if (session.start_date) {
        await supabase
          .from('attendance_halfdays')
          .upsert({
            session_id: session.id,
            trainee_id: selectedTrainee.id,
            date: session.start_date,
            period: 'morning',
            present: true,
          }, { onConflict: 'session_id,trainee_id,date,period' })
      }

      setSuccess(true)
    } catch (err) {
      console.error('Erreur soumission:', err)
      alert('Erreur lors de l\'enregistrement. Veuillez réessayer.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
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
            Votre fiche de renseignements a été enregistrée et votre présence pour la première demi-journée a été validée.
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
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-t-xl p-6 text-white">
          <h1 className="text-xl font-bold">Fiche de renseignements stagiaire</h1>
          <p className="text-blue-100 mt-1">{session?.courses?.title || 'Formation'}</p>
          <p className="text-sm text-blue-200 mt-2">
            {session?.clients?.name} • {session?.start_date ? new Date(session.start_date).toLocaleDateString('fr-FR') : ''}
          </p>
        </div>

        <div className="bg-white rounded-b-xl shadow-lg p-6">
          {/* Étape 1 : Choix du stagiaire */}
          {step === 1 && (
            <div>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <User className="w-5 h-5 text-blue-600" />
                Sélectionnez votre nom
              </h2>
              
              {trainees.length === 0 ? (
                <p className="text-gray-500 text-center py-8">Aucun stagiaire inscrit à cette session.</p>
              ) : (
                <div className="space-y-2">
                  {trainees.map(t => (
                    <button
                      key={t.id}
                      onClick={() => handleSelectTrainee(t)}
                      className="w-full p-4 border rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors text-left"
                    >
                      <p className="font-medium">{t.first_name} {t.last_name?.toUpperCase()}</p>
                      <p className="text-sm text-gray-500">{t.email}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Étape 2 : Formulaire */}
          {step === 2 && selectedTrainee && (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="bg-blue-50 p-4 rounded-lg mb-6">
                <p className="font-medium text-blue-900">{selectedTrainee.first_name} {selectedTrainee.last_name?.toUpperCase()}</p>
                <button type="button" onClick={() => setStep(1)} className="text-sm text-blue-600 hover:underline">
                  ← Changer de stagiaire
                </button>
              </div>

              {/* Informations professionnelles */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-gray-600" />
                  Informations professionnelles
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Poste exercé</label>
                    <input
                      type="text"
                      value={formData.job_title}
                      onChange={(e) => setFormData({...formData, job_title: e.target.value})}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ex: Agent de production"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Dans ce poste depuis</label>
                    <input
                      type="text"
                      value={formData.job_since}
                      onChange={(e) => setFormData({...formData, job_since: e.target.value})}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ex: 3 ans, janvier 2020..."
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Adresse de l'entreprise</label>
                    <textarea
                      value={formData.company_address}
                      onChange={(e) => setFormData({...formData, company_address: e.target.value})}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      rows={2}
                      placeholder="Adresse complète"
                    />
                  </div>
                </div>
              </div>

              {/* Formation */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <GraduationCap className="w-4 h-4 text-gray-600" />
                  Parcours de formation
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Année de votre dernière formation dans ce domaine</label>
                    <input
                      type="number"
                      value={formData.last_training_year}
                      onChange={(e) => setFormData({...formData, last_training_year: e.target.value})}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ex: 2022"
                      min="1970"
                      max={new Date().getFullYear()}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Plus haut diplôme obtenu</label>
                    <input
                      type="text"
                      value={formData.highest_diploma}
                      onChange={(e) => setFormData({...formData, highest_diploma: e.target.value})}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ex: CAP, BAC, BTS..."
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Niveau de connaissance dans le domaine de la formation
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {knowledgeLevels.map(level => (
                        <button
                          key={level.value}
                          type="button"
                          onClick={() => setFormData({...formData, knowledge_level: level.value})}
                          className={`px-4 py-2 rounded-lg border transition-colors ${
                            formData.knowledge_level === level.value
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {level.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Attentes */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-gray-600" />
                  Vos besoins et attentes
                </h3>
                
                <textarea
                  value={formData.training_expectations}
                  onChange={(e) => setFormData({...formData, training_expectations: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  rows={4}
                  placeholder="Quels sont vos besoins spécifiques et vos attentes concernant cette formation ?"
                />
              </div>

              {/* Consentement RGPD */}
              <div className="bg-gray-50 p-4 rounded-lg border">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.rgpd_consent}
                    onChange={(e) => setFormData({...formData, rgpd_consent: e.target.checked})}
                    className="w-5 h-5 mt-0.5 rounded text-blue-600"
                  />
                  <span className="text-sm text-gray-700">
                    <strong>J'accepte</strong> que mes données personnelles soient traitées par Access Formation 
                    dans le cadre de cette formation, conformément au RGPD. Ces données seront conservées 
                    5 ans maximum après la fin de la formation. Je peux exercer mes droits d'accès, 
                    rectification et suppression à tout moment.
                  </span>
                </label>
              </div>

              {/* Bouton soumission */}
              <button
                type="submit"
                disabled={submitting || !formData.rgpd_consent}
                className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Enregistrement...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    Valider ma fiche et ma présence
                  </>
                )}
              </button>
              
              <p className="text-xs text-gray-500 text-center">
                En validant, votre présence pour la première demi-journée sera automatiquement enregistrée.
              </p>
            </form>
          )}
        </div>
        
        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-6">
          Access Formation • Indicateur Qualiopi 8
        </p>
      </div>
    </div>
  )
}
