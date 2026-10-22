import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../../core/supabase'
import { useBranding, brandLogo } from '../../../core/branding/BrandingProvider'
import {
  User, FileText, CheckCircle, AlertCircle, Loader2, Calendar, Star, MessageSquare,
  ExternalLink, Shield, ChevronRight, ChevronLeft, Fingerprint, ClipboardCheck, Sun, Sunset,
  Zap, Trophy, BookOpen, Lock, Home, GraduationCap, MapPin, PenLine, Sparkles, ShieldCheck, ArrowRight,
} from 'lucide-react'
import { format, parseISO, isToday, eachDayOfInterval } from 'date-fns'
import { fr } from 'date-fns/locale'
import TraineeDocuments from '../../formation/components/TraineeDocuments'
import CompteStagiairePortail from '../components/CompteStagiairePortail'
import RessentiJour from '../components/RessentiJour'
import { EcranVitrine, CodeCases } from '../components/Vitrine'
import QuizFlashJeu from '../components/QuizFlashJeu'
import { estPanneReseau, garder, enAttente, envoyerEnAttente } from '../lib/fileSignatures'
import { Banner } from '../../../ui/Banner'
import FullscreenSignaturePad from '../../../ui/signature/FullscreenSignaturePad'
import QuizEngine from '../../formation/quiz/QuizEngine'
import PasseportPortalBlock from '../../passeport/components/PasseportPortalBlock'
import DechargeNir from '../components/DechargeNir'
import { donneesDecharge } from '../../prevention/lib/dechargeNir'
import { generatePasseportPreventionPDF } from '../../prevention/pdf/pdfPasseportPrevention'
import { prepareOrgForPDF } from '../../../core/org/orgUtils'
import { portailPasseport } from '../../passeport/lib/ppData'
import { normaliserNir } from '../../passeport/lib/rules'
import ChampNir from '../../../core/nir/ChampNir'
import { verifierNir } from '../../../core/nir/verifierNir'

// Portail stagiaire : identification, fiche de renseignement, positionnement (quiz),
// émargement par signature, entraînement, évaluation des acquis, satisfaction.
// Tout passe par des RPC publiques (le jeton de session est dans l'URL).

const portalStyles = `
  @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes scaleIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  @keyframes checkPop { 0% { transform: scale(0); } 55% { transform: scale(1.2); } 100% { transform: scale(1); } }
  .portal-step-enter { animation: fadeSlideIn 0.35s ease-out forwards; }
  .portal-card-enter { animation: scaleIn 0.3s ease-out forwards; }
  .check-pop { animation: checkPop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
`

// ---------------------------------------------------------------
// Étapes d'accueil (avant l'espace stagiaire)
// ---------------------------------------------------------------
const ONBOARDING_STEPS = [
  { key: 'info_sheet', label: 'Fiche', icon: FileText },
  { key: 'positioning', label: 'Positionnement', icon: ClipboardCheck },
  { key: 'hub', label: 'Mon espace', icon: Home },
]

const ProgressStepper = ({ currentStep, hasTest }) => {
  const steps = hasTest ? ONBOARDING_STEPS : ONBOARDING_STEPS.filter((s) => s.key !== 'positioning')
  const currentIdx = steps.findIndex((s) => s.key === currentStep)
  if (currentIdx === -1) return null
  return (
    <div className="flex items-center justify-between px-3 py-3">
      {steps.map((step, idx) => {
        const Icon = step.icon
        const isActive = idx === currentIdx
        const isDone = idx < currentIdx
        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-500 ${
                isDone ? 'bg-primary-900 text-white' : isActive ? 'bg-accent-500 text-accent-fg shadow-md' : 'bg-gray-100 text-gray-400'
              }`}>
                {isDone ? <CheckCircle className="w-4 h-4 check-pop" /> : <Icon className="w-4 h-4" />}
              </div>
              <span className={`text-ui-sm mt-1 font-semibold ${isDone ? 'text-primary-900' : isActive ? 'text-accent-700' : 'text-gray-400'}`}>{step.label}</span>
            </div>
            {idx < steps.length - 1 && (
              <div className="flex-1 mx-2 -mt-4">
                <div className="h-0.5 rounded-full bg-gray-200 overflow-hidden">
                  <div className={`h-full bg-primary-900 rounded-full transition-all duration-700 ${isDone ? 'w-full' : 'w-0'}`} />
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------
// Fin d'émargement du dernier jour : transition vers la satisfaction
// ---------------------------------------------------------------
const AttendanceCompletePage = ({ session, trainee, onContinue }) => {
  const [showButton, setShowButton] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShowButton(true), 2500)
    return () => clearTimeout(timer)
  }, [])
  const courseTitle = session.courses?.title || 'la formation'
  return (
    <div className="text-center py-6 portal-card-enter">
      <div className="relative mx-auto mb-6 w-24 h-24">
        <div className="absolute inset-0 rounded-full bg-primary-900 opacity-10 animate-ping" style={{ animationDuration: '2s' }} />
        <div className="relative w-24 h-24 rounded-full bg-primary-900 flex items-center justify-center shadow-sm">
          <CheckCircle className="w-12 h-12 text-white check-pop" />
        </div>
      </div>
      <h2 className="font-display text-2xl font-bold text-gray-900 mb-2">Merci {trainee.first_name}</h2>
      <p className="text-gray-600 mb-1">Votre présence a bien été enregistrée.</p>
      <p className="text-ui-sm text-gray-400 mb-6">Nous espérons que {courseTitle} vous a été utile.</p>
      <div className="bg-primary-50 rounded-ui-lg p-4 mb-6 text-left">
        <div className="flex items-center gap-2 text-ui text-primary-900 mb-1">
          <Fingerprint className="w-4 h-4" />
          <span className="font-semibold">Émargement confirmé</span>
        </div>
        <div className="flex items-center gap-2 text-ui-sm text-primary-700">
          <Calendar className="w-3.5 h-3.5" />
          <span>{format(new Date(), "EEEE d MMMM yyyy 'à' HH'h'mm", { locale: fr })}</span>
        </div>
      </div>
      <p className="text-ui text-gray-500 mb-4">Une dernière étape : votre avis nous aide à nous améliorer.</p>
      <div className={`transition-all duration-700 ${showButton ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
        <button type="button" onClick={onContinue} className="w-full py-3.5 bg-accent-500 text-accent-fg font-bold rounded-ui-lg shadow-md flex items-center justify-center gap-2">
          <Star className="w-5 h-5" /> Donner mon avis
        </button>
      </div>
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
  ],
}

const EVAL_KEYS = Object.values(evalQuestions).flat().map((q) => q.key)

const inputClass = 'w-full px-3 py-2.5 border border-gray-200 rounded-ui text-base focus:border-accent-400 focus:ring-2 focus:ring-accent-100'
const labelClass = 'block text-ui font-medium text-gray-800 mb-1'
const errorClass = 'text-ui-sm text-[rgb(var(--c-danger))] mt-1'

// ---------------------------------------------------------------
// Carte de l'espace stagiaire
// ---------------------------------------------------------------
function HubCard({ icon: Icon, title, subtitle, status, tone = 'neutral', onClick, disabled, primary, badge }) {
  const tones = {
    neutral: 'bg-gray-100 text-gray-600',
    done: 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]',
    accent: 'bg-accent-50 text-accent-700',
    highlight: 'bg-highlight-50 text-highlight-800',
    locked: 'bg-gray-100 text-gray-400',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left rounded-ui-lg border-2 p-4 transition-all flex items-center gap-4 ${
        primary ? 'border-accent-500 bg-white shadow-md' : 'border-gray-100 bg-white hover:border-gray-200'
      } ${disabled ? 'opacity-70 cursor-default' : 'active:scale-[0.99]'}`}
    >
      <div className={`w-12 h-12 rounded-ui flex items-center justify-center flex-shrink-0 ${tones[tone]}`}>
        <Icon className="w-6 h-6" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="font-display font-semibold text-gray-900">{title}</div>
          {badge && <span className="text-ui-sm font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent-500 text-accent-fg">{badge}</span>}
        </div>
        {subtitle && <div className="text-ui-sm text-gray-500 truncate">{subtitle}</div>}
        {status && <div className={`text-ui-sm font-medium mt-0.5 ${tone === 'done' ? 'text-[rgb(var(--c-success))]' : tone === 'locked' ? 'text-gray-400' : 'text-gray-700'}`}>{status}</div>}
      </div>
      {!disabled && <ChevronRight className="w-5 h-5 text-gray-300 flex-shrink-0" />}
      {disabled && tone === 'locked' && <Lock className="w-4 h-4 text-gray-300 flex-shrink-0" />}
    </button>
  )
}

// ===============================================================
export default function TraineePortal() {
  const { token } = useParams()
  const { branding } = useBranding()
  const logo = brandLogo(branding, true)
  const orgName = branding.org_name || ''

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  // Message d'erreur affiché dans l'écran (remplace les alertes du navigateur)
  const [portalError, setPortalError] = useState(null)
  const [error, setError] = useState(null)

  const [session, setSession] = useState(null)
  const [selectedTrainee, setSelectedTrainee] = useState(null)

  // 'select' (code personnel) | 'absent' | 'info_sheet' | 'hub' | 'attendance' | 'attendance_complete'
  // | 'evaluation' | 'thank_you' | 'google_review' | 'thank_you_website'
  const [currentStep, setCurrentStep] = useState('select')
  const [showDocuments, setShowDocuments] = useState(false)

  // Quiz en cours (plein écran) : { mode, questions }
  const [quiz, setQuiz] = useState(null)
  const [positioningQuestions, setPositioningQuestions] = useState([])
  const [positioningTestCompleted, setPositioningTestCompleted] = useState(false)
  const [quizSummary, setQuizSummary] = useState(null)

  const [accessCode, setAccessCode] = useState('')
  // Ticket délivré par la vérification du code d'accès, exigé ensuite pour lire ou modifier la fiche
  const [portalTicket, setPortalTicket] = useState(null)
  // Décharge « numéro non communiqué » (0436) : état, fenêtre ouverte et suite du parcours après signature
  const [decharge, setDecharge] = useState(null)
  const [dechargeOuverte, setDechargeOuverte] = useState(false)
  const [apresDecharge, setApresDecharge] = useState(null)
  // Numéro de sécurité sociale déjà connu : jamais renvoyé, seulement ses 3 derniers chiffres
  const [ssnOnFile, setSsnOnFile] = useState({ known: false, last3: '' })
  const [codeError, setCodeError] = useState('')
  const [secoue, setSecoue] = useState(0)

  const [infoSheet, setInfoSheet] = useState(null)
  const [attendanceData, setAttendanceData] = useState({})
  const [signingPeriod, setSigningPeriod] = useState(null)
  const [signingBusy, setSigningBusy] = useState(false)
  const [signedTimes, setSignedTimes] = useState({})
  const [evaluationData, setEvaluationData] = useState(null)

  const [infoForm, setInfoForm] = useState({
    first_name: '', last_name: '', birth_date_display: '', email: '', email_refused: false, ssn: '', ssn_refused: false,
    last_training_year: '', highest_diploma: '', csp: '', job_title: '', training_expectations: '', gender: '', rgpd_consent: false,
  })
  const [formErrors, setFormErrors] = useState({})
  // Contexte de vérification du n° de sécurité sociale (genre et date de naissance saisis dans la fiche)
  const ctxNir = { gender: infoForm.gender, birth_date: /^\d{2}\/\d{2}\/\d{4}$/.test(infoForm.birth_date_display || '') ? infoForm.birth_date_display.split('/').reverse().join('-') : null }
  // Passeport de prévention (module actif) : le numéro part chiffré par le serveur, jamais par les fonctions du portail
  const [pp, setPp] = useState({ enabled: false })

  const [evalForm, setEvalForm] = useState(() => ({
    ...Object.fromEntries(EVAL_KEYS.map((k) => [k, 5])),
    would_recommend: true, comment_general: '', comment_projet: '',
    attentes_satisfaites: '', attentes_commentaire: '',
  }))

  const getTodayFormation = () => format(new Date(), 'yyyy-MM-dd')
  const today = getTodayFormation()

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
    if (parts.length === 3 && parts[0].length === 2 && parts[1].length === 2 && parts[2].length === 4) return `${parts[2]}-${parts[1]}-${parts[0]}`
    return null
  }
  const isValidBirthDate = (displayDate) => {
    if (!displayDate || displayDate.length !== 10) return false
    const [d, m, y] = displayDate.split('/').map((v) => parseInt(v, 10))
    if ([d, m, y].some(isNaN)) return false
    if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1900 || y > new Date().getFullYear()) return false
    const date = new Date(y, m - 1, d)
    return date.getDate() === d && date.getMonth() === m - 1 && date.getFullYear() === y
  }
  const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

  // ---------------- Chargement ----------------
  useEffect(() => { loadSession() }, [token])

  const loadSession = async () => {
    try {
      const { data: sessionData, error: sessionError } = await supabase.rpc('get_portal_session', { token_param: token })
      if (sessionError || !sessionData) {
        setError('Session non trouvée ou lien invalide')
        setLoading(false)
        return
      }
      let sessionPeriods = ['morning', 'afternoon']
      if (sessionData.day_type === 'half') {
        const startHour = sessionData.start_time ? parseInt(sessionData.start_time.split(':')[0], 10) : 9
        sessionPeriods = startHour >= 12 ? ['afternoon'] : ['morning']
      }
      sessionData.periods = sessionPeriods
      setSession(sessionData)
      setLoading(false)
    } catch (err) {
      console.error('Erreur :', err)
      setError('Erreur lors du chargement')
      setLoading(false)
    }
  }

  const loadQuizSummary = useCallback(async (traineeId) => {
    const { data } = await supabase.rpc('portal_quiz_summary', { p_token: token, p_trainee_id: traineeId })
    if (data) setQuizSummary(data)
  }, [token])

  // Entrée par code (0423) : le code personnel identifie le stagiaire ; aucune liste de noms n'est chargée
  const handleEntrer = async (e, valeur) => {
    e?.preventDefault?.()
    const codeSaisi = valeur || accessCode
    if (codeSaisi.length !== 6 || submitting) return
    setSubmitting(true)
    setCodeError('')
    try {
      const { data, error } = await supabase.rpc('portal_entrer', { p_token: token, p_code: codeSaisi })
      if (error) throw error
      if (!data?.success) {
        setCodeError(data?.error || 'Code incorrect')
        setSecoue((n) => n + 1)
        setSubmitting(false)
        return
      }
      const trainee = data.trainee
      setPortalTicket(data.ticket || null)
      setSelectedTrainee(trainee)
      if (trainee.absent) { setSubmitting(false); setCurrentStep('absent'); return }
      await loadTraineeData(trainee, data.ticket || null)
    } catch (err) {
      console.error('Erreur :', err)
      setCodeError('Erreur lors de la vérification')
      setSubmitting(false)
    }
  }

  // Retour à l'accueil du portail : la personne suivante tape son propre code
  const quitter = () => {
    setSelectedTrainee(null)
    setPortalTicket(null)
    setAccessCode('')
    setCodeError('')
    setQuizSummary(null)
    setCurrentStep('select')
  }

  const isWithinSessionDates = (sess) => {
    if (!sess?.start_date || !sess?.end_date) return false
    return today >= sess.start_date && today <= sess.end_date
  }

  const allPeriodsSignedToday = (map, sess) => sess.periods.every((p) => map[`${today}_${p}`] === true)

  // Oriente le stagiaire après identification
  const routeAfterLoad = (sess, attendanceMap, evalData) => {
    if (isWithinSessionDates(sess) && !allPeriodsSignedToday(attendanceMap, sess)) {
      setCurrentStep('attendance')
      return
    }
    if (isWithinSessionDates(sess) && sess.end_date === today && !(evalData && evalData.questionnaire_submitted) && allPeriodsSignedToday(attendanceMap, sess)) {
      setCurrentStep('hub')
      return
    }
    setCurrentStep('hub')
  }

  const loadTraineeData = async (trainee = selectedTrainee, ticket = portalTicket) => {
    try {
      const { data: traineeData, error: traineeError } = await supabase.rpc('load_trainee_data', { p_token: token, p_trainee_id: trainee.id, p_ticket: ticket })
      if (traineeError) throw traineeError

      const infoData = traineeData?.info_sheet
      const attendanceRecords = traineeData?.attendance || []
      const evalData = traineeData?.evaluation
      const questions = traineeData?.positioning_questions || []
      const testCompleted = traineeData?.positioning_test_completed || false

      setInfoSheet(infoData)
      setSsnOnFile({ known: !!infoData?.ssn_on_file, last3: infoData?.ssn_last3 || '' })
      setPp({ enabled: false })
      portailPasseport('portal-state', { token, trainee_id: trainee.id, code: accessCode || undefined })
        .then((st) => setPp(st.enabled ? { ...st, nom: st.nom_naissance, nir: '', refuse: st.refuse } : { enabled: false }))
        .catch(() => setPp({ enabled: false }))
      setDecharge(null)
      supabase.rpc('portail_decharge_nir_etat', { p_token: token, p_trainee_id: trainee.id, p_ticket: ticket })
        .then(({ data }) => setDecharge(data || null)).catch(() => setDecharge(null))
      setPositioningQuestions(questions)
      setPositioningTestCompleted(testCompleted)

      let birthDateDisplay = ''
      if (trainee.birth_date) {
        const parts = trainee.birth_date.split('-')
        if (parts.length === 3) birthDateDisplay = `${parts[2]}/${parts[1]}/${parts[0]}`
      }
      setInfoForm({
        first_name: trainee.first_name || '',
        last_name: trainee.last_name || '',
        birth_date_display: birthDateDisplay,
        email: traineeData?.email || trainee.email || '',
        email_refused: trainee.email_refused || infoData?.email_refused || false,
        ssn: '',
        ssn_refused: infoData?.ssn_refused || false,
        last_training_year: infoData?.last_training_year?.toString() || '',
        highest_diploma: infoData?.highest_diploma || '',
        csp: trainee.csp || infoData?.csp || '',
        job_title: trainee.job_title || infoData?.job_title || '',
        training_expectations: infoData?.training_expectations || '',
        gender: traineeData?.gender || trainee.gender || '',
        rgpd_consent: infoData?.rgpd_consent || false,
      })

      const attendanceMap = {}
      attendanceRecords?.forEach((rec) => {
        if (!rec.date) return
        const dateStr = typeof rec.date === 'string' ? rec.date.substring(0, 10) : format(new Date(rec.date), 'yyyy-MM-dd')
        if (rec.morning) attendanceMap[`${dateStr}_morning`] = true
        if (rec.afternoon) attendanceMap[`${dateStr}_afternoon`] = true
      })
      setAttendanceData(attendanceMap)

      setEvaluationData(evalData)
      if (evalData) {
        setEvalForm({
          ...Object.fromEntries(EVAL_KEYS.map((k) => [k, evalData[k] ?? 5])),
          would_recommend: evalData.would_recommend ?? true,
          comment_general: evalData.comment_general || '',
          comment_projet: evalData.comment_projet || '',
          attentes_satisfaites: evalData.attentes_satisfaites || '',
          attentes_commentaire: evalData.attentes_commentaire || '',
        })
      }

      loadQuizSummary(trainee.id)

      if (infoData && infoData.filled_at) {
        if (questions.length > 0 && !testCompleted) {
          setCurrentStep('hub')
          startQuiz('positioning', trainee)
        } else {
          routeAfterLoad(session, attendanceMap, evalData)
        }
      } else {
        setCurrentStep('info_sheet')
      }
      setSubmitting(false)
    } catch (err) {
      console.error('Erreur chargement :', err)
      setCurrentStep('info_sheet')
      setSubmitting(false)
    }
  }

  // ---------------- Fiche de renseignement ----------------
  const handleSubmitInfoSheet = async (e) => {
    e.preventDefault()
    const errors = {}
    if (!infoForm.first_name) errors.first_name = 'Prénom requis'
    if (!infoForm.last_name) errors.last_name = 'Nom requis'
    if (!infoForm.email_refused) {
      if (!infoForm.email) errors.email = 'Email requis, ou cochez la case en dessous'
      else if (!isValidEmail(infoForm.email)) errors.email = 'Email invalide'
    }
    if (!infoForm.birth_date_display) errors.birth_date = 'Date de naissance requise'
    else if (!isValidBirthDate(infoForm.birth_date_display)) errors.birth_date = 'Date invalide (format JJ/MM/AAAA)'
    if (pp.enabled) {
      if (!pp.refuse) {
        if (!String(pp.nom || '').trim()) errors.pp = 'Nom de naissance requis, ou cochez la case'
        else if (!pp.nir && !pp.nir_present) errors.pp = 'Numéro requis, ou cochez la case'
        else if (pp.nir && !normaliserNir(pp.nir, { saisie: true }).ok) errors.pp = normaliserNir(pp.nir, { saisie: true }).error
      }
    } else if (!infoForm.ssn_refused) {
      const ssnNumbers = infoForm.ssn.replace(/\s/g, '')
      if (!ssnNumbers) { if (!ssnOnFile.known) errors.ssn = 'Numéro requis, ou cochez "Je refuse"' }
      else if (!verifierNir(ssnNumbers).ok) errors.ssn = verifierNir(ssnNumbers).erreurs[0]
    }
    if (!infoForm.gender) errors.gender = 'Genre requis'
    if (!infoForm.highest_diploma) errors.highest_diploma = 'Diplôme requis'
    if (!infoForm.csp) errors.csp = 'CSP requise'
    if (!infoForm.job_title) errors.job_title = 'Intitulé du poste requis'
    if (!infoForm.training_expectations || infoForm.training_expectations.trim().length === 0) errors.training_expectations = 'Vos attentes sont requises'
    setFormErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    try {
      const birthDateISO = parseBirthDateToISO(infoForm.birth_date_display)
      let ppWarning = null
      if (pp.enabled) {
        try {
          const st = await portailPasseport('portal-save', {
            token, trainee_id: selectedTrainee.id, code: accessCode || undefined,
            nom_naissance: pp.nom, nir: pp.refuse ? '' : (pp.nir || ''), refuse: !!pp.refuse,
            gender: infoForm.gender || undefined, birth_date: birthDateISO || undefined,
          })
          setPp({ ...st, nom: st.nom_naissance, nir: '', refuse: st.refuse })
        } catch (ppErr) {
          if (ppErr.status === 400) { setFormErrors({ pp: ppErr.message }); setSubmitting(false); return }
          ppWarning = "Votre fiche est enregistrée, mais pas votre numéro : le formateur pourra le saisir."
        }
      }
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
      if (pp.enabled) {
        delete traineeUpdate.social_security_number
        traineeUpdate.refused_ssn = !!pp.refuse
      }
      const { error: updateError } = await supabase.rpc('update_trainee_data', { p_token: token, p_trainee_id: selectedTrainee.id, p_data: traineeUpdate, p_ticket: portalTicket })
      if (updateError) throw updateError
      const { social_security_number: _ssnSent, ...traineeShown } = traineeUpdate
      setSelectedTrainee({ ...selectedTrainee, ...traineeShown })

      const { error: infoError } = await supabase.rpc('save_trainee_info', {
        p_token: token,
        p_trainee_id: selectedTrainee.id,
        p_ticket: portalTicket,
        p_data: {
          email: infoForm.email_refused ? null : infoForm.email,
          ssn: pp.enabled || infoForm.ssn_refused ? null : infoForm.ssn.replace(/\s/g, ''),
          ssn_refused: pp.enabled ? !!pp.refuse : infoForm.ssn_refused,
          last_training_year: infoForm.last_training_year ? parseInt(infoForm.last_training_year) : null,
          highest_diploma: infoForm.highest_diploma,
          csp: infoForm.csp || null,
          job_title: infoForm.job_title || null,
          training_expectations: infoForm.training_expectations,
          // Mention d'information affichée (chantier F, décision de H du 17/10) : plus de case obligatoire ; le champ
          // garde la date à laquelle la fiche a été remplie avec la mention sous les yeux
          rgpd_consent: true,
          rgpd_consent_date: new Date().toISOString(),
          filled_at: new Date().toISOString(),
          filled_online: true,
        },
      })
      if (infoError) throw infoError

      await supabase.rpc('portal_set_email_refused', { p_token: token, p_trainee_id: selectedTrainee.id, p_refused: !!infoForm.email_refused })

      const typedSsn = pp.enabled ? '' : infoForm.ssn.replace(/\s/g, '')
      if (!pp.enabled && infoForm.ssn_refused) setSsnOnFile({ known: false, last3: '' })
      else if (typedSsn) setSsnOnFile({ known: true, last3: typedSsn.slice(-3) })
      setInfoForm((f) => ({ ...f, ssn: '' }))
      setInfoSheet({ ...infoForm, ssn: '', filled_at: new Date().toISOString() })
      if (ppWarning) setPp((p) => ({ ...p, warning: ppWarning }))

      const suite = () => {
        if (positioningQuestions.length > 0 && !positioningTestCompleted) {
          setCurrentStep('hub')
          startQuiz('positioning')
        } else {
          routeAfterLoad(session, attendanceData, evaluationData)
        }
      }
      // Numéro non communiqué : la décharge à signer s'ouvre avant la suite du parcours (0436)
      const refuse = pp.enabled ? !!pp.refuse : !!infoForm.ssn_refused
      let etatDecharge = null
      if (refuse) {
        try { etatDecharge = (await supabase.rpc('portail_decharge_nir_etat', { p_token: token, p_trainee_id: selectedTrainee.id, p_ticket: portalTicket })).data } catch { etatDecharge = null }
        setDecharge(etatDecharge)
      }
      if (refuse && etatDecharge && !etatDecharge.signee) {
        setApresDecharge(() => suite)
        setDechargeOuverte(true)
      } else {
        suite()
      }
    } catch (err) {
      console.error('Erreur :', err)
      setPortalError("Erreur lors de l'enregistrement. Veuillez réessayer.")
    } finally {
      setSubmitting(false)
    }
  }

  // ---------------- Décharge « numéro non communiqué » (0436) ----------------
  const genererDecharge = async () => {
    const { data: org, error } = await supabase.rpc('portail_org_stagiaire', { p_token: token, p_trainee_id: selectedTrainee.id, p_ticket: portalTicket })
    if (error || !org) throw new Error('Organisme introuvable')
    const orgPdf = (await prepareOrgForPDF(org)) || org
    return generatePasseportPreventionPDF('decharge', orgPdf, donneesDecharge(session, selectedTrainee)).output('datauristring').split(',')[1]
  }
  const signerDecharge = async ({ signature, sha256, nom }) => {
    const { data, error } = await supabase.rpc('portail_decharge_nir_signer', {
      p_token: token, p_trainee_id: selectedTrainee.id, p_ticket: portalTicket, p_signature: signature, p_hash: sha256, p_nom: nom,
    })
    if (error) throw new Error(error.message || 'Signature impossible')
    setDecharge((d) => ({ ...(d || {}), refuse: true, signee: true, signed_at: data?.signed_at }))
    setDechargeOuverte(false)
    const suite = apresDecharge
    setApresDecharge(null)
    if (suite) suite()
  }
  const reporterDecharge = () => {
    setDechargeOuverte(false)
    const suite = apresDecharge
    setApresDecharge(null)
    if (suite) suite()
  }

  // ---------------- Quiz ----------------
  // Les questions viennent toujours de portal_quiz_questions (sans les bonnes réponses)
  const startQuiz = async (mode, trainee = selectedTrainee) => {
    setSubmitting(true)
    try {
      const { data, error } = await supabase.rpc('portal_quiz_questions', { p_token: token, p_trainee_id: trainee.id, p_purpose: mode })
      if (error) throw error
      if (!data || data.length === 0) {
        setPortalError("Aucune question n'est disponible pour cette formation.")
        return
      }
      setQuiz({ mode, questions: data })
    } catch (err) {
      console.error('Quiz :', err)
      setPortalError('Impossible de charger le quiz.')
    } finally {
      setSubmitting(false)
    }
  }

  const quizCheck = async (question, answer) => {
    const { data, error } = await supabase.rpc('portal_quiz_check', { p_token: token, p_question_id: question.id, p_answer: answer })
    if (error) throw error
    return data
  }

  const quizFinish = async (answers) => {
    if (quiz.mode === 'positioning') {
      // Format historique attendu par save_positioning_test_answers
      const formatted = quiz.questions.map((q) => {
        const a = answers.find((x) => x.question_id === q.id) || {}
        return {
          question_id: q.id,
          question_type: q.question_type,
          selected_option_index: typeof a.index === 'number' ? a.index : null,
          text_answer: typeof a.text === 'string' ? a.text : null,
        }
      })
      const { error } = await supabase.rpc('save_positioning_test_answers', { p_token: token, p_trainee_id: selectedTrainee.id, p_answers: formatted })
      if (error) throw error
      setPositioningTestCompleted(true)
      return { ok: true }
    }
    const { data, error } = await supabase.rpc('portal_quiz_finish', { p_token: token, p_trainee_id: selectedTrainee.id, p_purpose: quiz.mode, p_answers: answers })
    if (error) throw error
    return data
  }

  const closeQuiz = () => {
    const wasPositioning = quiz?.mode === 'positioning'
    setQuiz(null)
    loadQuizSummary(selectedTrainee.id)
    if (wasPositioning && positioningTestCompleted) routeAfterLoad(session, attendanceData, evaluationData)
    else if (wasPositioning) setCurrentStep('hub')
  }

  // ---------------- Émargement ----------------
  const periodOuverte = (period) => {
    if (session?.signature_mode === 'ferme') return { ouvert: false, message: 'Signatures fermées par le formateur' }
    if (session?.signature_mode === 'ouvert') return { ouvert: true }
    if (!isWithinSessionDates(session)) return { ouvert: false, message: "Nous ne sommes pas dans les dates de la formation" }
    const now = new Date()
    const heure = now.getHours() + now.getMinutes() / 60
    const [startHour, startMin] = (session?.start_time || '09:00').split(':').map(Number)
    const debut = startHour + (startMin || 0) / 60 - 1
    if (heure < debut) return { ouvert: false, message: `Signature possible à partir de ${String(Math.max(0, Math.floor(debut))).padStart(2, '0')}h` }
    if (period === 'afternoon' && heure < 13) return { ouvert: false, message: "L'après-midi se signe à partir de 13h" }
    return { ouvert: true }
  }

  // Émargement sans réseau (0417) : signatures gardées sur ce téléphone, envoyées au retour du réseau
  const [signaturesEnAttente, setSignaturesEnAttente] = useState(() => enAttente(token).length)
  useEffect(() => {
    if (!token) return undefined
    let actif = true
    const essayer = async () => {
      if (enAttente(token).length === 0) { if (actif) setSignaturesEnAttente(0); return }
      const r = await envoyerEnAttente(supabase, token)
      if (!actif) return
      setSignaturesEnAttente(enAttente(token).length)
      if (r.refus.length) setPortalError(`Une signature faite sans réseau n'a pas été acceptée : ${r.refus[0].error}. Prévenez votre formateur.`)
    }
    essayer()
    const t = setInterval(essayer, 20000)
    window.addEventListener('online', essayer)
    return () => { actif = false; clearInterval(t); window.removeEventListener('online', essayer) }
  }, [token])

  const handleSignPeriod = async (period, image) => {
    const key = `${today}_${period}`
    setSigningPeriod(null)
    setSigningBusy(true)
    try {
      let reponse
      try {
        reponse = await supabase.rpc('portal_sign_halfday', { p_token: token, p_trainee_id: selectedTrainee.id, p_period: period, p_signature: image })
      } catch (e) { reponse = { error: e } }
      // Coupure de réseau : la signature est gardée sur ce téléphone avec son heure, envoyée au retour du réseau
      if (reponse.error && estPanneReseau(reponse.error)) {
        if (!garder({ token, traineeId: selectedTrainee.id, period, image, date: today })) throw reponse.error
        setSignaturesEnAttente(enAttente(token).length)
        reponse = { data: { ok: true } }
      }
      const { data, error } = reponse
      if (error) throw error
      if (!data?.ok) {
        setPortalError(data?.error || "La signature n'a pas pu être enregistrée")
        setSigningBusy(false)
        return
      }
      const newAttendanceData = { ...attendanceData, [key]: true }
      setAttendanceData(newAttendanceData)
      setSignedTimes({ ...signedTimes, [key]: new Date().toISOString() })

      if (allPeriodsSignedToday(newAttendanceData, session)) {
        const isLastDay = session.end_date && isToday(parseISO(session.end_date))
        if (isLastDay && !(evaluationData && evaluationData.questionnaire_submitted)) setCurrentStep('attendance_complete')
        else setCurrentStep('hub')
      }
    } catch (err) {
      console.error('Erreur émargement :', err)
      setPortalError("Erreur lors de l'enregistrement de votre signature. Prévenez votre formateur.")
    } finally {
      setSigningBusy(false)
    }
  }

  // ---------------- Satisfaction ----------------
  const handleSubmitEvaluation = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const evalData = {
        session_id: session.id,
        trainee_id: selectedTrainee.id,
        ...Object.fromEntries(EVAL_KEYS.map((k) => [k, evalForm[k]])),
        would_recommend: evalForm.would_recommend,
        comment_general: evalForm.comment_general || null,
        comment_projet: evalForm.comment_projet || null,
        questionnaire_submitted: true,
        submitted_at: new Date().toISOString(),
        submitted_online: true,
      }
      const { error: evalError } = await supabase.rpc('save_evaluation', { p_token: token, p_trainee_id: selectedTrainee.id, p_eval_data: evalData })
      if (evalError) throw evalError
      // Bilan des attentes (0413) : réponse du stagiaire sur les attentes de sa fiche de renseignements
      if (evalForm.attentes_satisfaites) {
        const { error: attErr } = await supabase.rpc('portal_save_attentes', {
          p_token: token, p_trainee_id: selectedTrainee.id, p_verdict: evalForm.attentes_satisfaites,
          p_commentaire: evalForm.attentes_commentaire || null, p_ticket: portalTicket,
        })
        if (attErr) console.warn('Bilan des attentes non enregistré :', attErr.message)
        else Object.assign(evalData, { attentes_satisfaites: evalForm.attentes_satisfaites, attentes_commentaire: evalForm.attentes_commentaire || null })
      }
      setEvaluationData({ ...evalData })

      const scores = EVAL_KEYS.map((k) => evalForm[k]).filter((v) => v > 0)
      const average = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
      if (evalForm.would_recommend && average >= 4.5 && branding.google_review_url) setCurrentStep('google_review')
      else setCurrentStep('thank_you_website')
    } catch (err) {
      console.error('Erreur :', err)
      setPortalError("Erreur lors de l'enregistrement. Veuillez réessayer.")
    } finally {
      setSubmitting(false)
    }
  }

  const RatingButtons = ({ questionKey, currentValue }) => (
    <div className="flex flex-wrap gap-1.5">
      <button type="button" onClick={() => setEvalForm({ ...evalForm, [questionKey]: 0 })}
        className={`px-2.5 py-1.5 text-ui-sm rounded-ui border transition-all ${currentValue === 0 ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-400 border-gray-200'}`}>
        N/C
      </button>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => setEvalForm({ ...evalForm, [questionKey]: n })}
          className={`w-9 h-9 rounded-ui border text-ui font-semibold transition-all ${
            currentValue === n ? 'bg-accent-500 text-accent-fg border-accent-500 shadow-sm scale-105' : 'bg-white text-gray-600 border-gray-200 hover:border-accent-300'
          }`}>
          {n}
        </button>
      ))}
    </div>
  )

  // ---------------- Vues plein écran ----------------
  if (showDocuments) {
    return <TraineeDocuments token={token} session={session} traineeId={selectedTrainee?.id} onBack={() => setShowDocuments(false)} />
  }

  if (signingPeriod && selectedTrainee) {
    return (
      <FullscreenSignaturePad
        title={`${selectedTrainee.first_name} ${(selectedTrainee.last_name || '').toUpperCase()}`}
        subtitle={`${signingPeriod === 'morning' ? 'Matin' : 'Après-midi'}, ${session?.courses?.title || 'Formation'}`}
        confirmLabel="Je signe ma présence"
        onValidate={(image) => handleSignPeriod(signingPeriod, image)}
        onCancel={() => setSigningPeriod(null)}
      />
    )
  }

  if (quiz && selectedTrainee) {
    const titles = { positioning: 'Test de positionnement', training: 'Entraînement', final: 'Évaluation des acquis' }
    return (
      <QuizEngine
        questions={quiz.questions}
        mode={quiz.mode}
        title={titles[quiz.mode]}
        onCheck={quizCheck}
        onFinish={quizFinish}
        onClose={closeQuiz}
      />
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'rgb(var(--ground))' }}>
        <style>{portalStyles}</style>
        <div className="flex flex-col items-center gap-3 portal-card-enter">
          <div className="w-14 h-14 rounded-ui-lg bg-white shadow-md flex items-center justify-center">
            <Loader2 className="w-7 h-7 animate-spin text-accent-500" />
          </div>
          <p className="text-ui text-gray-500 font-medium">Chargement</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'rgb(var(--ground))' }}>
        <style>{portalStyles}</style>
        <div className="bg-white rounded-ui-lg shadow-sm p-8 max-w-md text-center portal-card-enter">
          <div className="w-16 h-16 rounded-full bg-[rgb(var(--c-danger-bg))] flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-[rgb(var(--c-danger))]" />
          </div>
          <h1 className="font-display text-xl font-bold text-gray-900 mb-2">Lien invalide</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    )
  }

  // ---------------- Données dérivées pour l'espace ----------------
  const sessionDays = session.start_date && session.end_date ? eachDayOfInterval({ start: parseISO(session.start_date), end: parseISO(session.end_date) }) : []
  const inDates = isWithinSessionDates(session)
  const lastDay = session.end_date === today
  const signedToday = session.periods.filter((p) => attendanceData[`${today}_${p}`]).length
  const evaluationBank = quizSummary?.evaluation_bank || 0
  const finalDone = !!quizSummary?.final
  const finalAvailable = finalDone || (inDates && lastDay) || session.status === 'completed' || today > session.end_date
  const satisfactionDone = !!(evaluationData && evaluationData.questionnaire_submitted)
  const satisfactionAvailable = satisfactionDone || lastDay || today > session.end_date

  const goHub = () => setCurrentStep('hub')


  // Accueil du portail (0423) : vitrine de l'organisme et code personnel, aucun nom d'inscrit
  if (currentStep === 'select') {
    const dates = session?.start_date && session?.end_date
      ? (session.start_date === session.end_date
        ? format(parseISO(session.start_date), 'd MMMM yyyy', { locale: fr })
        : `Du ${format(parseISO(session.start_date), 'd MMM', { locale: fr })} au ${format(parseISO(session.end_date), 'd MMM yyyy', { locale: fr })}`)
      : ''
    return (
      <EcranVitrine branding={branding} libelle="Portail stagiaire" pastille="Votre formation" pastilleIcone={Sparkles}
        titre={session?.courses?.title || 'Votre formation'}
        accroche={[dates, session?.location_city].filter(Boolean).join(' · ')}
        atouts={[
          { i: PenLine, t: 'Émargement sur votre téléphone, matin et après-midi' },
          { i: FileText, t: 'Votre fiche, vos évaluations et vos documents de formation' },
          { i: ShieldCheck, t: branding.qualiopi_certified ? 'Organisme certifié Qualiopi, données protégées' : 'Accès personnel protégé par votre code' },
        ]}
        pied={`${orgName}${branding.qualiopi_certified ? ', organisme certifié Qualiopi' : ''}`}>
        <div className="w-12 h-12 rounded-full bg-accent-500/10 text-accent-600 flex items-center justify-center mb-5"><Lock className="w-6 h-6" aria-hidden="true" /></div>
        <h2 className="font-display text-2xl font-semibold text-gray-900">Votre code personnel</h2>
        <p className="text-sm text-gray-500 mt-1.5">Il figure sur votre convocation. Sinon, demandez-le à votre formateur.</p>
        <form onSubmit={handleEntrer} className="mt-6">
          <CodeCases id="portail-code" code={accessCode} erreur={!!codeError} secoue={secoue}
            onChange={(v) => { setAccessCode(v); setCodeError('') }} onComplet={(v) => handleEntrer(null, v)} />
          {codeError && <p role="alert" className="mt-3 text-sm text-[rgb(var(--c-danger))] flex items-start gap-1.5"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />{codeError}</p>}
          <button type="submit" className="btn btn-primary w-full justify-center mt-5 h-11 gap-2" disabled={submitting || accessCode.length !== 6}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <>Entrer <ArrowRight className="w-4 h-4" aria-hidden="true" /></>}
          </button>
        </form>
        <button type="button" onClick={() => setShowDocuments(true)} className="btn btn-secondary w-full justify-center mt-3 h-11 gap-2">
          <FileText className="w-4 h-4" aria-hidden="true" /> Documents de formation
        </button>
        <p className="mt-6 text-xs text-gray-400 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />Code personnel : ne le communiquez pas. Aucun nom n'est affiché sur cette page.</p>
      </EcranVitrine>
    )
  }

  return (
    <div className="min-h-screen py-4 px-3 sm:py-6 sm:px-4" style={{ background: 'rgb(var(--ground))' }}>
      <style>{portalStyles}</style>
      <div className="max-w-lg mx-auto">
        {signaturesEnAttente > 0 && (
          <div className="mb-3">
            <Banner tone="warning" title={`${signaturesEnAttente} signature${signaturesEnAttente > 1 ? 's' : ''} gardée${signaturesEnAttente > 1 ? 's' : ''} sur ce téléphone`}>
              Pas de réseau pour l'instant : l'envoi se fera tout seul dès son retour, avec l'heure de votre signature. Si possible, gardez cette page ouverte.
            </Banner>
          </div>
        )}
        {portalError && (
          <div className="fixed inset-x-0 bottom-0 z-50 p-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
            <div className="max-w-lg mx-auto bg-white" style={{ borderRadius: 'var(--radius-ui)', boxShadow: 'var(--shadow-pop)' }}>
              <Banner tone="danger" title={portalError} onClose={() => setPortalError(null)} />
            </div>
          </div>
        )}
        {/* Quiz flash lancé par le formateur (0425) : bandeau, puis jeu en plein écran */}
        {selectedTrainee && !['select', 'absent'].includes(currentStep) && <QuizFlashJeu token={token} traineeId={selectedTrainee.id} ticket={portalTicket} />}
        {dechargeOuverte && selectedTrainee && (
          <DechargeNir genererPdf={genererDecharge} nom={[selectedTrainee.first_name, (selectedTrainee.last_name || '').toUpperCase()].filter(Boolean).join(' ')}
            onSigner={signerDecharge} onPlusTard={reporterDecharge} />
        )}
        {/* En-tête aux couleurs de l'organisme */}
        <div className="bg-nav text-nav-fg rounded-t-ui-lg p-5 relative overflow-hidden">
          <div className="relative">
            <div className="flex items-center gap-3">
              {logo ? (
                <img src={logo} alt={orgName} className="h-10 w-auto max-w-[120px] object-contain bg-white/95 rounded-ui-sm px-1.5 py-1" />
              ) : (
                <div className="w-10 h-10 rounded-ui bg-accent-500 text-accent-fg flex items-center justify-center font-display font-bold text-lg">
                  {(orgName || 'O').slice(0, 1)}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-ui-sm uppercase tracking-wider opacity-70 font-semibold">{orgName}</div>
                <h1 className="font-display text-lg font-bold leading-tight truncate">{session.courses?.title}</h1>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-ui-sm opacity-85">
              {session.clients?.name && (
                <span className="flex items-center gap-1.5"><GraduationCap className="w-3.5 h-3.5" />{session.clients.name}</span>
              )}
              {session.start_date && session.end_date && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  {session.start_date === session.end_date
                    ? format(parseISO(session.start_date), 'd MMMM yyyy', { locale: fr })
                    : `${format(parseISO(session.start_date), 'd MMM', { locale: fr })} au ${format(parseISO(session.end_date), 'd MMM yyyy', { locale: fr })}`}
                </span>
              )}
              {session.location_city && (
                <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{session.location_city}</span>
              )}
            </div>
            {selectedTrainee && (
              <div className="mt-3 inline-flex items-center gap-2 text-ui bg-white/10 rounded-full pl-1 pr-3 py-1">
                <span className="w-6 h-6 rounded-full bg-accent-500 text-accent-fg text-ui-sm font-bold flex items-center justify-center">
                  {(selectedTrainee.first_name || '?').slice(0, 1)}{(selectedTrainee.last_name || '').slice(0, 1)}
                </span>
                {selectedTrainee.first_name} {selectedTrainee.last_name}
              </div>
            )}
          </div>
        </div>

        {['info_sheet', 'positioning'].includes(currentStep) && (
          <div className="bg-white border-x border-gray-100">
            <ProgressStepper currentStep={currentStep} hasTest={positioningQuestions.length > 0} />
          </div>
        )}

        <div className="bg-white rounded-b-ui-lg shadow-md shadow-primary-900/5 p-5 sm:p-6">
          <div key={currentStep} className="portal-step-enter">

            {/* Fiche de renseignement */}
            {currentStep === 'info_sheet' && selectedTrainee && (
              <form onSubmit={handleSubmitInfoSheet} className="space-y-4">
                <div>
                  <h2 className="font-display text-lg font-bold flex items-center gap-2">
                    <FileText className="w-5 h-5 text-accent-500" /> Fiche de renseignement
                  </h2>
                  <p className="text-ui-sm text-gray-500 mt-1">Première connexion uniquement. Ces informations restent confidentielles.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Prénom *</label>
                    <input type="text" value={infoForm.first_name} onChange={(e) => setInfoForm({ ...infoForm, first_name: e.target.value })} className={inputClass} />
                    {formErrors.first_name && <p className={errorClass}>{formErrors.first_name}</p>}
                  </div>
                  <div>
                    <label className={labelClass}>Nom *</label>
                    <input type="text" value={infoForm.last_name} onChange={(e) => setInfoForm({ ...infoForm, last_name: e.target.value })} className={inputClass} />
                    {formErrors.last_name && <p className={errorClass}>{formErrors.last_name}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Date de naissance *</label>
                    <input type="text" inputMode="numeric" placeholder="JJ/MM/AAAA" value={infoForm.birth_date_display}
                      onChange={(e) => setInfoForm({ ...infoForm, birth_date_display: formatBirthDateInput(e.target.value) })} maxLength={10} className={inputClass} />
                    {formErrors.birth_date && <p className={errorClass}>{formErrors.birth_date}</p>}
                  </div>
                  <div>
                    <label className={labelClass}>Genre *</label>
                    <select value={infoForm.gender} onChange={(e) => setInfoForm({ ...infoForm, gender: e.target.value })} className={inputClass}>
                      <option value="">Choisir</option>
                      <option value="male">Homme</option>
                      <option value="female">Femme</option>
                      <option value="non_binary">Non genré</option>
                    </select>
                    {formErrors.gender && <p className={errorClass}>{formErrors.gender}</p>}
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Email {!infoForm.email_refused && '*'}</label>
                  <input type="email" value={infoForm.email_refused ? '' : infoForm.email} onChange={(e) => setInfoForm({ ...infoForm, email: e.target.value })}
                    disabled={infoForm.email_refused} placeholder={infoForm.email_refused ? 'Non communiqué' : 'vous@exemple.fr'}
                    className={`${inputClass} ${infoForm.email_refused ? 'bg-gray-50 text-gray-400' : ''}`} />
                  {formErrors.email && <p className={errorClass}>{formErrors.email}</p>}
                  <label className="flex items-start gap-2 mt-2 cursor-pointer">
                    <input type="checkbox" checked={!!infoForm.email_refused} onChange={(e) => setInfoForm({ ...infoForm, email_refused: e.target.checked })} className="w-4 h-4 mt-0.5 accent-[rgb(var(--c-accent-500))]" />
                    <span className="text-ui-sm text-gray-600">
                      Je ne souhaite pas communiquer mon adresse email. Mes documents (attestation, certificat) seront envoyés au responsable de mon entreprise.
                    </span>
                  </label>
                </div>

                {pp.enabled ? (
                  <PasseportPortalBlock value={pp} onChange={setPp} error={formErrors.pp} ctx={ctxNir} />
                ) : (
                <div>
                  <label className={labelClass} htmlFor="portail-nir">Numéro de Sécurité sociale {!infoForm.ssn_refused && '*'}</label>
                  <ChampNir id="portail-nir" value={infoForm.ssn} onChange={(v) => setInfoForm({ ...infoForm, ssn: v })} ctx={ctxNir}
                    disabled={infoForm.ssn_refused} placeholder={infoForm.ssn_refused ? 'Non communiqué' : (ssnOnFile.known ? `Déjà enregistré (se termine par ${ssnOnFile.last3})` : '1 85 05 78 006 084 36')}
                    className={`${inputClass} ${infoForm.ssn_refused ? 'bg-gray-50 text-gray-400' : ''}`} aide={!ssnOnFile.known ? 'Sur votre carte Vitale : 15 caractères, clé comprise.' : null} />
                  {formErrors.ssn && <p className={errorClass}>{formErrors.ssn}</p>}
                  {ssnOnFile.known && !infoForm.ssn_refused && !infoForm.ssn && (
                    <p className="text-ui-sm mt-1 text-gray-500">Numéro déjà enregistré. Laissez vide pour le conserver, ou saisissez-le pour le corriger.</p>
                  )}
                  <label className="flex items-start gap-2 mt-2 cursor-pointer">
                    <input type="checkbox" checked={infoForm.ssn_refused}
                      onChange={(e) => setInfoForm({ ...infoForm, ssn_refused: e.target.checked, ssn: e.target.checked ? '' : infoForm.ssn })} className="w-4 h-4 mt-0.5 accent-[rgb(var(--c-accent-500))]" />
                    <span className="text-ui-sm text-gray-600">Je refuse de communiquer mon numéro de Sécurité sociale</span>
                  </label>
                </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Dernière formation (année)</label>
                    <input type="text" inputMode="numeric" placeholder="2023" maxLength={4} value={infoForm.last_training_year}
                      onChange={(e) => setInfoForm({ ...infoForm, last_training_year: e.target.value.replace(/\D/g, '') })} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Diplôme le plus élevé *</label>
                    <select value={infoForm.highest_diploma} onChange={(e) => setInfoForm({ ...infoForm, highest_diploma: e.target.value })} className={inputClass}>
                      <option value="">Sélectionner</option>
                      <option value="Sans diplôme">Sans diplôme</option>
                      <option value="CAP/BEP">CAP/BEP</option>
                      <option value="Baccalauréat">Baccalauréat</option>
                      <option value="Bac+2">Bac+2 (BTS, DUT)</option>
                      <option value="Bac+3">Bac+3 (Licence)</option>
                      <option value="Bac+5">Bac+5 (Master)</option>
                      <option value="Bac+8">Bac+8 (Doctorat)</option>
                    </select>
                    {formErrors.highest_diploma && <p className={errorClass}>{formErrors.highest_diploma}</p>}
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Catégorie socio-professionnelle *</label>
                  <select value={infoForm.csp} onChange={(e) => setInfoForm({ ...infoForm, csp: e.target.value })} className={inputClass}>
                    <option value="">Sélectionner</option>
                    <option value="Agriculteurs exploitants">Agriculteurs exploitants</option>
                    <option value="Artisans, commerçants, chefs d'entreprise">Artisans, commerçants, chefs d'entreprise</option>
                    <option value="Cadres et professions intellectuelles supérieures">Cadres et professions intellectuelles supérieures</option>
                    <option value="Professions intermédiaires">Professions intermédiaires</option>
                    <option value="Employés">Employés</option>
                    <option value="Ouvriers">Ouvriers</option>
                    <option value="Retraités">Retraités</option>
                    <option value="Autres personnes sans activité professionnelle">Autres personnes sans activité professionnelle</option>
                  </select>
                  {formErrors.csp && <p className={errorClass}>{formErrors.csp}</p>}
                </div>

                <div>
                  <label className={labelClass}>Intitulé du poste *</label>
                  <input type="text" value={infoForm.job_title} onChange={(e) => setInfoForm({ ...infoForm, job_title: e.target.value })} placeholder="Technicien de maintenance" className={inputClass} />
                  {formErrors.job_title && <p className={errorClass}>{formErrors.job_title}</p>}
                </div>

                <div>
                  <label className={labelClass}>Mes attentes de la formation *</label>
                  <textarea value={infoForm.training_expectations} onChange={(e) => setInfoForm({ ...infoForm, training_expectations: e.target.value })}
                    placeholder="Vos attentes, objectifs personnels, compétences à acquérir" className={inputClass} rows={3} />
                  {formErrors.training_expectations && <p className={errorClass}>{formErrors.training_expectations}</p>}
                </div>

                <div className="bg-primary-50 rounded-ui-lg p-3 text-ui-sm text-gray-700 space-y-1">
                  <p className="font-semibold">Vos données</p>
                  <p>
                    {orgName || 'L\'organisme de formation'} utilise ces informations pour organiser votre formation, établir les documents
                    obligatoires (émargement, attestations, certificats) et répondre aux financeurs : c'est nécessaire à votre formation
                    et imposé par le code du travail. Elles sont gardées 5 ans après votre dernière formation (6 ans pour les preuves de réalisation).
                  </p>
                  <p>
                    Vous pouvez y accéder, les faire corriger ou effacer quand la loi le permet, et vous opposer à certains usages, en écrivant
                    à l'organisme (coordonnées sur votre convocation). Vous pouvez aussi saisir la CNIL (cnil.fr).
                  </p>
                </div>

                <button type="submit" disabled={submitting}
                  className="w-full py-3.5 bg-accent-500 text-accent-fg font-bold rounded-ui-lg disabled:bg-gray-200 disabled:text-gray-400 flex items-center justify-center gap-2">
                  {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />} Enregistrer et continuer
                </button>
              </form>
            )}

            {/* Stagiaire noté absent */}
            {currentStep === 'absent' && (
              <div className="text-center py-10 portal-card-enter">
                <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-5">
                  <AlertCircle className="w-10 h-10 text-gray-400" />
                </div>
                <h2 className="font-display text-xl font-bold text-gray-900 mb-2">Accès indisponible</h2>
                <p className="text-gray-500">Vous êtes noté absent sur cette formation.<br />Adressez-vous à votre formateur.</p>
                <button onClick={quitter} className="mt-6 px-5 py-2.5 rounded-ui bg-gray-100 text-gray-700 font-medium">Retour</button>
              </div>
            )}

            {/* Espace stagiaire */}
            {currentStep === 'hub' && selectedTrainee && (
              <div className="space-y-3">
                {decharge?.refuse && !decharge?.signee && (
                  <div className="rounded-ui border border-accent-500/30 bg-accent-500/5 p-3 flex items-center gap-3 flex-wrap">
                    <PenLine className="w-5 h-5 text-accent-600 shrink-0" aria-hidden="true" />
                    <p className="flex-1 min-w-[12rem] text-ui-sm text-gray-800">Vous ne communiquez pas votre numéro de sécurité sociale : merci de signer la décharge.</p>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setDechargeOuverte(true)}>Signer la décharge</button>
                  </div>
                )}
                <div className="flex items-end justify-between">
                  <div>
                    <h2 className="font-display text-lg font-bold text-gray-900">Mon espace</h2>
                    <p className="text-ui-sm text-gray-500">
                      {inDates ? (sessionDays.length > 1 ? `Jour ${sessionDays.findIndex((d) => format(d, 'yyyy-MM-dd') === today) + 1} sur ${sessionDays.length}` : 'Formation en cours') : today < session.start_date ? 'Avant la formation' : 'Formation terminée'}
                    </p>
                  </div>
                  {quizSummary && quizSummary.xp > 0 && (
                    <div className="flex items-center gap-1 text-highlight-800 bg-highlight-50 rounded-full px-3 py-1 font-semibold text-ui-sm">
                      <Zap className="w-4 h-4" /> {quizSummary.xp} XP
                    </div>
                  )}
                </div>

                {inDates && (
                  <HubCard icon={Fingerprint} title="Émargement" primary={signedToday < session.periods.length}
                    tone={signedToday === session.periods.length ? 'done' : 'accent'}
                    status={signedToday === session.periods.length ? 'Présence du jour signée' : `${signedToday} / ${session.periods.length} demi-journée${session.periods.length > 1 ? 's' : ''} signée${signedToday > 1 ? 's' : ''}`}
                    subtitle={format(new Date(), 'EEEE d MMMM', { locale: fr })}
                    onClick={() => setCurrentStep('attendance')} />
                )}

                {/* Ressenti au fil de la formation (0414) */}
                {inDates && <RessentiJour token={token} traineeId={selectedTrainee.id} ticket={portalTicket} />}

                {positioningQuestions.length > 0 && (
                  <HubCard icon={ClipboardCheck} title="Test de positionnement" tone={positioningTestCompleted ? 'done' : 'accent'}
                    status={positioningTestCompleted ? 'Complété' : 'À faire avant la formation'}
                    disabled={positioningTestCompleted}
                    onClick={() => startQuiz('positioning')} />
                )}

                {evaluationBank > 0 && (
                  <HubCard icon={BookOpen} title="Entraînement" tone="highlight"
                    subtitle="Questions corrigées et expliquées, à refaire autant de fois que vous voulez"
                    status={quizSummary?.training_attempts > 0 ? `Meilleur score : ${quizSummary.training_best}% (${quizSummary.training_attempts} partie${quizSummary.training_attempts > 1 ? 's' : ''})` : null}
                    onClick={() => startQuiz('training')} />
                )}

                {evaluationBank > 0 && (
                  <HubCard icon={Trophy} title="Évaluation des acquis"
                    tone={finalDone ? 'done' : finalAvailable ? 'accent' : 'locked'}
                    badge={finalAvailable && !finalDone ? 'Nouveau' : null}
                    subtitle={finalDone ? null : 'Une seule tentative, en fin de formation'}
                    status={finalDone ? `${quizSummary.final.score} / ${quizSummary.final.max_score} (${Math.round((100 * quizSummary.final.score) / Math.max(1, quizSummary.final.max_score))}%)` : finalAvailable ? 'Disponible' : 'Disponible le dernier jour'}
                    disabled={finalDone || !finalAvailable}
                    onClick={() => startQuiz('final')} />
                )}

                <HubCard icon={Star} title="Questionnaire de satisfaction"
                  tone={satisfactionDone ? 'done' : satisfactionAvailable ? 'accent' : 'locked'}
                  status={satisfactionDone ? 'Envoyé, merci' : satisfactionAvailable ? 'À compléter' : 'Disponible le dernier jour'}
                  disabled={satisfactionDone || !satisfactionAvailable}
                  onClick={() => setCurrentStep('evaluation')} />

                <HubCard icon={FileText} title="Documents de formation" subtitle="Programme, supports et livrets" onClick={() => setShowDocuments(true)} />

                {/* Compte stagiaire personnel (lot 2, 0047) */}
                <CompteStagiairePortail token={token} trainee={selectedTrainee} ticket={portalTicket} emailConnu={selectedTrainee.email} />

                <button type="button" onClick={quitter}
                  className="w-full text-gray-400 hover:text-gray-600 text-ui font-medium flex items-center justify-center gap-1 pt-2">
                  <ChevronLeft className="w-4 h-4" /> Ce n'est pas moi : quitter
                </button>
              </div>
            )}

            {/* Émargement */}
            {currentStep === 'attendance' && selectedTrainee && (() => {
              const todayIndex = sessionDays.findIndex((d) => format(d, 'yyyy-MM-dd') === today)
              const currentDate = todayIndex >= 0 ? sessionDays[todayIndex] : new Date()
              return (
                <div className="space-y-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-display text-lg font-bold flex items-center gap-2">
                        <Fingerprint className="w-5 h-5 text-accent-500" /> Votre présence
                      </h2>
                      <p className="text-ui-sm text-gray-500 mt-1">Signez avec votre doigt : votre signature vaut émargement.</p>
                    </div>
                    <button type="button" onClick={goHub} className="text-ui-sm text-gray-500 flex items-center gap-1 whitespace-nowrap pt-1"><Home className="w-4 h-4" /> Mon espace</button>
                  </div>

                  <div className="bg-primary-50 rounded-ui-lg p-4">
                    <p className="text-ui font-semibold text-primary-900 capitalize">{format(currentDate, 'EEEE d MMMM yyyy', { locale: fr })}</p>
                    {todayIndex >= 0 && sessionDays.length > 1 && <p className="text-ui-sm text-primary-700 mt-0.5">Jour {todayIndex + 1} sur {sessionDays.length}</p>}
                  </div>

                  <div className="space-y-3">
                    {session.periods.map((period) => {
                      const key = `${today}_${period}`
                      const isSigned = attendanceData[key] === true
                      const ouverture = periodOuverte(period)
                      const Icon = period === 'morning' ? Sun : Sunset
                      return (
                        <div key={period} className={`rounded-ui-lg border-2 p-4 ${isSigned ? 'bg-[rgb(var(--c-success-bg))] border-transparent' : 'bg-white border-gray-100'}`}>
                          <div className="flex items-center gap-3 mb-3">
                            <div className={`w-11 h-11 rounded-ui flex items-center justify-center ${isSigned ? 'bg-[rgb(var(--c-success))] text-white' : 'bg-gray-100 text-gray-500'}`}>
                              {isSigned ? <CheckCircle className="w-6 h-6 check-pop" /> : <Icon className="w-6 h-6" />}
                            </div>
                            <div>
                              <p className="font-display font-semibold text-gray-900 text-lg">{period === 'morning' ? 'Matin' : 'Après-midi'}</p>
                              {isSigned && (
                                <p className="text-ui-sm text-[rgb(var(--c-success))]">
                                  Présence signée{signedTimes[key] ? ` à ${format(new Date(signedTimes[key]), 'HH')}h${format(new Date(signedTimes[key]), 'mm')}` : ''}
                                </p>
                              )}
                            </div>
                          </div>
                          {!isSigned && (ouverture.ouvert ? (
                            <button type="button" disabled={signingBusy} onClick={() => setSigningPeriod(period)}
                              className="w-full py-4 rounded-ui-lg bg-accent-500 text-accent-fg text-lg font-bold shadow-md disabled:opacity-60">
                              {signingBusy ? 'Enregistrement' : 'Signer ma présence'}
                            </button>
                          ) : (
                            <p className="text-ui text-gray-500 bg-gray-50 rounded-ui p-3 text-center">{ouverture.message}</p>
                          ))}
                        </div>
                      )
                    })}
                  </div>

                  <p className="text-ui-sm text-gray-400 text-center">
                    Une demi-journée signée ne peut plus être modifiée.<br />En cas de souci, votre formateur peut vous faire signer sur son téléphone.
                  </p>
                </div>
              )
            })()}

            {currentStep === 'attendance_complete' && selectedTrainee && (
              <AttendanceCompletePage session={session} trainee={selectedTrainee} onContinue={() => setCurrentStep('evaluation')} />
            )}

            {currentStep === 'thank_you' && (
              <div className="text-center py-8 portal-card-enter">
                <div className="w-20 h-20 rounded-full bg-primary-900 flex items-center justify-center mx-auto mb-5 shadow-md">
                  <CheckCircle className="w-10 h-10 text-white check-pop" />
                </div>
                <h2 className="font-display text-2xl font-bold text-gray-900 mb-2">C'est noté</h2>
                <p className="text-gray-500">Merci, vos informations sont enregistrées.</p>
                <button type="button" onClick={goHub} className="mt-6 px-5 py-2.5 rounded-ui bg-gray-100 text-gray-700 font-medium">Retour à mon espace</button>
              </div>
            )}

            {/* Satisfaction */}
            {currentStep === 'evaluation' && selectedTrainee && (
              <form onSubmit={handleSubmitEvaluation} className="space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-bold flex items-center gap-2">
                      <Star className="w-5 h-5 text-highlight-600" /> Votre avis sur la formation
                    </h2>
                    <p className="text-ui-sm text-gray-500 mt-1">De 1 (insuffisant) à 5 (très satisfaisant). N/C : non concerné.</p>
                  </div>
                  <button type="button" onClick={goHub} className="text-ui-sm text-gray-500 flex items-center gap-1 whitespace-nowrap pt-1"><Home className="w-4 h-4" /> Mon espace</button>
                </div>

                {[['Organisation', evalQuestions.organisation], ['Contenu', evalQuestions.contenu], ['Formateur', evalQuestions.formateur], ['Global', evalQuestions.global]].map(([title, qs]) => (
                  <div key={title}>
                    <h3 className="font-display font-semibold text-ui text-gray-900 mb-2 pb-1 border-b border-gray-100">{title}</h3>
                    <div className="space-y-3">
                      {qs.map((q) => (
                        <div key={q.key} className="flex flex-col gap-1">
                          <span className="text-ui-sm text-gray-700">{q.label}</span>
                          <RatingButtons questionKey={q.key} currentValue={evalForm[q.key]} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Bilan des attentes (0413) : les attentes écrites dans la fiche de renseignements, reprises en fin de formation */}
                {infoSheet?.training_expectations?.trim() && (
                  <div className="rounded-ui-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                    <div className="text-ui-sm text-gray-500">Au début de la formation, vous attendiez :</div>
                    <blockquote className="text-ui text-gray-800 italic border-l-2 border-accent-300 pl-2 whitespace-pre-line">{infoSheet.training_expectations.trim()}</blockquote>
                    <div className="text-ui-sm text-gray-700 font-medium">Ces attentes ont-elles été satisfaites ?</div>
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Attentes satisfaites">
                      {[['oui', 'Oui'], ['en_partie', 'En partie'], ['non', 'Non']].map(([v, l]) => (
                        <button key={v} type="button" role="radio" aria-checked={evalForm.attentes_satisfaites === v}
                          onClick={() => setEvalForm({ ...evalForm, attentes_satisfaites: v })}
                          className={`px-4 py-1.5 rounded-ui text-ui font-medium border ${evalForm.attentes_satisfaites === v ? 'bg-accent-500 text-accent-fg border-accent-500' : 'bg-white text-gray-700 border-gray-200'}`}>{l}</button>
                      ))}
                    </div>
                    {evalForm.attentes_satisfaites && evalForm.attentes_satisfaites !== 'oui' && (
                      <textarea placeholder="Qu'est-ce qui a manqué ?" value={evalForm.attentes_commentaire}
                        onChange={(e) => setEvalForm({ ...evalForm, attentes_commentaire: e.target.value })} className={inputClass} rows={2} />
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <span className="text-ui-sm text-gray-700">Recommanderiez-vous cette formation ?</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setEvalForm({ ...evalForm, would_recommend: true })}
                      className={`px-4 py-1.5 rounded-ui text-ui font-medium ${evalForm.would_recommend ? 'bg-[rgb(var(--c-success))] text-white' : 'bg-gray-100'}`}>Oui</button>
                    <button type="button" onClick={() => setEvalForm({ ...evalForm, would_recommend: false })}
                      className={`px-4 py-1.5 rounded-ui text-ui font-medium ${evalForm.would_recommend === false ? 'bg-[rgb(var(--c-danger))] text-white' : 'bg-gray-100'}`}>Non</button>
                  </div>
                </div>

                <div>
                  <h3 className="font-display font-semibold text-ui text-gray-900 mb-2 pb-1 border-b border-gray-100 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" /> Commentaires
                  </h3>
                  <textarea placeholder="Commentaire général (remarques, suggestions)" value={evalForm.comment_general}
                    onChange={(e) => setEvalForm({ ...evalForm, comment_general: e.target.value })} className={`${inputClass} mb-2`} rows={2} />
                  <textarea placeholder="Projet de formation (besoins futurs)" value={evalForm.comment_projet}
                    onChange={(e) => setEvalForm({ ...evalForm, comment_projet: e.target.value })} className={inputClass} rows={2} />
                </div>

                <button type="submit" disabled={submitting}
                  className="w-full py-3.5 bg-accent-500 text-accent-fg font-bold rounded-ui-lg disabled:bg-gray-200 disabled:text-gray-400 flex items-center justify-center gap-2">
                  {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />} Envoyer mon avis
                </button>
              </form>
            )}

            {currentStep === 'google_review' && (
              <div className="text-center py-6">
                <CheckCircle className="w-16 h-16 text-[rgb(var(--c-success))] mx-auto mb-4 check-pop" />
                <h2 className="font-display text-xl font-bold text-gray-900 mb-2">Merci</h2>
                <p className="text-gray-600 mb-6">Votre avis a bien été enregistré.</p>
                <div className="bg-highlight-50 rounded-ui-lg p-4 mb-4">
                  <p className="text-ui text-highlight-900 mb-3"><strong>Une dernière chose</strong><br />Votre avis compte : aidez-nous en laissant un avis sur Google.</p>
                  <a href={branding.google_review_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-highlight-500 text-highlight-fg font-semibold rounded-ui-lg">
                    <Star className="w-5 h-5" /> Laisser un avis Google <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
                <button type="button" onClick={goHub} className="text-ui text-gray-500">Retour à mon espace</button>
              </div>
            )}

            {currentStep === 'thank_you_website' && (
              <div className="text-center py-6">
                <CheckCircle className="w-16 h-16 text-[rgb(var(--c-success))] mx-auto mb-4 check-pop" />
                <h2 className="font-display text-xl font-bold text-gray-900 mb-2">Merci pour votre retour</h2>
                <p className="text-gray-600 mb-6">Votre avis a bien été enregistré.<br />Nous prenons en compte tous vos commentaires pour améliorer nos formations.</p>
                {branding.website && (
                  <div className="bg-primary-50 rounded-ui-lg p-4 mb-4">
                    <p className="text-ui text-primary-900 mb-3">Découvrez toutes nos formations sur notre site</p>
                    <a href={branding.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-6 py-3 bg-primary-900 text-white font-semibold rounded-ui-lg">
                      Visiter notre site <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                )}
                <button type="button" onClick={goHub} className="text-ui text-gray-500">Retour à mon espace</button>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-ui-sm text-gray-400 mt-4 font-medium">
          {orgName}{branding.qualiopi_certified ? ', organisme certifié Qualiopi' : ''}
        </p>
      </div>
    </div>
  )
}
