import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../../core/supabase'
import { 
  User, GraduationCap, FileText, CheckCircle, AlertCircle, 
  Loader2, Calendar, Star, MessageSquare, ExternalLink, Shield,
  ChevronRight, Fingerprint, ClipboardCheck
} from 'lucide-react'
import { format, parseISO, isToday, eachDayOfInterval } from 'date-fns'
import { fr } from 'date-fns/locale'
import TraineeDocuments from '../../formation/components/TraineeDocuments'
import PositioningTestForm from '../../formation/components/PositioningTestForm'
import FullscreenSignaturePad from '../../../ui/signature/FullscreenSignaturePad'

// ─── CSS Animations ──────────────────────────────────────────
const portalStyles = `
  @keyframes fadeSlideIn {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes scaleIn {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }
  @keyframes pulseGlow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
    50% { box-shadow: 0 0 0 12px rgba(16, 185, 129, 0); }
  }
  @keyframes checkPop {
    0% { transform: scale(0); }
    50% { transform: scale(1.2); }
    100% { transform: scale(1); }
  }
  @keyframes shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  @keyframes confettiBurst {
    0% { opacity: 1; transform: translateY(0) rotate(0deg) scale(1); }
    100% { opacity: 0; transform: translateY(-60px) rotate(360deg) scale(0); }
  }
  .portal-step-enter {
    animation: fadeSlideIn 0.4s ease-out forwards;
  }
  .portal-card-enter {
    animation: scaleIn 0.3s ease-out forwards;
  }
  .pulse-sign {
    animation: pulseGlow 2s ease-in-out infinite;
  }
  .check-pop {
    animation: checkPop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
  }
  .btn-shimmer {
    background-size: 200% auto;
    animation: shimmer 3s linear infinite;
  }
  .glass-card {
    background: rgba(255, 255, 255, 0.85);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.6);
  }
  .glass-card-strong {
    background: rgba(255, 255, 255, 0.92);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.8);
  }
`

// ─── Progress Stepper ────────────────────────────────────────
const STEPS_CONFIG = [
  { key: 'info_sheet', label: 'Fiche', icon: FileText },
  { key: 'positioning_test', label: 'Test', icon: ClipboardCheck },
  { key: 'attendance', label: 'Émargement', icon: Fingerprint },
  { key: 'evaluation', label: 'Évaluation', icon: Star },
]

const ProgressStepper = ({ currentStep, hasTest }) => {
  const steps = hasTest ? STEPS_CONFIG : STEPS_CONFIG.filter(s => s.key !== 'positioning_test')
  // attendance_complete = émargement terminé, en route vers évaluation
  const mappedStep = currentStep === 'attendance_complete' ? 'evaluation' : currentStep
  const currentIdx = steps.findIndex(s => s.key === mappedStep)
  // Si l'étape n'est pas dans la liste (select, verify_code, thank_you...), ne pas afficher
  if (currentIdx === -1) return null

  return (
    <div className="flex items-center justify-between px-2 py-3 mb-1">
      {steps.map((step, idx) => {
        const Icon = step.icon
        const isActive = idx === currentIdx
        const isDone = idx < currentIdx
        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-0">
            <div className="flex flex-col items-center">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-500 ${
                isDone ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200' 
                : isActive ? 'bg-white text-emerald-600 shadow-lg shadow-emerald-100 ring-2 ring-emerald-400' 
                : 'bg-white/50 text-gray-400'
              }`}>
                {isDone ? <CheckCircle className="w-4 h-4 check-pop" /> : <Icon className="w-4 h-4" />}
              </div>
              <span className={`text-[10px] mt-1 font-medium transition-colors ${
                isDone ? 'text-emerald-600' : isActive ? 'text-emerald-700' : 'text-gray-400'
              }`}>{step.label}</span>
            </div>
            {idx < steps.length - 1 && (
              <div className="flex-1 mx-1.5 mt-[-12px]">
                <div className="h-0.5 rounded-full bg-gray-200 overflow-hidden">
                  <div className={`h-full bg-emerald-500 rounded-full transition-all duration-700 ${
                    isDone ? 'w-full' : 'w-0'
                  }`} />
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Attendance Complete Page ────────────────────────────────
const AttendanceCompletePage = ({ session, trainee, onContinue }) => {
  const [showButton, setShowButton] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setShowButton(true), 4000)
    return () => clearTimeout(timer)
  }, [])

  const courseTitle = session.courses?.title || 'la formation'
  const firstName = trainee.first_name || ''

  return (
    <div className="text-center py-6 portal-card-enter">
      {/* Icône animée */}
      <div className="relative mx-auto mb-6 w-24 h-24">
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 opacity-20 animate-ping" style={{ animationDuration: '2s' }} />
        <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-xl shadow-emerald-200">
          <CheckCircle className="w-12 h-12 text-white check-pop" />
        </div>
      </div>

      <h2 className="text-2xl font-bold text-gray-900 mb-2">
        Merci {firstName} !
      </h2>
      <p className="text-gray-600 mb-1">
        Votre présence a bien été enregistrée.
      </p>
      <p className="text-sm text-gray-400 mb-6">
        Nous espérons que {courseTitle} vous a été utile et enrichissante.
      </p>

      {/* Récap discret */}
      <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl p-4 mb-6 text-left">
        <div className="flex items-center gap-2 text-sm text-emerald-700 mb-2">
          <Fingerprint className="w-4 h-4" />
          <span className="font-semibold">Émargement confirmé</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-emerald-600">
          <Calendar className="w-3.5 h-3.5" />
          <span>{format(new Date(), "EEEE d MMMM yyyy 'à' HH'h'mm", { locale: fr })}</span>
        </div>
      </div>

      {/* Message avant bouton */}
      <p className="text-sm text-gray-500 mb-4">
        Une dernière étape : votre avis compte pour nous améliorer !
      </p>

      {/* Bouton différé avec fade-in */}
      <div className={`transition-all duration-700 ${showButton ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
        <button
          type="button"
          onClick={onContinue}
          className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-xl shadow-lg shadow-orange-200 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2"
        >
          <Star className="w-5 h-5" />
          Donner mon avis
        </button>
      </div>

      {/* Points de chargement avant le bouton */}
      {!showButton && (
        <div className="flex items-center justify-center gap-2 text-emerald-500">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      )}
    </div>
  )
}

const evalQuestions = {
  organisation: [
    { key: 'q_org_documents', label: 'Communication des documents avant la formation' },
    { key: 'q_org_accueil', label: 'Accueil sur le lieu de la formation' },
    { key: 'q_org_locaux', label: 'Qualité des locaux' },
    { key: 'q_org_materiel', label: 'Adéquation des moyens matériels' },
  ],
  contenu: [
    { key: 'q_contenu_organisation', label: 'Organisation et déroulement' },
    { key: 'q_contenu_supports', label: 'Qualité des supports pédagogiques' },
    { key: 'q_contenu_duree', label: 'Durée de la formation' },
    { key: 'q_contenu_programme', label: 'Respect du programme' },
  ],
  formateur: [
    { key: 'q_formateur_pedagogie', label: 'Pédagogie du formateur' },
    { key: 'q_formateur_expertise', label: 'Expertise du formateur' },
    { key: 'q_formateur_progression', label: 'Progression (rythme)' },
    { key: 'q_formateur_moyens', label: 'Moyens mis à disposition' },
  ],
  global: [
    { key: 'q_global_adequation', label: 'Adéquation formation / métier' },
    { key: 'q_global_competences', label: 'Amélioration de vos connaissances' },
  ]
}

const GOOGLE_REVIEW_URL = 'https://g.page/r/CdNbodNlTStbEBM/review'

// Fonction de formatage du numéro de Sécurité Sociale
const formatSSN = (value) => {
  // Enlever tout sauf les chiffres
  const numbers = value.replace(/\D/g, '')
  
  // Limiter à 15 chiffres max
  const truncated = numbers.slice(0, 15)
  
  // Formater : 1 23 45 67 890 123 45
  if (truncated.length <= 1) return truncated
  if (truncated.length <= 3) return `${truncated.slice(0, 1)} ${truncated.slice(1)}`
  if (truncated.length <= 5) return `${truncated.slice(0, 1)} ${truncated.slice(1, 3)} ${truncated.slice(3)}`
  if (truncated.length <= 7) return `${truncated.slice(0, 1)} ${truncated.slice(1, 3)} ${truncated.slice(3, 5)} ${truncated.slice(5)}`
  if (truncated.length <= 10) return `${truncated.slice(0, 1)} ${truncated.slice(1, 3)} ${truncated.slice(3, 5)} ${truncated.slice(5, 7)} ${truncated.slice(7)}`
  if (truncated.length <= 13) return `${truncated.slice(0, 1)} ${truncated.slice(1, 3)} ${truncated.slice(3, 5)} ${truncated.slice(5, 7)} ${truncated.slice(7, 10)} ${truncated.slice(10)}`
  // Avec clé (2 derniers chiffres)
  return `${truncated.slice(0, 1)} ${truncated.slice(1, 3)} ${truncated.slice(3, 5)} ${truncated.slice(5, 7)} ${truncated.slice(7, 10)} ${truncated.slice(10, 13)} ${truncated.slice(13)}`
}

// Fonction de validation de la clé de contrôle du numéro SS
const validateSSNKey = (ssn) => {
  // Enlever espaces
  const numbers = ssn.replace(/\s/g, '')
  
  // Doit faire 15 chiffres
  if (numbers.length !== 15) return false
  
  // Séparer numéro et clé
  const ssnNumber = numbers.slice(0, 13)
  const key = parseInt(numbers.slice(13, 15), 10)
  
  // Calcul clé de contrôle
  const calculatedKey = 97 - (parseInt(ssnNumber, 10) % 97)
  
  return key === calculatedKey
}

export default function TraineePortal() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  
  const [session, setSession] = useState(null)
  const [trainees, setTrainees] = useState([])
  const [selectedTrainee, setSelectedTrainee] = useState(null)
  
  // Steps: 'select' | 'verify_code' | 'info_sheet' | 'positioning_test' | 'attendance' | 'attendance_complete' | 'evaluation' | 'thank_you' | 'google_review' | 'thank_you_website'
  const [currentStep, setCurrentStep] = useState('select')
  const [showDocuments, setShowDocuments] = useState(false)
  
  // Test de positionnement
  const [positioningQuestions, setPositioningQuestions] = useState([])
  const [positioningTestCompleted, setPositioningTestCompleted] = useState(false)
  
  // Code d'accès
  const [accessCode, setAccessCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [attemptsRemaining, setAttemptsRemaining] = useState(5)
  
  // Data
  const [infoSheet, setInfoSheet] = useState(null)
  const [attendanceData, setAttendanceData] = useState({})
  const [signingPeriod, setSigningPeriod] = useState(null)   // demi-journée en cours de signature
  const [signingBusy, setSigningBusy] = useState(false)
  const [signedTimes, setSignedTimes] = useState({})          // heures de signature affichées
  const [evaluationData, setEvaluationData] = useState(null)
  
  // Forms
  const [infoForm, setInfoForm] = useState({
    first_name: '',
    last_name: '',
    birth_date_display: '',
    email: '',
    ssn: '',
    ssn_refused: false,
    last_training_year: '',
    highest_diploma: '',
    csp: '',
    job_title: '',
    training_expectations: '',
    gender: '',
    rgpd_consent: false,
  })
  
  const [formErrors, setFormErrors] = useState({})
  
  const formatBirthDateInput = (value) => {
    const digits = value.replace(/\D/g, '')
    let formatted = ''
    if (digits.length > 0) formatted = digits.slice(0, 2)
    if (digits.length > 2) formatted += '/' + digits.slice(2, 4)
    if (digits.length > 4) formatted += '/' + digits.slice(4, 8)
    return formatted
  }
  
  const parseBirthDateToISO = (displayDate) => {
    const parts = displayDate.split('/')
    if (parts.length === 3 && parts[0].length === 2 && parts[1].length === 2 && parts[2].length === 4) {
      return `${parts[2]}-${parts[1]}-${parts[0]}`
    }
    return null
  }
  
  const isValidBirthDate = (displayDate) => {
    if (!displayDate || displayDate.length !== 10) return false
    const parts = displayDate.split('/')
    if (parts.length !== 3) return false
    const day = parseInt(parts[0], 10)
    const month = parseInt(parts[1], 10)
    const year = parseInt(parts[2], 10)
    if (isNaN(day) || isNaN(month) || isNaN(year)) return false
    if (day < 1 || day > 31 || month < 1 || month > 12) return false
    if (year < 1900 || year > new Date().getFullYear()) return false
    const date = new Date(year, month - 1, day)
    return date.getDate() === day && date.getMonth() === month - 1 && date.getFullYear() === year
  }
  
  const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  
  const [evalForm, setEvalForm] = useState({
    q_org_documents: 5, q_org_accueil: 5, q_org_locaux: 5, q_org_materiel: 5,
    q_contenu_organisation: 5, q_contenu_supports: 5, q_contenu_duree: 5, q_contenu_programme: 5,
    q_formateur_pedagogie: 5, q_formateur_expertise: 5, q_formateur_progression: 5, q_formateur_moyens: 5,
    q_global_adequation: 5, q_global_competences: 5,
    would_recommend: true,
    comment_general: '',
    comment_projet: '',
  })

  useEffect(() => {
    loadSession()
  }, [token])

  const loadSession = async () => {
    try {
      // Utiliser la fonction RPC pour contourner le problème CORS
      const { data: sessionData, error: sessionError } = await supabase
        .rpc('get_portal_session', { token_param: token })

      if (sessionError || !sessionData) {
        setError('Session non trouvée ou lien invalide')
        setLoading(false)
        return
      }

      // Déterminer les périodes selon le type de session
      let sessionPeriods = ['morning', 'afternoon']
      if (sessionData.day_type === 'half') {
        // Déterminer si c'est matin ou après-midi selon l'heure de début
        const startHour = sessionData.start_time ? parseInt(sessionData.start_time.split(':')[0], 10) : 9
        sessionPeriods = startHour >= 12 ? ['afternoon'] : ['morning']
      }
      
      sessionData.periods = sessionPeriods
      setSession(sessionData)
      
      const traineesList = sessionData.trainees || []
      
      setTrainees(traineesList)
      setLoading(false)
    } catch (err) {
      console.error('Erreur:', err)
      setError('Erreur lors du chargement')
      setLoading(false)
    }
  }

  const handleSelectTrainee = (trainee) => {
    setSelectedTrainee(trainee)
    setAccessCode('')
    setCodeError('')
    setAttemptsRemaining(5 - (trainee.access_code_attempts || 0))

    if (trainee.absent) {
      setCurrentStep('absent')
      return
    }

    // Si pas de code d'accès configuré ou codes désactivés, passer directement
    if (!trainee.has_access_code) {
      loadTraineeDataDirect(trainee)
    } else {
      setCurrentStep('verify_code')
    }
  }

  // Chargement direct sans vérification de code (fallback)
  const loadTraineeDataDirect = async (trainee) => {
    setSelectedTrainee(trainee)
    setSubmitting(true)
    await loadTraineeData(trainee)
  }

  const handleVerifyCode = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setCodeError('')

    try {
      // Vérification via RPC si disponible, sinon vérification directe
      const { data, error } = await supabase.rpc('verify_trainee_access_code', {
        p_session_trainee_id: selectedTrainee.session_trainee_id,
        p_access_code: accessCode
      })

      if (error) throw error

      if (!data?.success) {
        setCodeError(data?.error || 'Code incorrect')
        if (data?.attempts_remaining !== undefined) {
          setAttemptsRemaining(data.attempts_remaining)
        }
        if (data?.locked_until) {
          setCodeError(`Compte verrouillé jusqu'à ${new Date(data.locked_until).toLocaleTimeString('fr-FR')}`)
        }
        setSubmitting(false)
        return
      }

      await loadTraineeData(selectedTrainee)
      
    } catch (err) {
      console.error('Erreur:', err)
      setCodeError('Erreur lors de la vérification')
      setSubmitting(false)
    }
  }

  const loadTraineeData = async (trainee = selectedTrainee) => {
    try {
      // Charger toutes les données via RPC
      const { data: traineeData, error: traineeError } = await supabase.rpc('load_trainee_data', {
        p_token: token,
        p_trainee_id: trainee.id
      })
      
      if (traineeError) {
        console.error('Erreur chargement données:', traineeError)
        throw traineeError
      }
      
      const infoData = traineeData?.info_sheet
      const attendanceRecords = traineeData?.attendance || []
      const evalData = traineeData?.evaluation
      const questions = traineeData?.positioning_questions || []
      const testCompleted = traineeData?.positioning_test_completed || false
      
      setInfoSheet(infoData)
      setPositioningQuestions(questions)
      setPositioningTestCompleted(testCompleted)
      
      let birthDateDisplay = ''
      if (trainee.birth_date) {
        const parts = trainee.birth_date.split('-')
        if (parts.length === 3) {
          birthDateDisplay = `${parts[2]}/${parts[1]}/${parts[0]}`
        }
      }
      
      setInfoForm({
        first_name: trainee.first_name || '',
        last_name: trainee.last_name || '',
        birth_date_display: birthDateDisplay,
        email: trainee.email || '',
        ssn: infoData?.ssn || '',
        ssn_refused: infoData?.ssn_refused || false,
        last_training_year: infoData?.last_training_year?.toString() || '',
        highest_diploma: infoData?.highest_diploma || '',
        csp: trainee.csp || infoData?.csp || '',
        job_title: trainee.job_title || infoData?.job_title || '',
        training_expectations: infoData?.training_expectations || '',
        // Genre : fourni par load_trainee_data (après vérification du code) — plus de 'male' par défaut
        gender: traineeData?.gender || trainee.gender || '',
        rgpd_consent: infoData?.rgpd_consent || false,
        email_refused: trainee.email_refused || infoData?.email_refused || false,
      })

      // Charger émargement
      const attendanceMap = {}
      attendanceRecords?.forEach(rec => {
        if (!rec.date) return // Ignorer si pas de date
        const dateStr = typeof rec.date === 'string' ? rec.date.substring(0, 10) : format(new Date(rec.date), 'yyyy-MM-dd')
        if (rec.morning) {
          attendanceMap[`${dateStr}_morning`] = true
        }
        if (rec.afternoon) {
          attendanceMap[`${dateStr}_afternoon`] = true
        }
      })
      setAttendanceData(attendanceMap)

      setEvaluationData(evalData)
      if (evalData) {
        setEvalForm({
          q_org_documents: evalData.q_org_documents || 5,
          q_org_accueil: evalData.q_org_accueil || 5,
          q_org_locaux: evalData.q_org_locaux || 5,
          q_org_materiel: evalData.q_org_materiel || 5,
          q_contenu_organisation: evalData.q_contenu_organisation || 5,
          q_contenu_supports: evalData.q_contenu_supports || 5,
          q_contenu_duree: evalData.q_contenu_duree || 5,
          q_contenu_programme: evalData.q_contenu_programme || 5,
          q_formateur_pedagogie: evalData.q_formateur_pedagogie || 5,
          q_formateur_expertise: evalData.q_formateur_expertise || 5,
          q_formateur_progression: evalData.q_formateur_progression || 5,
          q_formateur_moyens: evalData.q_formateur_moyens || 5,
          q_global_adequation: evalData.q_global_adequation || 5,
          q_global_competences: evalData.q_global_competences || 5,
          would_recommend: evalData.would_recommend ?? true,
          comment_general: evalData.comment_general || '',
          comment_projet: evalData.comment_projet || '',
        })
      }

      // Déterminer étape
      const today = getTodayFormation()
      
      if (infoData && infoData.filled_at) {
        // Si le test de positionnement n'est pas complété et qu'il y a des questions
        if (questions.length > 0 && !testCompleted) {
          setCurrentStep('positioning_test')
        } else {
          // Vérifier si toutes les périodes du jour sont cochées
          const allPeriodsChecked = session.periods.every(period => {
            const key = `${today}_${period}`
            return attendanceMap[key] === true
          })
          
          if (allPeriodsChecked) {
            const isLastDay = session.end_date && isToday(parseISO(session.end_date))
            if (isLastDay) {
              if (evalData && evalData.questionnaire_submitted) {
                setCurrentStep('thank_you')
              } else {
                setCurrentStep('attendance_complete')
              }
            } else {
              setCurrentStep('thank_you')
            }
          } else {
            setCurrentStep('attendance')
          }
        }
      } else {
        setCurrentStep('info_sheet')
      }
      
      setSubmitting(false)
    } catch (err) {
      console.error('Erreur chargement:', err)
      setCurrentStep('info_sheet')
      setSubmitting(false)
    }
  }

  const getTodayFormation = () => format(new Date(), 'yyyy-MM-dd')

  const handleSubmitInfoSheet = async (e) => {
    e.preventDefault()
    
    const errors = {}
    if (!infoForm.first_name) errors.first_name = 'Prénom requis'
    if (!infoForm.last_name) errors.last_name = 'Nom requis'
    if (!infoForm.email_refused) {
      if (!infoForm.email) {
        errors.email = 'Email requis, ou cochez la case en dessous'
      } else if (!isValidEmail(infoForm.email)) {
        errors.email = 'Email invalide'
      }
    }
    if (!infoForm.birth_date_display) {
      errors.birth_date = 'Date de naissance requise'
    } else if (!isValidBirthDate(infoForm.birth_date_display)) {
      errors.birth_date = 'Date invalide (format JJ/MM/AAAA)'
    }
    
    // Validation numéro SS stricte
    if (!infoForm.ssn_refused) {
      const ssnNumbers = infoForm.ssn.replace(/\s/g, '')
      
      if (!ssnNumbers) {
        errors.ssn = 'N° Sécurité Sociale requis ou cochez "Je refuse"'
      } else if (ssnNumbers.length !== 15) {
        errors.ssn = 'Le numéro doit contenir exactement 15 chiffres (13 + 2 clé)'
      } else if (!/^\d{15}$/.test(ssnNumbers)) {
        errors.ssn = 'Le numéro ne doit contenir que des chiffres'
      } else if (!validateSSNKey(infoForm.ssn)) {
        errors.ssn = 'La clé de contrôle est incorrecte - Vérifiez votre numéro'
      }
    }
    
    if (!infoForm.gender) {
      errors.gender = 'Genre requis'
    }
    if (!infoForm.highest_diploma) {
      errors.highest_diploma = 'Diplôme requis'
    }
    if (!infoForm.csp) {
      errors.csp = 'CSP requise'
    }
    if (!infoForm.job_title) {
      errors.job_title = 'Intitulé du poste requis'
    }
    if (!infoForm.training_expectations || infoForm.training_expectations.trim().length === 0) {
      errors.training_expectations = 'Vos attentes sont requises'
    }
    if (!infoForm.rgpd_consent) {
      errors.rgpd = 'Veuillez accepter les conditions RGPD'
    }
    
    setFormErrors(errors)
    if (Object.keys(errors).length > 0) return
    
    setSubmitting(true)
    try {
      const birthDateISO = parseBirthDateToISO(infoForm.birth_date_display)
      
      const traineeUpdate = {
        first_name: infoForm.first_name,
        last_name: infoForm.last_name,
        email: infoForm.email_refused ? null : infoForm.email,
        birth_date: birthDateISO,
        social_security_number: infoForm.ssn_refused ? null : infoForm.ssn.replace(/\s/g, ''),
        refused_ssn: infoForm.ssn_refused,
        csp: infoForm.csp || null,
        job_title: infoForm.job_title || null,
        gender: infoForm.gender || null,
      }
      
      console.log('🔄 Mise à jour trainee avec:', traineeUpdate)
      
      const { data: updateData, error: updateError } = await supabase.rpc('update_trainee_data', {
        p_token: token,
        p_trainee_id: selectedTrainee.id,
        p_data: traineeUpdate
      })
      
      console.log('✅ Résultat update trainees:', { updateData, updateError })
      
      if (updateError) {
        throw updateError
      }
      
      setSelectedTrainee({ ...selectedTrainee, ...traineeUpdate })
      
      const { data: infoResult, error: infoError } = await supabase.rpc('save_trainee_info', {
        p_token: token,
        p_trainee_id: selectedTrainee.id,
        p_data: {
          email: infoForm.email_refused ? null : infoForm.email,
          ssn: infoForm.ssn_refused ? null : infoForm.ssn.replace(/\s/g, ''),
          ssn_refused: infoForm.ssn_refused,
          last_training_year: infoForm.last_training_year ? parseInt(infoForm.last_training_year) : null,
          highest_diploma: infoForm.highest_diploma,
          csp: infoForm.csp || null,
          job_title: infoForm.job_title || null,
          training_expectations: infoForm.training_expectations,
          rgpd_consent: infoForm.rgpd_consent,
          rgpd_consent_date: new Date().toISOString(),
          filled_at: new Date().toISOString(),
          filled_online: true
        }
      })
      
      if (infoError) {
        console.error('Erreur sauvegarde fiche:', infoError)
        throw infoError
      }

      // Refus de communiquer l'adresse email : les documents partiront à l'entreprise
      await supabase.rpc('portal_set_email_refused', {
        p_token: token,
        p_trainee_id: selectedTrainee.id,
        p_refused: !!infoForm.email_refused,
      })
      
      setInfoSheet({ 
        email: infoForm.email,
        ssn: infoForm.ssn_refused ? null : infoForm.ssn.replace(/\s/g, ''),
        ssn_refused: infoForm.ssn_refused,
        last_training_year: infoForm.last_training_year ? parseInt(infoForm.last_training_year) : null,
        highest_diploma: infoForm.highest_diploma,
        csp: infoForm.csp || null,
        job_title: infoForm.job_title || null,
        training_expectations: infoForm.training_expectations,
        rgpd_consent: infoForm.rgpd_consent,
        filled_at: new Date().toISOString() 
      })
      
      // Aller au test de positionnement si des questions existent, sinon émargement
      if (positioningQuestions.length > 0 && !positioningTestCompleted) {
        setCurrentStep('positioning_test')
      } else {
        setCurrentStep('attendance')
      }
    } catch (err) {
      console.error('Erreur:', err)
      alert('Erreur lors de l\'enregistrement. Veuillez réessayer.')
    } finally {
      setSubmitting(false)
    }
  }

  // Handler pour complétion du test de positionnement
  const handlePositioningTestComplete = async (answers) => {
    setSubmitting(true)
    try {
      console.log('🎯 DÉBUT handlePositioningTestComplete')
      console.log('answers:', answers)
      
      const { data, error } = await supabase.rpc('save_positioning_test_answers', {
        p_token: token,
        p_trainee_id: selectedTrainee.id,
        p_answers: answers
      })
      
      console.log('📥 Réponse save_positioning_test_answers:', { data, error })
      
      if (error) {
        console.error('Erreur sauvegarde test:', error)
        throw error
      }
      
      console.log('✅ Test sauvegardé, maintenant setPositioningTestCompleted(true)')
      setPositioningTestCompleted(true)
      
      // Vérifier si on est dans les dates de session
      const today = format(new Date(), 'yyyy-MM-dd')
      const sessionDates = session.start_date && session.end_date
        ? eachDayOfInterval({ start: parseISO(session.start_date), end: parseISO(session.end_date) })
        : []
      const isWithinSessionDates = sessionDates.some(d => format(d, 'yyyy-MM-dd') === today)
      
      console.log('📅 Vérification date:')
      console.log('  today:', today)
      console.log('  sessionDates:', sessionDates.map(d => format(d, 'yyyy-MM-dd')))
      console.log('  isWithinSessionDates:', isWithinSessionDates)
      
      if (isWithinSessionDates) {
        console.log('🚀 On est dans les dates → attendance')
        setCurrentStep('attendance')
      } else {
        console.log('⏰ Pas encore dans les dates → thank_you')
        setCurrentStep('thank_you')
      }
      
      console.log('✅ FIN handlePositioningTestComplete SANS ERREUR')
    } catch (err) {
      console.error('❌ ERREUR dans handlePositioningTestComplete:', err)
      alert('Erreur lors de l\'enregistrement du test. Veuillez réessayer.')
    } finally {
      setSubmitting(false)
    }
  }

  // ============================================================

  // ========================================
  // FONCTIONS UTILITAIRES POUR ÉMARGEMENT
  // ========================================
  
  // Créneau autorisé pour cette demi-journée (affichage seulement — le serveur décide)
  const periodOuverte = (period) => {
    if (session?.signature_mode === 'ferme') return { ouvert: false, message: 'Signatures fermées par le formateur' }
    if (session?.signature_mode === 'ouvert') return { ouvert: true }
    const now = new Date()
    const heure = now.getHours() + now.getMinutes() / 60
    const [startHour, startMin] = (session?.start_time || '09:00').split(':').map(Number)
    const debut = startHour + (startMin || 0) / 60 - 1
    if (heure < debut) {
      return { ouvert: false, message: `Signature possible à partir de ${String(Math.max(0, Math.floor(debut))).padStart(2, '0')}h` }
    }
    if (period === 'afternoon' && heure < 13) {
      return { ouvert: false, message: "L'après-midi se signe à partir de 13h" }
    }
    return { ouvert: true }
  }

  // Le stagiaire signe : le tracé vaut émargement, il n'y a rien d'autre à faire
  const handleSignPeriod = async (period, image) => {
    const today = getTodayFormation()
    const key = `${today}_${period}`
    setSigningPeriod(null)
    setSigningBusy(true)

    try {
      const { data, error } = await supabase.rpc('portal_sign_halfday', {
        p_token: token,
        p_trainee_id: selectedTrainee.id,
        p_period: period,
        p_signature: image,
      })
      if (error) throw error
      if (!data?.ok) {
        alert(data?.error || "La signature n'a pas pu être enregistrée")
        setSigningBusy(false)
        return
      }

      const newAttendanceData = { ...attendanceData, [key]: true }
      setAttendanceData(newAttendanceData)
      setSignedTimes({ ...signedTimes, [key]: new Date().toISOString() })

      // Toutes les demi-journées du jour sont-elles signées ?
      const allPeriodsChecked = session.periods.every(p => newAttendanceData[`${today}_${p}`] === true)
      if (allPeriodsChecked) {
        const isLastDay = session.end_date && isToday(parseISO(session.end_date))
        if (isLastDay) {
          if (evaluationData && evaluationData.questionnaire_submitted) {
            setCurrentStep('thank_you')
          } else {
            setCurrentStep('attendance_complete')
          }
        } else {
          setCurrentStep('thank_you')
        }
      }
    } catch (err) {
      console.error('Erreur émargement:', err)
      alert("Erreur lors de l'enregistrement de votre signature. Prévenez votre formateur.")
    } finally {
      setSigningBusy(false)
    }
  }

  const handleSubmitEvaluation = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    
    try {
      // Lister explicitement tous les champs pour éviter les conflits
      const evalData = {
        session_id: session.id,
        trainee_id: selectedTrainee.id,
        q_org_documents: evalForm.q_org_documents,
        q_org_accueil: evalForm.q_org_accueil,
        q_org_locaux: evalForm.q_org_locaux,
        q_org_materiel: evalForm.q_org_materiel,
        q_contenu_organisation: evalForm.q_contenu_organisation,
        q_contenu_supports: evalForm.q_contenu_supports,
        q_contenu_duree: evalForm.q_contenu_duree,
        q_contenu_programme: evalForm.q_contenu_programme,
        q_formateur_pedagogie: evalForm.q_formateur_pedagogie,
        q_formateur_expertise: evalForm.q_formateur_expertise,
        q_formateur_progression: evalForm.q_formateur_progression,
        q_formateur_moyens: evalForm.q_formateur_moyens,
        q_global_adequation: evalForm.q_global_adequation,
        q_global_competences: evalForm.q_global_competences,
        would_recommend: evalForm.would_recommend,
        comment_general: evalForm.comment_general || null,
        comment_projet: evalForm.comment_projet || null,
        questionnaire_submitted: true,
        submitted_at: new Date().toISOString(),
        submitted_online: true,
      }

      console.log('Saving evaluation:', evalData)

      const { data: evalResult, error: evalError } = await supabase.rpc('save_evaluation', {
        p_token: token,
        p_trainee_id: selectedTrainee.id,
        p_eval_data: evalData
      })

      console.log('Save evaluation result:', { evalResult, evalError })

      if (evalError) {
        console.error('Erreur save evaluation:', evalError)
        throw evalError
      }
      
      // Calcul moyenne (exclure N/C = 0)
      const questionKeys = [
        'q_org_documents', 'q_org_accueil', 'q_org_locaux', 'q_org_materiel',
        'q_contenu_organisation', 'q_contenu_supports', 'q_contenu_duree', 'q_contenu_programme',
        'q_formateur_pedagogie', 'q_formateur_expertise', 'q_formateur_progression', 'q_formateur_moyens',
        'q_global_adequation', 'q_global_competences'
      ]
      const scores = questionKeys.map(k => evalForm[k]).filter(v => v > 0)
      const average = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
      
      // Redirection : Google si moyenne ≥4.5 ET would_recommend, sinon site web
      if (evalForm.would_recommend && average >= 4.5) {
        setCurrentStep('google_review')
      } else {
        setCurrentStep('thank_you_website')
      }
    } catch (err) {
      console.error('Erreur:', err)
      alert('Erreur lors de l\'enregistrement. Veuillez réessayer.')
    } finally {
      setSubmitting(false)
    }
  }

  const RatingButtons = ({ questionKey, currentValue }) => (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => setEvalForm({...evalForm, [questionKey]: 0})}
        className={`px-2.5 py-1.5 text-xs rounded-lg border transition-all duration-200 ${
          currentValue === 0 ? 'bg-gray-700 text-white border-gray-700 shadow-sm' : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
        }`}
      >
        N/C
      </button>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => setEvalForm({...evalForm, [questionKey]: n})}
          className={`w-9 h-9 rounded-lg border text-sm font-medium transition-all duration-200 ${
            currentValue === n 
              ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white border-amber-400 shadow-md shadow-amber-200 scale-110' 
              : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300 hover:bg-amber-50'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  )

  // Vue Documents
  if (showDocuments) {
    return (
      <TraineeDocuments 
        session={session}
        traineeId={selectedTrainee?.id}
        onBack={() => setShowDocuments(false)}
      />
    )
  }

  // Pad plein écran : le stagiaire signe, c'est enregistré
  if (signingPeriod && selectedTrainee) {
    return (
      <FullscreenSignaturePad
        title={`${selectedTrainee.first_name} ${(selectedTrainee.last_name || '').toUpperCase()}`}
        subtitle={`${signingPeriod === 'morning' ? 'Matin' : 'Après-midi'} — ${session?.courses?.title || 'Formation'}`}
        confirmLabel="Je signe ma présence"
        onValidate={(image) => handleSignPeriod(signingPeriod, image)}
        onCancel={() => setSigningPeriod(null)}
      />
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-emerald-50/30 to-teal-50/40 flex items-center justify-center">
        <style>{portalStyles}</style>
        <div className="flex flex-col items-center gap-3 portal-card-enter">
          <div className="w-14 h-14 rounded-2xl bg-white shadow-lg shadow-emerald-100 flex items-center justify-center">
            <Loader2 className="w-7 h-7 animate-spin text-emerald-600" />
          </div>
          <p className="text-sm text-gray-500 font-medium">Chargement…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-red-50/20 to-orange-50/30 flex items-center justify-center p-4">
        <style>{portalStyles}</style>
        <div className="glass-card-strong rounded-2xl shadow-xl p-8 max-w-md text-center portal-card-enter">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Erreur</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    )
  }

  const today = getTodayFormation()

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-emerald-50/30 to-teal-50/40 py-6 px-4">
      <style>{portalStyles}</style>
      <div className="max-w-lg mx-auto">
        {/* En-tête moderne */}
        <div className="bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 rounded-t-2xl p-5 text-white relative overflow-hidden">
          {/* Motif décoratif */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-20 h-20 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center backdrop-blur-sm">
                <GraduationCap className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-bold leading-tight truncate">{session.courses?.title}</h1>
                <p className="text-sm text-emerald-100">{session.clients?.name}</p>
              </div>
            </div>
            {selectedTrainee && (
              <div className="mt-2 flex items-center gap-2 text-sm text-emerald-100">
                <User className="w-3.5 h-3.5" />
                <span>{selectedTrainee.first_name} {selectedTrainee.last_name}</span>
              </div>
            )}
            {session.start_date && session.end_date && (
              <p className="text-sm text-emerald-200 flex items-center gap-1 mt-1">
                <Calendar className="w-3.5 h-3.5" />
                {format(parseISO(session.start_date), 'd MMM', { locale: fr })} - {format(parseISO(session.end_date), 'd MMM yyyy', { locale: fr })}
              </p>
            )}
          </div>
        </div>

        {/* Stepper de progression */}
        <div className="bg-white/60 backdrop-blur-sm border-x border-white/60">
          <ProgressStepper currentStep={currentStep} hasTest={positioningQuestions.length > 0} />
        </div>

        {/* Contenu avec glassmorphism */}
        <div className="glass-card-strong rounded-b-2xl shadow-xl shadow-emerald-900/5 p-6">
          <div key={currentStep} className="portal-step-enter">
          {/* STEP: Sélection */}
          {currentStep === 'select' && (
            <div className="space-y-3">
              <h2 className="text-lg font-bold flex items-center gap-2 text-gray-900">
                <User className="w-5 h-5 text-emerald-600" />
                Sélectionnez votre nom
              </h2>
              {trainees.map((trainee, idx) => (
                <button
                  key={trainee.id}
                  onClick={() => handleSelectTrainee(trainee)}
                  className="w-full p-4 text-left rounded-xl border-2 border-gray-100 hover:border-emerald-300 hover:bg-emerald-50/50 transition-all duration-200 hover:shadow-md group portal-card-enter"
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-gray-900 group-hover:text-emerald-700 transition-colors">
                        {trainee.first_name} {trainee.last_name}
                      </div>
                      {trainee.email && (
                        <div className="text-sm text-gray-500">{trainee.email}</div>
                      )}
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-emerald-500 transition-all group-hover:translate-x-0.5" />
                  </div>
                </button>
              ))}
              
              {/* Bouton Documents */}
              <div className="mt-6 pt-6 border-t border-gray-100">
                <button
                  onClick={() => setShowDocuments(true)}
                  className="w-full p-4 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl hover:shadow-lg hover:shadow-blue-200 transition-all duration-200 flex items-center justify-center gap-3 font-semibold"
                >
                  <FileText className="w-5 h-5" />
                  Consulter les documents de formation
                </button>
                <p className="text-xs text-center text-gray-400 mt-2">
                  Accédez aux supports pédagogiques et livrets
                </p>
              </div>
            </div>
          )}

          {/* STEP: Vérification code */}
          {currentStep === 'verify_code' && (
            <div>
              <div className="text-center mb-6">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-purple-200">
                  <Shield className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-xl font-bold mb-2">Vérification d'accès</h2>
                <p className="text-gray-500">
                  Bonjour <strong className="text-gray-900">{selectedTrainee.first_name} {selectedTrainee.last_name}</strong>
                </p>
              </div>

              <form onSubmit={handleVerifyCode} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Code d'accès à 6 chiffres
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={accessCode}
                    onChange={(e) => setAccessCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full px-4 py-3.5 border-2 border-gray-200 rounded-xl text-center text-2xl tracking-widest focus:ring-2 focus:ring-violet-500 focus:border-violet-400 transition-all"
                    placeholder="000000"
                    required
                    autoFocus
                  />
                  <p className="text-xs text-gray-400 mt-2">
                    Vous avez reçu ce code par email ou de la part du formateur
                  </p>
                </div>

                {codeError && (
                  <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-red-700">
                      {codeError}
                      {attemptsRemaining > 0 && (
                        <div className="mt-1 font-medium">Tentatives restantes : {attemptsRemaining}</div>
                      )}
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || accessCode.length !== 6}
                  className="w-full py-3.5 bg-gradient-to-r from-violet-600 to-purple-600 text-white font-bold rounded-xl hover:shadow-lg hover:shadow-purple-200 disabled:from-gray-300 disabled:to-gray-400 disabled:shadow-none disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                  Vérifier
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCurrentStep('select')
                    setSelectedTrainee(null)
                    setAccessCode('')
                    setCodeError('')
                  }}
                  className="w-full text-gray-400 hover:text-gray-600 transition text-sm font-medium"
                >
                  ← Changer de stagiaire
                </button>
              </form>
            </div>
          )}

          {/* STEP: Fiche info */}
          {currentStep === 'info_sheet' && selectedTrainee && (
            <form onSubmit={handleSubmitInfoSheet} className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                Fiche de renseignement
              </h2>
              <p className="text-xs text-gray-500">1ère connexion uniquement • Ces informations sont confidentielles</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Prénom *</label>
                  <input
                    type="text"
                    value={infoForm.first_name}
                    onChange={(e) => setInfoForm({...infoForm, first_name: e.target.value})}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                  {formErrors.first_name && <p className="text-xs text-red-600 mt-1">{formErrors.first_name}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Nom *</label>
                  <input
                    type="text"
                    value={infoForm.last_name}
                    onChange={(e) => setInfoForm({...infoForm, last_name: e.target.value})}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                  {formErrors.last_name && <p className="text-xs text-red-600 mt-1">{formErrors.last_name}</p>}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Date de naissance *</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="JJ/MM/AAAA"
                  value={infoForm.birth_date_display}
                  onChange={(e) => setInfoForm({...infoForm, birth_date_display: formatBirthDateInput(e.target.value)})}
                  maxLength={10}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
                {formErrors.birth_date && <p className="text-xs text-red-600 mt-1">{formErrors.birth_date}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Genre *</label>
                <select
                  value={infoForm.gender}
                  onChange={(e) => setInfoForm({...infoForm, gender: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="">-- Choisir --</option>
                  <option value="male">Homme</option>
                  <option value="female">Femme</option>
                  <option value="non_binary">Non genré</option>
                </select>
                {formErrors.gender && <p className="text-xs text-red-600 mt-1">{formErrors.gender}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Email {!infoForm.email_refused && '*'}</label>
                <input
                  type="email"
                  value={infoForm.email_refused ? '' : infoForm.email}
                  onChange={(e) => setInfoForm({...infoForm, email: e.target.value})}
                  disabled={infoForm.email_refused}
                  placeholder={infoForm.email_refused ? 'Non communiqué' : 'vous@exemple.fr'}
                  className={`w-full px-3 py-2 border rounded-lg text-sm ${infoForm.email_refused ? 'bg-gray-100 text-gray-400' : ''}`}
                />
                {formErrors.email && <p className="text-xs text-red-600 mt-1">{formErrors.email}</p>}
                <label className="flex items-start gap-2 mt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!infoForm.email_refused}
                    onChange={(e) => setInfoForm({...infoForm, email_refused: e.target.checked})}
                    className="w-4 h-4 mt-0.5"
                  />
                  <span className="text-xs text-gray-600">
                    Je ne souhaite pas communiquer mon adresse email.
                    Mes documents (attestation, certificat) seront envoyés au responsable de mon entreprise.
                  </span>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">N° Sécurité Sociale {!infoForm.ssn_refused && '*'}</label>
                <input
                  type="text"
                  value={infoForm.ssn}
                  onChange={(e) => {
                    const formatted = formatSSN(e.target.value)
                    setInfoForm({...infoForm, ssn: formatted})
                  }}
                  disabled={infoForm.ssn_refused}
                  placeholder={infoForm.ssn_refused ? 'Non communiqué' : '1 23 45 67 890 123 45'}
                  maxLength={21}
                  className={`w-full px-3 py-2 border rounded-lg text-sm font-mono ${
                    infoForm.ssn_refused ? 'bg-gray-100 text-gray-400' : ''
                  }`}
                />
                {formErrors.ssn && (
                  <p className="text-xs text-red-600 mt-1">{formErrors.ssn}</p>
                )}
                {infoForm.ssn && !infoForm.ssn_refused && infoForm.ssn.replace(/\s/g, '').length === 15 && (
                  <p className="text-xs text-gray-600 mt-1 flex items-center gap-1">
                    {validateSSNKey(infoForm.ssn) ? (
                      <>
                        <span className="text-green-600">✓</span> Numéro valide
                      </>
                    ) : (
                      <>
                        <span className="text-orange-600">⚠</span> Clé de contrôle incorrecte - Vérifiez votre saisie
                      </>
                    )}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Année dernière formation</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Ex: 2023"
                  maxLength={4}
                  value={infoForm.last_training_year}
                  onChange={(e) => setInfoForm({...infoForm, last_training_year: e.target.value.replace(/\D/g, '')})}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Diplôme le plus élevé *</label>
                <select
                  value={infoForm.highest_diploma}
                  onChange={(e) => setInfoForm({...infoForm, highest_diploma: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="">-- Sélectionner --</option>
                  <option value="Sans diplôme">Sans diplôme</option>
                  <option value="CAP/BEP">CAP/BEP</option>
                  <option value="Baccalauréat">Baccalauréat</option>
                  <option value="Bac+2">Bac+2 (BTS, DUT)</option>
                  <option value="Bac+3">Bac+3 (Licence)</option>
                  <option value="Bac+5">Bac+5 (Master)</option>
                  <option value="Bac+8">Bac+8 (Doctorat)</option>
                </select>
                {formErrors.highest_diploma && <p className="text-xs text-red-600 mt-1">{formErrors.highest_diploma}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Catégorie socio-professionnelle (CSP) *</label>
                <select
                  value={infoForm.csp}
                  onChange={(e) => setInfoForm({...infoForm, csp: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="">-- Sélectionner --</option>
                  <option value="Agriculteurs exploitants">Agriculteurs exploitants</option>
                  <option value="Artisans, commerçants, chefs d'entreprise">Artisans, commerçants, chefs d'entreprise</option>
                  <option value="Cadres et professions intellectuelles supérieures">Cadres et professions intellectuelles supérieures</option>
                  <option value="Professions intermédiaires">Professions intermédiaires</option>
                  <option value="Employés">Employés</option>
                  <option value="Ouvriers">Ouvriers</option>
                  <option value="Retraités">Retraités</option>
                  <option value="Autres personnes sans activité professionnelle">Autres personnes sans activité professionnelle</option>
                </select>
                {formErrors.csp && <p className="text-xs text-red-600 mt-1">{formErrors.csp}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Intitulé du poste *</label>
                <input
                  type="text"
                  value={infoForm.job_title}
                  onChange={(e) => setInfoForm({...infoForm, job_title: e.target.value})}
                  placeholder="Ex: Technicien de maintenance"
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
                {formErrors.job_title && <p className="text-xs text-red-600 mt-1">{formErrors.job_title}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Mes attentes de la formation *</label>
                <textarea
                  value={infoForm.training_expectations}
                  onChange={(e) => setInfoForm({...infoForm, training_expectations: e.target.value})}
                  placeholder="Décrivez vos attentes, objectifs personnels, compétences à acquérir..."
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  rows={3}
                />
                {formErrors.training_expectations && <p className="text-xs text-red-600 mt-1">{formErrors.training_expectations}</p>}
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                <label className="flex items-start gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={infoForm.ssn_refused}
                    onChange={(e) => setInfoForm({...infoForm, ssn_refused: e.target.checked, ssn: e.target.checked ? '' : infoForm.ssn})}
                    className="mt-0.5 rounded"
                  />
                  <span>Je refuse de communiquer mon numéro de Sécurité Sociale</span>
                </label>
                
                <label className="flex items-start gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={infoForm.rgpd_consent}
                    onChange={(e) => setInfoForm({...infoForm, rgpd_consent: e.target.checked})}
                    className="mt-0.5 rounded"
                  />
                  <span>
                    J'accepte que mes données personnelles soient collectées et traitées par Access Formation 
                    conformément au RGPD. Ces données serviront uniquement à la gestion de ma formation.
                  </span>
                </label>
                {formErrors.rgpd && <p className="text-xs text-red-600">{formErrors.rgpd}</p>}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-400 flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                Enregistrer et continuer
              </button>
            </form>
          )}

          {/* STEP: Test de positionnement */}
          {currentStep === 'positioning_test' && selectedTrainee && positioningQuestions.length > 0 && (
            <div>
              <PositioningTestForm
                questions={positioningQuestions}
                traineeId={selectedTrainee.id}
                onComplete={handlePositioningTestComplete}
              />
            </div>
          )}

          {/* STEP: Stagiaire noté absent */}
          {currentStep === 'absent' && (
            <div className="text-center py-10 portal-card-enter">
              <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-5">
                <AlertCircle className="w-10 h-10 text-gray-400" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Accès indisponible</h2>
              <p className="text-gray-500">
                Vous êtes noté absent sur cette formation.<br />
                Adressez-vous à votre formateur.
              </p>
              <button
                onClick={() => { setSelectedTrainee(null); setCurrentStep('select') }}
                className="mt-6 px-5 py-2.5 rounded-xl bg-gray-100 text-gray-700 font-medium"
              >
                Retour
              </button>
            </div>
          )}

          {/* STEP: Émargement — le stagiaire signe, c'est tout */}
          {currentStep === 'attendance' && selectedTrainee && (() => {
            const dates = session.start_date && session.end_date
              ? eachDayOfInterval({ start: parseISO(session.start_date), end: parseISO(session.end_date) })
              : []
            const todayIndex = dates.findIndex(d => format(d, 'yyyy-MM-dd') === today)
            const currentDate = todayIndex >= 0 ? dates[todayIndex] : new Date()

            return (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Fingerprint className="w-5 h-5 text-emerald-600" />
                    Votre présence
                  </h2>
                  <p className="text-xs text-gray-500 mt-1">
                    Signez avec votre doigt : votre signature vaut émargement.
                  </p>
                </div>

                <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-100 rounded-xl p-4">
                  <p className="text-sm font-semibold text-emerald-900 capitalize">
                    {format(currentDate, 'EEEE d MMMM yyyy', { locale: fr })}
                  </p>
                  {todayIndex >= 0 && dates.length > 1 && (
                    <p className="text-xs text-emerald-600 mt-1 font-medium">
                      Jour {todayIndex + 1} sur {dates.length}
                    </p>
                  )}
                </div>

                <div className="space-y-3">
                  {session.periods.map(period => {
                    const key = `${today}_${period}`
                    const isSigned = attendanceData[key] === true
                    const ouverture = periodOuverte(period)

                    return (
                      <div
                        key={period}
                        className={`rounded-2xl border-2 p-4 ${
                          isSigned ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-100'
                        }`}
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
                            isSigned ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {isSigned
                              ? <CheckCircle className="w-6 h-6 check-pop" />
                              : period === 'morning' ? <span className="text-xl">🌅</span> : <span className="text-xl">🌆</span>}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900 text-lg">
                              {period === 'morning' ? 'Matin' : 'Après-midi'}
                            </p>
                            {isSigned && (
                              <p className="text-sm text-emerald-700">
                                Présence signée{signedTimes[key] ? ` à ${format(new Date(signedTimes[key]), 'HH')}h${format(new Date(signedTimes[key]), 'mm')}` : ''}
                              </p>
                            )}
                          </div>
                        </div>

                        {!isSigned && (
                          ouverture.ouvert ? (
                            <button
                              type="button"
                              disabled={signingBusy}
                              onClick={() => setSigningPeriod(period)}
                              className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-lg font-bold shadow-lg shadow-emerald-200 disabled:opacity-60"
                            >
                              {signingBusy ? 'Enregistrement…' : 'Signer ma présence'}
                            </button>
                          ) : (
                            <p className="text-sm text-gray-500 bg-gray-50 rounded-xl p-3 text-center">
                              {ouverture.message}
                            </p>
                          )
                        )}
                      </div>
                    )
                  })}
                </div>

                <p className="text-xs text-gray-400 text-center">
                  Une demi-journée signée ne peut plus être modifiée.<br />
                  En cas de souci, votre formateur peut vous faire signer sur son téléphone.
                </p>
              </div>
            )
          })()}

          {/* STEP: Émargement terminé - transition vers évaluation */}
          {currentStep === 'attendance_complete' && selectedTrainee && (
            <AttendanceCompletePage
              session={session}
              trainee={selectedTrainee}
              onContinue={() => setCurrentStep('evaluation')}
            />
          )}

          {/* STEP: Thank you */}
          {currentStep === 'thank_you' && (
            <div className="text-center py-8 portal-card-enter">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-emerald-200">
                <CheckCircle className="w-10 h-10 text-white check-pop" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">C'est noté !</h2>
              <p className="text-gray-500">Merci d'avoir complété le questionnaire.</p>
              <p className="text-sm text-gray-400 mt-4">À très bientôt pour la formation !</p>
            </div>
          )}

          {/* STEP: Évaluation */}
          {currentStep === 'evaluation' && selectedTrainee && (
            <form onSubmit={handleSubmitEvaluation} className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Star className="w-5 h-5 text-orange-500" />
                  Évaluation à chaud
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  Échelle : 1 (Mauvais) → 5 (Très satisfaisant) • N/C = Non concerné
                </p>
              </div>

              {/* Organisation */}
              <div>
                <h3 className="font-medium text-sm text-gray-900 mb-2 pb-1 border-b">📋 Organisation</h3>
                <div className="space-y-3">
                  {evalQuestions.organisation.map(q => (
                    <div key={q.key} className="flex flex-col gap-1">
                      <span className="text-xs text-gray-700">{q.label}</span>
                      <RatingButtons questionKey={q.key} currentValue={evalForm[q.key]} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Contenu */}
              <div>
                <h3 className="font-medium text-sm text-gray-900 mb-2 pb-1 border-b">📚 Contenu</h3>
                <div className="space-y-3">
                  {evalQuestions.contenu.map(q => (
                    <div key={q.key} className="flex flex-col gap-1">
                      <span className="text-xs text-gray-700">{q.label}</span>
                      <RatingButtons questionKey={q.key} currentValue={evalForm[q.key]} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Formateur */}
              <div>
                <h3 className="font-medium text-sm text-gray-900 mb-2 pb-1 border-b">👨‍🏫 Formateur</h3>
                <div className="space-y-3">
                  {evalQuestions.formateur.map(q => (
                    <div key={q.key} className="flex flex-col gap-1">
                      <span className="text-xs text-gray-700">{q.label}</span>
                      <RatingButtons questionKey={q.key} currentValue={evalForm[q.key]} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Global */}
              <div>
                <h3 className="font-medium text-sm text-gray-900 mb-2 pb-1 border-b">⭐ Global</h3>
                <div className="space-y-3">
                  {evalQuestions.global.map(q => (
                    <div key={q.key} className="flex flex-col gap-1">
                      <span className="text-xs text-gray-700">{q.label}</span>
                      <RatingButtons questionKey={q.key} currentValue={evalForm[q.key]} />
                    </div>
                  ))}
                  
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-gray-700">Recommanderiez-vous cette formation ?</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEvalForm({...evalForm, would_recommend: true})}
                        className={`px-4 py-1.5 rounded text-sm ${
                          evalForm.would_recommend ? 'bg-green-600 text-white' : 'bg-gray-100 hover:bg-green-50'
                        }`}
                      >
                        Oui
                      </button>
                      <button
                        type="button"
                        onClick={() => setEvalForm({...evalForm, would_recommend: false})}
                        className={`px-4 py-1.5 rounded text-sm ${
                          evalForm.would_recommend === false ? 'bg-red-600 text-white' : 'bg-gray-100 hover:bg-red-50'
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
                <h3 className="font-medium text-sm text-gray-900 mb-2 pb-1 border-b flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" /> Commentaires
                </h3>
                <textarea
                  placeholder="Commentaire général (remarques, suggestions)"
                  value={evalForm.comment_general}
                  onChange={(e) => setEvalForm({...evalForm, comment_general: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg text-sm mb-2"
                  rows={2}
                />
                <textarea
                  placeholder="Projet de formation (besoins futurs)"
                  value={evalForm.comment_projet}
                  onChange={(e) => setEvalForm({...evalForm, comment_projet: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  rows={2}
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 disabled:bg-gray-400 flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                Envoyer mon évaluation
              </button>
            </form>
          )}

          {/* STEP: Google Review */}
          {currentStep === 'google_review' && (
            <div className="text-center py-6">
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-gray-900 mb-2">Merci !</h2>
              <p className="text-gray-600 mb-6">Votre évaluation a été enregistrée avec succès.</p>
              
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-yellow-800 mb-3">
                  <strong>Une dernière chose...</strong><br />
                  Votre avis compte ! Aidez-nous en laissant un avis sur Google.
                </p>
                <a
                  href={GOOGLE_REVIEW_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-yellow-500 text-white font-semibold rounded-lg hover:bg-yellow-600"
                >
                  <Star className="w-5 h-5" />
                  Laisser un avis Google
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
              
              <p className="text-xs text-gray-400">Vous pouvez fermer cette page.</p>
            </div>
          )}

          {/* STEP: Thank You + Website */}
          {currentStep === 'thank_you_website' && (
            <div className="text-center py-6">
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-gray-900 mb-2">Merci pour votre retour !</h2>
              <p className="text-gray-600 mb-6">
                Votre évaluation a été enregistrée avec succès.<br />
                Nous prenons en compte tous vos commentaires pour améliorer nos formations.
              </p>
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-blue-800 mb-3">
                  Découvrez toutes nos formations sur notre site internet
                </p>
                <a
                  href="https://www.accessformation.pro/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700"
                >
                  Visiter notre site
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
              
              <p className="text-xs text-gray-400">Vous pouvez fermer cette page.</p>
            </div>
          )}
          </div>{/* fin portal-step-enter */}
        </div>

        <p className="text-center text-xs text-gray-400 mt-4 font-medium">
          Access Formation • Portail stagiaire
        </p>
      </div>
    </div>
  )
}
