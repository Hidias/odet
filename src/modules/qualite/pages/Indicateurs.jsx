import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDataStore, useAuthStore } from '../../../core/store'
import { supabase } from '../../../core/supabase'
import { fetchAll, fetchAllIn } from '../../../core/fetchAll'
import { 
  BarChart3, Filter, Users, Star, TrendingUp, ThumbsUp, 
  Thermometer, Clock, Building, BookOpen, UserCheck, Target,
  Send, CheckCircle, AlertTriangle, ExternalLink, MessageSquare, Plus, Info, Link2, LogOut,
  Download, PieChart, Table2
} from 'lucide-react'
import toast from 'react-hot-toast'
import SearchSelect, { clientOptions, courseOptions } from '../../../ui/SearchSelect'

const ratingColor = (value, max = 5) => {
  const percent = (value / max) * 100
  if (percent >= 80) return 'text-[rgb(var(--c-success))] bg-[rgb(var(--c-success-bg))]'
  if (percent >= 60) return 'text-[rgb(var(--c-warning))] bg-[rgb(var(--c-warning-bg))]'
  return 'text-[rgb(var(--c-danger))] bg-[rgb(var(--c-danger-bg))]'
}

const ratingBg = (value, max = 5) => {
  const percent = (value / max) * 100
  if (percent >= 80) return 'bg-[rgb(var(--c-success))]'
  if (percent >= 60) return 'bg-[rgb(var(--c-warning))]'
  return 'bg-[rgb(var(--c-danger))]'
}

export default function Indicateurs() {
  const { sessions, fetchSessions, clients, fetchClients, courses, fetchCourses } = useDataStore()
  const { user } = useAuthStore()
  const navigate = useNavigate()
  
  const [loading, setLoading] = useState(true)
  const [themes, setThemes] = useState([])
  const [traineeEvals, setTraineeEvals] = useState([])
  const [trainerEvals, setTrainerEvals] = useState([])
  const [coldEvals, setColdEvals] = useState([])
  const [traineeResults, setTraineeResults] = useState([])
  const [traineesData, setTraineesData] = useState({}) // Map trainee_id -> {csp, job_title, ...}
  
  // Alertes qualité
  const [qualityAlerts, setQualityAlerts] = useState([])
  const [nonConformites, setNonConformites] = useState([])
  const [showAlertModal, setShowAlertModal] = useState(false)
  const [selectedAlert, setSelectedAlert] = useState(null)
  const [treatmentComment, setTreatmentComment] = useState('')
  const [alertFilter, setAlertFilter] = useState('pending') // pending, treated, all
  
  // Filtres
  const [filterTheme, setFilterTheme] = useState('')
  const [filterClient, setFilterClient] = useState('')
  const [filterPeriod, setFilterPeriod] = useState('all') // all, year, quarter, month
  
  // Nouveaux filtres stats détaillées
  const [filterCSP, setFilterCSP] = useState('')
  const [filterSituation, setFilterSituation] = useState('')
  const [filterFunding, setFilterFunding] = useState('')
  const [filterCourse, setFilterCourse] = useState('')
  const [statsGroupBy, setStatsGroupBy] = useState('csp') // csp, situation, funding, client, course
  
  // Seuil RGPD : minimum de personnes pour afficher les stats
  const RGPD_THRESHOLD = 5
  
  // Données nominatives réservées aux rôles de direction
  const userRole = useAuthStore((s) => s.userRole)
  const isAdmin = ['superadmin', 'admin', 'direction'].includes(userRole)
  
  const [activeTab, setActiveTab] = useState('hot') // hot, trainer, cold, stats
  
  useEffect(() => {
    loadData()
  }, [])
  
  // Mise à jour automatique du statut des sessions terminées
  // Sessions passées « terminées » : écrites chaque nuit par la base (0376, daily_maintenance).
  
  const loadData = async () => {
    setLoading(true)
    
    // Charger TOUT en parallèle pour accélérer
    const [
      _sessions,
      _clients,
      _courses,
      themesResult,
      hotEvalsResult,
      trainerEvalsResult,
      coldEvalsResult,
      resultsResult,
      alertsResult,
      ncsResult
    ] = await Promise.all([
      fetchSessions(),
      fetchClients(),
      fetchCourses(),
      // fetchAll : pagination complète (PostgREST tronque à 1 000 lignes sans erreur)
      fetchAll(() => supabase.from('training_themes').select('*').order('position')),
      fetchAll(() => supabase.from('trainee_evaluations').select('*')),
      fetchAll(() => supabase.from('trainer_evaluations').select('*')),
      fetchAll(() => supabase.from('evaluations_cold').select('*')),
      fetchAll(() => supabase.from('session_trainees').select('session_id, trainee_id, result, presence_complete, early_departure, situation, funding_type')),
      fetchAll(() => supabase.from('quality_alerts').select('*').order('created_at', { ascending: false })),
      fetchAll(() => supabase.from('non_conformites').select('id, title, status').order('created_at', { ascending: false }))
    ])
    
    setThemes(themesResult.data || [])
    setTraineeEvals(hotEvalsResult.data || [])
    setTrainerEvals(trainerEvalsResult.data || [])
    setColdEvals(coldEvalsResult.data || [])
    setTraineeResults(resultsResult.data || [])
    setNonConformites(ncsResult.data || [])
    
    // Charger les stagiaires pour enrichissement (avec CSP et job_title)
    // Seuls les stagiaires référencés (inscriptions + alertes) sont chargés, par lots
    const neededTraineeIds = [
      ...(resultsResult.data || []).map(r => r.trainee_id),
      ...(alertsResult.data || []).map(a => a.trainee_id),
    ]
    const { data: allTrainees } = await fetchAllIn(() => supabase.from('trainees').select('id, first_name, last_name, csp, job_title'), 'id', neededTraineeIds)
    const traineesMap = {}
    ;(allTrainees || []).forEach(t => { traineesMap[t.id] = t })
    setTraineesData(traineesMap)
    
    // Charger les formateurs
    const { data: allTrainers } = await fetchAll(() => supabase.from('trainers').select('id, first_name, last_name'))
    const trainersMap = {}
    ;(allTrainers || []).forEach(t => { trainersMap[t.id] = t })
    
    // Enrichir les alertes avec les données déjà chargées
    const enrichedAlerts = (alertsResult.data || []).map(alert => {
      const session = sessions.find(s => s.id === alert.session_id)
      return {
        ...alert,
        sessions: session ? {
          ...session,
          trainer: session.trainer_id ? trainersMap[session.trainer_id] : null
        } : null,
        trainees: traineesMap[alert.trainee_id] || null
      }
    })
    setQualityAlerts(enrichedAlerts)
    
    // Afficher la page IMMÉDIATEMENT
    setLoading(false)
    
    // Alertes sur les notes basses : créées chaque nuit par la base (0376, daily_maintenance)
  }
  
  
  // Helper pour recharger les alertes
  const reloadAlerts = async () => {
    const { data: updatedAlerts } = await fetchAll(() => supabase
      .from('quality_alerts')
      .select('*')
      .order('created_at', { ascending: false }))
    
    if (updatedAlerts) {
      // Charger les stagiaires et formateurs pour enrichissement
      // Seuls les stagiaires cités dans les alertes sont chargés, par lots
      const { data: allTrainees } = await fetchAllIn(() => supabase.from('trainees').select('id, first_name, last_name'), 'id', updatedAlerts.map(a => a.trainee_id))
      const traineesMap = {}
      ;(allTrainees || []).forEach(t => { traineesMap[t.id] = t })
      
      const { data: allTrainers } = await fetchAll(() => supabase.from('trainers').select('id, first_name, last_name'))
      const trainersMap = {}
      ;(allTrainers || []).forEach(t => { trainersMap[t.id] = t })
      
      // Enrichir avec les sessions du store
      const enriched = updatedAlerts.map(alert => {
        const session = sessions.find(s => s.id === alert.session_id)
        return {
          ...alert,
          sessions: session ? {
            ...session,
            trainer: session.trainer_id ? trainersMap[session.trainer_id] : null
          } : null,
          trainees: traineesMap[alert.trainee_id] || null
        }
      })
      setQualityAlerts(enriched)
    }
  }
  
  // Traiter une alerte
  const handleTreatAlert = async () => {
    if (!selectedAlert || !treatmentComment.trim()) {
      toast.error('Veuillez saisir un commentaire')
      return
    }
    
    const { error } = await supabase
      .from('quality_alerts')
      .update({
        status: 'treated',
        treated_at: new Date().toISOString(),
        treated_by: 'Utilisateur', // TODO: récupérer l'utilisateur connecté
        treatment_comment: treatmentComment,
        updated_at: new Date().toISOString()
      })
      .eq('id', selectedAlert.id)
    
    if (error) {
      toast.error('Erreur lors du traitement')
      return
    }
    
    toast.success('Alerte traitée')
    setShowAlertModal(false)
    setSelectedAlert(null)
    setTreatmentComment('')
    
    await reloadAlerts()
  }
  
  // Créer une non-conformité depuis une alerte
  const handleCreateNC = async (alert) => {
    try {
      // Récupérer les infos enrichies
      const sessionRef = alert.sessions?.reference || 'N/A'
      const courseName = alert.sessions?.courses?.name || alert.sessions?.course?.name || ''
      const sessionDate = alert.sessions?.start_date ? new Date(alert.sessions.start_date).toLocaleDateString('fr-FR') : ''
      const trainerName = alert.sessions?.trainer ? `${alert.sessions.trainer.first_name || ''} ${alert.sessions.trainer.last_name || ''}`.trim() : ''
      const traineeName = alert.trainees ? `${alert.trainees.first_name || ''} ${alert.trainees.last_name || ''}`.trim() : ''
      
      const ncData = {
        title: `Note basse: ${alert.criterion_label} (${alert.score}/5)`,
        description: `Alerte qualité détectée automatiquement.\n\nSession: ${sessionRef} - ${courseName}\nDate: ${sessionDate}\nFormateur: ${trainerName}\nStagiaire: ${traineeName}\n\nCritère: ${alert.criterion_label}\nNote: ${alert.score}/5`,
        source: 'evaluation',
        session_id: alert.session_id || null,
        critere_qualiopi: '32',
        severity: alert.score === 1 ? 'major' : 'minor',
        status: 'open',
        cause_analysis: '',
        corrective_action: '',
        action_responsible: '',
        action_deadline: null,
        preventive_action: ''
      }
      
      console.log('Création NC avec données:', ncData)
      
      const { data: nc, error: insertError } = await supabase
        .from('non_conformites')
        .insert([ncData])
        .select()
        .single()
      
      if (insertError) {
        console.error('Erreur création NC:', insertError)
        toast.error(`Erreur création NC: ${insertError.message}`)
        return
      }
      
      console.log('NC créée:', nc.id)
      
      // Mettre à jour l'alerte avec le lien vers la NC
      const { error: updateError } = await supabase
        .from('quality_alerts')
        .update({
          status: 'nc_created',
          non_conformite_id: nc.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', alert.id)
      
      if (updateError) {
        console.error('Erreur update alerte:', updateError)
        toast.error(`NC créée mais erreur liaison: ${updateError.message}`)
      } else {
        console.log('Alerte liée à NC:', alert.id, '→', nc.id)
        toast.success(`Non-conformité créée: ${nc.title}`)
      }
      
      await reloadAlerts()
    } catch (err) {
      console.error('Erreur inattendue handleCreateNC:', err)
      toast.error(`Erreur inattendue: ${err.message}`)
    }
  }
  
  // Lier une alerte à une NC existante
  const handleLinkNC = async (alert, ncId) => {
    const { error } = await supabase
      .from('quality_alerts')
      .update({
        status: 'nc_linked',
        non_conformite_id: ncId,
        updated_at: new Date().toISOString()
      })
      .eq('id', alert.id)
    
    if (error) {
      toast.error('Erreur lors du lien')
      return
    }
    
    toast.success('Alerte liée à la non-conformité')
    
    await reloadAlerts()
  }
  
  // Filtrer les sessions selon les critères
  const getFilteredSessions = () => {
    let filtered = sessions.filter(s => s.status === 'completed')
    
    if (filterTheme) {
      filtered = filtered.filter(s => s.courses?.theme_id === filterTheme)
    }
    if (filterClient) {
      filtered = filtered.filter(s => s.client_id === filterClient)
    }
    if (filterPeriod !== 'all') {
      const now = new Date()
      let startDate
      if (filterPeriod === 'year') {
        startDate = new Date(now.getFullYear(), 0, 1)
      } else if (filterPeriod === 'quarter') {
        const quarter = Math.floor(now.getMonth() / 3)
        startDate = new Date(now.getFullYear(), quarter * 3, 1)
      } else if (filterPeriod === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      }
      filtered = filtered.filter(s => new Date(s.end_date) >= startDate)
    }
    
    return filtered
  }
  
  const filteredSessions = getFilteredSessions()
  const filteredSessionIds = filteredSessions.map(s => s.id)
  
  // Évaluations à chaud filtrées (exclure les absents)
  const filteredHotEvals = traineeEvals.filter(e => {
    if (!filteredSessionIds.includes(e.session_id)) return false
    
    // Vérifier que le stagiaire est formé (présent ou départ anticipé)
    const traineeResult = traineeResults.find(r => 
      r.session_id === e.session_id && 
      r.trainee_id === e.trainee_id
    )
    
    // DEBUG
    if (e.session_id === '9bdd3c72-1cea-494a-a406-e7089b0b602e') {
      console.log('Eval found for session MK2TZI7S:', {
        trainee_id: e.trainee_id,
        traineeResult: traineeResult,
        presence_complete: traineeResult?.presence_complete,
        early_departure: traineeResult?.early_departure,
        will_keep: traineeResult && (traineeResult.presence_complete === true || traineeResult.early_departure === true)
      })
    }
    
    return traineeResult && (traineeResult.presence_complete === true || traineeResult.early_departure === true)
  })
  
  console.log('Indicateurs - Évaluations filtrées:', {
    total_hot_evals: traineeEvals.length,
    filtered_hot_evals: filteredHotEvals.length,
    total_trainee_results: traineeResults.length
  })
  
  // Évaluations formateur filtrées
  const filteredTrainerEvals = trainerEvals.filter(e => filteredSessionIds.includes(e.session_id))
  
  // Évaluations à froid filtrées (exclure les absents)
  const filteredColdEvals = coldEvals.filter(e => {
    if (!filteredSessionIds.includes(e.session_id)) return false
    
    // Vérifier que le stagiaire est formé (présent ou départ anticipé)
    const traineeResult = traineeResults.find(r => 
      r.session_id === e.session_id && 
      r.trainee_id === e.trainee_id
    )
    return traineeResult && (traineeResult.presence_complete === true || traineeResult.early_departure === true)
  })
  
  // Calcul des moyennes pour évaluations à chaud (qualité complet)
  const calcHotStats = () => {
    if (filteredHotEvals.length === 0) return null
    
    // Critères qualité - utilise UNIQUEMENT les nouvelles colonnes (saisie manuelle)
    const criteriaGroups = [
      { 
        label: 'Organisation et accueil', 
        keys: ['q_org_accueil', 'q_org_documents', 'q_org_locaux', 'q_org_materiel'] 
      },
      { 
        label: 'Contenu et supports', 
        keys: ['q_contenu_supports', 'q_contenu_programme', 'q_contenu_organisation', 'q_contenu_duree'] 
      },
      { 
        label: 'Formateur / Pédagogie', 
        keys: ['q_formateur_pedagogie', 'q_formateur_expertise', 'q_formateur_progression', 'q_formateur_moyens'] 
      },
      { 
        label: 'Adéquation et compétences', 
        keys: ['q_global_adequation', 'q_global_competences'] 
      },
    ]
    
    // Calculer la moyenne pour chaque groupe
    const stats = criteriaGroups.map(group => {
      const allValues = []
      filteredHotEvals.forEach(e => {
        group.keys.forEach(key => {
          if (e[key] !== null && e[key] !== undefined && !isNaN(e[key])) {
            allValues.push(Number(e[key]))
          }
        })
      })
      const avg = allValues.length > 0 ? allValues.reduce((a, b) => a + b, 0) / allValues.length : 0
      return { label: group.label, avg: avg.toFixed(1), count: allValues.length }
    })
    
    // Calculer la satisfaction globale (moyenne de TOUTES les nouvelles colonnes uniquement)
    const allScores = []
    filteredHotEvals.forEach(e => {
      const newKeys = [
        'q_org_accueil', 'q_org_documents', 'q_org_locaux', 'q_org_materiel',
        'q_contenu_supports', 'q_contenu_programme', 'q_contenu_organisation', 'q_contenu_duree',
        'q_formateur_pedagogie', 'q_formateur_expertise', 'q_formateur_progression', 'q_formateur_moyens',
        'q_global_adequation', 'q_global_competences'
      ]
      newKeys.forEach(key => {
        if (e[key] !== null && e[key] !== undefined && !isNaN(e[key])) {
          allScores.push(Number(e[key]))
        }
      })
    })
    const globalAvg = allScores.length > 0 ? (allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(2) : '0'
    
    // Taux de recommandation
    const evalsWithRecommend = filteredHotEvals.filter(e => e.would_recommend !== null && e.would_recommend !== undefined)
    const recommendCount = evalsWithRecommend.filter(e => e.would_recommend === true).length
    const recommendRate = evalsWithRecommend.length > 0 
      ? (recommendCount / evalsWithRecommend.length * 100).toFixed(0)
      : 0
    
    // Évaluations avec au moins une réponse (nouvelles colonnes)
    const evalsWithData = filteredHotEvals.filter(e => 
      e.q_org_accueil !== null ||
      e.q_formateur_pedagogie !== null ||
      e.q_global_adequation !== null
    )
    const questionnaireRate = filteredHotEvals.length > 0
      ? (evalsWithData.length / filteredHotEvals.length * 100).toFixed(0)
      : 0
    
    return { 
      stats,
      globalAvg,
      recommendRate, 
      questionnaireRate,
      totalWithResponse: evalsWithData.length,
      total: filteredHotEvals.length 
    }
  }
  
  // Calcul des moyennes pour évaluations formateur
  const calcTrainerStats = () => {
    if (filteredTrainerEvals.length === 0) return null
    
    const questions = [
      { key: 'group_motivation', label: 'Motivation du groupe' },
      { key: 'group_level', label: 'Niveau des stagiaires' },
      { key: 'material_conditions', label: 'Conditions matérielles' },
      { key: 'organization', label: 'Organisation' },
      { key: 'documentation', label: 'Documentation fournie' },
      { key: 'overall_score', label: 'Appréciation globale' },
    ]
    
    const stats = questions.map(q => {
      const values = filteredTrainerEvals.map(e => e[q.key]).filter(v => v !== null && v !== undefined)
      const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
      return { ...q, avg: avg.toFixed(1), count: values.length }
    })
    
    const objectivesValues = filteredTrainerEvals.map(e => e.objectives_achieved).filter(v => v !== null)
    const avgObjectives = objectivesValues.length > 0 
      ? (objectivesValues.reduce((a, b) => a + b, 0) / objectivesValues.length).toFixed(0)
      : 0
    
    return { stats, avgObjectives, total: filteredTrainerEvals.length }
  }
  
  // Calcul des taux pour évaluations à froid (5=Oui, 1=Non)
  const calcColdStats = () => {
    // Total stagiaires FORMÉS des sessions terminées (base pour le taux d'envoi)
    const completedSessionIds = filteredSessions.filter(s => s.status === 'completed').map(s => s.id)
    const totalTraineesInCompleted = traineeResults.filter(r => 
      completedSessionIds.includes(r.session_id) &&
      (r.presence_complete === true || r.early_departure === true)
    ).length
    
    if (totalTraineesInCompleted === 0) return null
    
    // Évaluations à froid des sessions filtrées
    const coldEvalsFiltered = coldEvals.filter(e => completedSessionIds.includes(e.session_id))
    
    // Taux d'envoi : combien ont été envoyées / total stagiaires formés
    const sentCount = coldEvalsFiltered.filter(e => e.sent_at).length
    const sendRate = (sentCount / totalTraineesInCompleted * 100).toFixed(0)
    
    // Taux de retour : combien reçues / envoyées
    const receivedCount = coldEvalsFiltered.filter(e => e.sent_at && e.completed_at).length
    const returnRate = sentCount > 0 ? (receivedCount / sentCount * 100).toFixed(0) : 0
    
    // Stats de satisfaction (uniquement sur les reçues)
    const receivedEvals = coldEvalsFiltered.filter(e => e.completed_at)
    
    const questions = [
      { key: 'skills_applied', label: 'Compétences mises en pratique' },
      { key: 'objectives_met', label: 'Objectifs atteints' },
      { key: 'knowledge_retained', label: 'Besoins satisfaits' },
      { key: 'job_impact', label: 'Amélioration du travail' },
    ]
    
    const stats = questions.map(q => {
      const responses = receivedEvals.filter(e => e[q.key] !== null && e[q.key] !== undefined)
      const yesCount = responses.filter(e => e[q.key] === 5 || e[q.key] === true).length
      const rate = responses.length > 0 ? (yesCount / responses.length * 100).toFixed(0) : 0
      return { ...q, rate, yesCount, count: responses.length }
    })
    
    // Recommandation (uniquement sur les reçues)
    const recommendCount = receivedEvals.filter(e => e.would_recommend === true).length
    const recommendResponses = receivedEvals.filter(e => e.would_recommend !== null && e.would_recommend !== undefined).length
    const recommendRate = recommendResponses > 0 
      ? (recommendCount / recommendResponses * 100).toFixed(0)
      : 0
    
    return { 
      stats, 
      recommendRate, 
      sendRate, 
      returnRate, 
      totalTrainees: totalTraineesInCompleted,
      sentCount,
      receivedCount,
      total: receivedEvals.length 
    }
  }
  
  // Calcul du taux de réussite (Acquis/Non acquis)
  const calcSuccessRate = () => {
    const completedSessionIds = filteredSessions.filter(s => s.status === 'completed').map(s => s.id)
    const filteredResults = traineeResults.filter(r => completedSessionIds.includes(r.session_id) && r.result)
    
    if (filteredResults.length === 0) return null
    
    const acquiredCount = filteredResults.filter(r => r.result === 'acquired').length
    const rate = (acquiredCount / filteredResults.length * 100).toFixed(0)
    
    return { rate, acquired: acquiredCount, total: filteredResults.length }
  }
  
  // Calcul du taux de présence (basé sur tous les inscrits vs présents)
  const calcPresenceRate = () => {
    const completedSessionIds = filteredSessions.filter(s => s.status === 'completed').map(s => s.id)
    
    // Base = TOUS les inscrits dans les sessions terminées (y compris absents)
    const allTraineesInCompleted = traineeResults.filter(r => 
      completedSessionIds.includes(r.session_id)
    )
    
    if (allTraineesInCompleted.length === 0) return null
    
    // Présents = ceux qui sont venus (presence_complete OU early_departure)
    const presentCount = allTraineesInCompleted.filter(r => 
      r.presence_complete === true || r.early_departure === true
    ).length
    
    const rate = (presentCount / allTraineesInCompleted.length * 100).toFixed(0)
    
    return { rate, present: presentCount, total: allTraineesInCompleted.length }
  }
  
  // Calcul du taux d'abandon (basé sur early_departure)
  const calcAbandonRate = () => {
    const completedSessionIds = filteredSessions.filter(s => s.status === 'completed').map(s => s.id)
    // Base = stagiaires formés (presence_complete OU early_departure)
    const traineesFormed = traineeResults.filter(r => 
      completedSessionIds.includes(r.session_id) &&
      (r.presence_complete === true || r.early_departure === true)
    )
    
    if (traineesFormed.length === 0) return null
    
    const abandonCount = traineesFormed.filter(r => r.early_departure === true).length
    const rate = (abandonCount / traineesFormed.length * 100).toFixed(0)
    
    return { rate, abandoned: abandonCount, total: traineesFormed.length }
  }
  
  // Calcul du taux de recommandation global
  const calcGlobalRecommendRate = () => {
    const withResponse = filteredHotEvals.filter(e => e.would_recommend !== null && e.would_recommend !== undefined)
    if (withResponse.length === 0) return null
    
    const recommendCount = withResponse.filter(e => e.would_recommend === true).length
    const rate = (recommendCount / withResponse.length * 100).toFixed(0)
    
    return { rate, recommended: recommendCount, total: withResponse.length }
  }
  
  // Calcul du nombre total de stagiaires formés (présence_complete OU early_departure)
  const calcTotalTrainees = () => {
    const completedSessionIds = filteredSessions.filter(s => s.status === 'completed').map(s => s.id)
    const traineesInCompleted = traineeResults.filter(r => 
      completedSessionIds.includes(r.session_id) &&
      (r.presence_complete === true || r.early_departure === true)
    )
    return traineesInCompleted.length
  }
  
  // =====================================================
  // STATS GROUPÉES RGPD-FRIENDLY
  // =====================================================
  
  // Liste des CSP INSEE
  const cspOptions = [
    { value: 'agriculteurs', label: 'Agriculteurs exploitants' },
    { value: 'artisans', label: 'Artisans, commerçants, chefs d\'entreprise' },
    { value: 'cadres', label: 'Cadres et professions intellectuelles supérieures' },
    { value: 'professions_inter', label: 'Professions intermédiaires' },
    { value: 'employes', label: 'Employés' },
    { value: 'ouvriers', label: 'Ouvriers' },
    { value: 'retraites', label: 'Retraités' },
    { value: 'sans_activite', label: 'Autres sans activité professionnelle' }
  ]
  
  // Liste des situations
  const situationOptions = [
    { value: 'cdi', label: 'CDI' },
    { value: 'cdd', label: 'CDD' },
    { value: 'interim', label: 'Intérim' },
    { value: 'independant', label: 'Indépendant / Auto-entrepreneur' },
    { value: 'demandeur_emploi', label: 'Demandeur d\'emploi' },
    { value: 'etudiant', label: 'Étudiant' },
    { value: 'retraite', label: 'Retraité' },
    { value: 'autre', label: 'Autre' }
  ]
  
  // Liste des types de financement
  const fundingOptions = [
    { value: 'opco', label: 'OPCO' },
    { value: 'cpf', label: 'CPF' },
    { value: 'employeur', label: 'Plan de formation employeur' },
    { value: 'pole_emploi', label: 'Pôle Emploi / France Travail' },
    { value: 'region', label: 'Région / Collectivité' },
    { value: 'personnel', label: 'Financement personnel' },
    { value: 'autre', label: 'Autre' }
  ]
  
  // Fonction pour calculer les stats d'un groupe
  // Fonction pour calculer les stats groupées par critère
  const calcGroupedStats = () => {
    const completedSessionIds = filteredSessions.map(s => s.id)
    const relevantResults = traineeResults.filter(r => completedSessionIds.includes(r.session_id))
    
    // Construire la liste enrichie des participations avec leurs données
    let enrichedResults = relevantResults.map(r => {
      const trainee = traineesData[r.trainee_id] || {}
      const session = sessions.find(s => s.id === r.session_id)
      return {
        ...r,
        csp: trainee.csp || 'non_renseigne',
        situation: r.situation || 'non_renseigne',
        funding_type: r.funding_type || 'non_renseigne',
        client_id: session?.client_id,
        course_id: session?.course_id
      }
    })
    
    // Appliquer les filtres sélectionnés
    if (filterCSP) {
      enrichedResults = enrichedResults.filter(r => r.csp === filterCSP)
    }
    if (filterSituation) {
      enrichedResults = enrichedResults.filter(r => r.situation === filterSituation)
    }
    if (filterFunding) {
      enrichedResults = enrichedResults.filter(r => r.funding_type === filterFunding)
    }
    if (filterCourse) {
      enrichedResults = enrichedResults.filter(r => r.course_id === filterCourse)
    }
    
    // Grouper selon le critère sélectionné
    const groups = {}
    
    enrichedResults.forEach(r => {
      let key
      switch (statsGroupBy) {
        case 'csp':
          key = r.csp
          break
        case 'situation':
          key = r.situation
          break
        case 'funding':
          key = r.funding_type
          break
        case 'client':
          key = r.client_id || 'non_renseigne'
          break
        case 'course':
          key = r.course_id || 'non_renseigne'
          break
        default:
          key = 'all'
      }
      
      if (!groups[key]) groups[key] = []
      // Stocker la participation complète (pas juste trainee_id)
      groups[key].push(r)
    })
    
    // Calculer les stats pour chaque groupe
    const results = []
    Object.entries(groups).forEach(([key, participations]) => {
      // Compter les personnes uniques pour le seuil RGPD
      const uniqueTraineeIds = [...new Set(participations.map(p => p.trainee_id))]
      const nbPersonnesUniques = uniqueTraineeIds.length
      
      // Nombre de participations (peut être > nombre de personnes)
      const nbParticipations = participations.length
      
      // Calculer les KPIs sur les participations
      const withResult = participations.filter(p => p.result)
      const nbAcquis = withResult.filter(p => p.result === 'acquired').length
      const tauxReussite = withResult.length > 0 ? (nbAcquis / withResult.length * 100).toFixed(0) : null
      
      const nbPresenceComplete = participations.filter(p => p.presence_complete === true).length
      const tauxPresence = (nbPresenceComplete / participations.length * 100).toFixed(0)
      
      const nbAbandon = participations.filter(p => p.early_departure === true).length
      const tauxAbandon = (nbAbandon / participations.length * 100).toFixed(0)
      
      // Créer un Set des paires session_id|trainee_id pour filtrage précis
      const participationKeys = new Set(participations.map(p => `${p.session_id}|${p.trainee_id}`))
      
      // Satisfaction (moyenne des évaluations à chaud) - filtrée par session_id ET trainee_id
      const groupEvals = filteredHotEvals.filter(e => participationKeys.has(`${e.session_id}|${e.trainee_id}`))
      let satisfaction = null
      if (groupEvals.length > 0) {
        const scores = groupEvals.map(e => {
          const vals = [
            e.q_contenu_conformite, e.q_contenu_qualite, e.q_contenu_rythme,
            e.q_formateur_pedagogue, e.q_formateur_maitrise, e.q_formateur_disponible
          ].filter(v => v !== null && v !== undefined)
          return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
        }).filter(s => s !== null)
        if (scores.length > 0) {
          satisfaction = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
        }
      }
      
      // Taux de recommandation - filtrée par session_id ET trainee_id
      const groupRecommend = groupEvals.filter(e => e.would_recommend !== null && e.would_recommend !== undefined)
      const nbRecommend = groupRecommend.filter(e => e.would_recommend === true).length
      const tauxRecommandation = groupRecommend.length > 0 ? (nbRecommend / groupRecommend.length * 100).toFixed(0) : null
      
      // Trouver le label du groupe
      let label = key
      if (statsGroupBy === 'csp') {
        label = cspOptions.find(o => o.value === key)?.label || key
      } else if (statsGroupBy === 'situation') {
        label = situationOptions.find(o => o.value === key)?.label || key
      } else if (statsGroupBy === 'funding') {
        label = fundingOptions.find(o => o.value === key)?.label || key
      } else if (statsGroupBy === 'client') {
        label = clients.find(c => c.id === key)?.name || 'Non renseigné'
      } else if (statsGroupBy === 'course') {
        label = courses.find(c => c.id === key)?.title || 'Non renseigné'
      }
      
      if (label === 'non_renseigne') label = 'Non renseigné'
      
      results.push({
        key,
        label,
        nbFormes: nbParticipations,
        nbPersonnes: nbPersonnesUniques,
        tauxReussite,
        tauxPresence,
        tauxAbandon,
        satisfaction,
        tauxRecommandation,
        nbEvals: groupEvals.length,
        // RGPD : masquer si moins de 5 personnes UNIQUES
        isRGPDHidden: nbPersonnesUniques < RGPD_THRESHOLD
      })
    })
    
    // Trier par nombre de participations décroissant
    return results.sort((a, b) => b.nbFormes - a.nbFormes)
  }
  
  // Export CSV des stats groupées
  const exportStatsCSV = () => {
    const stats = calcGroupedStats()
    const headers = ['Groupe', 'Participations', 'Personnes uniques', 'Taux réussite (%)', 'Taux présence (%)', 'Taux abandon (%)', 'Satisfaction (/5)', 'Taux recommandation (%)']
    
    const rows = stats.map(s => {
      if (s.isRGPDHidden) {
        return [s.label, `<${RGPD_THRESHOLD}`, `<${RGPD_THRESHOLD}`, '-', '-', '-', '-', '-']
      }
      return [
        s.label,
        s.nbFormes,
        s.nbPersonnes,
        s.tauxReussite || '-',
        s.tauxPresence || '-',
        s.tauxAbandon || '-',
        s.satisfaction || '-',
        s.tauxRecommandation || '-'
      ]
    })
    
    const csv = [headers, ...rows].map(row => row.join(';')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `stats_${statsGroupBy}_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Export CSV téléchargé')
  }
  
  const hotStats = calcHotStats()
  const trainerStats = calcTrainerStats()
  const coldStats = calcColdStats()
  const successRate = calcSuccessRate()
  const presenceRate = calcPresenceRate()
  const abandonRate = calcAbandonRate()
  const globalRecommendRate = calcGlobalRecommendRate()
  const totalTrainees = calcTotalTrainees()
  
  // Calcul note globale (basé sur évaluations à chaud et formateur uniquement - PAS à froid)
  const globalScore = () => {
    let total = 0, count = 0
    // Utiliser globalAvg de hotStats (moyenne réelle non arrondie)
    if (hotStats && hotStats.globalAvg && parseFloat(hotStats.globalAvg) > 0) {
      total += parseFloat(hotStats.globalAvg)
      count++
    }
    if (trainerStats && trainerStats.stats && trainerStats.stats.length > 0) {
      const avgAll = trainerStats.stats.reduce((acc, s) => acc + parseFloat(s.avg), 0) / trainerStats.stats.length
      if (avgAll > 0) { total += avgAll; count++ }
    }
    return count > 0 ? (total / count).toFixed(2) : '-'
  }
  
  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="loading loading-lg"></div></div>
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-primary" />
            Indicateurs de Résultats
          </h1>
          <p className="text-gray-600 mt-1">Synthèse des évaluations et indicateurs qualité</p>
        </div>
      </div>
      
      {/* Filtres */}
      <div className="card bg-white p-4">
        <div className="flex flex-wrap gap-4 items-center">
          <Filter className="w-5 h-5 text-gray-500" />
          
          <select 
            className="input input-sm w-48"
            value={filterTheme}
            onChange={(e) => setFilterTheme(e.target.value)}
          >
            <option value="">Tous les thèmes</option>
            {themes.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          
          <SearchSelect
            className="w-56"
            value={filterClient}
            onChange={(v) => setFilterClient(v)}
            options={clientOptions(clients, { excludeArchived: false })}
            emptyLabel="Tous les clients" searchPlaceholder="Rechercher un client..." aria-label="Filtrer par client" />
          
          <select 
            className="input input-sm w-40"
            value={filterPeriod}
            onChange={(e) => setFilterPeriod(e.target.value)}
          >
            <option value="all">Toute période</option>
            <option value="year">Cette année</option>
            <option value="quarter">Ce trimestre</option>
            <option value="month">Ce mois</option>
          </select>
          
          <span className="text-ui text-gray-500">
            {filteredSessions.length} session(s) • {totalTrainees} stagiaires • {filteredHotEvals.length} éval. à chaud ({totalTrainees > 0 ? Math.round(filteredHotEvals.length / totalTrainees * 100) : 0}%) • {coldStats ? `${coldStats.sentCount} éval. à froid envoyées (${coldStats.sendRate}%)` : '0 éval. à froid'}
          </span>
        </div>
      </div>
      
      {/* KPIs principaux */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className={`card p-4 ${ratingColor(parseFloat(globalScore()) || 0)}`}>
          <div className="flex items-center gap-3">
            <Star className="w-8 h-8" />
            <div>
              <p className="text-ui font-medium">Score Global</p>
              <p className="text-3xl font-bold">{globalScore()}/5</p>
            </div>
          </div>
        </div>
        
        <div className={`card p-4 ${successRate ? (parseInt(successRate.rate) >= 80 ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : parseInt(successRate.rate) >= 60 ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]') : 'bg-gray-100 text-gray-500'}`}>
          <div className="flex items-center gap-3">
            <Target className="w-8 h-8" />
            <div>
              <p className="text-ui font-medium">Taux de réussite</p>
              <p className="text-3xl font-bold">{successRate ? `${successRate.rate}%` : '-'}</p>
              {successRate && <p className="text-ui-sm">{successRate.acquired}/{successRate.total} acquis</p>}
            </div>
          </div>
        </div>
        
        <div className={`card p-4 ${presenceRate ? (parseInt(presenceRate.rate) >= 80 ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : parseInt(presenceRate.rate) >= 60 ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]') : 'bg-gray-100 text-gray-500'}`}>
          <div className="flex items-center gap-3">
            <UserCheck className="w-8 h-8" />
            <div>
              <p className="text-ui font-medium">Taux de présence</p>
              <p className="text-3xl font-bold">{presenceRate ? `${presenceRate.rate}%` : '-'}</p>
              {presenceRate && <p className="text-ui-sm">{presenceRate.present}/{presenceRate.total} complet</p>}
            </div>
          </div>
        </div>
        
        <div className={`card p-4 ${abandonRate ? (parseInt(abandonRate.rate) <= 5 ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : parseInt(abandonRate.rate) <= 15 ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]') : 'bg-gray-100 text-gray-500'}`}>
          <div className="flex items-center gap-3">
            <LogOut className="w-8 h-8" />
            <div>
              <p className="text-ui font-medium">Taux d'abandon</p>
              <p className="text-3xl font-bold">{abandonRate ? `${abandonRate.rate}%` : '-'}</p>
              {abandonRate && <p className="text-ui-sm">{abandonRate.abandoned}/{abandonRate.total} abandons</p>}
            </div>
          </div>
        </div>
        
        <div className={`card p-4 ${globalRecommendRate ? (parseInt(globalRecommendRate.rate) >= 80 ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : parseInt(globalRecommendRate.rate) >= 60 ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]') : 'bg-gray-100 text-gray-500'}`}>
          <div className="flex items-center gap-3">
            <ThumbsUp className="w-8 h-8" />
            <div>
              <p className="text-ui font-medium">Taux de recommandation</p>
              <p className="text-3xl font-bold">{globalRecommendRate ? `${globalRecommendRate.rate}%` : '-'}</p>
              {globalRecommendRate && <p className="text-ui-sm">{globalRecommendRate.recommended}/{globalRecommendRate.total} recommandent</p>}
            </div>
          </div>
        </div>
      </div>
      
      {/* Compteurs d'évaluations */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card bg-white p-4">
          <div className="flex items-center gap-3">
            <Thermometer className="w-8 h-8 text-[rgb(var(--c-warning))]" />
            <div>
              <p className="text-ui text-gray-600">Éval. à chaud</p>
              <p className="text-2xl font-bold">{filteredHotEvals.length}</p>
            </div>
          </div>
        </div>
        
        <div className="card bg-white p-4">
          <div className="flex items-center gap-3">
            <Users className="w-8 h-8 text-[rgb(var(--c-info))]" />
            <div>
              <p className="text-ui text-gray-600">Éval. formateur</p>
              <p className="text-2xl font-bold">{filteredTrainerEvals.length}</p>
            </div>
          </div>
        </div>
        
        <div className="card bg-white p-4">
          <div className="flex items-center gap-3">
            <Clock className="w-8 h-8 text-gray-800" />
            <div>
              <p className="text-ui text-gray-600">Éval. à froid</p>
              <p className="text-2xl font-bold">
                {coldStats ? coldStats.sentCount : 0}
                <span className="text-ui font-normal text-gray-500 ml-1">
                  envoyées
                </span>
              </p>
              {coldStats && coldStats.receivedCount > 0 && (
                <p className="text-ui-sm text-[rgb(var(--c-success))]">{coldStats.receivedCount} reçues</p>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Tabs */}
      <div className="flex gap-2 border-b">
        <button 
          onClick={() => setActiveTab('hot')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${activeTab === 'hot' ? 'border-[rgb(var(--c-warning)/0.3)] text-[rgb(var(--c-warning))]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <Thermometer className="w-4 h-4 inline mr-2" />
          À chaud ({filteredHotEvals.length})
        </button>
        <button 
          onClick={() => setActiveTab('trainer')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${activeTab === 'trainer' ? 'border-[rgb(var(--c-info)/0.3)] text-[rgb(var(--c-info))]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <UserCheck className="w-4 h-4 inline mr-2" />
          Formateur ({filteredTrainerEvals.length})
        </button>
        <button 
          onClick={() => setActiveTab('cold')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${activeTab === 'cold' ? 'border-gray-400 text-gray-800' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <Clock className="w-4 h-4 inline mr-2" />
          À froid ({coldStats ? `${coldStats.sentCount}/${coldStats.totalTrainees}` : '0'})
        </button>
        {isAdmin && (
          <button 
            onClick={() => setActiveTab('stats')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${activeTab === 'stats' ? 'border-gray-400 text-gray-800' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <PieChart className="w-4 h-4 inline mr-2" />
            Stats détaillées
          </button>
        )}
      </div>
      
      {/* Contenu des tabs */}
      <div className="card bg-white p-6">
        {/* Évaluations à chaud */}
        {activeTab === 'hot' && (
          <div>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Thermometer className="w-5 h-5 text-[rgb(var(--c-warning))]" />
              Évaluations à chaud (stagiaires) - Critères qualité
            </h3>
            
            {!hotStats ? (
              <p className="text-gray-500 text-center py-8">Aucune évaluation à chaud pour les critères sélectionnés</p>
            ) : (
              <div className="space-y-6">
                {/* Critères qualité */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {hotStats.stats.map((stat, idx) => (
                    <div key={idx} className="flex items-center gap-4">
                      <div className="flex-1">
                        <div className="flex justify-between mb-1">
                          <span className="text-ui font-medium">{stat.label}</span>
                          <span className={`text-ui font-bold px-2 py-0.5 rounded ${ratingColor(parseFloat(stat.avg))}`}>
                            {stat.avg}/5
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${ratingBg(parseFloat(stat.avg))}`}
                            style={{ width: `${(parseFloat(stat.avg) / 5) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Taux */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t pt-4">
                  {/* Taux de questionnaires reçus */}
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="flex justify-between mb-1">
                        <span className="text-ui font-medium">Questionnaires reçus</span>
                        <span className={`text-ui font-bold px-2 py-0.5 rounded ${parseInt(hotStats.questionnaireRate) >= 80 ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : parseInt(hotStats.questionnaireRate) >= 60 ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]'}`}>
                          {hotStats.questionnaireRate}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${parseInt(hotStats.questionnaireRate) >= 80 ? 'bg-[rgb(var(--c-success))]' : parseInt(hotStats.questionnaireRate) >= 60 ? 'bg-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-danger))]'}`}
                          style={{ width: `${hotStats.questionnaireRate}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  
                  {/* Taux de recommandation */}
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="flex justify-between mb-1">
                        <span className="text-ui font-medium">Taux de recommandation</span>
                        <span className={`text-ui font-bold px-2 py-0.5 rounded ${parseInt(hotStats.recommendRate) >= 80 ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : parseInt(hotStats.recommendRate) >= 60 ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]'}`}>
                          {hotStats.recommendRate}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${parseInt(hotStats.recommendRate) >= 80 ? 'bg-[rgb(var(--c-success))]' : parseInt(hotStats.recommendRate) >= 60 ? 'bg-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-danger))]'}`}
                          style={{ width: `${hotStats.recommendRate}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="text-ui text-gray-500 text-center">
                  {hotStats.totalWithResponse} questionnaire(s) reçu(s) sur {hotStats.total} stagiaire(s)
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Évaluations formateur */}
        {activeTab === 'trainer' && (
          <div>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-[rgb(var(--c-info))]" />
              Évaluations formateur
            </h3>
            
            {!trainerStats ? (
              <p className="text-gray-500 text-center py-8">Aucune évaluation formateur pour les critères sélectionnés</p>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {trainerStats.stats.map((stat, idx) => (
                    <div key={idx} className="flex items-center gap-4">
                      <div className="flex-1">
                        <div className="flex justify-between mb-1">
                          <span className="text-ui font-medium">{stat.label}</span>
                          <span className={`text-ui font-bold px-2 py-0.5 rounded ${ratingColor(parseFloat(stat.avg))}`}>
                            {stat.avg}/5
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${ratingBg(parseFloat(stat.avg))}`}
                            style={{ width: `${(parseFloat(stat.avg) / 5) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                <div className="border-t pt-4 flex items-center gap-8">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-[rgb(var(--c-info))]" />
                    <span className="text-ui">Objectifs atteints (moyenne) : </span>
                    <span className={`font-bold px-2 py-1 rounded ${parseInt(trainerStats.avgObjectives) >= 80 ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : parseInt(trainerStats.avgObjectives) >= 60 ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]'}`}>
                      {trainerStats.avgObjectives}%
                    </span>
                  </div>
                  <span className="text-ui text-gray-500">
                    Base : {trainerStats.total} session(s)
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Évaluations à froid */}
        {activeTab === 'cold' && (
          <div>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-gray-800" />
              Évaluations à froid (90 jours)
            </h3>
            
            {!coldStats ? (
              <p className="text-gray-500 text-center py-8">Aucune session terminée pour les critères sélectionnés</p>
            ) : (
              <div className="space-y-6">
                {/* Taux d'envoi et de retour */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-gray-50 border border-gray-200 rounded-ui-sm p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-ui font-medium text-gray-800 flex items-center gap-2">
                        <Send className="w-4 h-4" /> Taux d'envoi
                      </span>
                      <span className={`text-xl font-bold ${parseInt(coldStats.sendRate) >= 100 ? 'text-[rgb(var(--c-success))]' : parseInt(coldStats.sendRate) >= 80 ? 'text-[rgb(var(--c-warning))]' : 'text-[rgb(var(--c-danger))]'}`}>
                        {coldStats.sendRate}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div 
                        className={`h-3 rounded-full ${parseInt(coldStats.sendRate) >= 100 ? 'bg-[rgb(var(--c-success))]' : parseInt(coldStats.sendRate) >= 80 ? 'bg-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-danger))]'}`}
                        style={{ width: `${Math.min(coldStats.sendRate, 100)}%` }}
                      />
                    </div>
                    <p className="text-ui-sm text-gray-800 mt-1">{coldStats.sentCount} envoyées / {coldStats.totalTrainees} stagiaires</p>
                  </div>
                  
                  <div className="bg-[rgb(var(--c-info-bg))] border border-[rgb(var(--c-info)/0.3)] rounded-ui-sm p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-ui font-medium text-[rgb(var(--c-info))] flex items-center gap-2">
                        <CheckCircle className="w-4 h-4" /> Taux de retour
                      </span>
                      <span className={`text-xl font-bold ${parseInt(coldStats.returnRate) >= 50 ? 'text-[rgb(var(--c-success))]' : parseInt(coldStats.returnRate) >= 25 ? 'text-[rgb(var(--c-warning))]' : 'text-[rgb(var(--c-warning))]'}`}>
                        {coldStats.returnRate}%
                      </span>
                    </div>
                    <div className="w-full bg-[rgb(var(--c-info-bg))] rounded-full h-3">
                      <div 
                        className={`h-3 rounded-full ${parseInt(coldStats.returnRate) >= 50 ? 'bg-[rgb(var(--c-success))]' : parseInt(coldStats.returnRate) >= 25 ? 'bg-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-warning))]'}`}
                        style={{ width: `${coldStats.returnRate}%` }}
                      />
                    </div>
                    <p className="text-ui-sm text-[rgb(var(--c-info))] mt-1">{coldStats.receivedCount} reçues / {coldStats.sentCount} envoyées</p>
                  </div>
                </div>
                
                {/* Stats de satisfaction (seulement si des réponses reçues) */}
                {coldStats.total > 0 ? (
                  <>
                    <h4 className="font-medium text-gray-700 border-t pt-4">Résultats des évaluations reçues ({coldStats.total})</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {coldStats.stats.map((stat, idx) => (
                        <div key={idx} className="flex items-center gap-4">
                          <div className="flex-1">
                            <div className="flex justify-between mb-1">
                              <span className="text-ui font-medium">{stat.label}</span>
                              <span className={`text-ui font-bold px-2 py-0.5 rounded ${parseInt(stat.rate) >= 80 ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : parseInt(stat.rate) >= 60 ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]'}`}>
                                {stat.rate}% Oui
                              </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div 
                                className={`h-2 rounded-full ${parseInt(stat.rate) >= 80 ? 'bg-[rgb(var(--c-success))]' : parseInt(stat.rate) >= 60 ? 'bg-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-danger))]'}`}
                                style={{ width: `${stat.rate}%` }}
                              />
                            </div>
                            <span className="text-ui-sm text-gray-500">{stat.yesCount}/{stat.count} réponses</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    <div className="border-t pt-4 flex flex-wrap items-center gap-8">
                      <div className="flex items-center gap-2">
                        <ThumbsUp className="w-5 h-5 text-[rgb(var(--c-success))]" />
                        <span className="text-ui">Recommandation : </span>
                        <span className={`font-bold px-2 py-1 rounded ${parseInt(coldStats.recommendRate) >= 80 ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]'}`}>
                          {coldStats.recommendRate}%
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="bg-gray-50 border border-gray-200 rounded-ui-sm p-4 text-center text-gray-500">
                    <p>Aucune réponse reçue pour le moment</p>
                    <p className="text-ui mt-1">Les statistiques de satisfaction apparaîtront ici quand des stagiaires auront répondu</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        
        {/* Stats détaillées RGPD */}
        {activeTab === 'stats' && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <PieChart className="w-5 h-5 text-gray-800" />
                Statistiques détaillées (RGPD-compliant)
              </h3>
              <button
                onClick={exportStatsCSV}
                className="btn btn-secondary flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
            </div>
            
            {/* Sélecteur de groupement */}
            <div className="bg-gray-50 border border-gray-200 rounded-ui-sm p-4 mb-4">
              <div className="flex flex-wrap items-center gap-4">
                <span className="text-ui font-medium text-gray-800">Grouper par :</span>
                {[
                  { value: 'csp', label: 'CSP', icon: Users },
                  { value: 'situation', label: 'Situation', icon: Building },
                  { value: 'funding', label: 'Financement', icon: Target },
                  { value: 'client', label: 'Client', icon: Building },
                  { value: 'course', label: 'Formation', icon: BookOpen }
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setStatsGroupBy(opt.value)}
                    className={`px-3 py-1.5 rounded-full text-ui font-medium flex items-center gap-1.5 transition-colors ${
                      statsGroupBy === opt.value 
                        ? 'bg-gray-700 text-white' 
                        : 'bg-white text-gray-800 border border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    <opt.icon className="w-4 h-4" />
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-ui-sm text-gray-800 mt-2">
                <Info className="w-3 h-3 inline mr-1" />
                Conformité RGPD : les groupes de moins de {RGPD_THRESHOLD} personnes uniques sont masqués
              </p>
            </div>
            
            {/* Filtres additionnels */}
            <div className="bg-gray-50 border border-gray-200 rounded-ui-sm p-4 mb-6">
              <div className="flex flex-wrap items-center gap-4">
                <span className="text-ui font-medium text-gray-700 flex items-center gap-1">
                  <Filter className="w-4 h-4" />
                  Filtrer :
                </span>
                <select
                  value={filterCSP}
                  onChange={(e) => setFilterCSP(e.target.value)}
                  className="input input-sm w-auto"
                >
                  <option value="">Tous CSP</option>
                  {cspOptions.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <select
                  value={filterSituation}
                  onChange={(e) => setFilterSituation(e.target.value)}
                  className="input input-sm w-auto"
                >
                  <option value="">Toutes situations</option>
                  {situationOptions.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <select
                  value={filterFunding}
                  onChange={(e) => setFilterFunding(e.target.value)}
                  className="input input-sm w-auto"
                >
                  <option value="">Tous financements</option>
                  {fundingOptions.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <SearchSelect
                  value={filterCourse}
                  onChange={(v) => setFilterCourse(v)}
                  className="w-64"
                  options={courseOptions(courses)}
                  emptyLabel="Toutes formations" searchPlaceholder="Rechercher une formation..." aria-label="Filtrer par formation" />
                {(filterCSP || filterSituation || filterFunding || filterCourse) && (
                  <button
                    onClick={() => {
                      setFilterCSP('')
                      setFilterSituation('')
                      setFilterFunding('')
                      setFilterCourse('')
                    }}
                    className="text-ui-sm text-[rgb(var(--c-danger))] hover:underline"
                  >
                    Réinitialiser filtres
                  </button>
                )}
              </div>
            </div>
            
            {/* Tableau des stats */}
            {(() => {
              const groupedStats = calcGroupedStats()
              
              if (groupedStats.length === 0) {
                return (
                  <div className="text-center py-12 text-gray-500">
                    <Table2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>Aucune donnée disponible pour ce critère</p>
                    <p className="text-ui mt-1">Vérifiez que les champs CSP, situation et financement sont renseignés</p>
                  </div>
                )
              }
              
              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-ui">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="text-left py-3 px-4 font-semibold">
                          {statsGroupBy === 'csp' ? 'Catégorie Socio-Professionnelle' :
                           statsGroupBy === 'situation' ? 'Situation' :
                           statsGroupBy === 'funding' ? 'Type de financement' :
                           statsGroupBy === 'client' ? 'Client' : 'Formation'}
                        </th>
                        <th className="text-center py-3 px-3 font-semibold">Participations</th>
                        <th className="text-center py-3 px-3 font-semibold">Personnes</th>
                        <th className="text-center py-3 px-3 font-semibold">Réussite</th>
                        <th className="text-center py-3 px-3 font-semibold">Présence</th>
                        <th className="text-center py-3 px-3 font-semibold">Abandon</th>
                        <th className="text-center py-3 px-3 font-semibold">Satisfaction</th>
                        <th className="text-center py-3 px-3 font-semibold">Recommandation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {groupedStats.map((stat, idx) => (
                        <tr key={idx} className={`hover:bg-gray-50 ${stat.isRGPDHidden ? 'opacity-60' : ''}`}>
                          <td className="py-3 px-4 font-medium">{stat.label}</td>
                          <td className="text-center py-3 px-3">
                            {stat.isRGPDHidden ? (
                              <span className="text-gray-400 text-ui-sm" title="Effectif insuffisant pour garantir l'anonymat">
                                &lt;{RGPD_THRESHOLD}
                              </span>
                            ) : (
                              <span className="font-semibold">{stat.nbFormes}</span>
                            )}
                          </td>
                          <td className="text-center py-3 px-3">
                            {stat.isRGPDHidden ? (
                              <span className="text-gray-400 text-ui-sm">
                                &lt;{RGPD_THRESHOLD}
                              </span>
                            ) : (
                              <span className="text-gray-600">{stat.nbPersonnes}</span>
                            )}
                          </td>
                          <td className="text-center py-3 px-3">
                            {stat.isRGPDHidden ? (
                              <span className="text-gray-300">-</span>
                            ) : stat.tauxReussite ? (
                              <span className={`px-2 py-0.5 rounded text-ui-sm font-medium ${
                                parseInt(stat.tauxReussite) >= 80 ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' :
                                parseInt(stat.tauxReussite) >= 60 ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]'
                              }`}>
                                {stat.tauxReussite}%
                              </span>
                            ) : <span className="text-gray-300">-</span>}
                          </td>
                          <td className="text-center py-3 px-3">
                            {stat.isRGPDHidden ? (
                              <span className="text-gray-300">-</span>
                            ) : (
                              <span className={`px-2 py-0.5 rounded text-ui-sm font-medium ${
                                parseInt(stat.tauxPresence) >= 80 ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' :
                                parseInt(stat.tauxPresence) >= 60 ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]'
                              }`}>
                                {stat.tauxPresence}%
                              </span>
                            )}
                          </td>
                          <td className="text-center py-3 px-3">
                            {stat.isRGPDHidden ? (
                              <span className="text-gray-300">-</span>
                            ) : (
                              <span className={`px-2 py-0.5 rounded text-ui-sm font-medium ${
                                parseInt(stat.tauxAbandon) <= 5 ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' :
                                parseInt(stat.tauxAbandon) <= 15 ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]'
                              }`}>
                                {stat.tauxAbandon}%
                              </span>
                            )}
                          </td>
                          <td className="text-center py-3 px-3">
                            {stat.isRGPDHidden ? (
                              <span className="text-gray-300">-</span>
                            ) : stat.satisfaction ? (
                              <span className={`px-2 py-0.5 rounded text-ui-sm font-medium ${
                                parseFloat(stat.satisfaction) >= 4 ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' :
                                parseFloat(stat.satisfaction) >= 3 ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]'
                              }`}>
                                {stat.satisfaction}/5
                              </span>
                            ) : <span className="text-gray-300">-</span>}
                          </td>
                          <td className="text-center py-3 px-3">
                            {stat.isRGPDHidden ? (
                              <span className="text-gray-300">-</span>
                            ) : stat.tauxRecommandation ? (
                              <span className={`px-2 py-0.5 rounded text-ui-sm font-medium ${
                                parseInt(stat.tauxRecommandation) >= 80 ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' :
                                parseInt(stat.tauxRecommandation) >= 60 ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]' : 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]'
                              }`}>
                                {stat.tauxRecommandation}%
                              </span>
                            ) : <span className="text-gray-300">-</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  
                  {/* Barres de progression visuelles */}
                  <div className="mt-8 space-y-4">
                    <h4 className="font-medium text-gray-700">Répartition visuelle</h4>
                    {groupedStats.filter(s => !s.isRGPDHidden).slice(0, 8).map((stat, idx) => (
                      <div key={idx} className="flex items-center gap-4">
                        <div className="w-48 truncate text-ui font-medium" title={stat.label}>
                          {stat.label}
                        </div>
                        <div className="flex-1 bg-gray-200 rounded-full h-6 relative overflow-hidden">
                          <div 
                            className="h-6 bg-gray-700 rounded-full flex items-center justify-end pr-2"
                            style={{ width: `${Math.max((stat.nbFormes / Math.max(...groupedStats.filter(s => !s.isRGPDHidden).map(s => s.nbFormes))) * 100, 10)}%` }}
                          >
                            <span className="text-ui-sm font-bold text-white">{stat.nbFormes}</span>
                          </div>
                        </div>
                        <div className="w-20 text-right">
                          <span className={`text-ui-sm font-medium ${
                            stat.satisfaction && parseFloat(stat.satisfaction) >= 4 ? 'text-[rgb(var(--c-success))]' : 'text-gray-500'
                          }`}>
                            {stat.satisfaction ? `${stat.satisfaction}/5` : '-'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Note RGPD */}
                  <div className="mt-6 p-4 bg-[rgb(var(--c-info-bg))] border border-[rgb(var(--c-info)/0.3)] rounded-ui-sm">
                    <h5 className="font-medium text-[rgb(var(--c-info))] mb-2 flex items-center gap-2">
                      <Info className="w-4 h-4" />
                      Information sur la conformité RGPD
                    </h5>
                    <ul className="text-ui text-[rgb(var(--c-info))] space-y-1">
                      <li>• Les données sont agrégées et anonymisées (aucun nom affiché)</li>
                      <li>• Les groupes de moins de {RGPD_THRESHOLD} personnes sont masqués</li>
                      <li>• L'export CSV respecte les mêmes règles d'anonymisation</li>
                      <li>• Ces statistiques peuvent être utilisées pour les rapports Qualiopi et OPCO</li>
                    </ul>
                  </div>
                </div>
              )
            })()}
          </div>
        )}
      </div>
      
      {/* Section Alertes Qualité */}
      <div className="card p-6 border-l-4 border-[rgb(var(--c-warning)/0.3)]">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-[rgb(var(--c-warning))]" />
            Alertes Qualité (Notes 1-3)
          </h3>
          <div className="flex gap-2">
            <select
              value={alertFilter}
              onChange={(e) => setAlertFilter(e.target.value)}
              className="input input-sm"
            >
              <option value="pending">Non traitées</option>
              <option value="treated">Traitées</option>
              <option value="all">Toutes</option>
            </select>
          </div>
        </div>
        
        {(() => {
          const filteredAlerts = qualityAlerts.filter(a => {
            if (alertFilter === 'pending') return a.status === 'pending'
            if (alertFilter === 'treated') return a.status !== 'pending'
            return true
          })
          
          if (filteredAlerts.length === 0) {
            return (
              <div className="text-center py-8 text-gray-500">
                <AlertTriangle className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p>{alertFilter === 'pending' ? 'Aucune alerte en attente' : 'Aucune alerte'}</p>
                <p className="text-ui">Les notes de 1 à 3 génèrent automatiquement des alertes</p>
              </div>
            )
          }
          
          return (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {filteredAlerts.map((alert) => (
                <div 
                  key={alert.id} 
                  className={`border rounded-ui-sm p-3 ${alert.status === 'pending' ? 'bg-[rgb(var(--c-warning-bg))] border-[rgb(var(--c-warning)/0.3)]' : 'bg-[rgb(var(--c-success-bg))] border-[rgb(var(--c-success)/0.3)]'}`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded text-ui-sm font-bold ${alert.score === 1 ? 'bg-[rgb(var(--c-danger))] text-white' : alert.score === 2 ? 'bg-[rgb(var(--c-warning))] text-white' : 'bg-[rgb(var(--c-warning))] text-white'}`}>
                          {alert.score}/5
                        </span>
                        <span className="font-medium text-ui">{alert.criterion_label}</span>
                      </div>
                      <div className="text-ui-sm text-gray-600 space-y-0.5">
                        <p>
                          <span className="font-medium">Session:</span> {alert.sessions?.reference || 'N/A'} - {alert.sessions?.courses?.name || alert.sessions?.course?.name || ''}
                        </p>
                        <p>
                          <span className="font-medium">Date:</span> {alert.sessions?.start_date ? new Date(alert.sessions.start_date).toLocaleDateString('fr-FR') : 'N/A'}
                          {alert.sessions?.end_date && alert.sessions.end_date !== alert.sessions.start_date && ` au ${new Date(alert.sessions.end_date).toLocaleDateString('fr-FR')}`}
                        </p>
                        <p>
                          <span className="font-medium">Formateur:</span> {alert.sessions?.trainer?.first_name || ''} {alert.sessions?.trainer?.last_name || 'N/A'}
                        </p>
                        <p>
                          <span className="font-medium">Stagiaire:</span> {alert.trainees?.first_name || ''} {alert.trainees?.last_name || 'N/A'}
                        </p>
                        {alert.status !== 'pending' && (
                          <p className="text-[rgb(var(--c-success))]">
                            <span className="font-medium">Traité par:</span> {alert.treated_by} le {new Date(alert.treated_at).toLocaleDateString('fr-FR')}
                            {alert.treatment_comment && ` - ${alert.treatment_comment}`}
                          </p>
                        )}
                        {alert.non_conformites && (
                          <p className="text-[rgb(var(--c-info))]">
                            <span className="font-medium">NC liée:</span> {alert.non_conformites.title}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 ml-2">
                      <button
                        onClick={() => navigate(`/sessions/${alert.session_id}`)}
                        className="btn btn-xs btn-outline flex items-center gap-1"
                        title="Voir la session"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </button>
                      {alert.status === 'pending' && (
                        <>
                          <button
                            onClick={() => {
                              setSelectedAlert(alert)
                              setShowAlertModal(true)
                            }}
                            className="btn btn-xs btn-success flex items-center gap-1"
                            title="Marquer comme traitée"
                          >
                            <CheckCircle className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleCreateNC(alert)}
                            className="btn btn-xs btn-warning flex items-center gap-1"
                            title="Créer une NC"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                          {nonConformites.length > 0 && (
                            <select
                              onChange={(e) => {
                                if (e.target.value) {
                                  handleLinkNC(alert, e.target.value)
                                  e.target.value = ''
                                }
                              }}
                              className="input input-xs w-20"
                              title="Lier à une NC existante"
                            >
                              <option value="">Lier NC</option>
                              {nonConformites.map(nc => (
                                <option key={nc.id} value={nc.id}>{nc.title.substring(0, 20)}...</option>
                              ))}
                            </select>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        })()}
      </div>
      
      {/* Modal traitement alerte */}
      {showAlertModal && selectedAlert && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-ui-sm p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-[rgb(var(--c-success))]" />
              Traiter l'alerte
            </h3>
            <div className="mb-4 text-ui text-gray-600 space-y-1">
              <p><strong>Critère:</strong> {selectedAlert.criterion_label}</p>
              <p><strong>Note:</strong> <span className={`px-2 py-0.5 rounded text-ui-sm font-bold ${selectedAlert.score === 1 ? 'bg-[rgb(var(--c-danger))] text-white' : selectedAlert.score === 2 ? 'bg-[rgb(var(--c-warning))] text-white' : 'bg-[rgb(var(--c-warning))] text-white'}`}>{selectedAlert.score}/5</span></p>
              <p><strong>Session:</strong> {selectedAlert.sessions?.reference || 'N/A'} - {selectedAlert.sessions?.courses?.name || selectedAlert.sessions?.course?.name || ''}</p>
              <p><strong>Date:</strong> {selectedAlert.sessions?.start_date ? new Date(selectedAlert.sessions.start_date).toLocaleDateString('fr-FR') : 'N/A'}</p>
              <p><strong>Formateur:</strong> {selectedAlert.sessions?.trainer?.first_name || ''} {selectedAlert.sessions?.trainer?.last_name || 'N/A'}</p>
              <p><strong>Stagiaire:</strong> {selectedAlert.trainees?.first_name || ''} {selectedAlert.trainees?.last_name || 'N/A'}</p>
            </div>
            <div className="mb-4">
              <label className="block text-ui font-medium mb-1">Commentaire de traitement *</label>
              <textarea
                value={treatmentComment}
                onChange={(e) => setTreatmentComment(e.target.value)}
                className="input w-full h-24"
                placeholder="Décrivez les actions menées pour traiter cette alerte..."
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowAlertModal(false)
                  setSelectedAlert(null)
                  setTreatmentComment('')
                }}
                className="btn btn-ghost"
              >
                Annuler
              </button>
              <button
                onClick={handleTreatAlert}
                className="btn btn-success"
              >
                Valider le traitement
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Texte explicatif */}
      <div className="card p-6 bg-[rgb(var(--c-info-bg))] border border-[rgb(var(--c-info)/0.3)]">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Info className="w-5 h-5 text-[rgb(var(--c-info))]" />
          Comment sont calculés les indicateurs ?
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-ui text-gray-700">
          <div>
            <h4 className="font-semibold text-[rgb(var(--c-info))] mb-2">Score Global</h4>
            <p className="mb-2">Moyenne pondérée des évaluations :</p>
            <ul className="list-disc list-inside space-y-1 text-ui-sm">
              <li><strong>Évaluations stagiaires (à chaud)</strong> : moyenne des 14 critères (Organisation, Contenu, Formateur, Perception)</li>
              <li><strong>Évaluations formateur</strong> : si disponibles, incluses dans le calcul</li>
            </ul>
            <p className="mt-2 text-ui-sm italic">Score = (Moyenne stagiaires + Moyenne formateurs) / 2</p>
          </div>
          <div>
            <h4 className="font-semibold text-[rgb(var(--c-info))] mb-2">Taux de réussite</h4>
            <p className="mb-2">Pourcentage de stagiaires ayant acquis leurs objectifs :</p>
            <p className="text-ui-sm">= Nombre "Acquis" / Total stagiaires évalués × 100</p>
            <p className="mt-2 text-ui-sm italic">Un stagiaire obtient "Acquis" si tous ses objectifs sont validés ET présence 100%</p>
          </div>
          <div>
            <h4 className="font-semibold text-[rgb(var(--c-info))] mb-2">Taux de présence</h4>
            <p className="mb-2">Pourcentage de stagiaires avec présence complète :</p>
            <p className="text-ui-sm">= Stagiaires 100% présents / Total stagiaires × 100</p>
          </div>
          <div>
            <h4 className="font-semibold text-[rgb(var(--c-info))] mb-2">Taux de recommandation</h4>
            <p className="mb-2">Pourcentage de stagiaires recommandant la formation :</p>
            <p className="text-ui-sm">= Réponses "Oui" / Total réponses × 100</p>
            <p className="mt-2 text-ui-sm italic">Recueil des appréciations : indicateur 30. Publication avec la méthode de calcul : indicateur 2.</p>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-[rgb(var(--c-info)/0.3)]">
          <h4 className="font-semibold text-[rgb(var(--c-warning))] mb-2">Alertes Qualité</h4>
          <p className="text-ui-sm">Toute note de 1 à 3/5 génère automatiquement une alerte. Ces alertes doivent être traitées (commentaire justificatif) ou liées à une non-conformité pour démontrer l'amélioration continue lors de l'audit Qualiopi.</p>
        </div>
      </div>
    </div>
  )
}
