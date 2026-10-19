import { toneStyle } from '../../../ui/StatusBadge'
import { useState, useEffect } from 'react'
import { supabase } from '../../../core/supabase'
import { fetchAll, fetchAllIn } from '../../../core/fetchAll'
import { useAuthStore } from '../../../core/store'
import { loadNirEtat } from '../../passeport/lib/ppData'
import { 
  AlertCircle, CheckCircle, User, Calendar, FileText, Star, 
  Target, BookOpen, Users, Shield, Filter, Download, 
  ExternalLink, Loader2, TrendingUp
} from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { buildCompletudePDF } from '../pdf/completudePDF'
import SearchSelect from '../../../ui/SearchSelect'

const PRIORITIES = {
  bloquant: { label: 'Bloquant', color: 'red', icon: '' },
  important: { label: 'Important', color: 'orange', icon: '' },
  mineur: { label: 'Mineur', color: 'yellow', icon: '' }
}

const CATEGORIES = {
  stagiaires: { label: 'Stagiaires', icon: User, color: 'blue' },
  sessions: { label: 'Sessions', icon: Calendar, color: 'green' },
  emargements: { label: 'Émargements', icon: FileText, color: 'purple' },
  evaluations: { label: 'Évaluations', icon: Star, color: 'yellow' },
  objectifs: { label: 'Objectifs', icon: Target, color: 'indigo' },
  formations: { label: 'Formations', icon: BookOpen, color: 'pink' },
  formateurs: { label: 'Formateurs', icon: Users, color: 'teal' },
  qualite: { label: 'Qualité', icon: Shield, color: 'red' }
}

export default function Completude() {
  const { modules: ppModules } = useAuthStore()
  const passeportOn = (ppModules || []).includes('passeport')
  const [loading, setLoading] = useState(true)
  const [issues, setIssues] = useState([])
  const [expandedCategories, setExpandedCategories] = useState(Object.keys(CATEGORIES))
  
  // Filtres
  const [filterPriority, setFilterPriority] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterClient, setFilterClient] = useState('all')
  const [clients, setClients] = useState([])

  // Stats
  const [stats, setStats] = useState({
    total: 0,
    bloquant: 0,
    important: 0,
    mineur: 0,
    byCategory: {}
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    const allIssues = []

    try {
      // 1. STAGIAIRES
      const { data: trainees } = await fetchAll(() => supabase
        .from('trainees')
        .select('id, first_name, last_name, birth_date, csp, job_title, gender, ssn_present, refused_ssn'))
      
      // Module Passeport de prévention actif : le numéro est chiffré à part (présence seulement, jamais le numéro)
      let nirPresents = null
      if (passeportOn && trainees?.length) {
        try { nirPresents = await loadNirEtat(trainees.map((t) => t.id)) } catch { nirPresents = null }
      }

      trainees?.forEach(t => {
        if (!t.birth_date) {
          allIssues.push({
            category: 'stagiaires',
            priority: 'important',
            element: `${t.first_name} ${t.last_name}`,
            detail: 'Date de naissance manquante',
            link: '/stagiaires',
            entityId: t.id,
            since: null
          })
        }
        if (!t.csp) {
          allIssues.push({
            category: 'stagiaires',
            priority: 'important',
            element: `${t.first_name} ${t.last_name}`,
            detail: 'CSP manquante',
            link: '/stagiaires',
            entityId: t.id,
            since: null
          })
        }
        if (!t.job_title) {
          allIssues.push({
            category: 'stagiaires',
            priority: 'important',
            element: `${t.first_name} ${t.last_name}`,
            detail: 'Poste/fonction manquant',
            link: '/stagiaires',
            entityId: t.id,
            since: null
          })
        }
        if (!t.gender) {
          allIssues.push({
            category: 'stagiaires',
            priority: 'important',
            element: `${t.first_name} ${t.last_name}`,
            detail: 'Genre manquant',
            link: '/stagiaires',
            entityId: t.id,
            since: null
          })
        }
        if (!t.refused_ssn && !(nirPresents ? nirPresents[t.id] : t.ssn_present)) {
          allIssues.push({
            category: 'stagiaires',
            priority: 'bloquant',
            element: `${t.first_name} ${t.last_name}`,
            detail: 'Numéro SS manquant',
            link: '/stagiaires',
            entityId: t.id,
            since: null
          })
        }
      })

      // 2. SESSIONS
      const { data: sessions } = await fetchAll(() => supabase
        .from('sessions')
        .select(`
          id, 
          reference, 
          start_date, 
          status,
          convention_sent,
          convention_signed,
          funding_type,
          location_name,
          clients(name),
          courses(title),
          trainer_id
        `)
        .eq('status', 'completed'))
      
      sessions?.forEach(s => {
        const clientName = s.clients?.name || 'Client inconnu'
        const courseName = s.courses?.title || 'Formation inconnue'
        
        if (!s.convention_sent) {
          allIssues.push({
            category: 'sessions',
            priority: 'bloquant',
            element: `${s.reference} - ${courseName}`,
            detail: 'Convention non envoyée',
            link: `/sessions/${s.id}`,
            entityId: s.id,
            client: clientName,
            since: s.start_date
          })
        }
        if (s.convention_sent && !s.convention_signed) {
          allIssues.push({
            category: 'sessions',
            priority: 'bloquant',
            element: `${s.reference} - ${courseName}`,
            detail: 'Convention non signée',
            link: `/sessions/${s.id}`,
            entityId: s.id,
            client: clientName,
            since: s.start_date
          })
        }
        if (!s.funding_type || s.funding_type === 'none') {
          allIssues.push({
            category: 'sessions',
            priority: 'important',
            element: `${s.reference} - ${courseName}`,
            detail: 'Type de financement non renseigné',
            link: `/sessions/${s.id}`,
            entityId: s.id,
            client: clientName,
            since: s.start_date
          })
        }
        if (!s.clients) {
          allIssues.push({
            category: 'sessions',
            priority: 'bloquant',
            element: `${s.reference} - ${courseName}`,
            detail: 'Client non renseigné',
            link: `/sessions/${s.id}`,
            entityId: s.id,
            since: s.start_date
          })
        }
        if (!s.trainer_id) {
          allIssues.push({
            category: 'sessions',
            priority: 'important',
            element: `${s.reference} - ${courseName}`,
            detail: 'Formateur non assigné',
            link: `/sessions/${s.id}`,
            entityId: s.id,
            client: clientName,
            since: s.start_date
          })
        }
        if (!s.location_name) {
          allIssues.push({
            category: 'sessions',
            priority: 'important',
            element: `${s.reference} - ${courseName}`,
            detail: 'Lieu non renseigné',
            link: `/sessions/${s.id}`,
            entityId: s.id,
            client: clientName,
            since: s.start_date
          })
        }
      })

      // 3 à 5 et 7 : participants des sessions en cours ou terminées, rapprochés par session et stagiaire
      // (émargements, évaluations et objectifs sont rattachés à session_id + trainee_id)
      const { data: doneSessions } = await fetchAll(() => supabase
        .from('sessions')
        .select('id, reference, start_date, end_date, start_time, end_time, status, courses(title)')
        .in('status', ['in_progress', 'completed']))
      const sessionById = new Map((doneSessions || []).map((s) => [s.id, s]))
      const doneIds = [...sessionById.keys()]
      const inDone = async (table, cols) => {
        if (!doneIds.length) return []
        // Par lots d'identifiants et sans troncature à 1 000 lignes
        const { data, error } = await fetchAllIn(() => supabase.from(table).select(cols), 'session_id', doneIds)
        if (error) console.error(`Complétude ${table} :`, error.message)
        return data || []
      }
      const [participants, halfdays, hotEvals, coldEvals, objectivesRows] = await Promise.all([
        inDone('session_trainees', 'id, session_id, trainee_id, absent, trainees(first_name, last_name)'),
        inDone('attendance_halfdays', 'session_id, trainee_id, morning, afternoon'),
        inDone('trainee_evaluations', 'session_id, trainee_id, questionnaire_submitted, submitted_at'),
        inDone('evaluations_cold', 'session_id, trainee_id, completed_at'),
        inDone('trainee_objectives', 'session_id, trainee_id, validated, remediation_comment'),
      ])
      const keyOf = (r) => `${r.session_id}|${r.trainee_id}`
      const groupBy = (rows) => {
        const m = new Map()
        rows.forEach((r) => { const k = keyOf(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r) })
        return m
      }
      const halfdaysBy = groupBy(halfdays)
      const objectivesBy = groupBy(objectivesRows)
      const hotDone = new Set(hotEvals.filter((e) => e.questionnaire_submitted || e.submitted_at).map(keyOf))
      const coldDone = new Set(coldEvals.filter((e) => e.completed_at).map(keyOf))
      const threeMonthsAgo = new Date()
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

      participants.forEach((st) => {
        const sess = sessionById.get(st.session_id)
        if (!sess) return
        const traineeName = `${st.trainees?.first_name || ''} ${st.trainees?.last_name || ''}`.trim()
        const sessionRef = sess.reference || 'Session'
        const k = keyOf(st)
        const base = { element: `${traineeName} - ${sessionRef}`, link: `/sessions/${sess.id}`, entityId: st.id }

        // 3. ÉMARGEMENTS (participant absent : rien à émarger)
        if (!st.absent) {
          const rows = halfdaysBy.get(k) || []
          if (!rows.length) {
            allIssues.push({ ...base, category: 'emargements', priority: 'bloquant', detail: 'Aucun émargement', since: sess.start_date })
          } else {
            // Demi-journées attendues selon les horaires (une session de matinée n'a pas d'après-midi à émarger)
            const hhmm = (t, d) => String(t || d).slice(0, 5)
            const expectMorning = hhmm(sess.start_time, '09:00') < '12:30'
            const expectAfternoon = hhmm(sess.end_time, '17:00') > '13:30'
            const missingHalfDays = rows.filter((r) => (expectMorning && !r.morning) || (expectAfternoon && !r.afternoon))
            if (missingHalfDays.length > 0) {
              allIssues.push({ ...base, category: 'emargements', priority: 'important', detail: `${missingHalfDays.length} demi-journée(s) non émargée(s)`, since: sess.start_date })
            }
          }
        }

        if (sess.status !== 'completed' || st.absent) return

        // 4. ÉVALUATIONS À CHAUD
        if (!hotDone.has(k)) {
          allIssues.push({ ...base, category: 'evaluations', priority: 'important', detail: 'Évaluation à chaud manquante', since: sess.end_date })
        }

        // 5. ÉVALUATIONS À FROID (sessions terminées depuis plus de 3 mois)
        if (sess.end_date && new Date(sess.end_date) < threeMonthsAgo && !coldDone.has(k)) {
          allIssues.push({ ...base, category: 'evaluations', priority: 'important', detail: 'Évaluation à froid manquante (>3 mois)', since: sess.end_date })
        }

        // 7. OBJECTIFS
        const objs = objectivesBy.get(k) || []
        if (!objs.length) {
          allIssues.push({ ...base, category: 'objectifs', priority: 'important', detail: 'Objectifs non évalués', since: null })
        } else {
          const needsRemediation = objs.filter((o) => !o.validated && !(o.remediation_comment || '').trim())
          if (needsRemediation.length > 0) {
            allIssues.push({ ...base, category: 'objectifs', priority: 'important', detail: `${needsRemediation.length} objectif(s) non acquis sans remédiation`, since: null })
          }
        }
      })

      // 6. ÉVALUATIONS FORMATEURS
      const { data: trainerEvals } = await fetchAll(() => supabase
        .from('sessions')
        .select(`
          id,
          reference,
          end_date,
          courses(title),
          trainer_id, trainers(id, first_name, last_name)
        `)
        .eq('status', 'completed'))
      
      if (trainerEvals) {
        const { data: existingEvals } = await fetchAll(() => supabase
          .from('trainer_evaluations')
          .select('session_id, trainer_id'))
        
        const evalMap = new Map()
        existingEvals?.forEach(e => {
          evalMap.set(`${e.session_id}-${e.trainer_id}`, true)
        })
        
        trainerEvals.forEach(s => {
          // Formateur de la session : sessions.trainer_id (seule affectation utilisée)
          ;(s.trainers ? [{ trainers: s.trainers }] : []).forEach(st => {
            const key = `${s.id}-${st.trainers?.id}`
            if (!evalMap.has(key)) {
              const trainerName = `${st.trainers?.first_name} ${st.trainers?.last_name}`
              const courseName = s.courses?.title || 'Formation'
              
              allIssues.push({
                category: 'evaluations',
                priority: 'important',
                element: `${trainerName} - ${s.reference}`,
                detail: 'Évaluation formateur manquante',
                link: `/sessions/${s.id}`,
                entityId: s.id,
                since: s.end_date
              })
            }
          })
        })
      }

      // 8. FORMATIONS
      const { data: courses } = await supabase
        .from('courses')
        .select('id, title, program, prerequisites, objectives, course_documents(id)')
      
      courses?.forEach(c => {
        if (!c.program || !c.program.trim()) {
          allIssues.push({
            category: 'formations',
            priority: 'important',
            element: c.title,
            detail: 'Programme manquant',
            link: '/formations',
            entityId: c.id,
            since: null
          })
        }
        if (!c.course_documents || c.course_documents.length === 0) {
          allIssues.push({
            category: 'formations',
            priority: 'important',
            element: c.title,
            detail: 'Documents pédagogiques manquants',
            link: '/formations',
            entityId: c.id,
            since: null
          })
        }
        if (!c.prerequisites || !c.prerequisites.trim()) {
          allIssues.push({
            category: 'formations',
            priority: 'mineur',
            element: c.title,
            detail: 'Prérequis non définis',
            link: '/formations',
            entityId: c.id,
            since: null
          })
        }
        if (!c.objectives || !c.objectives.trim()) {
          allIssues.push({
            category: 'formations',
            priority: 'important',
            element: c.title,
            detail: 'Objectifs pédagogiques manquants',
            link: '/formations',
            entityId: c.id,
            since: null
          })
        }
      })

      // 9. FORMATEURS
      // Lectures séparées : ces tables n'ont pas de clé étrangère déclarée vers trainers,
      // une jointure imbriquée échouait et la rubrique Formateurs restait vide
      const [trR, certR, itvR, trnR] = await Promise.all([
        supabase.from('trainers').select('id, first_name, last_name'),
        supabase.from('trainer_certificates').select('id, trainer_id'),
        supabase.from('trainer_interviews').select('trainer_id, interview_date'),
        supabase.from('trainer_trainings').select('trainer_id, training_date'),
      ])
      ;[trR, certR, itvR, trnR].forEach(r => { if (r.error) console.error('Complétude formateurs :', r.error.message) })
      const byTrainer = (rows) => (rows || []).reduce((m, x) => { (m[x.trainer_id] ||= []).push(x); return m }, {})
      const certs = byTrainer(certR.data), itvs = byTrainer(itvR.data), trns = byTrainer(trnR.data)
      const trainers = (trR.data || []).map(t => ({ ...t, trainer_certificates: certs[t.id] || [], trainer_interviews: itvs[t.id] || [], trainer_trainings: trns[t.id] || [] }))
      
      const oneYearAgo = new Date()
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      
      trainers?.forEach(t => {
        const trainerName = `${t.first_name} ${t.last_name}`
        
        if (!t.trainer_certificates || t.trainer_certificates.length === 0) {
          allIssues.push({
            category: 'formateurs',
            priority: 'important',
            element: trainerName,
            detail: 'Certificats/qualifications manquants',
            link: '/formateurs',
            entityId: t.id,
            since: null
          })
        }
        
        // Entretien annuel
        const lastYearInterviews = t.trainer_interviews?.filter(i => 
          new Date(i.interview_date) >= oneYearAgo
        )
        if (!lastYearInterviews || lastYearInterviews.length === 0) {
          allIssues.push({
            category: 'formateurs',
            priority: 'important',
            element: trainerName,
            detail: 'Entretien annuel manquant (12 derniers mois)',
            link: '/formateurs',
            entityId: t.id,
            since: null
          })
        }
        
        // Formations continues
        const recentTrainings = t.trainer_trainings?.filter(tr => 
          new Date(tr.training_date) >= oneYearAgo
        )
        if (!recentTrainings || recentTrainings.length === 0) {
          allIssues.push({
            category: 'formateurs',
            priority: 'mineur',
            element: trainerName,
            detail: 'Aucune formation continue (12 derniers mois)',
            link: '/formateurs',
            entityId: t.id,
            since: null
          })
        }
      })

      // 10. QUALITÉ
      // Veille mois en cours
      const startOfMonth = new Date()
      startOfMonth.setDate(1)
      startOfMonth.setHours(0, 0, 0, 0)
      
      const { data: veilleMonth } = await supabase
        .from('veille_qualiopi')
        .select('id')
        .gte('date', startOfMonth.toISOString())
      
      if (!veilleMonth || veilleMonth.length === 0) {
        allIssues.push({
          category: 'qualite',
          priority: 'important',
          element: 'Veille Qualiopi',
          detail: 'Aucune veille ce mois-ci',
          link: '/veille-qualiopi',
          entityId: null,
          since: startOfMonth.toISOString()
        })
      }
      
      // Réclamations >5j
      const fiveDaysAgo = new Date()
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5)
      
      const { data: oldReclamations } = await supabase
        .from('reclamations')
        .select('id, reference, created_at')
        .not('status', 'in', '(closed,resolved)')
        .lt('created_at', fiveDaysAgo.toISOString())
      
      oldReclamations?.forEach(r => {
        allIssues.push({
          category: 'qualite',
          priority: 'bloquant',
          element: r.reference,
          detail: 'Réclamation non clôturée (>5 jours)',
          link: '/qualite',
          entityId: r.id,
          since: r.created_at
        })
      })
      
      // Audit interne annuel
      const startOfYear = new Date()
      startOfYear.setMonth(0, 1)
      startOfYear.setHours(0, 0, 0, 0)
      
      const { data: auditsYear } = await supabase
        .from('audits_internes')
        .select('id')
        .gte('date_audit', startOfYear.toISOString())
      
      if (!auditsYear || auditsYear.length === 0) {
        allIssues.push({
          category: 'qualite',
          priority: 'important',
          element: 'Audit interne',
          detail: 'Aucun audit interne cette année',
          link: '/qualite',
          entityId: null,
          since: startOfYear.toISOString()
        })
      }

      // Extract unique clients
      const uniqueClients = [...new Set(allIssues.map(i => i.client).filter(Boolean))]
      setClients(uniqueClients)

      setIssues(allIssues)
      calculateStats(allIssues)
      
    } catch (error) {
      console.error('Erreur chargement complétude:', error)
      toast.error('Erreur lors du chargement')
    }
    
    setLoading(false)
  }

  const calculateStats = (allIssues) => {
    const stats = {
      total: allIssues.length,
      bloquant: allIssues.filter(i => i.priority === 'bloquant').length,
      important: allIssues.filter(i => i.priority === 'important').length,
      mineur: allIssues.filter(i => i.priority === 'mineur').length,
      byCategory: {}
    }

    Object.keys(CATEGORIES).forEach(cat => {
      stats.byCategory[cat] = allIssues.filter(i => i.category === cat).length
    })

    setStats(stats)
  }

  const filteredIssues = issues.filter(issue => {
    if (filterPriority !== 'all' && issue.priority !== filterPriority) return false
    if (filterCategory !== 'all' && issue.category !== filterCategory) return false
    if (filterClient !== 'all' && issue.client !== filterClient) return false
    return true
  })

  const toggleCategory = (cat) => {
    setExpandedCategories(prev => 
      prev.includes(cat) 
        ? prev.filter(c => c !== cat)
        : [...prev, cat]
    )
  }

  const exportCSV = () => {
    const headers = ['Priorité', 'Catégorie', 'Élément', 'Détail', 'Client', 'Depuis']
    const rows = filteredIssues.map(issue => [
      PRIORITIES[issue.priority].label,
      CATEGORIES[issue.category].label,
      issue.element,
      issue.detail,
      issue.client || '-',
      issue.since ? format(new Date(issue.since), 'dd/MM/yyyy') : '-'
    ])

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `completude-${format(new Date(), 'yyyy-MM-dd')}.csv`
    link.click()
    
    toast.success('Export CSV téléchargé')
  }

  const exportPDF = async () => {
    try {
      const ORG = await loadPdfOrg(true)
      const doc = buildCompletudePDF(ORG, {
        stats,
        issues: filteredIssues.map(issue => ({ ...issue, categoryLabel: CATEGORIES[issue.category]?.label || issue.category })),
      })
      doc.save(`completude-${format(new Date(), 'yyyy-MM-dd')}.pdf`)
      toast.success('Export PDF téléchargé')
    } catch (e) {
      console.error('Erreur PDF :', e)
      toast.error("Erreur lors de l'export PDF")
    }
  }

  const completionRate = stats.total > 0 
    ? Math.round((1 - stats.total / 1000) * 100) // Approximation
    : 100

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-[rgb(var(--c-info))]" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* HEADER */}
      <div className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="page-title">Complétude</h1>
            <p className="text-ui text-gray-600">Suivi des éléments manquants</p>
          </div>
          <div className="flex gap-2">
            <button onClick={loadData} disabled={loading} className="btn btn-secondary">
              <TrendingUp className="w-4 h-4 mr-2" />
              Actualiser
            </button>
            <button onClick={exportCSV} className="btn btn-secondary">
              <Download className="w-4 h-4 mr-2" />
              CSV
            </button>
            <button onClick={exportPDF} className="btn btn-primary">
              <Download className="w-4 h-4 mr-2" />
              PDF
            </button>
          </div>
        </div>

        {/* BARRE DE PROGRESSION */}
        <div className="bg-white rounded-ui-sm shadow-sm border p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-3xl font-bold text-gray-900">{completionRate}%</div>
              <div className="text-ui text-gray-600">Taux de complétude global</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-[rgb(var(--c-danger))]">{stats.total}</div>
              <div className="text-ui text-gray-600">éléments manquants</div>
            </div>
          </div>
          
          <div className="w-full bg-gray-200 rounded-full h-4 mb-4">
            <div 
              className="bg-gray-50 h-4 rounded-full transition-all"
              style={{ width: `${completionRate}%` }}
            />
          </div>
          
          <div className="flex gap-4 text-ui">
            <div className="flex items-center gap-2">
              <span className="text-2xl"></span>
              <span className="font-semibold">{stats.bloquant}</span>
              <span className="text-gray-600">Bloquant</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl"></span>
              <span className="font-semibold">{stats.important}</span>
              <span className="text-gray-600">Important</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl"></span>
              <span className="font-semibold">{stats.mineur}</span>
              <span className="text-gray-600">Mineur</span>
            </div>
          </div>
        </div>
      </div>

      {/* FILTRES */}
      <div className="bg-white rounded-ui-sm shadow-sm border p-4 mb-6">
        <div className="flex items-center gap-4">
          <Filter className="w-5 h-5 text-gray-400" />
          
          <select 
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="input"
          >
            <option value="all">Toutes priorités</option>
            <option value="bloquant"> Bloquant</option>
            <option value="important"> Important</option>
            <option value="mineur"> Mineur</option>
          </select>
          
          <select 
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="input"
          >
            <option value="all">Toutes catégories</option>
            {Object.entries(CATEGORIES).map(([key, cat]) => (
              <option key={key} value={key}>{cat.label}</option>
            ))}
          </select>
          
          {clients.length > 0 && (
            <SearchSelect
              value={filterClient === 'all' ? '' : filterClient}
              onChange={(v) => setFilterClient(v || 'all')}
              options={clients.map(client => ({ value: client, label: client }))}
              emptyLabel="Tous clients" searchPlaceholder="Rechercher un client..." aria-label="Filtrer par client" />
          )}
          
          <div className="ml-auto text-ui text-gray-600">
            {filteredIssues.length} résultat(s)
          </div>
        </div>
      </div>

      {/* CATÉGORIES */}
      <div className="space-y-4">
        {Object.entries(CATEGORIES).map(([catKey, category]) => {
          const catIssues = filteredIssues.filter(i => i.category === catKey)
          if (catIssues.length === 0) return null
          
          const Icon = category.icon
          const isExpanded = expandedCategories.includes(catKey)
          
          return (
            <div key={catKey} className="bg-white rounded-ui-sm shadow-sm border overflow-hidden">
              <button
                onClick={() => toggleCategory(catKey)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-ui-sm`} style={toneStyle(category.color, { text: false })}>
                    <Icon className={`w-5 h-5`} style={toneStyle(category.color, { bg: false })} />
                  </div>
                  <div className="text-left">
                    <h3 className="font-semibold text-gray-900">{category.label}</h3>
                    <p className="text-ui text-gray-600">
                      {catIssues.length} élément(s) manquant(s)
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex gap-2">
                    {catIssues.filter(i => i.priority === 'bloquant').length > 0 && (
                      <span className="px-2 py-1 bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))] text-ui-sm rounded">
                         {catIssues.filter(i => i.priority === 'bloquant').length}
                      </span>
                    )}
                    {catIssues.filter(i => i.priority === 'important').length > 0 && (
                      <span className="px-2 py-1 bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] text-ui-sm rounded">
                         {catIssues.filter(i => i.priority === 'important').length}
                      </span>
                    )}
                    {catIssues.filter(i => i.priority === 'mineur').length > 0 && (
                      <span className="px-2 py-1 bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] text-ui-sm rounded">
                         {catIssues.filter(i => i.priority === 'mineur').length}
                      </span>
                    )}
                  </div>
                  <span className={`transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                </div>
              </button>
              
              {isExpanded && (
                <div className="border-t overflow-x-auto">
                  <table className="w-full min-w-[700px]">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-ui-sm font-medium text-gray-500 uppercase">Priorité</th>
                        <th className="px-6 py-3 text-left text-ui-sm font-medium text-gray-500 uppercase">Élément</th>
                        <th className="px-6 py-3 text-left text-ui-sm font-medium text-gray-500 uppercase">Détail</th>
                        {catIssues.some(i => i.client) && (
                          <th className="px-6 py-3 text-left text-ui-sm font-medium text-gray-500 uppercase">Client</th>
                        )}
                        <th className="px-6 py-3 text-left text-ui-sm font-medium text-gray-500 uppercase">Depuis</th>
                        <th className="px-6 py-3 text-left text-ui-sm font-medium text-gray-500 uppercase">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {catIssues.map((issue, idx) => (
                        <tr key={idx} className="hover:bg-gray-50 group">
                          <td className="px-6 py-4">
                            <span className="text-2xl" title={PRIORITIES[issue.priority].label}>
                              {PRIORITIES[issue.priority].icon}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-ui font-medium text-gray-900">
                            {issue.element}
                          </td>
                          <td className="px-6 py-4 text-ui text-gray-600">
                            {issue.detail}
                          </td>
                          {catIssues.some(i => i.client) && (
                            <td className="px-6 py-4 text-ui text-gray-600">
                              {issue.client || '-'}
                            </td>
                          )}
                          <td className="px-6 py-4 text-ui text-gray-600">
                            {issue.since ? format(new Date(issue.since), 'dd/MM/yyyy') : '-'}
                          </td>
                          <td className="px-6 py-4">
                            <a
                              href={`#${issue.link}`}
                              className="inline-flex items-center gap-1 text-ui text-[rgb(var(--c-info))] hover:text-[rgb(var(--c-info))]"
                              title="Corriger"
                            >
                              <ExternalLink className="w-4 h-4" />
                              <span className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                Corriger
                              </span>
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {filteredIssues.length === 0 && (
        <div className="text-center py-12 bg-white rounded-ui-sm shadow-sm border">
          <CheckCircle className="w-16 h-16 text-[rgb(var(--c-success))] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Aucun élément manquant !
          </h3>
          <p className="text-gray-600">
            Toutes les données sont complètes 
          </p>
        </div>
      )}
    </div>
  )
}
