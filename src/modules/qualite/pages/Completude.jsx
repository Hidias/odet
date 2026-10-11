import { useState, useEffect } from 'react'
import { supabase } from '../../../core/supabase'
import { 
  AlertCircle, CheckCircle, User, Calendar, FileText, Star, 
  Target, BookOpen, Users, Shield, Filter, Download, 
  ExternalLink, Loader2, TrendingUp
} from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { jsPDF } from 'jspdf'
import 'jspdf-autotable'

const PRIORITIES = {
  bloquant: { label: 'Bloquant', color: 'red', icon: '🔴' },
  important: { label: 'Important', color: 'orange', icon: '🟠' },
  mineur: { label: 'Mineur', color: 'yellow', icon: '🟡' }
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
      const { data: trainees } = await supabase
        .from('trainees')
        .select('id, first_name, last_name, birth_date, csp, job_title, gender, social_security_number, refused_ssn')
      
      trainees?.forEach(t => {
        if (!t.birth_date) {
          allIssues.push({
            category: 'stagiaires',
            priority: 'important',
            element: `${t.first_name} ${t.last_name}`,
            detail: 'Date de naissance manquante',
            link: `/trainees/${t.id}`,
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
            link: `/trainees/${t.id}`,
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
            link: `/trainees/${t.id}`,
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
            link: `/trainees/${t.id}`,
            entityId: t.id,
            since: null
          })
        }
        if (!t.refused_ssn && !t.social_security_number) {
          allIssues.push({
            category: 'stagiaires',
            priority: 'bloquant',
            element: `${t.first_name} ${t.last_name}`,
            detail: 'Numéro SS manquant',
            link: `/trainees/${t.id}`,
            entityId: t.id,
            since: null
          })
        }
      })

      // 2. SESSIONS
      const { data: sessions } = await supabase
        .from('sessions')
        .select(`
          id, 
          reference, 
          start_date, 
          status,
          convention_sent,
          convention_signed,
          funding_type,
          location,
          clients(name),
          courses(name),
          session_trainers(trainers(id))
        `)
        .eq('status', 'completed')
      
      sessions?.forEach(s => {
        const clientName = s.clients?.name || 'Client inconnu'
        const courseName = s.courses?.name || 'Formation inconnue'
        
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
        if (!s.session_trainers || s.session_trainers.length === 0) {
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
        if (!s.location) {
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

      // 3. ÉMARGEMENTS
      const { data: attendance } = await supabase
        .from('session_trainees')
        .select(`
          id,
          trainees(first_name, last_name),
          sessions(id, reference, start_date, courses(name)),
          attendance_halfdays(morning, afternoon)
        `)
        .in('sessions.status', ['ongoing', 'completed'])
      
      attendance?.forEach(st => {
        const hasAttendance = st.attendance_halfdays && st.attendance_halfdays.length > 0
        if (!hasAttendance) {
          const traineeName = `${st.trainees?.first_name} ${st.trainees?.last_name}`
          const sessionRef = st.sessions?.reference || 'Session'
          const courseName = st.sessions?.courses?.name || ''
          
          allIssues.push({
            category: 'emargements',
            priority: 'bloquant',
            element: `${traineeName} - ${sessionRef}`,
            detail: 'Aucun émargement',
            link: `/sessions/${st.sessions?.id}`,
            entityId: st.id,
            since: st.sessions?.start_date
          })
        } else {
          // Vérifier demi-journées manquantes
          const missingHalfDays = st.attendance_halfdays.filter(a => !a.morning || !a.afternoon)
          if (missingHalfDays.length > 0) {
            const traineeName = `${st.trainees?.first_name} ${st.trainees?.last_name}`
            const sessionRef = st.sessions?.reference || 'Session'
            
            allIssues.push({
              category: 'emargements',
              priority: 'important',
              element: `${traineeName} - ${sessionRef}`,
              detail: `${missingHalfDays.length} demi-journée(s) non émargée(s)`,
              link: `/sessions/${st.sessions?.id}`,
              entityId: st.id,
              since: st.sessions?.start_date
            })
          }
        }
      })

      // 4. ÉVALUATIONS À CHAUD
      const { data: evalHot } = await supabase
        .from('session_trainees')
        .select(`
          id,
          questionnaire_submitted,
          trainees(first_name, last_name),
          sessions(id, reference, end_date, courses(name))
        `)
        .eq('sessions.status', 'completed')
        .is('questionnaire_submitted', false)
      
      evalHot?.forEach(st => {
        const traineeName = `${st.trainees?.first_name} ${st.trainees?.last_name}`
        const sessionRef = st.sessions?.reference || 'Session'
        
        allIssues.push({
          category: 'evaluations',
          priority: 'important',
          element: `${traineeName} - ${sessionRef}`,
          detail: 'Évaluation à chaud manquante',
          link: `/sessions/${st.sessions?.id}`,
          entityId: st.id,
          since: st.sessions?.end_date
        })
      })

      // 5. ÉVALUATIONS À FROID
      const threeMonthsAgo = new Date()
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
      
      const { data: evalCold } = await supabase
        .from('session_trainees')
        .select(`
          id,
          trainees(first_name, last_name),
          sessions(id, reference, end_date, courses(name))
        `)
        .eq('sessions.status', 'completed')
        .lt('sessions.end_date', threeMonthsAgo.toISOString())
      
      if (evalCold) {
        const { data: coldEvals } = await supabase
          .from('evaluations_cold')
          .select('session_trainee_id')
        
        const coldEvalIds = new Set(coldEvals?.map(e => e.session_trainee_id) || [])
        
        evalCold.forEach(st => {
          if (!coldEvalIds.has(st.id)) {
            const traineeName = `${st.trainees?.first_name} ${st.trainees?.last_name}`
            const sessionRef = st.sessions?.reference || 'Session'
            
            allIssues.push({
              category: 'evaluations',
              priority: 'important',
              element: `${traineeName} - ${sessionRef}`,
              detail: 'Évaluation à froid manquante (>3 mois)',
              link: `/sessions/${st.sessions?.id}`,
              entityId: st.id,
              since: st.sessions?.end_date
            })
          }
        })
      }

      // 6. ÉVALUATIONS FORMATEURS
      const { data: trainerEvals } = await supabase
        .from('sessions')
        .select(`
          id,
          reference,
          end_date,
          courses(name),
          session_trainers(trainers(id, first_name, last_name))
        `)
        .eq('status', 'completed')
      
      if (trainerEvals) {
        const { data: existingEvals } = await supabase
          .from('trainer_evaluations')
          .select('session_id, trainer_id')
        
        const evalMap = new Map()
        existingEvals?.forEach(e => {
          evalMap.set(`${e.session_id}-${e.trainer_id}`, true)
        })
        
        trainerEvals.forEach(s => {
          s.session_trainers?.forEach(st => {
            const key = `${s.id}-${st.trainers?.id}`
            if (!evalMap.has(key)) {
              const trainerName = `${st.trainers?.first_name} ${st.trainers?.last_name}`
              const courseName = s.courses?.name || 'Formation'
              
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

      // 7. OBJECTIFS
      const { data: objectives } = await supabase
        .from('session_trainees')
        .select(`
          id,
          trainees(first_name, last_name),
          sessions(id, reference, courses(name)),
          trainee_objectives(result, remediation_comment)
        `)
        .eq('sessions.status', 'completed')
      
      objectives?.forEach(st => {
        const traineeName = `${st.trainees?.first_name} ${st.trainees?.last_name}`
        const sessionRef = st.sessions?.reference || 'Session'
        
        if (!st.trainee_objectives || st.trainee_objectives.length === 0) {
          allIssues.push({
            category: 'objectifs',
            priority: 'important',
            element: `${traineeName} - ${sessionRef}`,
            detail: 'Objectifs non définis',
            link: `/sessions/${st.sessions?.id}`,
            entityId: st.id,
            since: null
          })
        } else {
          // Vérifier résultats non validés
          const unvalidated = st.trainee_objectives.filter(o => !o.result || o.result === 'pending')
          if (unvalidated.length > 0) {
            allIssues.push({
              category: 'objectifs',
              priority: 'important',
              element: `${traineeName} - ${sessionRef}`,
              detail: `${unvalidated.length} objectif(s) non validé(s)`,
              link: `/sessions/${st.sessions?.id}`,
              entityId: st.id,
              since: null
            })
          }
          
          // Vérifier remédiation manquante
          const needsRemediation = st.trainee_objectives.filter(o => 
            o.result === 'not_acquired' && (!o.remediation_comment || !o.remediation_comment.trim())
          )
          if (needsRemediation.length > 0) {
            allIssues.push({
              category: 'objectifs',
              priority: 'important',
              element: `${traineeName} - ${sessionRef}`,
              detail: `${needsRemediation.length} remédiation(s) manquante(s)`,
              link: `/sessions/${st.sessions?.id}`,
              entityId: st.id,
              since: null
            })
          }
        }
      })

      // 8. FORMATIONS
      const { data: courses } = await supabase
        .from('courses')
        .select('id, name, program, prerequisites, objectives, course_documents(id)')
      
      courses?.forEach(c => {
        if (!c.program || !c.program.trim()) {
          allIssues.push({
            category: 'formations',
            priority: 'important',
            element: c.name,
            detail: 'Programme manquant',
            link: `/courses/${c.id}`,
            entityId: c.id,
            since: null
          })
        }
        if (!c.course_documents || c.course_documents.length === 0) {
          allIssues.push({
            category: 'formations',
            priority: 'important',
            element: c.name,
            detail: 'Documents pédagogiques manquants',
            link: `/courses/${c.id}`,
            entityId: c.id,
            since: null
          })
        }
        if (!c.prerequisites || !c.prerequisites.trim()) {
          allIssues.push({
            category: 'formations',
            priority: 'mineur',
            element: c.name,
            detail: 'Prérequis non définis',
            link: `/courses/${c.id}`,
            entityId: c.id,
            since: null
          })
        }
        if (!c.objectives || !c.objectives.trim()) {
          allIssues.push({
            category: 'formations',
            priority: 'important',
            element: c.name,
            detail: 'Objectifs pédagogiques manquants',
            link: `/courses/${c.id}`,
            entityId: c.id,
            since: null
          })
        }
      })

      // 9. FORMATEURS
      const { data: trainers } = await supabase
        .from('trainers')
        .select(`
          id, 
          first_name, 
          last_name,
          cv_url,
          trainer_qualifications(id),
          trainer_interviews(date),
          trainer_trainings(date)
        `)
      
      const oneYearAgo = new Date()
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      
      trainers?.forEach(t => {
        const trainerName = `${t.first_name} ${t.last_name}`
        
        if (!t.cv_url) {
          allIssues.push({
            category: 'formateurs',
            priority: 'important',
            element: trainerName,
            detail: 'CV manquant',
            link: `/trainers/${t.id}`,
            entityId: t.id,
            since: null
          })
        }
        
        if (!t.trainer_qualifications || t.trainer_qualifications.length === 0) {
          allIssues.push({
            category: 'formateurs',
            priority: 'important',
            element: trainerName,
            detail: 'Certificats/qualifications manquants',
            link: `/trainers/${t.id}`,
            entityId: t.id,
            since: null
          })
        }
        
        // Entretien annuel
        const lastYearInterviews = t.trainer_interviews?.filter(i => 
          new Date(i.date) >= oneYearAgo
        )
        if (!lastYearInterviews || lastYearInterviews.length === 0) {
          allIssues.push({
            category: 'formateurs',
            priority: 'important',
            element: trainerName,
            detail: 'Entretien annuel manquant (12 derniers mois)',
            link: `/trainers/${t.id}`,
            entityId: t.id,
            since: null
          })
        }
        
        // Formations continues
        const recentTrainings = t.trainer_trainings?.filter(tr => 
          new Date(tr.date) >= oneYearAgo
        )
        if (!recentTrainings || recentTrainings.length === 0) {
          allIssues.push({
            category: 'formateurs',
            priority: 'mineur',
            element: trainerName,
            detail: 'Aucune formation continue (12 derniers mois)',
            link: `/trainers/${t.id}`,
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
          link: '/qualite/veille',
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
        .neq('status', 'closed')
        .lt('created_at', fiveDaysAgo.toISOString())
      
      oldReclamations?.forEach(r => {
        allIssues.push({
          category: 'qualite',
          priority: 'bloquant',
          element: r.reference,
          detail: 'Réclamation non clôturée (>5 jours)',
          link: '/qualite/reclamations',
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

  const exportPDF = () => {
    const doc = new jsPDF()
    
    // Header
    doc.setFontSize(18)
    doc.text('Rapport de Complétude', 20, 20)
    doc.setFontSize(10)
    doc.text(`Généré le ${format(new Date(), 'dd/MM/yyyy à HH:mm', { locale: fr })}`, 20, 28)
    
    // Stats
    doc.setFontSize(12)
    doc.text(`Total : ${stats.total} éléments manquants`, 20, 40)
    doc.setFontSize(10)
    doc.text(`🔴 Bloquant : ${stats.bloquant} | 🟠 Important : ${stats.important} | 🟡 Mineur : ${stats.mineur}`, 20, 47)
    
    // Table
    const tableData = filteredIssues.map(issue => [
      PRIORITIES[issue.priority].icon,
      CATEGORIES[issue.category].label,
      issue.element,
      issue.detail,
      issue.client || '-',
      issue.since ? format(new Date(issue.since), 'dd/MM/yy') : '-'
    ])
    
    doc.autoTable({
      startY: 55,
      head: [['', 'Catégorie', 'Élément', 'Détail', 'Client', 'Depuis']],
      body: tableData,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 58, 68] }
    })
    
    doc.save(`completude-${format(new Date(), 'yyyy-MM-dd')}.pdf`)
    toast.success('Export PDF téléchargé')
  }

  const completionRate = stats.total > 0 
    ? Math.round((1 - stats.total / 1000) * 100) // Approximation
    : 100

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* HEADER */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Complétude</h1>
            <p className="text-sm text-gray-600">Suivi des éléments manquants</p>
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
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-3xl font-bold text-gray-900">{completionRate}%</div>
              <div className="text-sm text-gray-600">Taux de complétude global</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-red-600">{stats.total}</div>
              <div className="text-sm text-gray-600">éléments manquants</div>
            </div>
          </div>
          
          <div className="w-full bg-gray-200 rounded-full h-4 mb-4">
            <div 
              className="bg-gradient-to-r from-blue-500 to-blue-600 h-4 rounded-full transition-all"
              style={{ width: `${completionRate}%` }}
            />
          </div>
          
          <div className="flex gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🔴</span>
              <span className="font-semibold">{stats.bloquant}</span>
              <span className="text-gray-600">Bloquant</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">🟠</span>
              <span className="font-semibold">{stats.important}</span>
              <span className="text-gray-600">Important</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">🟡</span>
              <span className="font-semibold">{stats.mineur}</span>
              <span className="text-gray-600">Mineur</span>
            </div>
          </div>
        </div>
      </div>

      {/* FILTRES */}
      <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
        <div className="flex items-center gap-4">
          <Filter className="w-5 h-5 text-gray-400" />
          
          <select 
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="input"
          >
            <option value="all">Toutes priorités</option>
            <option value="bloquant">🔴 Bloquant</option>
            <option value="important">🟠 Important</option>
            <option value="mineur">🟡 Mineur</option>
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
            <select 
              value={filterClient}
              onChange={(e) => setFilterClient(e.target.value)}
              className="input"
            >
              <option value="all">Tous clients</option>
              {clients.map(client => (
                <option key={client} value={client}>{client}</option>
              ))}
            </select>
          )}
          
          <div className="ml-auto text-sm text-gray-600">
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
            <div key={catKey} className="bg-white rounded-lg shadow-sm border overflow-hidden">
              <button
                onClick={() => toggleCategory(catKey)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg bg-${category.color}-100`}>
                    <Icon className={`w-5 h-5 text-${category.color}-600`} />
                  </div>
                  <div className="text-left">
                    <h3 className="font-semibold text-gray-900">{category.label}</h3>
                    <p className="text-sm text-gray-600">
                      {catIssues.length} élément(s) manquant(s)
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex gap-2">
                    {catIssues.filter(i => i.priority === 'bloquant').length > 0 && (
                      <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded">
                        🔴 {catIssues.filter(i => i.priority === 'bloquant').length}
                      </span>
                    )}
                    {catIssues.filter(i => i.priority === 'important').length > 0 && (
                      <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs rounded">
                        🟠 {catIssues.filter(i => i.priority === 'important').length}
                      </span>
                    )}
                    {catIssues.filter(i => i.priority === 'mineur').length > 0 && (
                      <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs rounded">
                        🟡 {catIssues.filter(i => i.priority === 'mineur').length}
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
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priorité</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Élément</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Détail</th>
                        {catIssues.some(i => i.client) && (
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                        )}
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Depuis</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
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
                          <td className="px-6 py-4 text-sm font-medium text-gray-900">
                            {issue.element}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-600">
                            {issue.detail}
                          </td>
                          {catIssues.some(i => i.client) && (
                            <td className="px-6 py-4 text-sm text-gray-600">
                              {issue.client || '-'}
                            </td>
                          )}
                          <td className="px-6 py-4 text-sm text-gray-600">
                            {issue.since ? format(new Date(issue.since), 'dd/MM/yyyy') : '-'}
                          </td>
                          <td className="px-6 py-4">
                            <a
                              href={issue.link}
                              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                              title="Corriger"
                            >
                              <ExternalLink className="w-4 h-4" />
                              <span className="opacity-0 group-hover:opacity-100 transition-opacity">
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
        <div className="text-center py-12 bg-white rounded-lg shadow-sm border">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Aucun élément manquant !
          </h3>
          <p className="text-gray-600">
            Toutes les données sont complètes 🎉
          </p>
        </div>
      )}
    </div>
  )
}
