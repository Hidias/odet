import { apiFetch } from '../../core/api'
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore, useDataStore } from '../../core/store'
import { fetchAll } from '../../core/fetchAll'
import { supabase } from '../../core/supabase'
import { 
  Building2, GraduationCap, Users, Calendar, FileText, ArrowRight, GitMerge, 
  CheckCircle, AlertTriangle, UserCheck, AlertCircle, 
  Send, Clock, User, XCircle, Shield, Trash2, ExternalLink, Phone,
  Settings, Eye, EyeOff, GripVertical, ChevronUp, ChevronDown,
  BarChart3, TrendingUp, Target, Award, Star, MessageSquare,
  ClipboardCheck, FileWarning, RefreshCw, Zap, Activity,
  ThumbsUp, Mail, BookOpen, Layers, PieChart, X, Maximize2, Minimize2, PenLine
} from 'lucide-react'
import { format, isAfter, isBefore, startOfToday, addDays, addMonths, differenceInDays, subMonths, startOfMonth, endOfMonth } from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { qualiopiCycle } from '../certification/lib/certData'
import InterventionsDashboardCard from '../interventions/components/DashboardCard'
import { useDroits } from '../../core/rights/useDroit'

// ═══════════════════════════════════════════════════════════
// WIDGET REGISTRY
// ═══════════════════════════════════════════════════════════
const WIDGET_REGISTRY = {
  sessions_today:       { id: 'sessions_today',       label: 'Sessions aujourd\'hui',     icon: Calendar,      category: 'formation', color: 'blue',   defaultSize: 'md' },
  sessions_upcoming:    { id: 'sessions_upcoming',    label: 'Sessions à venir (7j)',     icon: Clock,         category: 'formation', color: 'blue',   defaultSize: 'md' },
  quality_indicators:   { id: 'quality_indicators',   label: 'Indicateurs qualité',       icon: Award,         category: 'formation', color: 'amber',  defaultSize: 'lg' },
  attendance_incomplete:{ id: 'attendance_incomplete', label: 'Émargements incomplets',    icon: ClipboardCheck,category: 'formation', color: 'red',    defaultSize: 'md' },
  evaluations_pending:  { id: 'evaluations_pending',  label: 'Évaluations en attente',    icon: FileText,      category: 'formation', color: 'orange', defaultSize: 'md' },
  certif_expiring:      { id: 'certif_expiring',      label: 'Certifications expirantes', icon: Shield,        category: 'formation', color: 'purple', defaultSize: 'md' },
  positioning_pending:  { id: 'positioning_pending',  label: 'Positionnements en attente',icon: Target,        category: 'formation', color: 'teal',   defaultSize: 'sm' },
  documents_missing:    { id: 'documents_missing',    label: 'Documents manquants',       icon: FileWarning,   category: 'formation', color: 'red',    defaultSize: 'md' },
  quotes_pipeline:      { id: 'quotes_pipeline',      label: 'Pipeline devis',            icon: TrendingUp,    category: 'commerce',  color: 'emerald',defaultSize: 'lg' },
  monthly_revenue:      { id: 'monthly_revenue',      label: 'CA mensuel',                icon: BarChart3,     category: 'commerce',  color: 'green',  defaultSize: 'md' },
  rdv_week:             { id: 'rdv_week',             label: 'RDV à prendre',             icon: Calendar,      category: 'commerce',  color: 'blue',   defaultSize: 'md' },
  hot_prospects:        { id: 'hot_prospects',        label: 'Prospects à rappeler',      icon: Phone,         category: 'commerce',  color: 'orange', defaultSize: 'md' },
  new_clients:          { id: 'new_clients',          label: 'Nouveaux clients',          icon: Building2,     category: 'commerce',  color: 'green',  defaultSize: 'sm' },
  conversion_rate:      { id: 'conversion_rate',      label: 'Taux de conversion',        icon: Target,        category: 'commerce',  color: 'blue',   defaultSize: 'sm' },
  top_courses:          { id: 'top_courses',          label: 'Top formations',            icon: Star,          category: 'commerce',  color: 'amber',  defaultSize: 'md' },
  reclamations_open:    { id: 'reclamations_open',    label: 'Réclamations ouvertes',     icon: AlertCircle,   category: 'alertes',   color: 'red',    defaultSize: 'md' },
  non_conformites:      { id: 'non_conformites',      label: 'Non-conformités',           icon: AlertTriangle, category: 'alertes',   color: 'orange', defaultSize: 'md' },
  auto_reminders:       { id: 'auto_reminders',       label: 'Rappels automatiques',      icon: Zap,           category: 'alertes',   color: 'yellow', defaultSize: 'lg' },
  recent_messages:      { id: 'recent_messages',      label: 'Messages récents',          icon: Mail,          category: 'alertes',   color: 'blue',   defaultSize: 'md' },
  qualiopi_audit:       { id: 'qualiopi_audit',       label: 'Audit Qualiopi',            icon: Shield,        category: 'alertes',   color: 'emerald',defaultSize: 'md' },
  bpf_status:           { id: 'bpf_status',           label: 'BPF Status',                icon: FileText,      category: 'alertes',   color: 'purple', defaultSize: 'sm' },
  revenue_12m:          { id: 'revenue_12m',          label: 'CA 12 mois',                icon: BarChart3,     category: 'analytique',color: 'green',  defaultSize: 'xl' },
  theme_distribution:   { id: 'theme_distribution',   label: 'Répartition par thème',     icon: PieChart,      category: 'analytique',color: 'blue',   defaultSize: 'md' },
  hours_realized:       { id: 'hours_realized',       label: 'Heures réalisées',          icon: Clock,         category: 'analytique',color: 'teal',   defaultSize: 'md' },
  trainee_stats:        { id: 'trainee_stats',        label: 'Statistiques stagiaires',   icon: Users,         category: 'analytique',color: 'purple', defaultSize: 'md' },
}

// Widgets construits sur les factures et les devis
const BILLING_WIDGETS = new Set(['quotes_pipeline', 'monthly_revenue', 'conversion_rate', 'revenue_12m'])

const CATEGORIES = {
  formation:  { label: 'Formation',  color: 'amber' },
  commerce:   { label: 'Commerce',   color: 'blue' },
  alertes:    { label: 'Alertes',    color: 'red' },
  analytique: { label: 'Analytique', color: 'green' },
}

const SIZE_CLASSES = {
  sm: 'col-span-1',
  md: 'col-span-1 lg:col-span-1',
  lg: 'col-span-1 lg:col-span-2',
  xl: 'col-span-1 lg:col-span-3',
}

// ═══════════════════════════════════════════════════════════
// UTILITY COMPONENTS
// ═══════════════════════════════════════════════════════════
function MiniBarChart({ data, height = 80, color = '#3B82F6' }) {
  if (!data || data.length === 0) return null
  const max = Math.max(...data.map(d => d.value), 1)
  const barWidth = Math.max(12, Math.floor(280 / data.length) - 4)
  const totalWidth = data.length * (barWidth + 4)
  return (
    <svg viewBox={`0 0 ${totalWidth} ${height + 20}`} className="w-full" style={{ maxHeight: height + 20 }}>
      {data.map((d, i) => {
        const bh = (d.value / max) * height
        return (
          <g key={i}>
            <rect x={i * (barWidth + 4)} y={height - bh} width={barWidth} height={Math.max(bh, 2)} rx={3} fill={d.highlight ? '#E9B44C' : color} opacity={d.highlight ? 1 : 0.7} />
            <text x={i * (barWidth + 4) + barWidth / 2} y={height + 14} textAnchor="middle" className="fill-gray-400" fontSize="9">{d.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

function ProgressBar({ value, max = 100, color = 'bg-gray-800', label, showValue = true }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="space-y-1">
      {label && <div className="flex justify-between text-ui-sm"><span className="text-gray-600">{label}</span>{showValue && <span className="font-medium text-gray-900">{pct}%</span>}</div>}
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ═══════════════════════════════════════════════════════════
export default function Dashboard() {
  const { clients, fetchClients, courses, fetchCourses, trainees, fetchTrainees, sessions, fetchSessions, getPurgeStats, organization, fetchOrganization } = useDataStore()
  const { user, modules, userRole } = useAuthStore()
  const navigate = useNavigate()
  // Gardes des boutons d'écriture du tableau de bord (la base refuse de toute façon ce qui n'est pas permis)
  const d = useDroits({
    preferences: 'organisation.preferences.gerer',
    signer: ['formation.suivi.gerer', 'formation.sessions.modifier_siennes'],
    session: 'formation.sessions.creer',
    client: 'clients.fiches.modifier',
    stagiaire: 'formation.stagiaires.creer',
  })
  
  
  const [widgetConfigs, setWidgetConfigs] = useState([])
  const [showSettings, setShowSettings] = useState(false)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [dragIdx, setDragIdx] = useState(null)
  
  const [dashData, setDashData] = useState({
    nonConformites: [], qualityAlerts: [], reclamations: [],
    purgeStats: null, rdvsAPrendre: [], callbacksToday: [], quotes: [],
    notifications: [],
    //  TABLE CORRECTE: trainee_evaluations (pas evaluations_hot)
    traineeEvaluations: [],
    sstCertifications: [], trainingThemes: [],
    invoices: [],
  })

  // ─── Widget config loading ─────────────────────────────
  useEffect(() => { loadWidgetConfigs() }, [])
  
  const loadWidgetConfigs = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setConfigLoaded(true); return }
    
    try { await supabase.rpc('init_dashboard_widgets', { p_user_id: user.id }) } catch(e) { console.warn('init_dashboard_widgets:', e.message) }
    
    const { data } = await supabase.from('dashboard_widget_configs').select('*').eq('user_id', user.id).order('position')
    
    if (data && data.length > 0) {
      // Merger avec WIDGET_REGISTRY pour ajouter les nouveaux widgets manquants
      const savedIds = new Set(data.map(d => d.widget_id))
      const missing = Object.values(WIDGET_REGISTRY)
        .filter(w => !savedIds.has(w.id))
        .map((w, i) => ({ widget_id: w.id, position: data.length + i, size: w.defaultSize, visible: true }))
      setWidgetConfigs([...data, ...missing])
    } else {
      setWidgetConfigs(Object.values(WIDGET_REGISTRY).map((w, i) => ({
        widget_id: w.id, position: i, size: w.defaultSize, visible: w.id !== 'recent_messages',
      })))
    }
    setConfigLoaded(true)
  }

  // ─── Data loading ──────────────────────────────────────
  useEffect(() => { loadData() }, [])
  
  useEffect(() => {
    const updateCompleted = async () => {
      if (sessions.length === 0) return
      const now = new Date(); now.setHours(0,0,0,0)
      const toComplete = sessions.filter(s => {
        if (s.status === 'completed' || s.status_locked || !s.end_date) return false
        const end = new Date(s.end_date); end.setHours(0,0,0,0)
        const dayAfter = new Date(end); dayAfter.setDate(dayAfter.getDate() + 1)
        return now >= dayAfter
      })
      for (const s of toComplete) await supabase.from('sessions').update({ status: 'completed' }).eq('id', s.id)
      if (toComplete.length > 0) fetchSessions()
    }
    updateCompleted()
  }, [sessions.length])
  
  useEffect(() => {
    if (!loading && sessions.length > 0) generateAutoNotifications()
  }, [loading, sessions.length])
  
  const generateAutoNotifications = async () => {
    const t = new Date(), dow = t.getDay(), dom = t.getDate(), mo = t.getMonth() + 1
    const key = `notif_gen_${format(t, 'yyyy-MM-dd')}`
    if (localStorage.getItem(key)) return
    const notifs = []
    if (dow === 1) notifs.push({ type: 'veille', title: 'Veille réglementaire à réaliser', message: 'Rappel hebdomadaire', link: '/veille-qualiopi' })
    if (dow === 6) notifs.push({ type: 'materiel', title: 'Vérification matériel', message: 'Rappel hebdomadaire', link: '/parametres' })
    if (dom === 1 && mo === 7) notifs.push({ type: 'audit', title: 'Audit interne annuel', message: 'Planifiez votre audit', link: '/qualiopi' })
    if (dom === 1 && mo === 8) notifs.push({ type: 'revue_direction', title: 'Revue de direction', message: 'Revue annuelle à réaliser', link: '/qualiopi' })
    // Une seule notification par type et par jour, quel que soit le navigateur (le repère local ne suffit pas)
    const dayStart = new Date(t); dayStart.setHours(0, 0, 0, 0)
    for (const n of notifs) {
      const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true })
        .eq('type', n.type).gte('created_at', dayStart.toISOString())
      if (!count) await supabase.from('notifications').insert(n)
    }
    // Échéances de certification (NDA, audits Qualiopi, BPF) : notifiées 90, 30 et 7 jours avant
    await supabase.rpc('cert_daily_notifications').then(() => {}, () => {})
    localStorage.setItem(key, 'done')
  }
  
  const loadData = async () => {
    await Promise.all([fetchClients(), fetchCourses(), fetchTrainees(), fetchSessions()])
    
    const [ncR, alertsR, reclR, rdvR, cbR, quotesR, notifR, traineeEvalsR, sstR, themesR, invoicesR] = await Promise.all([
      supabase.from('non_conformites').select('*').in('status', ['open', 'in_progress']).order('created_at', { ascending: false }),
      supabase.from('quality_alerts').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(10),
      //  reclamations - pas de trainee_id
      supabase.from('reclamations').select('id, reference, subject, description, created_at, session_id, status, date_reception').in('status', ['open', 'in_progress']).order('created_at', { ascending: false }).limit(10),
      supabase.from('prospect_rdv').select('*, clients(name)').eq('status', 'a_prendre').order('created_at', { ascending: false }),
      supabase.from('prospect_calls').select('*, clients(name)').eq('needs_callback', true).gte('callback_date', new Date().toISOString().split('T')[0]).order('callback_date').order('callback_time').limit(20),
      supabase.from('quotes').select('*, clients(name)').order('created_at', { ascending: false }).limit(50),
      supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(20),
      //  TABLE CORRECTE: trainee_evaluations (la vraie table des évals à chaud)
      fetchAll(() => supabase.from('trainee_evaluations').select('session_id, trainee_id, q_org_documents, q_org_accueil, q_org_locaux, q_org_materiel, q_contenu_organisation, q_contenu_supports, q_contenu_duree, q_contenu_programme, q_formateur_pedagogie, q_formateur_expertise, q_formateur_progression, q_formateur_moyens, q_global_adequation, q_global_competences, would_recommend, questionnaire_submitted, submitted_at')),
      fetchAll(() => supabase.from('sst_certifications').select('id, session_id, trainee_id, formation_type, candidat_certifie, date_certification, created_at')),
      supabase.from('training_themes').select('id, code, name, color'),
      // Factures émises (y compris partielles et annulées par avoir) + avoirs validés (déduits)
      fetchAll(() => supabase.from('invoices').select('id, reference, type, invoice_date, total_net_ht, total_ttc, status').in('status', ['paid', 'due', 'sent', 'overdue', 'partial', 'credited'])),
    ])
    
    // Enrich alerts
    let enrichedAlerts = []
    const alerts = alertsR.data || []
    if (alerts.length > 0) {
      const sIds = [...new Set(alerts.map(a => a.session_id).filter(Boolean))]
      const tIds = [...new Set(alerts.map(a => a.trainee_id).filter(Boolean))]
      const [sRes, tRes] = await Promise.all([
        sIds.length > 0 ? supabase.from('sessions').select('id, reference, course_id').in('id', sIds) : { data: [] },
        tIds.length > 0 ? supabase.from('trainees').select('id, first_name, last_name').in('id', tIds) : { data: [] },
      ])
      const cIds = [...new Set((sRes.data || []).map(s => s.course_id).filter(Boolean))]
      const cRes = cIds.length > 0 ? await supabase.from('courses').select('id, title').in('id', cIds) : { data: [] }
      const cMap = {}; (cRes.data || []).forEach(c => cMap[c.id] = c)
      const sMap = {}; (sRes.data || []).forEach(s => sMap[s.id] = { ...s, courses: cMap[s.course_id] || null })
      const tMap = {}; (tRes.data || []).forEach(t => tMap[t.id] = t)
      enrichedAlerts = alerts.map(a => ({ ...a, sessions: sMap[a.session_id] || null, trainees: tMap[a.trainee_id] || null }))
    }
    
    // Enrich reclamations
    let enrichedRecl = []
    const recl = reclR.data || []
    if (recl.length > 0) {
      const sIds = [...new Set(recl.map(r => r.session_id).filter(Boolean))]
      const sRes = sIds.length > 0 ? await supabase.from('sessions').select('id, reference, course_id').in('id', sIds) : { data: [] }
      const cIds = [...new Set((sRes.data || []).map(s => s.course_id).filter(Boolean))]
      const cRes = cIds.length > 0 ? await supabase.from('courses').select('id, title').in('id', cIds) : { data: [] }
      const cMap = {}; (cRes.data || []).forEach(c => cMap[c.id] = c)
      const sMap = {}; (sRes.data || []).forEach(s => sMap[s.id] = { ...s, courses: cMap[s.course_id] || null })
      enrichedRecl = recl.map(r => ({ ...r, sessions: sMap[r.session_id] || null }))
    }
    
    let purgeStats = null
    try { const { data: ps } = await getPurgeStats(); if (ps && ps.length > 0) purgeStats = ps[0] } catch {}
    
    setDashData({
      nonConformites: ncR.data || [], qualityAlerts: enrichedAlerts, reclamations: enrichedRecl,
      purgeStats, rdvsAPrendre: rdvR.data || [],
      callbacksToday: cbR.data || [], quotes: quotesR.data || [], notifications: notifR.data || [],
      //  La bonne table
      traineeEvaluations: traineeEvalsR.data || [],
      sstCertifications: sstR.data || [],
      trainingThemes: themesR.data || [],
      invoices: invoicesR.data || [],
    })
    setLoading(false)
  }

  // ─── Computed data ─────────────────────────────────────
  const today = startOfToday()
  useEffect(() => { if (!organization) fetchOrganization() }, [])
  const next7Days = addDays(today, 7)
  const next30Days = addDays(today, 30)
  const thisMonth = startOfMonth(today)
  const lastMonth = startOfMonth(subMonths(today, 1))
  
  const sessionsToday = useMemo(() => sessions.filter(s => {
    if (!s.start_date || !s.end_date) return false
    const st = new Date(s.start_date); st.setHours(0,0,0,0)
    const en = new Date(s.end_date); en.setHours(23,59,59,999)
    return today >= st && today <= en && s.status !== 'cancelled'
  }), [sessions])
  
  const sessionsUpcoming = useMemo(() => sessions.filter(s => {
    const d = new Date(s.start_date)
    return s.status === 'planned' && isAfter(d, today) && isBefore(d, next7Days)
  }).sort((a, b) => new Date(a.start_date) - new Date(b.start_date)), [sessions])
  
  const sessionsUpcoming30 = useMemo(() => sessions.filter(s => {
    const d = new Date(s.start_date)
    return s.status === 'planned' && isAfter(d, today) && isBefore(d, next30Days)
  }).sort((a, b) => new Date(a.start_date) - new Date(b.start_date)), [sessions])
  
  const sessionsWithoutTrainer = useMemo(() => sessions.filter(s => (s.status === 'planned' || s.status === 'draft') && !s.trainer_id), [sessions])
  const sessionsInProgress = useMemo(() => sessions.filter(s => s.status === 'in_progress'), [sessions])
  const completedSessions = useMemo(() => sessions.filter(s => s.status === 'completed'), [sessions])
  
  //  Personnes formées = presence_complete || early_departure || result renseigné
  const personnesFormees = useMemo(() => completedSessions.reduce((t, s) => {
    return t + (s.session_trainees || []).filter(st => 
      st.presence_complete === true || st.early_departure === true || st.result
    ).length
  }, 0), [completedSessions])
  
  // J+90 évaluations à froid
  const sessionsJ90 = useMemo(() => sessions.filter(s => {
    if (s.status !== 'completed' || !s.end_date) return false
    const days = differenceInDays(today, new Date(s.end_date))
    if (days < 85 || days > 95) return false
    const formed = (s.session_trainees || []).filter(st => st.presence_complete || st.early_departure || st.result)
    return formed.length > 0
  }), [sessions])
  
  //  Émargements incomplets - sessions en cours avec stagiaires sans presence_complete
  const incompleteAttendance = useMemo(() => {
    return sessions.filter(s => {
      if (s.status !== 'in_progress') return false
      const sts = s.session_trainees || []
      if (sts.length === 0) return false
      return sts.some(st => st.presence_complete !== true && st.early_departure !== true)
    })
  }, [sessions])
  
  //  Évaluations en attente - cross-ref avec trainee_evaluations (la VRAIE table)
  // Un stagiaire a fait son éval si il existe une ligne dans trainee_evaluations avec questionnaire_submitted=true
  const traineeEvalSet = useMemo(() => {
    const s = new Set()
    dashData.traineeEvaluations.forEach(ev => {
      if (ev.questionnaire_submitted || ev.submitted_at) {
        s.add(`${ev.session_id}_${ev.trainee_id}`)
      }
    })
    return s
  }, [dashData.traineeEvaluations])
  
  const evaluationsPending = useMemo(() => {
    return completedSessions.filter(s => {
      const formed = (s.session_trainees || []).filter(st => 
        st.presence_complete === true || st.early_departure === true || st.result
      )
      if (formed.length === 0) return false
      const withEval = formed.filter(st => traineeEvalSet.has(`${s.id}_${st.trainee_id}`))
      return withEval.length < formed.length
    })
  }, [completedSessions, traineeEvalSet])
  
  const getEvalCount = (session) => {
    const formed = (session.session_trainees || []).filter(st => 
      st.presence_complete === true || st.early_departure === true || st.result
    )
    const withEval = formed.filter(st => traineeEvalSet.has(`${session.id}_${st.trainee_id}`))
    return { done: withEval.length, total: formed.length }
  }
  
  // Certifications SST expirantes (24 mois)
  const certifExpiring = useMemo(() => {
    const in3m = addDays(today, 90)
    return dashData.sstCertifications
      .filter(cert => {
        if (!cert.candidat_certifie || !cert.date_certification) return false
        const expiry = new Date(cert.date_certification)
        expiry.setMonth(expiry.getMonth() + 24)
        return isAfter(expiry, today) && isBefore(expiry, in3m)
      })
      .map(cert => {
        const expiry = new Date(cert.date_certification)
        expiry.setMonth(expiry.getMonth() + 24)
        const trainee = trainees.find(t => t.id === cert.trainee_id)
        return { ...cert, expiry, trainee }
      })
      .sort((a, b) => a.expiry - b.expiry)
  }, [dashData.sstCertifications, trainees])
  
  // Documents manquants
  const documentsMissing = useMemo(() => {
    const issues = []
    sessionsUpcoming30.forEach(s => {
      if (!s.convention_sent) issues.push({ session: s, type: 'Convention' })
    })
    sessionsUpcoming30.forEach(s => {
      const sts = s.session_trainees || []
      const withoutConvocation = sts.filter(st => !st.convocation_sent_at)
      if (sts.length > 0 && withoutConvocation.length > 0) {
        issues.push({ session: s, type: `Convocation (${withoutConvocation.length})` })
      }
    })
    return issues
  }, [sessionsUpcoming30])
  
  // Positionnements via positioning_test_completed
  const positioningPending = useMemo(() => {
    let count = 0
    sessions.filter(s => s.status === 'planned' || s.status === 'in_progress').forEach(s => {
      const sts = s.session_trainees || []
      const hasPositioning = s.courses?.positioning_questions && (
        Array.isArray(s.courses.positioning_questions) ? s.courses.positioning_questions.length > 0 : true
      )
      if (!hasPositioning) return
      sts.forEach(st => {
        if (st.positioning_test_completed !== true) count++
      })
    })
    return count
  }, [sessions])
  
  // Pipeline devis
  const quotesPipeline = useMemo(() => {
    const q = dashData.quotes
    return {
      draft: q.filter(x => x.status === 'draft'),
      sent: q.filter(x => x.status === 'sent' || x.status === 'pending'),
      signed: q.filter(x => x.status === 'signed' || x.status === 'accepted'),
      refused: q.filter(x => x.status === 'refused' || x.status === 'rejected'),
      totalDraft: q.filter(x => x.status === 'draft').reduce((s, x) => s + (parseFloat(x.total_ht) || 0), 0),
      totalSent: q.filter(x => x.status === 'sent' || x.status === 'pending').reduce((s, x) => s + (parseFloat(x.total_ht) || 0), 0),
      totalSigned: q.filter(x => x.status === 'signed' || x.status === 'accepted').reduce((s, x) => s + (parseFloat(x.total_ht) || 0), 0),
    }
  }, [dashData.quotes])

  // Devis envoyés sans réponse > 7j
  const quotesRelance = useMemo(() => {
    const now = Date.now()
    return (dashData.quotes || [])
      .filter(q => q.status === 'sent' || q.status === 'pending')
      .map(q => {
        const sentDate = q.updated_at || q.quote_date || q.created_at
        const days = sentDate ? Math.floor((now - new Date(sentDate).getTime()) / 86400000) : 0
        return { ...q, daysSinceSent: days }
      })
      .filter(q => q.daysSinceSent >= 7)
      .sort((a, b) => b.daysSinceSent - a.daysSinceSent)
  }, [dashData.quotes])

  const monthlyCA = useMemo(() => {
    const inv = dashData.invoices.filter(i => i.status !== 'cancelled')
    const signedHt = (i) => (i.type === 'credit_note' ? -1 : 1) * (parseFloat(i.total_net_ht) || 0)
    const current = inv.filter(i => i.invoice_date && new Date(i.invoice_date) >= thisMonth)
      .reduce((sum, i) => sum + signedHt(i), 0)
    const previous = inv.filter(i => i.invoice_date && new Date(i.invoice_date) >= lastMonth && new Date(i.invoice_date) < thisMonth)
      .reduce((sum, i) => sum + signedHt(i), 0)
    return { current, previous }
  }, [dashData.invoices])
  
  const newClientsThisMonth = useMemo(() => clients.filter(c => c.created_at && new Date(c.created_at) >= thisMonth), [clients])
  
  const conversionRate = useMemo(() => {
    const t = dashData.quotes.length
    const s = dashData.quotes.filter(d => d.status === 'signed' || d.status === 'accepted').length
    return t > 0 ? Math.round((s / t) * 100) : 0
  }, [dashData.quotes])
  
  const topCourses = useMemo(() => {
    const m = {}
    sessions.forEach(s => {
      if (s.course_id && s.status !== 'cancelled') {
        if (!m[s.course_id]) m[s.course_id] = { id: s.course_id, title: s.courses?.title || 'Formation', count: 0, trainees: 0 }
        m[s.course_id].count++
        m[s.course_id].trainees += (s.session_trainees?.length || 0)
      }
    })
    return Object.values(m).sort((a, b) => b.count - a.count).slice(0, 5)
  }, [sessions])
  
  const revenue12m = useMemo(() => {
    const inv = dashData.invoices.filter(i => i.status !== 'cancelled')
    const months = []
    for (let i = 11; i >= 0; i--) {
      const m = subMonths(today, i)
      const s = startOfMonth(m), e = endOfMonth(m)
      const rev = inv.filter(f => f.invoice_date && new Date(f.invoice_date) >= s && new Date(f.invoice_date) <= e)
        .reduce((sum, f) => sum + (f.type === 'credit_note' ? -1 : 1) * (parseFloat(f.total_net_ht) || 0), 0)
      months.push({ label: format(m, 'MMM', { locale: fr }), value: rev, highlight: i === 0 })
    }
    return months
  }, [dashData.invoices])
  
  // Répartition par thème
  const themeDistribution = useMemo(() => {
    const themeMap = {}
    dashData.trainingThemes.forEach(t => { themeMap[t.id] = t.name })
    const th = {}
    sessions.forEach(s => {
      if (s.status === 'cancelled') return
      const themeId = s.courses?.theme_id
      const themeName = themeId ? (themeMap[themeId] || 'Autre') : 'Non classé'
      if (!th[themeName]) th[themeName] = { name: themeName, count: 0, trainees: 0 }
      th[themeName].count++
      th[themeName].trainees += (s.session_trainees?.length || 0)
    })
    return Object.values(th).sort((a, b) => b.count - a.count)
  }, [sessions, dashData.trainingThemes])
  
  const hoursRealized = useMemo(() => completedSessions.reduce((s, se) => s + (parseFloat(se.courses?.duration_hours) || 0), 0), [completedSessions])
  
  //  Indicateurs qualité - utilise trainee_evaluations (14 critères q_org/q_contenu/q_formateur/q_global)
  const qualityStats = useMemo(() => {
    const evals = dashData.traineeEvaluations
    const hasEvalData = evals.length > 0
    
    // Satisfaction = moyenne des 14 critères sur tous les questionnaires soumis
    const scoringKeys = [
      'q_org_documents', 'q_org_accueil', 'q_org_locaux', 'q_org_materiel',
      'q_contenu_organisation', 'q_contenu_supports', 'q_contenu_duree', 'q_contenu_programme',
      'q_formateur_pedagogie', 'q_formateur_expertise', 'q_formateur_progression', 'q_formateur_moyens',
      'q_global_adequation', 'q_global_competences'
    ]
    
    let totalScore = 0, countScore = 0
    evals.forEach(ev => {
      const scores = scoringKeys.map(k => ev[k]).filter(v => v != null && !isNaN(v) && Number(v) > 0)
      if (scores.length > 0) {
        totalScore += scores.reduce((s, v) => s + Number(v), 0) / scores.length
        countScore++
      }
    })
    
    // Recommandation
    let recYes = 0, recTotal = 0
    evals.forEach(ev => {
      if (ev.would_recommend !== null && ev.would_recommend !== undefined) {
        recTotal++
        if (ev.would_recommend) recYes++
      }
    })
    
    // Présence via presence_complete + early_departure
    let presTotal = 0, presOk = 0
    completedSessions.forEach(s => {
      (s.session_trainees || []).forEach(st => {
        presTotal++
        if (st.presence_complete === true || st.early_departure === true) presOk++
      })
    })
    
    //  Réussite via result === 'acquired'
    let successTotal = 0, successOk = 0
    completedSessions.forEach(s => {
      (s.session_trainees || []).forEach(st => {
        if (st.presence_complete || st.early_departure || st.result) {
          successTotal++
          if (st.result === 'acquired') successOk++
        }
      })
    })
    
    return {
      satisfaction: countScore > 0 ? (totalScore / countScore).toFixed(2) : null,
      presence: presTotal > 0 ? Math.round((presOk / presTotal) * 100) : null,
      success: successTotal > 0 ? Math.round((successOk / successTotal) * 100) : null,
      recommendation: recTotal > 0 ? Math.round((recYes / recTotal) * 100) : null,
      nbEvals: evals.filter(e => e.questionnaire_submitted || e.submitted_at).length,
      hasEvalData,
      hasPresenceData: presTotal > 0,
    }
  }, [dashData.traineeEvaluations, completedSessions])
  
  // Rappels automatiques
  const autoReminders = useMemo(() => {
    const r = []
    sessionsWithoutTrainer.forEach(s => r.push({ type: 'error', icon: XCircle, text: `Sans formateur: ${s.courses?.title || 'Session'} - ${s.start_date ? format(new Date(s.start_date), 'd MMM', { locale: fr }) : '?'}`, link: `/sessions/${s.id}` }))
    sessionsJ90.forEach(s => r.push({ type: 'warning', icon: Clock, text: `Éval. à froid J+90: ${s.courses?.title}`, link: `/sessions/${s.id}` }))
    if (dashData.purgeStats?.trainees_to_purge > 0) r.push({ type: 'info', icon: Shield, text: `RGPD: ${dashData.purgeStats.trainees_to_purge} stagiaire(s) à purger`, link: '/stagiaires' })
    documentsMissing.slice(0, 5).forEach(d => r.push({ type: 'warning', icon: FileWarning, text: `${d.type} manquante: ${d.session.courses?.title}`, link: `/sessions/${d.session.id}` }))
    return r
  }, [sessionsWithoutTrainer, sessionsJ90, dashData.purgeStats, documentsMissing])
  
  // Audit Qualiopi : mêmes règles que le module Certification (qualiopiCycle) : surveillance entre le 14e
  // et le 22e mois après l'obtention, renouvellement avant la fin de validité. Module actif : échéances
  // calculées par la base (cert_deadlines, tiennent compte d'une surveillance déjà passée).
  const certOn = (modules || []).includes('certification')
  const [certSteps, setCertSteps] = useState(null)
  useEffect(() => {
    if (!certOn) { setCertSteps(null); return }
    supabase.rpc('cert_deadlines').then(({ data }) => setCertSteps(data || []), () => setCertSteps(null))
  }, [certOn, organization?.qualiopi_since])
  const qualiopiAudit = useMemo(() => {
    if (!organization?.qualiopi_certified || !organization?.qualiopi_since) return null
    const initialDate = new Date(organization.qualiopi_since)
    if (Number.isNaN(initialDate.getTime())) return null
    let target = null
    let label = ''
    const step = (certSteps || []).filter((d) => ['surveillance_ouverture', 'surveillance_limite', 'renouvellement'].includes(d.key) && d.due_date)
      .sort((x, y) => x.due_date.localeCompare(y.due_date))[0]
    if (step) {
      target = new Date(`${step.due_date}T12:00:00`)
      label = step.label
    } else {
      const c = qualiopiCycle({ certified_at: String(organization.qualiopi_since).slice(0, 10) })
      const todayIso = format(today, 'yyyy-MM-dd')
      if (todayIso < c.surveillanceFrom) { target = new Date(`${c.surveillanceFrom}T12:00:00`); label = 'Ouverture de la fenêtre de surveillance' }
      else if (todayIso <= c.surveillanceTo) { target = new Date(`${c.surveillanceTo}T12:00:00`); label = 'Audit de surveillance, date limite' }
      else { target = new Date(`${c.renewalAlert}T12:00:00`); label = 'Audit de renouvellement' }
    }
    return {
      daysLeft: differenceInDays(target, today),
      date: target,
      initialDate,
      label,
      certifier: organization.qualiopi_organisme || '',
    }
  }, [organization, today, certSteps])

  // ─── Config management ─────────────────────────────────
  const configsRef = useRef(widgetConfigs)
  useEffect(() => { configsRef.current = widgetConfigs }, [widgetConfigs])
  
  const saveConfigs = async (nc) => {
    setWidgetConfigs(nc)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    try {
      const payload = nc.map(c => ({ widget_id: c.widget_id, position: c.position, size: c.size, visible: c.visible }))
      await supabase.rpc('save_widget_configs', { p_user_id: user.id, p_configs: payload })
    } catch {
      for (const c of nc) {
        await supabase.from('dashboard_widget_configs').upsert({
          user_id: user.id, widget_id: c.widget_id, position: c.position, size: c.size, visible: c.visible
        }, { onConflict: 'user_id,widget_id' })
      }
    }
  }
  
  const toggleWidget = (wid) => { const nc = widgetConfigs.map(c => c.widget_id === wid ? { ...c, visible: !c.visible } : c); saveConfigs(nc) }
  const cycleSize = (wid) => { const sizes = ['sm', 'md', 'lg', 'xl']; const nc = widgetConfigs.map(c => { if (c.widget_id !== wid) return c; return { ...c, size: sizes[(sizes.indexOf(c.size) + 1) % sizes.length] } }); saveConfigs(nc) }
  const moveWidget = (wid, dir) => {
    const idx = widgetConfigs.findIndex(c => c.widget_id === wid)
    const ni = idx + dir
    if (ni < 0 || ni >= widgetConfigs.length) return
    const nc = [...widgetConfigs]; [nc[idx], nc[ni]] = [nc[ni], nc[idx]]
    nc.forEach((c, i) => c.position = i); saveConfigs(nc)
  }
  
  const handleDragStart = (i) => setDragIdx(i)
  const handleDragOver = (e, i) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === i) return
    const nc = [...widgetConfigs]; const [d] = nc.splice(dragIdx, 1); nc.splice(i, 0, d)
    nc.forEach((c, j) => c.position = j); setWidgetConfigs(nc); setDragIdx(i)
  }
  const handleDragEnd = () => { setDragIdx(null); saveConfigs(configsRef.current) }

  // ═══════════════════════════════════════════════════════════
  // WIDGET RENDERER
  // ═══════════════════════════════════════════════════════════
  const renderWidget = (wid) => {
    switch (wid) {
      case 'sessions_today':
        return sessionsToday.length === 0 ? <p className="text-gray-400 text-ui py-4 text-center">Aucune session aujourd'hui</p> : (
          <div className="space-y-2">{sessionsToday.map(s => (
            <Link key={s.id} to={`/sessions/${s.id}`} className="block p-3 rounded-ui-sm bg-gray-50 hover:bg-gray-100 border border-gray-200 transition-colors">
              <p className="font-medium text-gray-900 truncate text-ui">{s.courses?.title || 'Formation'}</p>
              <div className="flex items-center gap-3 mt-1 text-ui-sm text-gray-500">
                <span>{s.clients?.name}</span>
                <span className="flex items-center gap-1"><Users className="w-3 h-3" />{s.session_trainees?.length || 0}</span>
                {(s.location_name || s.location_city) && <span className="truncate">{s.location_name || s.location_city}</span>}
              </div>
            </Link>
          ))}</div>
        )
      
      case 'sessions_upcoming':
        return sessionsUpcoming.length === 0 ? <p className="text-gray-400 text-ui py-4 text-center">Aucune session dans les 7 prochains jours</p> : (
          <div className="space-y-2 max-h-64 overflow-y-auto">{sessionsUpcoming.map(s => {
            const d = differenceInDays(new Date(s.start_date), today)
            return (
              <Link key={s.id} to={`/sessions/${s.id}`} className="flex items-center justify-between p-2.5 rounded-ui-sm hover:bg-gray-50 border border-gray-100 transition-colors">
                <div className="flex-1 min-w-0"><p className="text-ui font-medium text-gray-900 truncate">{s.courses?.title}</p><p className="text-ui-sm text-gray-500 truncate">{s.clients?.name}</p></div>
                <div className="text-right ml-2 flex-shrink-0">
                  <span className={`badge text-ui-sm ${d <= 2 ? 'badge-red' : d <= 5 ? 'badge-yellow' : 'badge-blue'}`}>J-{d}</span>
                  <p className="text-ui-sm text-gray-400 mt-0.5">{format(new Date(s.start_date), 'd MMM', { locale: fr })}</p>
                </div>
              </Link>
            )
          })}</div>
        )

      case 'quality_indicators':
        return (
          <div className="grid grid-cols-2 gap-3">
            <ProgressBar 
              value={qualityStats.satisfaction ? parseFloat(qualityStats.satisfaction) / 5 * 100 : 0} 
              color="bg-[rgb(var(--c-success))]" 
              label={`Satisfaction: ${qualityStats.satisfaction || '-'}/5`} 
              showValue={false} 
            />
            <ProgressBar 
              value={qualityStats.presence ?? 0} 
              color="bg-gray-800" 
              label={`Présence: ${qualityStats.presence != null ? qualityStats.presence + '%' : '-'}`} 
              showValue={false} 
            />
            <ProgressBar 
              value={qualityStats.success ?? 0} 
              color="bg-[rgb(var(--c-success))]" 
              label={`Réussite: ${qualityStats.success != null ? qualityStats.success + '%' : '-'}`} 
              showValue={false} 
            />
            <ProgressBar 
              value={qualityStats.recommendation ?? 0} 
              color="bg-[rgb(var(--c-warning))]" 
              label={`Recommandation: ${qualityStats.recommendation != null ? qualityStats.recommendation + '%' : '-'}`} 
              showValue={false} 
            />
            <div className="col-span-2 pt-2 border-t flex items-center justify-between">
              <span className="text-ui-sm text-gray-500">
                Sessions: <b>{completedSessions.length}</b> • Formés: <b>{personnesFormees}</b> • Évals: <b>{qualityStats.nbEvals}</b>
              </span>
              <div className="flex items-center gap-2">
                {!qualityStats.hasEvalData && <span className="text-ui-sm text-[rgb(var(--c-warning))] italic">En attente d'évals</span>}
                <Link to="/indicateurs" className="text-ui-sm text-accent-700 hover:underline flex items-center gap-1">Détails <ArrowRight className="w-3 h-3" /></Link>
              </div>
            </div>
          </div>
        )

      case 'attendance_incomplete':
        return incompleteAttendance.length === 0 ? <div className="text-center py-3"><CheckCircle className="w-6 h-6 text-[rgb(var(--c-success))] mx-auto mb-1" /><p className="text-ui text-gray-500">Tout est à jour</p></div> : (
          <div className="space-y-2 max-h-48 overflow-y-auto">{incompleteAttendance.slice(0, 8).map(s => {
            const total = (s.session_trainees || []).length
            const missing = (s.session_trainees || []).filter(st => st.presence_complete !== true && st.early_departure !== true).length
            return (
              <Link key={s.id} to={`/sessions/${s.id}`} className="flex items-center justify-between p-2 rounded-ui-sm bg-[rgb(var(--c-danger-bg))] hover:bg-[rgb(var(--c-danger-bg))] border border-[rgb(var(--c-danger)/0.25)] text-ui transition-colors">
                <span className="truncate font-medium text-gray-800">{s.courses?.title}</span>
                <span className="badge badge-red text-ui-sm flex-shrink-0 ml-2">{missing}/{total}</span>
              </Link>
            )
          })}</div>
        )

      case 'evaluations_pending':
        return evaluationsPending.length === 0 ? <div className="text-center py-3"><CheckCircle className="w-6 h-6 text-[rgb(var(--c-success))] mx-auto mb-1" /><p className="text-ui text-gray-500">Toutes complètes</p></div> : (
          <div className="space-y-2 max-h-48 overflow-y-auto">{evaluationsPending.slice(0, 8).map(s => {
            const { done, total } = getEvalCount(s)
            return (
              <Link key={s.id} to={`/sessions/${s.id}`} className="flex items-center justify-between p-2 rounded-ui-sm bg-[rgb(var(--c-warning-bg))] hover:bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.25)] text-ui transition-colors">
                <span className="truncate font-medium text-gray-800">{s.courses?.title}</span>
                <span className="badge badge-yellow text-ui-sm flex-shrink-0 ml-2">{done}/{total}</span>
              </Link>
            )
          })}</div>
        )

      case 'certif_expiring':
        return certifExpiring.length === 0 ? <div className="text-center py-3"><CheckCircle className="w-6 h-6 text-[rgb(var(--c-success))] mx-auto mb-1" /><p className="text-ui text-gray-500">Aucun recyclage à prévoir</p></div> : (
          <div className="space-y-2 max-h-48 overflow-y-auto">{certifExpiring.slice(0, 8).map(cert => {
            const d = differenceInDays(cert.expiry, today)
            return (
              <div key={cert.id} className="flex items-center justify-between p-2 rounded-ui-sm bg-gray-50 border border-gray-200 text-ui">
                <div className="flex-1 min-w-0">
                  <span className="truncate font-medium text-gray-800 block">{cert.trainee ? `${cert.trainee.first_name} ${cert.trainee.last_name}` : 'Stagiaire'}</span>
                  <span className="text-ui-sm text-gray-400">{cert.formation_type === 'mac' ? 'MAC SST' : 'SST Initial'}</span>
                </div>
                <span className={`badge text-ui-sm flex-shrink-0 ml-2 ${d <= 30 ? 'badge-red' : 'badge-yellow'}`}>J-{d}</span>
              </div>
            )
          })}</div>
        )

      case 'positioning_pending':
        return (
          <div className="text-center py-2">
            <p className="text-3xl font-bold text-gray-900">{positioningPending}</p>
            <p className="text-ui text-gray-500 mt-1">tests en attente</p>
            {positioningPending > 0 && <Link to="/tests-positionnement" className="text-ui-sm text-accent-700 hover:underline mt-2 inline-block">Voir →</Link>}
          </div>
        )

      case 'documents_missing':
        return documentsMissing.length === 0 ? <div className="text-center py-3"><CheckCircle className="w-6 h-6 text-[rgb(var(--c-success))] mx-auto mb-1" /><p className="text-ui text-gray-500">Tous générés</p></div> : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {documentsMissing.slice(0, 8).map((d, i) => (
              <Link key={i} to={`/sessions/${d.session.id}`} className="flex items-center justify-between p-2 rounded-ui-sm bg-[rgb(var(--c-danger-bg))] hover:bg-[rgb(var(--c-danger-bg))] border border-[rgb(var(--c-danger)/0.25)] text-ui transition-colors">
                <span className="truncate text-gray-800">{d.session.courses?.title}</span>
                <span className="badge badge-red text-ui-sm flex-shrink-0 ml-2">{d.type}</span>
              </Link>
            ))}
            {documentsMissing.length > 8 && <p className="text-ui-sm text-gray-400 text-center">+ {documentsMissing.length - 8} autres</p>}
          </div>
        )

      case 'quotes_pipeline':
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2">
              {[
                { l: 'Brouillon', c: quotesPipeline.draft.length, a: quotesPipeline.totalDraft, cl: 'gray' },
                { l: 'Envoyé', c: quotesPipeline.sent.length, a: quotesPipeline.totalSent, cl: 'blue' },
                { l: 'Signé', c: quotesPipeline.signed.length, a: quotesPipeline.totalSigned, cl: 'green' },
                { l: 'Refusé', c: quotesPipeline.refused.length, a: 0, cl: 'red' },
              ].map(s => (
                <div key={s.l} className="text-center p-2 rounded-ui-sm bg-gray-50 border border-gray-200">
                  <p className="text-lg font-bold text-gray-900">{s.c}</p>
                  <p className="text-ui-sm text-gray-500">{s.l}</p>
                  {s.a > 0 && <p className="text-ui-sm font-medium text-gray-700 mt-0.5">{s.a.toLocaleString('fr-FR')}€</p>}
                </div>
              ))}
            </div>
            {/* Alerte relance devis > 7j */}
            {quotesRelance.length > 0 && (
              <div className="bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.25)] rounded-ui-sm px-3 py-2">
                <p className="text-ui-sm font-bold text-[rgb(var(--c-warning))] mb-1"> {quotesRelance.length} devis en attente de réponse (&gt;7j)</p>
                {quotesRelance.slice(0, 3).map(q => (
                  <div key={q.id} className="flex items-center justify-between text-ui-sm py-0.5">
                    <span className="text-[rgb(var(--c-warning))] truncate">
                      <span className="font-medium">{q.clients?.name || '?'}</span>
                      <span className="text-[rgb(var(--c-warning))] ml-1">- {q.daysSinceSent}j</span>
                      {q.total_ht > 0 && <span className="text-[rgb(var(--c-warning))] ml-1">({q.total_ht.toLocaleString('fr-FR')}€)</span>}
                    </span>
                    <Link to="/devis" className="text-[rgb(var(--c-warning))] hover:text-[rgb(var(--c-warning))] font-medium underline ml-2 whitespace-nowrap">Relancer</Link>
                  </div>
                ))}
                {quotesRelance.length > 3 && <p className="text-ui-sm text-[rgb(var(--c-warning))] mt-1">+{quotesRelance.length - 3} autre(s)</p>}
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-ui-sm text-gray-500">Pipeline: <b>{(quotesPipeline.totalDraft + quotesPipeline.totalSent).toLocaleString('fr-FR')}€</b></span>
              <Link to="/devis" className="text-ui-sm text-accent-700 hover:underline flex items-center gap-1">Gérer <ArrowRight className="w-3 h-3" /></Link>
            </div>
          </div>
        )

      case 'monthly_revenue':
        const evo = monthlyCA.previous > 0 ? Math.round(((monthlyCA.current - monthlyCA.previous) / monthlyCA.previous) * 100) : 0
        return (
          <div className="space-y-3">
            <div className="flex items-end justify-between">
              <div><p className="text-3xl font-bold text-gray-900">{monthlyCA.current.toLocaleString('fr-FR')}€</p><p className="text-ui-sm text-gray-500">HT ce mois</p></div>
              {evo !== 0 && <span className={`text-ui font-medium ${evo > 0 ? 'text-[rgb(var(--c-success))]' : 'text-[rgb(var(--c-danger))]'}`}>{evo > 0 ? '+' : ''}{evo}%</span>}
            </div>
            <div className="pt-2 border-t"><p className="text-ui-sm text-gray-500">Mois précédent: <b>{monthlyCA.previous.toLocaleString('fr-FR')}€</b></p></div>
          </div>
        )

      case 'rdv_week':
        return dashData.rdvsAPrendre.length === 0 ? <div className="text-center py-3"><CheckCircle className="w-6 h-6 text-[rgb(var(--c-success))] mx-auto mb-1" /><p className="text-ui text-gray-500">Pas de RDV en attente</p></div> : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {dashData.rdvsAPrendre.slice(0, 8).map(r => (
              <div key={r.id} className="p-2 rounded-ui-sm bg-gray-50 border border-gray-200 text-ui">
                <p className="font-medium text-gray-900 truncate">{r.clients?.name || 'Client'}</p>
                {r.next_action && <p className="text-ui-sm text-gray-500 truncate">{r.next_action}</p>}
              </div>
            ))}
            <Link to="/prospection" className="text-ui-sm text-accent-700 hover:underline inline-flex items-center gap-1">Voir tous <ArrowRight className="w-3 h-3" /></Link>
          </div>
        )

      case 'hot_prospects':
        return dashData.callbacksToday.length === 0 ? <div className="text-center py-3"><CheckCircle className="w-6 h-6 text-[rgb(var(--c-success))] mx-auto mb-1" /><p className="text-ui text-gray-500">Aucun rappel</p></div> : (
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {dashData.callbacksToday.slice(0, 8).map(cb => {
              const isT = cb.callback_date === format(today, 'yyyy-MM-dd')
              return (
                <div key={cb.id} className={`p-2 rounded-ui-sm border text-ui ${isT ? 'bg-[rgb(var(--c-warning-bg))] border-[rgb(var(--c-warning)/0.25)]' : 'bg-white border-gray-100'}`}>
                  <div className="flex items-center gap-2"><span className={`text-ui-sm font-medium ${isT ? 'text-[rgb(var(--c-warning))]' : 'text-gray-500'}`}>{isT ? "Aujourd'hui" : format(new Date(cb.callback_date), 'EEE d', { locale: fr })} {cb.callback_time}</span></div>
                  <p className="font-medium text-gray-900 truncate">{cb.clients?.name || 'Prospect'}</p>
                  {cb.contact_name && <p className="text-ui-sm text-gray-500">{cb.contact_name}</p>}
                </div>
              )
            })}
            <Link to="/prospection-massive" className="text-ui-sm text-accent-700 hover:underline inline-flex items-center gap-1">Phoning <ArrowRight className="w-3 h-3" /></Link>
          </div>
        )

      case 'new_clients':
        return <div className="text-center py-2"><p className="text-3xl font-bold text-[rgb(var(--c-success))]">{newClientsThisMonth.length}</p><p className="text-ui text-gray-500 mt-1">ce mois</p><p className="text-ui-sm text-gray-400 mt-1">Total: {clients.length}</p></div>

      case 'conversion_rate':
        return <div className="text-center py-2"><p className="text-3xl font-bold text-gray-900">{conversionRate}%</p><p className="text-ui text-gray-500 mt-1">devis → signé</p><p className="text-ui-sm text-gray-400 mt-1">{dashData.quotes.filter(d => d.status === 'signed' || d.status === 'accepted').length}/{dashData.quotes.length}</p></div>

      case 'top_courses':
        return topCourses.length === 0 ? <p className="text-gray-400 text-ui py-4 text-center">Pas de données</p> : (
          <div className="space-y-2">{topCourses.map((c, i) => (
            <div key={c.id} className="flex items-center gap-3 text-ui">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-ui-sm font-bold ${i === 0 ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'bg-gray-100 text-gray-500'}`}>{i + 1}</span>
              <div className="flex-1 min-w-0"><p className="truncate font-medium text-gray-800">{c.title}</p><p className="text-ui-sm text-gray-400">{c.count} sessions • {c.trainees} stagiaires</p></div>
            </div>
          ))}</div>
        )

      case 'reclamations_open':
        return dashData.reclamations.length === 0 ? <div className="text-center py-3"><CheckCircle className="w-6 h-6 text-[rgb(var(--c-success))] mx-auto mb-1" /><p className="text-ui text-gray-500">Aucune réclamation</p></div> : (
          <div className="space-y-2 max-h-48 overflow-y-auto">{dashData.reclamations.map(r => (
            <div key={r.id} onClick={() => navigate('/non-conformites')} className="p-2.5 rounded-ui-sm bg-[rgb(var(--c-danger-bg))] border border-[rgb(var(--c-danger)/0.25)] hover:bg-[rgb(var(--c-danger-bg))] cursor-pointer transition-colors">
              <div className="flex items-center gap-2 mb-0.5"><span className="px-1.5 py-0.5 rounded text-ui-sm font-bold bg-[rgb(var(--c-danger))] text-white">RÉCL.</span><span className="font-medium text-ui truncate text-gray-900">{r.subject}</span></div>
              <p className="text-ui-sm text-gray-500">{r.date_reception ? format(new Date(r.date_reception), 'dd/MM/yyyy', { locale: fr }) : format(new Date(r.created_at), 'dd/MM/yyyy', { locale: fr })}</p>
            </div>
          ))}</div>
        )

      case 'non_conformites':
        return dashData.nonConformites.length === 0 ? <div className="text-center py-3"><CheckCircle className="w-6 h-6 text-[rgb(var(--c-success))] mx-auto mb-1" /><p className="text-ui text-gray-500">Aucune NC</p></div> : (
          <div className="space-y-2 max-h-48 overflow-y-auto">{dashData.nonConformites.slice(0, 6).map(nc => (
            <Link key={nc.id} to="/non-conformites" className="block p-2 rounded-ui-sm bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.25)] hover:bg-[rgb(var(--c-warning-bg))] text-ui transition-colors">
              <p className="font-medium text-gray-800 truncate">{nc.title}</p>
              <span className={`badge text-ui-sm mt-1 ${nc.status === 'open' ? 'badge-red' : 'badge-yellow'}`}>{nc.status === 'open' ? 'Ouverte' : 'En cours'}</span>
            </Link>
          ))}</div>
        )

      case 'auto_reminders':
        return autoReminders.length === 0 ? <div className="text-center py-4"><CheckCircle className="w-8 h-8 text-[rgb(var(--c-success))] mx-auto mb-2" /><p className="text-ui text-gray-500">Tout est en ordre !</p></div> : (
          <div className="space-y-2 max-h-64 overflow-y-auto">{autoReminders.map((r, i) => {
            const I = r.icon
            const bg = { error: 'bg-[rgb(var(--c-danger-bg))] border-[rgb(var(--c-danger)/0.25)]', warning: 'bg-[rgb(var(--c-warning-bg))] border-[rgb(var(--c-warning)/0.25)]', info: 'bg-gray-50 border-gray-200' }
            const ic = { error: 'text-[rgb(var(--c-danger))]', warning: 'text-[rgb(var(--c-warning))]', info: 'text-gray-500' }
            return (
              <Link key={i} to={r.link} className={`flex items-start gap-2.5 p-2.5 rounded-ui-sm border text-ui hover:opacity-80 transition-opacity ${bg[r.type]}`}>
                <I className={`w-4 h-4 mt-0.5 flex-shrink-0 ${ic[r.type]}`} /><span className="text-gray-800">{r.text}</span>
              </Link>
            )
          })}</div>
        )

      case 'recent_messages':
        return dashData.notifications.length === 0 ? <p className="text-gray-400 text-ui py-4 text-center">Aucun message</p> : (
          <div className="space-y-2 max-h-48 overflow-y-auto">{dashData.notifications.slice(0, 8).map(n => (
            <div key={n.id} className={`p-2 rounded-ui-sm border text-ui ${n.read_at ? 'bg-white border-gray-100' : 'bg-gray-50 border-gray-200'}`}>
              <p className={`truncate ${n.read_at ? 'text-gray-600' : 'font-medium text-gray-900'}`}>{n.title}</p>
              <p className="text-ui-sm text-gray-400 mt-0.5">{format(new Date(n.created_at), 'd MMM HH:mm', { locale: fr })}</p>
            </div>
          ))}</div>
        )

      case 'qualiopi_audit':
        return !qualiopiAudit ? (
          <div className="text-center py-3 space-y-2">
            <p className="text-ui font-medium text-gray-700">Certification Qualiopi non renseignée</p>
            <p className="text-ui-sm text-gray-400">Renseignez la date du certificat et l'organisme certificateur dans {(modules || []).includes('certification') ? 'Certification' : 'Paramètres'}.</p>
            <Link to="/qualiopi" className="inline-flex items-center gap-1 text-ui-sm text-accent-700 hover:underline">Checklist <ArrowRight className="w-3 h-3" /></Link>
          </div>
        ) : (
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))] text-ui-sm font-medium">
              <CheckCircle className="w-3.5 h-3.5" /> Certifié depuis le {format(qualiopiAudit.initialDate, 'd MMM yyyy', { locale: fr })}
            </div>
            <p className={`text-4xl font-bold ${qualiopiAudit.daysLeft <= 30 ? 'text-[rgb(var(--c-warning))]' : qualiopiAudit.daysLeft <= 90 ? 'text-[rgb(var(--c-warning))]' : 'text-[rgb(var(--c-success))]'}`}>
              J-{qualiopiAudit.daysLeft}
            </p>
            <p className="text-ui text-gray-500">
              {qualiopiAudit.label} : {format(qualiopiAudit.date, 'd MMMM yyyy', { locale: fr })}
            </p>
            {qualiopiAudit.certifier && <p className="text-ui-sm text-gray-400">{qualiopiAudit.certifier}</p>}
            <Link to="/qualiopi" className="inline-flex items-center gap-1 text-ui-sm text-accent-700 hover:underline">Checklist <ArrowRight className="w-3 h-3" /></Link>
          </div>
        )

      case 'bpf_status':
        return (
          <div className="text-center py-2 space-y-2">
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto"><FileText className="w-5 h-5 text-gray-900" /></div>
            <p className="text-ui font-medium text-gray-700">BPF à générer</p>
            <p className="text-ui-sm text-gray-400">NDA : {organization?.nda || "en cours d'attribution"}</p>
          </div>
        )

      case 'revenue_12m':
        return (
          <div>
            <MiniBarChart data={revenue12m} height={80} color="#10B981" />
            <div className="flex justify-between items-center mt-2 pt-2 border-t">
              <span className="text-ui-sm text-gray-500">Total: <b>{revenue12m.reduce((s, d) => s + d.value, 0).toLocaleString('fr-FR')}€</b></span>
              <span className="text-ui-sm text-gray-400">Moy: {Math.round(revenue12m.reduce((s, d) => s + d.value, 0) / 12).toLocaleString('fr-FR')}€/mois</span>
            </div>
          </div>
        )

      case 'theme_distribution':
        const thColors = ['bg-blue-500', 'bg-amber-500', 'bg-emerald-500', 'bg-purple-500', 'bg-red-500', 'bg-teal-500']
        const totalTh = themeDistribution.reduce((s, t) => s + t.count, 0) || 1
        return themeDistribution.length === 0 ? <p className="text-gray-400 text-ui py-4 text-center">Pas de données</p> : (
          <div className="space-y-2">{themeDistribution.slice(0, 6).map((t, i) => (
            <div key={t.name} className="space-y-1">
              <div className="flex justify-between text-ui-sm"><span className="text-gray-700 truncate">{t.name}</span><span className="text-gray-500 ml-2 flex-shrink-0">{t.count} ({Math.round(t.count / totalTh * 100)}%)</span></div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${thColors[i % thColors.length]}`} style={{ width: `${(t.count / totalTh) * 100}%` }} /></div>
            </div>
          ))}</div>
        )

      case 'hours_realized':
        return (
          <div className="text-center space-y-3">
            <div><p className="text-3xl font-bold text-gray-900">{hoursRealized}h</p><p className="text-ui text-gray-500">réalisées</p></div>
            <ProgressBar value={hoursRealized} max={500} color="bg-gray-800" label="Objectif: 500h" />
          </div>
        )

      case 'trainee_stats':
        return (
          <div className="grid grid-cols-2 gap-3">
            <div className="text-center p-2 bg-gray-50 rounded-ui-sm"><p className="text-2xl font-bold text-gray-900">{trainees.length}</p><p className="text-ui-sm text-gray-500">Inscrits</p></div>
            <div className="text-center p-2 bg-[rgb(var(--c-success-bg))] rounded-ui-sm"><p className="text-2xl font-bold text-[rgb(var(--c-success))]">{personnesFormees}</p><p className="text-ui-sm text-gray-500">Formés</p></div>
            <div className="text-center p-2 bg-gray-50 rounded-ui-sm"><p className="text-2xl font-bold text-gray-900">{sessionsInProgress.reduce((s, se) => s + (se.session_trainees?.length || 0), 0)}</p><p className="text-ui-sm text-gray-500">En formation</p></div>
            <div className="text-center p-2 bg-[rgb(var(--c-warning-bg))] rounded-ui-sm"><p className="text-2xl font-bold text-[rgb(var(--c-warning))]">{certifExpiring.length}</p><p className="text-ui-sm text-gray-500">SST à recycler</p></div>
          </div>
        )

      default: return <p className="text-gray-400 text-ui text-center py-4">Widget inconnu</p>
    }
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  if (loading || !configLoaded) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-500 mx-auto"></div><p className="text-ui text-gray-500 mt-3">Chargement...</p></div>
    </div>
  )
  
  // Chiffre d'affaires et devis : seulement pour les rôles qui lisent les factures et les devis
  // (formateur et lecture n'y ont pas accès dans la base)
  const canSeeBilling = ['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial', 'comptable'].includes(userRole)
  const visibleWidgets = widgetConfigs
    .filter(c => c.visible && (canSeeBilling || !BILLING_WIDGETS.has(c.widget_id)))
    .sort((a, b) => a.position - b.position)
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div className="grid gap-1 min-w-0">
          <span className="eyebrow first-letter:uppercase">{format(today, "EEEE d MMMM yyyy", { locale: fr })}</span>
          <h1 className="page-title leading-tight">Tableau de bord</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setLoading(true); loadData() }} className="btn btn-ghost btn-icon" title="Rafraîchir" aria-label="Rafraîchir"><RefreshCw className="w-5 h-5" /></button>
          {d.preferences && <button onClick={() => setShowSettings(true)} className="btn btn-secondary"><Settings className="w-4 h-4" />Personnaliser</button>}
        </div>
      </div>
      
      {/* ═══ Aujourd'hui : faire signer les stagiaires ═══ */}
      {sessionsToday.filter(s => s.session_type !== 'subcontract').length > 0 && (
        <div className="surface overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b hairline">
            <PenLine className="w-5 h-5 text-accent-600" />
            <h2 className="section-title">Aujourd'hui, émargement</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {sessionsToday.filter(s => s.session_type !== 'subcontract').map(s => (
              <div key={s.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{s.courses?.title || 'Formation'}</p>
                  <div className="flex items-center gap-3 text-ui-sm text-gray-500 mt-0.5">
                    <span className="truncate">{s.clients?.name}</span>
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" />{s.session_trainees?.length || 0}</span>
                    {s.start_time && <span>{String(s.start_time).substring(0, 5)} - {String(s.end_time || '').substring(0, 5)}</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link to={`/sessions/${s.id}`} className="btn btn-secondary">
                    La session
                  </Link>
                  {d.signer && (
                    <Link to={`/signature/${s.id}`} className="btn btn-primary">
                      <PenLine className="w-4 h-4" />Faire signer
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { to: '/clients', icon: Building2, value: clients.length, label: 'Clients' },
          { to: '/sessions', icon: Calendar, value: sessions.length, label: 'Sessions' },
          { to: '/stagiaires', icon: Users, value: personnesFormees, label: 'Personnes formées' },
          { to: '/sessions', icon: CheckCircle, value: completedSessions.length, label: 'Sessions réalisées' },
        ].map(s => (
          <Link key={s.label} to={s.to} className="surface p-4 hover:border-gray-300 transition-colors grid gap-1">
            <span className="flex items-center gap-2 text-ui-sm text-gray-500"><s.icon className="w-4 h-4 text-gray-400" aria-hidden="true" />{s.label}</span>
            <span className="font-display font-semibold text-gray-900 tabular-nums" style={{ fontSize: 'calc(var(--text-ui) * 1.9)', lineHeight: 1.1 }}>{s.value}</span>
            <span className="block h-0.5 w-5 bg-highlight-500" aria-hidden="true" />
          </Link>
        ))}
      </div>
      {(modules || []).includes('interventions') && <InterventionsDashboardCard />}
      

      {/* Widget grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {visibleWidgets.map((config, idx) => {
          const reg = WIDGET_REGISTRY[config.widget_id]
          if (!reg) return null
          const Icon = reg.icon
          return (
            <div
              key={config.widget_id}
              className={`card group ${SIZE_CLASSES[config.size] || 'col-span-1'} ${dragIdx === idx ? 'opacity-50 ring-2 ring-accent-300' : ''}`}
              draggable={d.preferences}
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 cursor-grab active:cursor-grabbing">
                  <GripVertical className="w-3.5 h-3.5 text-gray-300 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 transition-opacity" />
                  <Icon className="w-4 h-4 text-gray-400" />
                  <h3 className="text-ui font-semibold text-gray-700">{reg.label}</h3>
                </div>
                {d.preferences && (
                <div className="flex items-center gap-0.5">
                  <button onClick={() => cycleSize(config.widget_id)} className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600 text-ui-sm font-mono [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 transition-opacity" title="Changer taille">{config.size.toUpperCase()}</button>
                  <button onClick={() => toggleWidget(config.widget_id)} className="p-1.5 hover:bg-[rgb(var(--c-danger-bg))] rounded-ui-sm text-gray-300 hover:text-[rgb(var(--c-danger))] transition-colors" title="Retirer ce widget"><X className="w-3.5 h-3.5" /></button>
                </div>
                )}
              </div>
              {renderWidget(config.widget_id)}
            </div>
          )
        })}
      </div>
      
      {/* Widgets masqués */}
      {(() => {
        const hiddenWidgets = widgetConfigs.filter(c => !c.visible)
        if (hiddenWidgets.length === 0 || !d.preferences) return null
        return (
          <div className="card bg-gray-50 border-dashed border-2 border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-ui font-semibold text-gray-500 flex items-center gap-2">
                <EyeOff className="w-4 h-4" />
                {hiddenWidgets.length} widget{hiddenWidgets.length > 1 ? 's' : ''} masqué{hiddenWidgets.length > 1 ? 's' : ''}
              </h3>
              <button onClick={() => setShowSettings(true)} className="text-ui-sm text-accent-700 hover:underline">Gérer tout</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {hiddenWidgets.map(c => {
                const reg = WIDGET_REGISTRY[c.widget_id]
                if (!reg) return null
                const WIcon = reg.icon
                return (
                  <button key={c.widget_id} onClick={() => toggleWidget(c.widget_id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-ui-sm bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-ui text-gray-600 hover:text-gray-900 transition-colors">
                    <WIcon className="w-3.5 h-3.5" />{reg.label}<span className="text-accent-600 font-bold ml-0.5">+</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })()}
      
      {visibleWidgets.length === 0 && (
        <div className="card text-center py-12">
          <Settings className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 mb-2">Aucun widget visible</p>
          {d.preferences && <button onClick={() => setShowSettings(true)} className="btn btn-primary">Configurer</button>}
        </div>
      )}
      
      {/* Actions rapides */}
      <div className="card">
        <h2 className="section-title mb-3">Actions rapides</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {d.session && <Link to="/sessions" state={{ openNew: true }} className="flex items-center gap-3 p-3 rounded-ui-sm border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors"><Calendar className="w-5 h-5 text-gray-500" /><span className="font-medium text-gray-800">Nouvelle session</span></Link>}
          {d.client && <Link to="/clients" state={{ openNew: true }} className="flex items-center gap-3 p-3 rounded-ui-sm border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors"><Building2 className="w-5 h-5 text-gray-500" /><span className="font-medium text-gray-800">Nouveau client</span></Link>}
          {d.stagiaire && <Link to="/stagiaires" state={{ openNew: true }} className="flex items-center gap-3 p-3 rounded-ui-sm border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors"><Users className="w-5 h-5 text-gray-500" /><span className="font-medium text-gray-800">Nouveau stagiaire</span></Link>}
          <Link to="/non-conformites" className="flex items-center gap-3 p-3 rounded-ui-sm border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors"><AlertTriangle className="w-5 h-5 text-gray-500" /><span className="font-medium text-gray-800">Non-conformités</span></Link>
        </div>
      </div>
      
      {/* Footer */}
      <div className="text-center text-ui-sm text-gray-400 py-2">
        Données protégées conformément au RGPD
      </div>
      
      {/* Settings modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-ui shadow-2xl w-full max-w-2xl my-8">
            <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white rounded-t-xl z-10">
              <div><h2 className="text-xl font-bold text-gray-900">Configurer le tableau de bord</h2><p className="text-ui text-gray-500 mt-0.5">Activez, désactivez et réordonnez vos widgets</p></div>
              <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-gray-100 rounded-ui-sm"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-6">
              {Object.entries(CATEGORIES).map(([catId, cat]) => {
                const catWidgets = widgetConfigs.filter(c => WIDGET_REGISTRY[c.widget_id]?.category === catId)
                return (
                  <div key={catId}>
                    <h3 className="text-ui font-bold text-gray-700 mb-3">{cat.label}</h3>
                    <div className="space-y-1.5">
                      {catWidgets.map(w => {
                        const reg = WIDGET_REGISTRY[w.widget_id]
                        if (!reg) return null
                        return (
                          <div key={w.widget_id} className={`flex items-center gap-3 p-3 rounded-ui-sm border transition-colors ${w.visible ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
                            <button onClick={() => toggleWidget(w.widget_id)} className={`p-1 rounded ${w.visible ? 'text-[rgb(var(--c-success))] hover:bg-[rgb(var(--c-success-bg))]' : 'text-gray-400 hover:bg-gray-100'}`}>{w.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}</button>
                            <reg.icon className="w-4 h-4 text-gray-400" />
                            <span className="flex-1 text-ui font-medium text-gray-800">{reg.label}</span>
                            <div className="flex items-center gap-1">
                              <button onClick={() => cycleSize(w.widget_id)} className="px-2 py-0.5 text-ui-sm rounded bg-gray-100 hover:bg-gray-200 text-gray-600 font-mono">{w.size.toUpperCase()}</button>
                              <button onClick={() => moveWidget(w.widget_id, -1)} className="p-1 hover:bg-gray-100 rounded text-gray-400"><ChevronUp className="w-3.5 h-3.5" /></button>
                              <button onClick={() => moveWidget(w.widget_id, 1)} className="p-1 hover:bg-gray-100 rounded text-gray-400"><ChevronDown className="w-3.5 h-3.5" /></button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex justify-between items-center p-5 border-t bg-gray-50 rounded-b-xl">
              <button onClick={async () => {
                const { data: { user } } = await supabase.auth.getUser()
                if (!user) return
                await supabase.from('dashboard_widget_configs').delete().eq('user_id', user.id)
                await loadWidgetConfigs()
                toast.success('Configuration réinitialisée')
              }} className="text-ui text-[rgb(var(--c-danger))] hover:text-[rgb(var(--c-danger))] hover:underline">Réinitialiser</button>
              <button onClick={() => setShowSettings(false)} className="btn btn-primary">Fermer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
