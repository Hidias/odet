import { StatusBadge } from '../../../ui/StatusBadge'
import { apiFetch } from '../../../core/api'
import { useEffect, useState, useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useDataStore } from '../../../core/store'
import { useDroits } from '../../../core/rights/useDroit'
import { supabase } from '../../../core/supabase'
import { 
  Calendar, Plus, Search, MapPin, Users, Clock, ChevronRight, ChevronDown, X, Trash2, Copy, Building2, List, LayoutGrid, Briefcase, Euro, ClipboardPaste, Loader2, Check
} from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'
import MultiSiretWizard from '../components/MultiSiretWizard'
import SessionPlanning from '../components/SessionPlanning'
import SearchSelect, { clientOptions, courseOptions } from '../../../ui/SearchSelect'

import { confirmer } from '../../../ui/Confirm'
import { BadgeTest } from '../../../core/demo/BadgeTest'
// Type de journée déduit des horaires : ≤ 4h30 = demi-journée (même règle que Quotes / MultiSiretWizard)
const dayTypeFromTimes = (startTime, endTime) => {
  const [sh, sm] = (startTime || '09:00').split(':').map(Number)
  const [eh, em] = (endTime || '17:00').split(':').map(Number)
  let startMins = sh * 60 + (sm || 0)
  let endMins = eh * 60 + (em || 0)
  if (endMins <= startMins) endMins += 24 * 60
  return (endMins - startMins) <= 270 ? 'half' : 'full'
}

const statusLabels = {
  draft: { label: 'Brouillon', class: 'badge-gray' },
  planned: { label: 'Planifiée', class: 'badge-blue' },
  confirmed: { label: 'Confirmée', class: 'badge-campus' },
  in_progress: { label: 'En cours', class: 'badge-yellow' },
  completed: { label: 'Terminée', class: 'badge-green' },
  cancelled: { label: 'Annulée', class: 'badge-red' },
}

export default function Sessions() {
  const location = useLocation()
  const d = useDroits({
    creer: 'formation.sessions.creer',
    supprimer: 'formation.sessions.supprimer',
  })
  const { 
    sessions, sessionsLoading, fetchSessions, createSession, deleteSession, duplicateSession,
    clients, fetchClients,
    courses, fetchCourses,
    trainers, fetchTrainers,
    trainees, fetchTrainees
  } = useDataStore()
  
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showForm, setShowForm] = useState(location.state?.openNew || false)
  const [showMultiSiret, setShowMultiSiret] = useState(false)
  const [viewMode, setViewMode] = useState('list') // 'list' | 'planning'
  
  // Filtres stagiaires
  const [traineeSearch, setTraineeSearch] = useState('')
  const [traineeClientFilter, setTraineeClientFilter] = useState('')
  
  // Inter-sessions toggle
  const [expandedGroups, setExpandedGroups] = useState({})
  
  // Contacts du client sélectionné
  const [clientContacts, setClientContacts] = useState([])
  
  const [formData, setFormData] = useState({
    course_id: '',
    client_id: '',
    contact_id: '', // ID du contact spécifique (optionnel)
    signatory_name: '',
    signatory_role: '',
    start_date: '',
    end_date: '',
    start_time: '09:00',
    end_time: '17:00',
    day_type: 'full', // 'full' = journée complète (2 demi-journées), 'half' = demi-journée (1 seule)
    location: '',
    room: '',
    status: 'planned',
    is_intra: false,
    trainer_ids: [],
    trainee_ids: [],
    funding_type: 'none',
    funding_details: '',
    // Sous-traitance
    session_type: 'intra',
    subcontract_course_title: '',
    subcontract_client_ref: '',
    subcontract_nb_trainees: '',
    subcontract_daily_rate: '',
  })
  const [batchMode, setBatchMode] = useState(false)
  const [batchLines, setBatchLines] = useState([
    { client_ref: '', start_date: '', duration_days: '1', nb_trainees: '1' }
  ])
  // Import planning
  const [showImportModal, setShowImportModal] = useState(false)
  const [importText, setImportText] = useState('')
  const [importParsing, setImportParsing] = useState(false)
  const [importResult, setImportResult] = useState(null) // parsed days
  const [importChecked, setImportChecked] = useState([]) // indices of checked days
  
  useEffect(() => {
    fetchSessions()
    fetchClients()
    fetchCourses()
    fetchTrainers()
    fetchTrainees()
  }, [])
  
  // Mise à jour automatique du statut des sessions terminées (J+1 après fin)
  // Sessions passées « terminées » : écrites chaque nuit par la base (0376, daily_maintenance).
  
  useEffect(() => {
    if (location.state?.openNew) {
      setShowForm(true)
      if (location.state?.client_id) {
        setFormData(f => ({ ...f, client_id: location.state.client_id }))
      }
      window.history.replaceState({}, document.title)
    }
  }, [location])
  
  // Filtrer les stagiaires
  const filteredTrainees = useMemo(() => {
    return trainees.filter(t => {
      const matchSearch = !traineeSearch || 
        `${t.first_name} ${t.last_name}`.toLowerCase().includes(traineeSearch.toLowerCase())
      const matchClient = !traineeClientFilter || t.client_id === traineeClientFilter
      return matchSearch && matchClient
    })
  }, [trainees, traineeSearch, traineeClientFilter])
  
  // Quand is_intra change, mettre à jour le lieu
  useEffect(() => {
    if (formData.is_intra && formData.client_id) {
      const client = clients.find(c => c.id === formData.client_id)
      if (client) {
        const addr = [client.address, client.postal_code, client.city].filter(Boolean).join(', ')
        setFormData(prev => ({ ...prev, location: addr || 'Chez le client' }))
      }
    }
  }, [formData.is_intra, formData.client_id, clients])
  
  // Charger les contacts quand le client change
  useEffect(() => {
    const loadContacts = async () => {
      if (formData.client_id) {
        const { data } = await supabase
          .from('client_contacts')
          .select('*')
          .eq('client_id', formData.client_id)
          .order('is_primary', { ascending: false })
        setClientContacts(data || [])
      } else {
        setClientContacts([])
      }
      // Reset contact_id quand le client change
      setFormData(prev => ({ ...prev, contact_id: '', signatory_name: '', signatory_role: '' }))
    }
    loadContacts()
  }, [formData.client_id])
  
  const filteredSessions = sessions.filter(session => {
    const trainerName = session.trainers ? `${session.trainers.first_name} ${session.trainers.last_name}` : ''
    const searchFields = `${session.reference || ''} ${session.courses?.title || ''} ${session.clients?.name || ''} ${trainerName} ${session.location || ''} ${session.subcontract_course_title || ''} ${session.subcontract_client_ref || ''}`.toLowerCase()
    const matchSearch = !search || searchFields.includes(search.toLowerCase())
    
    const matchStatus = !statusFilter || session.status === statusFilter
    
    return matchSearch && matchStatus
  })
  
  // Regrouper les sessions inter-entreprises
  const groupedSessions = useMemo(() => {
    const interGroups = {}
    const soloSessions = []
    
    filteredSessions.forEach(session => {
      if (session.inter_group_id) {
        if (!interGroups[session.inter_group_id]) {
          interGroups[session.inter_group_id] = {
            id: session.inter_group_id,
            sessions: [],
            course: session.courses,
            start_date: session.start_date,
            end_date: session.end_date,
            location: session.location,

          }
        }
        interGroups[session.inter_group_id].sessions.push(session)
      } else {
        soloSessions.push({ type: 'solo', session })
      }
    })
    
    // Combiner : inter-groupes + sessions solo, triées par date
    const items = [
      ...Object.values(interGroups).map(g => ({ type: 'group', group: g })),
      ...soloSessions,
    ]
    
    // Trier par date de début décroissante
    items.sort((a, b) => {
      const dateA = a.type === 'group' ? a.group.start_date : a.session.start_date
      const dateB = b.type === 'group' ? b.group.start_date : b.session.start_date
      return (dateB || '').localeCompare(dateA || '')
    })
    
    return items
  }, [filteredSessions])
  
  const toggleGroup = (groupId) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }))
  }
  
  const resetForm = () => {
    setFormData({
      course_id: '',
      client_id: '',
      contact_id: '',
      signatory_name: '',
      signatory_role: '',
      start_date: '',
      end_date: '',
      start_time: '09:00',
      end_time: '17:00',
      day_type: 'full',
      location: '',
      room: '',
      status: 'planned',
      is_intra: false,
      trainer_ids: [],
      trainee_ids: [],
      session_type: 'intra',
      subcontract_course_title: '',
      subcontract_client_ref: '',
      subcontract_nb_trainees: '',
      subcontract_daily_rate: '',
    })
    setBatchMode(false)
    setBatchLines([{ client_ref: '', start_date: '', duration_days: '1', nb_trainees: '1' }])
    setShowImportModal(false); setImportText(''); setImportResult(null); setImportChecked([])
    setClientContacts([])
    setTraineeSearch('')
    setTraineeClientFilter('')
    setShowForm(false)
  }
  
  // ═══ IMPORT PLANNING ═══
  const parseImportText = async () => {
    if (!importText.trim()) { toast.error('Collez le planning dans la zone de texte'); return }
    setImportParsing(true)
    try {
      const res = await apiFetch('/api/parse-planning-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: importText, baseTitle: formData.subcontract_course_title })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur parsing')
      if (!data.days || data.days.length === 0) { toast.error('Aucune journée détectée'); return }
      setImportResult(data)
      setImportChecked(data.days.map((_, i) => i)) // tout coché par défaut
      // Pré-remplir le titre si détecté
      if (data.detected_training_type && !formData.subcontract_course_title) {
        setFormData(f => ({ ...f, subcontract_course_title: data.detected_training_type }))
      }
      toast.success(`${data.days.length} jour(s) détecté(s) - ${data.total_unique_trainees || '?'} stagiaire(s) uniques`)
    } catch (err) {
      toast.error('Erreur: ' + err.message)
      console.error(err)
    } finally {
      setImportParsing(false)
    }
  }

  const handleImportCreate = async () => {
    if (!formData.client_id) { toast.error('Sélectionnez un client'); return }
    if (!importResult?.days) return
    const selectedDays = importResult.days.filter((_, i) => importChecked.includes(i))
    if (selectedDays.length === 0) { toast.error('Sélectionnez au moins un jour'); return }

    let created = 0, errors = 0
    for (const day of selectedDays) {
      const refs = (day.session_refs || []).join(', ')
      const baseTitle = formData.subcontract_course_title || importResult.detected_training_type || 'Formation'
      const title = `${baseTitle} - ${day.date.split('-').reverse().join('/')} - Réf. ${refs}`

      const sessionData = {
        session_type: 'subcontract',
        course_id: null,
        client_id: formData.client_id,
        contact_id: formData.contact_id || null,
        start_date: day.date,
        end_date: day.date, // 1 jour = même date
        start_time: day.start_time || formData.start_time,
        end_time: day.end_time || formData.end_time,
        day_type: dayTypeFromTimes(day.start_time || formData.start_time, day.end_time || formData.end_time),
        location: day.location || formData.location,
        room: '',
        status: formData.status,
        is_intra: true,
        trainer_ids: formData.trainer_ids,
        trainee_ids: [],
        funding_type: 'none',
        funding_details: null,
        subcontract_course_title: title,
        subcontract_client_ref: refs,
        subcontract_nb_trainees: day.nb_trainees || 1,
        subcontract_daily_rate: parseFloat(formData.subcontract_daily_rate) || null,
      }
      const { error } = await createSession(sessionData)
      if (error) { errors++; console.error(error) } else { created++ }
    }

    if (errors > 0) toast.error(`${errors} erreur(s) sur ${selectedDays.length}`)
    if (created > 0) {
      toast.success(`${created} session${created > 1 ? 's' : ''} créée${created > 1 ? 's' : ''}`)
      resetForm()
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    const isSub = formData.session_type === 'subcontract'
    
    // ═══ MODE BATCH SOUS-TRAITANCE ═══
    if (isSub && batchMode) {
      if (!formData.client_id) { toast.error('Sélectionnez un client'); return }
      if (!formData.subcontract_course_title) { toast.error('Remplissez l\'intitulé de base'); return }
      const validLines = batchLines.filter(l => l.client_ref && l.start_date)
      if (validLines.length === 0) { toast.error('Ajoutez au moins une ligne avec réf. et date'); return }
      
      let created = 0, errors = 0
      for (const line of validLines) {
        const dur = Math.max(1, parseInt(line.duration_days) || 1)
        const startD = new Date(line.start_date)
        const endD = new Date(startD)
        endD.setDate(endD.getDate() + dur - 1)
        const endDateStr = endD.toISOString().split('T')[0]
        
        // Titre auto: "CACES R.489 - Réf. 2026-02-046"
        const autoTitle = `${formData.subcontract_course_title} - Réf. ${line.client_ref}`
        
        const sessionData = {
          session_type: 'subcontract',
          course_id: null,
          client_id: formData.client_id,
          contact_id: formData.contact_id || null,
          start_date: line.start_date,
          end_date: endDateStr,
          start_time: formData.start_time,
          end_time: formData.end_time,
          day_type: dayTypeFromTimes(formData.start_time, formData.end_time),
          location: formData.location,
          room: '',
          status: formData.status,
          is_intra: true,
          trainer_ids: formData.trainer_ids,
          trainee_ids: [],
          funding_type: 'none',
          funding_details: null,
          subcontract_course_title: autoTitle,
          subcontract_client_ref: line.client_ref,
          subcontract_nb_trainees: parseInt(line.nb_trainees) || 1,
          subcontract_daily_rate: parseFloat(formData.subcontract_daily_rate) || null,
        }
        const { error } = await createSession(sessionData)
        if (error) { errors++; console.error(error) } else { created++ }
      }
      
      if (errors > 0) toast.error(`${errors} erreur(s) sur ${validLines.length}`)
      if (created > 0) {
        toast.success(`${created} session${created > 1 ? 's' : ''} créée${created > 1 ? 's' : ''}`)
        resetForm()
      }
      return
    }
    
    // ═══ MODE SIMPLE ═══
    if (isSub) {
      if (!formData.client_id || !formData.start_date || !formData.end_date || !formData.subcontract_course_title) {
        toast.error('Remplissez le client, les dates et l\'intitulé de la formation')
        return
      }
    } else {
      if (!formData.course_id || (formData.session_type !== 'inter' && !formData.client_id) || !formData.start_date || !formData.end_date) {
        toast.error('Veuillez remplir tous les champs obligatoires')
        return
      }
      if (!formData.funding_type || formData.funding_type === '') {
        toast.error('Le type de financement est obligatoire')
        return
      }
    }
    
    if (new Date(formData.end_date) < new Date(formData.start_date)) {
      toast.error('La date de fin ne peut pas être avant la date de début')
      return
    }
    
    const sessionData = {
      session_type: formData.session_type,
      course_id: isSub ? null : formData.course_id,
      client_id: formData.client_id || null,
      contact_id: formData.contact_id || null,
      signatory_name: isSub ? null : (formData.signatory_name || null),
      signatory_role: isSub ? null : (formData.signatory_role || null),
      start_date: formData.start_date,
      end_date: formData.end_date,
      start_time: formData.start_time,
      end_time: formData.end_time,
      day_type: formData.day_type || 'full',
      location: formData.location,
      room: formData.room,
      status: formData.status,
      is_intra: isSub ? true : formData.is_intra,
      trainer_ids: formData.trainer_ids,
      trainee_ids: isSub ? [] : formData.trainee_ids,
      funding_type: isSub ? 'none' : (formData.funding_type || 'none'),
      funding_details: isSub ? null : (formData.funding_details || null),
      subcontract_course_title: isSub ? formData.subcontract_course_title : null,
      subcontract_client_ref: isSub ? formData.subcontract_client_ref : null,
      subcontract_nb_trainees: isSub ? (parseInt(formData.subcontract_nb_trainees) || 0) : 0,
      subcontract_daily_rate: isSub ? (parseFloat(formData.subcontract_daily_rate) || null) : null,
    }
    
    const { error } = await createSession(sessionData)
    if (error) {
      toast.error('Erreur lors de la création')
      console.error(error)
    } else {
      toast.success('Session créée avec succès')
      resetForm()
    }
  }
  
  const handleDelete = async (id, e) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!await confirmer('Supprimer cette session ?')) return
    
    const { error } = await deleteSession(id)
    if (error) {
      toast.error('Erreur lors de la suppression')
    } else {
      toast.success('Session supprimée')
    }
  }
  
  const handleDuplicate = async (id, e) => {
    e.preventDefault()
    e.stopPropagation()
    
    const { error } = await duplicateSession(id)
    if (error) {
      toast.error('Erreur lors de la duplication')
    } else {
      toast.success('Session dupliquée - Éditez les dates')
    }
  }
  
  const toggleTrainee = (traineeId) => {
    setFormData(prev => ({
      ...prev,
      trainee_ids: prev.trainee_ids.includes(traineeId)
        ? prev.trainee_ids.filter(id => id !== traineeId)
        : [...prev.trainee_ids, traineeId]
    }))
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Sessions</h1>
          <p className="text-gray-500 mt-1">{sessions.length} session(s)</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle Liste / Planning */}
          <div className="flex items-center bg-gray-100 rounded-ui-sm p-0.5 mr-2">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-ui font-medium rounded-ui-sm transition-all
                ${viewMode === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <List className="w-4 h-4" />
              Liste
            </button>
            <button
              onClick={() => setViewMode('planning')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-ui font-medium rounded-ui-sm transition-all
                ${viewMode === 'planning' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <LayoutGrid className="w-4 h-4" />
              Planning
            </button>
          </div>
          {d.creer && (
          <button onClick={() => setShowMultiSiret(true)} className="btn btn-secondary flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            Multi-SIRET
          </button>
          )}
          {d.creer && (
          <button onClick={() => setShowForm(true)} className="btn btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Nouvelle session
          </button>
          )}
        </div>
      </div>
      
      {/* Vue Planning */}
      {viewMode === 'planning' && (
        <SessionPlanning sessions={sessions} trainers={trainers} />
      )}
      
      {/* Vue Liste */}
      {viewMode === 'list' && <>
      {/* Filtres */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input w-full sm:w-48"
        >
          <option value="">Tous les statuts</option>
          {Object.entries(statusLabels).map(([value, { label }]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      
      {/* Liste */}
      <div className="space-y-4">
        {sessionsLoading ? (
          <div className="card p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          </div>
        ) : groupedSessions.length === 0 ? (
          <div className="card p-8 text-center text-gray-500">
            {search || statusFilter ? 'Aucun résultat' : 'Aucune session - Créez-en une !'}
          </div>
        ) : (
          groupedSessions.map((item) => {
            // ─── Session inter-entreprises groupée ───────────────
            if (item.type === 'group') {
              const { group } = item
              const isExpanded = expandedGroups[group.id]
              const totalTrainees = group.sessions.reduce((sum, s) => sum + (s.session_trainees?.length || 0), 0)
              // Prix retiré de l'affichage liste
              
              return (
                <div key={group.id} className="rounded-ui border-2 border-gray-200 bg-gray-50 overflow-hidden">
                  {/* En-tête du groupe */}
                  <div
                    className="px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => toggleGroup(group.id)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className="badge bg-gray-100 text-gray-800 flex items-center gap-1">
                            <Building2 className="w-3 h-3" />
                            Inter-entreprises • {group.sessions.length} entreprises
                          </span>
                          {(() => {
                            const statuses = [...new Set(group.sessions.map(s => s.status))]
                            if (statuses.length === 1) {
                              return <StatusBadge kind="session" status={statuses[0]} />
                            }
                            return null
                          })()}
                        </div>
                        
                        <h3 className="font-semibold text-gray-900 text-lg">
                          {group.course?.title || 'Formation'}
                        </h3>
                        
                        {/* Badges entreprises */}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {group.sessions.map(s => (
                            <span key={s.id} className="inline-flex items-center gap-1 text-ui-sm bg-white border border-gray-200 text-gray-800 px-2 py-0.5 rounded-full">
                              {s.clients?.name || '?'}
                              <span className="text-gray-500">({s.session_trainees?.length || 0})</span>
                            </span>
                          ))}
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-4 mt-2.5 text-ui text-gray-500">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            {group.start_date ? format(new Date(group.start_date), 'd MMM yyyy', { locale: fr }) : 'Date à définir'}
                            {group.end_date && group.end_date !== group.start_date && (
                              <> - {format(new Date(group.end_date), 'd MMM yyyy', { locale: fr })}</>
                            )}
                          </span>
                          {group.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-4 h-4" />
                              {group.location}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Users className="w-4 h-4" />
                            {totalTrainees} stagiaire(s)
                          </span>

                        </div>
                      </div>
                      
                      <div className="flex items-center gap-1 mt-1">
                        <ChevronDown className={`w-5 h-5 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                    </div>
                  </div>
                  
                  {/* Sessions du groupe (dépliées) */}
                  {isExpanded && (
                    <div className="border-t border-gray-200 divide-y divide-gray-200">
                      {group.sessions.map(session => (
                        <Link
                          key={session.id}
                          to={`/sessions/${session.id}`}
                          className="block px-5 py-3 hover:bg-white/80 transition-colors group"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-ui font-mono text-gray-400">{session.reference}</span>
                                <BadgeTest tbl="sessions" id={session.id} />
                                <StatusBadge kind="session" status={session.status} />
                              </div>
                              <p className="font-medium text-gray-900 mt-0.5">{session.clients?.name}</p>
                              <div className="flex items-center gap-3 mt-1 text-ui text-gray-500">
                                <span>{session.session_trainees?.length || 0} stagiaire(s)</span>

                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {d.creer && (
                              <button
                                onClick={(e) => handleDuplicate(session.id, e)}
                                className="p-1.5 hover:bg-gray-100 rounded-ui-sm [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                                title="Dupliquer"
                              >
                                <Copy className="w-4 h-4 text-gray-500" />
                              </button>
                              )}
                              {d.supprimer && (
                              <button
                                onClick={(e) => handleDelete(session.id, e)}
                                className="p-1.5 hover:bg-[rgb(var(--c-danger-bg))] rounded-ui-sm [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                                title="Supprimer"
                              >
                                <Trash2 className="w-4 h-4 text-[rgb(var(--c-danger))]" />
                              </button>
                              )}
                              <ChevronRight className="w-4 h-4 text-gray-400" />
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            }
            
            // ─── Session solo (classique) ────────────────────────
            const session = item.session
            
            // ─── Carte COMPACTE sous-traitance ────────────────────
            if (session.session_type === 'subcontract') {
              const refs = (session.subcontract_client_ref || '').split(',').map(r => r.trim()).filter(Boolean)
              const shortRefs = refs.map(r => r.replace(/^2026-\d{2}-0?/, ''))
              return (
                <Link
                  key={session.id}
                  to={`/sessions/${session.id}`}
                  className="block bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] rounded-ui-sm px-4 py-2.5 hover:bg-[rgb(var(--c-warning-bg))] transition-colors group"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0 flex-wrap">
                      {/* Date */}
                      <span className="text-ui font-medium text-gray-700 whitespace-nowrap w-[75px] shrink-0">
                        {session.start_date ? format(new Date(session.start_date), 'dd/MM/yyyy', { locale: fr }) : '-'}
                      </span>
                      {/* Réfs courtes */}
                      <div className="flex items-center gap-1 shrink-0">
                        {shortRefs.slice(0, 4).map((r, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] text-ui-sm rounded font-mono">{r}</span>
                        ))}
                        {shortRefs.length > 4 && <span className="text-ui-sm text-[rgb(var(--c-warning))]">+{shortRefs.length - 4}</span>}
                      </div>
                      {/* Lieu (tronqué) */}
                      <span className="text-ui-sm text-gray-500 truncate max-w-[180px] hidden sm:inline">
                        {(session.location_name || session.location || '').split(',')[0]}
                      </span>
                      {/* Stagiaires */}
                      <span className="text-ui-sm text-gray-500 whitespace-nowrap">
                        <Users className="w-3 h-3 inline mr-0.5" />{session.subcontract_nb_trainees || 0}
                      </span>
                      {/* Tarif */}
                      <span className="text-ui-sm font-medium text-[rgb(var(--c-warning))] whitespace-nowrap">
                        {parseFloat(session.subcontract_daily_rate || 0).toFixed(0)}€/j
                      </span>
                      {/* Statut */}
                      <span className={`text-ui-sm px-1.5 py-0.5 rounded-full ${
                        session.subcontract_invoiced ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' :
                        session.status === 'completed' ? 'bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]' :
                        session.status === 'cancelled' ? 'bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {session.subcontract_invoiced ? 'Fact.' : statusLabels[session.status]?.label || session.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {d.supprimer && (
                      <button onClick={(e) => handleDelete(session.id, e)} className="p-1 hover:bg-[rgb(var(--c-danger-bg))] rounded [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 transition-opacity" title="Supprimer">
                        <Trash2 className="w-3.5 h-3.5 text-[rgb(var(--c-danger))]" />
                      </button>
                      )}
                      <ChevronRight className="w-4 h-4 text-[rgb(var(--c-warning))]" />
                    </div>
                  </div>
                </Link>
              )
            }

            // ─── Carte STANDARD (intra / inter / public) ─────────
            return (
              <Link
                key={session.id}
                to={`/sessions/${session.id}`}
                className="card block hover:shadow-md transition-shadow group"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <span className="text-ui font-mono text-gray-500">{session.reference}</span>
                      <BadgeTest tbl="sessions" id={session.id} />
                      <StatusBadge kind="session" status={session.status} />
                      {session.is_intra && (
                        <span className="text-ui-sm text-gray-500">Intra</span>
                      )}
                    </div>
                    
                    <h3 className="font-semibold text-gray-900 text-lg">
                      {session.courses?.title || 'Formation'}
                    </h3>
                    <p className="text-gray-600">{session.clients?.name}</p>
                    
                    <div className="flex flex-wrap items-center gap-4 mt-3 text-ui text-gray-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {session.start_date ? format(new Date(session.start_date), 'd MMM yyyy', { locale: fr }) : 'Date à définir'}
                        {session.end_date && session.end_date !== session.start_date && (
                          <> - {format(new Date(session.end_date), 'd MMM yyyy', { locale: fr })}</>
                        )}
                      </span>
                      
                      {(session.location_name || session.location) && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-4 h-4" />
                          {session.location_name || session.location}
                        </span>
                      )}
                      
                      <span className="flex items-center gap-1">
                        <Users className="w-4 h-4" />
                        {session.session_trainees?.length || 0} stagiaire(s)
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {d.creer && (
                    <button
                      onClick={(e) => handleDuplicate(session.id, e)}
                      className="p-2 hover:bg-gray-100 rounded-ui-sm [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                      title="Dupliquer"
                    >
                      <Copy className="w-4 h-4 text-gray-500" />
                    </button>
                    )}
                    {d.supprimer && (
                    <button
                      onClick={(e) => handleDelete(session.id, e)}
                      className="p-2 hover:bg-[rgb(var(--c-danger-bg))] rounded-ui-sm [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                      title="Supprimer"
                    >
                      <Trash2 className="w-4 h-4 text-[rgb(var(--c-danger))]" />
                    </button>
                    )}
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  </div>
                </div>
              </Link>
            )
          })
        )}
      </div>
      </>}
      
      {/* Modal création */}
      {showForm && d.creer && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className={`bg-white rounded-ui shadow-md w-full my-8 ${formData.session_type === 'subcontract' && batchMode ? 'max-w-4xl' : 'max-w-2xl'}`}>
            <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white rounded-t-xl z-10">
              <h2 className="text-xl font-semibold">Nouvelle session</h2>
              <button onClick={resetForm} className="p-2 hover:bg-gray-100 rounded-ui-sm">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Toggle type de session */}
              <div className="flex items-center gap-1 bg-gray-100 rounded-ui-sm p-1">
                <button type="button"
                  onClick={() => setFormData({ ...formData, session_type: 'intra' })}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-ui font-medium rounded-ui-sm transition-all
                    ${formData.session_type !== 'subcontract' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <Calendar className="w-4 h-4" />
                  Formation directe
                </button>
                <button type="button"
                  onClick={() => setFormData({ ...formData, session_type: 'subcontract', funding_type: 'none', course_id: '' })}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-ui font-medium rounded-ui-sm transition-all
                    ${formData.session_type === 'subcontract' ? 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] shadow-sm border border-[rgb(var(--c-warning)/0.3)]' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <Briefcase className="w-4 h-4" />
                  Sous-traitance
                </button>
              </div>

              {/* ═══ FORMULAIRE SOUS-TRAITANCE ═══ */}
              {formData.session_type === 'subcontract' && (
                <>
                  <div className="bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] rounded-ui-sm p-3 text-ui text-[rgb(var(--c-warning))] flex items-center justify-between gap-2 flex-wrap">
                    <span><Briefcase className="w-4 h-4 inline mr-1.5" />Sous-traitance - {batchMode ? 'création par lot' : 'session unique'}</span>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setShowImportModal(true)}
                        className="px-3 py-1 rounded-full text-ui-sm font-medium bg-white text-[rgb(var(--c-warning))] border border-[rgb(var(--c-warning)/0.3)] hover:bg-[rgb(var(--c-warning-bg))] flex items-center gap-1">
                        <ClipboardPaste className="w-3 h-3" /> Importer planning
                      </button>
                      <button type="button" onClick={() => setBatchMode(!batchMode)}
                        className={`px-3 py-1 rounded-full text-ui-sm font-medium transition-colors ${batchMode ? 'bg-[rgb(var(--c-warning))] text-white' : 'bg-white text-[rgb(var(--c-warning))] border border-[rgb(var(--c-warning)/0.3)] hover:bg-[rgb(var(--c-warning-bg))]'}`}>
                        {batchMode ? '← Session unique' : 'Créer par lot →'}
                      </button>
                    </div>
                  </div>
                  
                  {/* En-tête partagé (client, formateur, lieu, horaires, tarif par défaut) */}
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="label">Donneur d'ordre (OF) *</label>
                      <SearchSelect value={formData.client_id} onChange={(v) => setFormData({ ...formData, client_id: v })} required
                        options={[
                          ...clientOptions(clients.filter(c => c.client_type === 'organisme_formation')).map(o => ({ ...o, group: 'Organismes de formation' })),
                          ...clientOptions(clients.filter(c => c.client_type !== 'organisme_formation')).map(o => ({ ...o, group: 'Autres clients' })),
                        ]}
                        emptyLabel="Sélectionner..." searchPlaceholder="Nom, ville, SIRET..." aria-label="Client" />
                    </div>
                    <div>
                      <label className="label">Formateur</label>
                      <select value={formData.trainer_ids[0] || ''} onChange={(e) => setFormData({ ...formData, trainer_ids: e.target.value ? [e.target.value] : [] })} className="input">
                        <option value="">Sélectionner...</option>
                        {trainers.map(trainer => (
                          <option key={trainer.id} value={trainer.id}>{trainer.first_name} {trainer.last_name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="label">Lieu par défaut</label>
                      <input type="text" value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })} className="input" placeholder="Adresse de la formation" />
                    </div>
                    <div>
                      <label className="label">Tarif journalier HT par défaut (€)</label>
                      <div className="relative">
                        <input type="number" min="0" step="0.01" value={formData.subcontract_daily_rate} onChange={(e) => setFormData({ ...formData, subcontract_daily_rate: e.target.value })} className="input pr-8" placeholder="0.00" />
                        <Euro className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      </div>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div><label className="label">Heure début</label><input type="time" value={formData.start_time} onChange={(e) => setFormData({ ...formData, start_time: e.target.value })} className="input" /></div>
                    <div><label className="label">Heure fin</label><input type="time" value={formData.end_time} onChange={(e) => setFormData({ ...formData, end_time: e.target.value })} className="input" /></div>
                  </div>

                  <div>
                    <label className="label">Intitulé de base de la formation {batchMode ? '*' : ''}</label>
                    <input type="text" value={formData.subcontract_course_title} onChange={(e) => setFormData({ ...formData, subcontract_course_title: e.target.value })} className="input" placeholder="Ex: CACES R.489" />
                    {batchMode && formData.subcontract_course_title && (
                      <p className="text-ui-sm text-gray-400 mt-1">Chaque session sera nommée : <span className="text-gray-600">{formData.subcontract_course_title} - Réf. [numéro]</span></p>
                    )}
                  </div>

                  {/* ═══ MODE UNIQUE ═══ */}
                  {!batchMode && (
                    <>
                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <label className="label">Réf. donneur d'ordre</label>
                          <input type="text" value={formData.subcontract_client_ref} onChange={(e) => setFormData({ ...formData, subcontract_client_ref: e.target.value })} className="input" placeholder="Réf. client" />
                        </div>
                        <div>
                          <label className="label">Nombre de stagiaires</label>
                          <input type="number" min="0" value={formData.subcontract_nb_trainees} onChange={(e) => setFormData({ ...formData, subcontract_nb_trainees: e.target.value })} className="input" placeholder="0" />
                        </div>
                      </div>
                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <label className="label">Date de début *</label>
                          <input type="date" value={formData.start_date} required onChange={(e) => { const d = e.target.value; setFormData({ ...formData, start_date: d, end_date: formData.end_date && formData.end_date < d ? d : (formData.end_date || d) }) }} className="input" />
                        </div>
                        <div>
                          <label className="label">Date de fin *</label>
                          <input type="date" value={formData.end_date} min={formData.start_date} required onChange={(e) => setFormData({ ...formData, end_date: e.target.value })} className="input" />
                        </div>
                      </div>
                      {formData.subcontract_daily_rate && formData.start_date && formData.end_date && (
                        <div className="bg-[rgb(var(--c-success-bg))] border border-[rgb(var(--c-success)/0.3)] rounded-ui-sm p-3 text-ui">
                          {(() => {
                            const days = Math.max(1, Math.round((new Date(formData.end_date) - new Date(formData.start_date)) / 86400000) + 1)
                            const total = days * parseFloat(formData.subcontract_daily_rate || 0)
                            return (
                              <div className="flex justify-between items-center">
                                <span className="text-[rgb(var(--c-success))]">{days} jour{days > 1 ? 's' : ''} × {parseFloat(formData.subcontract_daily_rate).toFixed(2)} €</span>
                                <span className="font-bold text-[rgb(var(--c-success))] text-lg">{total.toFixed(2)} € HT</span>
                              </div>
                            )
                          })()}
                        </div>
                      )}
                    </>
                  )}

                  {/* ═══ MODE BATCH ═══ */}
                  {batchMode && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-[1fr_110px_70px_60px_32px] gap-2 text-ui-sm font-medium text-gray-500 px-1">
                        <span>Réf. client *</span>
                        <span>Date début *</span>
                        <span>Durée</span>
                        <span>Stag.</span>
                        <span></span>
                      </div>
                      {batchLines.map((line, idx) => {
                        const dur = parseInt(line.duration_days) || 1
                        const rate = parseFloat(formData.subcontract_daily_rate) || 0
                        const lineTotal = dur * rate
                        const endDate = line.start_date ? (() => { const d = new Date(line.start_date); d.setDate(d.getDate() + dur - 1); return format(d, 'dd/MM', { locale: fr }) })() : ''
                        return (
                          <div key={idx} className="grid grid-cols-[1fr_110px_70px_60px_32px] gap-2 items-center">
                            <input type="text" value={line.client_ref} placeholder="2026-02-046"
                              onChange={(e) => { const u = [...batchLines]; u[idx].client_ref = e.target.value; setBatchLines(u) }}
                              className="px-2 py-1.5 border rounded text-ui font-mono" />
                            <input type="date" value={line.start_date}
                              onChange={(e) => { const u = [...batchLines]; u[idx].start_date = e.target.value; setBatchLines(u) }}
                              className="px-1.5 py-1.5 border rounded text-ui" />
                            <div className="flex items-center gap-1">
                              <input type="number" min="1" max="30" value={line.duration_days}
                                onChange={(e) => { const u = [...batchLines]; u[idx].duration_days = e.target.value; setBatchLines(u) }}
                                className="w-12 px-1.5 py-1.5 border rounded text-ui text-center" />
                              <span className="text-ui-sm text-gray-400">j</span>
                            </div>
                            <input type="number" min="0" value={line.nb_trainees} placeholder="1"
                              onChange={(e) => { const u = [...batchLines]; u[idx].nb_trainees = e.target.value; setBatchLines(u) }}
                              className="px-1.5 py-1.5 border rounded text-ui text-center" />
                            <button type="button" onClick={() => { if (batchLines.length > 1) setBatchLines(batchLines.filter((_, i) => i !== idx)) }}
                              disabled={batchLines.length <= 1}
                              className="p-1 text-[rgb(var(--c-danger))] hover:text-[rgb(var(--c-danger))] disabled:opacity-30">
                              <Trash2 className="w-4 h-4" />
                            </button>
                            {line.start_date && (
                              <div className="col-span-full flex justify-between text-ui-sm text-gray-400 -mt-1 px-1">
                                <span>{formData.subcontract_course_title ? `${formData.subcontract_course_title} - Réf. ${line.client_ref || '…'}` : `Réf. ${line.client_ref || '…'}`}{endDate ? ` · → ${endDate}` : ''}</span>
                                {lineTotal > 0 && <span className="text-[rgb(var(--c-success))] font-medium">{dur}j × {rate.toFixed(0)}€ = {lineTotal.toFixed(2)}€</span>}
                              </div>
                            )}
                          </div>
                        )
                      })}
                      <div className="flex items-center justify-between pt-1">
                        <button type="button"
                          onClick={() => setBatchLines([...batchLines, { client_ref: '', start_date: batchLines[batchLines.length - 1]?.start_date || '', duration_days: '1', nb_trainees: '1' }])}
                          className="text-ui text-[rgb(var(--c-warning))] hover:text-[rgb(var(--c-warning))] flex items-center gap-1">
                          <Plus className="w-4 h-4" /> Ajouter une ligne
                        </button>
                        {batchLines.filter(l => l.client_ref && l.start_date).length > 0 && (
                          <div className="bg-[rgb(var(--c-success-bg))] border border-[rgb(var(--c-success)/0.3)] rounded-ui-sm px-3 py-2 text-ui">
                            {(() => {
                              const validLines = batchLines.filter(l => l.client_ref && l.start_date)
                              const totalDays = validLines.reduce((s, l) => s + Math.max(1, parseInt(l.duration_days) || 1), 0)
                              const rate = parseFloat(formData.subcontract_daily_rate) || 0
                              const totalAmount = totalDays * rate
                              return (
                                <span className="text-[rgb(var(--c-success))]">
                                  <strong>{validLines.length}</strong> session{validLines.length > 1 ? 's' : ''} · {totalDays}j · <strong className="text-[rgb(var(--c-success))]">{totalAmount.toFixed(2)} € HT</strong>
                                </span>
                              )
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ═══ FORMULAIRE STANDARD (formation directe) ═══ */}
              {formData.session_type !== 'subcontract' && (
                <>
              {/* Session inter (lot 2, 0044) : plusieurs entreprises ou particuliers, un groupe chacun */}
              <label className="flex items-start gap-2 text-ui text-gray-800">
                <input type="checkbox" className="mt-0.5" checked={formData.session_type === 'inter'}
                  onChange={(e) => setFormData({ ...formData, session_type: e.target.checked ? 'inter' : 'intra', is_intra: e.target.checked ? false : formData.is_intra })} />
                <span>Session inter : plusieurs entreprises ou particuliers inscrits<span className="block text-ui-sm text-gray-500">Chaque inscription devient un groupe (onglet Groupes de la session) avec sa convention ou son contrat et sa facture.</span></span>
              </label>
              {/* Formation et Client */}
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Formation *</label>
                  <SearchSelect
                    value={formData.course_id}
                    onChange={(v) => setFormData({ ...formData, course_id: v })}
                    required
                    options={courseOptions(courses)}
                    emptyLabel="Sélectionner..." searchPlaceholder="Rechercher une formation..." aria-label="Formation" />
                </div>
                
                <div>
                  <label className="label">{formData.session_type === 'inter' ? 'Client principal (facultatif)' : 'Client *'}</label>
                  <SearchSelect
                    value={formData.client_id}
                    onChange={(v) => setFormData({ ...formData, client_id: v })}
                    required={formData.session_type !== 'inter'}
                    options={clientOptions(clients)}
                    emptyLabel="Sélectionner..." searchPlaceholder="Nom, ville, SIRET..." aria-label="Client" />
                </div>
              </div>
              
              {/* Contact pour la session */}
              {formData.client_id && (
                <div className="bg-[rgb(var(--c-info-bg))] rounded-ui-sm p-4">
                  <label className="label text-[rgb(var(--c-info))]">Contact pour cette session</label>
                  <select
                    value={formData.contact_id}
                    onChange={(e) => setFormData({ ...formData, contact_id: e.target.value })}
                    className="input"
                  >
                    <option value=""> Contact générique (entreprise)</option>
                    {clientContacts.length > 0 && (
                      <>
                        <optgroup label="Contacts spécifiques">
                          {clientContacts.map(contact => (
                            <option key={contact.id} value={contact.id}>
                               {contact.name}{contact.role ? ` (${contact.role})` : ''}
                            </option>
                          ))}
                        </optgroup>
                      </>
                    )}
                  </select>
                  <p className="text-ui-sm text-[rgb(var(--c-info))] mt-1">
                    Ce contact sera mentionné sur les convocations
                  </p>
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="label text-ui-sm text-[rgb(var(--c-info))]">Signataire convention</label>
                      <input
                        type="text"
                        value={formData.signatory_name}
                        onChange={(e) => setFormData({ ...formData, signatory_name: e.target.value })}
                        className="input"
                        placeholder="Ex: Frédéric LE REGENT"
                      />
                    </div>
                    <div>
                      <label className="label text-ui-sm text-[rgb(var(--c-info))]">Fonction signataire</label>
                      <input
                        type="text"
                        value={formData.signatory_role}
                        onChange={(e) => setFormData({ ...formData, signatory_role: e.target.value })}
                        className="input"
                        placeholder="Ex: Dirigeant"
                      />
                    </div>
                  </div>
                  <p className="text-ui-sm text-[rgb(var(--c-info))] mt-1">
                    Si vide, le contact ci-dessus sera utilisé comme signataire sur la convention
                  </p>
                </div>
              )}
              
              {/* Dates */}
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Date de début *</label>
                  <input
                    type="date"
                    value={formData.start_date}
                    onChange={(e) => {
                      const newStart = e.target.value
                      const newEnd = formData.end_date && formData.end_date < newStart ? newStart : (formData.end_date || newStart)
                      setFormData({ ...formData, start_date: newStart, end_date: newEnd })
                    }}
                    className="input"
                    required
                  />
                </div>
                <div>
                  <label className="label">Date de fin *</label>
                  <input
                    type="date"
                    value={formData.end_date}
                    min={formData.start_date}
                    onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                    className="input"
                    required
                  />
                </div>
              </div>
              
              {/* Horaires */}
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label className="label">Heure de début</label>
                  <input
                    type="time"
                    value={formData.start_time}
                    onChange={(e) => setFormData({ ...formData, start_time: e.target.value, day_type: dayTypeFromTimes(e.target.value, formData.end_time) })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Heure de fin</label>
                  <input
                    type="time"
                    value={formData.end_time}
                    onChange={(e) => setFormData({ ...formData, end_time: e.target.value, day_type: dayTypeFromTimes(formData.start_time, e.target.value) })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Type de journée</label>
                  <select
                    value={formData.day_type}
                    onChange={(e) => setFormData({ ...formData, day_type: e.target.value })}
                    className="input"
                  >
                    <option value="full">Journée complète (2 émargements/jour)</option>
                    <option value="half">Demi-journée (1 émargement/jour)</option>
                  </select>
                </div>
              </div>
              
              {/* Type de financement */}
              <div className="p-4 bg-[rgb(var(--c-info-bg))] rounded-ui-sm space-y-4">
                <h3 className="font-medium text-[rgb(var(--c-info))]">Financement de la formation</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Type de financement *</label>
                    <select
                      value={formData.funding_type}
                      onChange={(e) => setFormData({ ...formData, funding_type: e.target.value })}
                      className="input"
                      required
                    >
                      <option value="">Sélectionner...</option>
                      <option value="none">Aucun (pas de mention)</option>
                      <option value="opco">OPCO</option>
                      <option value="cpf">CPF</option>
                      <option value="faf">FAF</option>
                      <option value="region">Région</option>
                      <option value="france_travail">France Travail</option>
                      <option value="ptp">PTP (Plan de Transition Professionnel)</option>
                      <option value="fne">FNE (Fonds National de l'Emploi)</option>
                      <option value="direct">Financement direct</option>
                      <option value="other">Autre</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Précisions (optionnel)</label>
                    <input
                      type="text"
                      value={formData.funding_details}
                      onChange={(e) => setFormData({ ...formData, funding_details: e.target.value })}
                      className="input"
                      placeholder="Ex : OPCO, Région, France Travail..."
                    />
                  </div>
                </div>
                <p className="text-ui-sm text-[rgb(var(--c-info))]">
                  {formData.funding_type === 'none' 
                    ? 'Aucune mention de financement ne sera ajoutée à la convention' 
                    : 'Le type de financement sera mentionné dans la convention'}
                </p>
              </div>
              
              {/* Intra + Lieu */}
              <div className="p-4 bg-gray-50 rounded-ui-sm space-y-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_intra}
                    onChange={(e) => setFormData({ ...formData, is_intra: e.target.checked })}
                    className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <div>
                    <span className="font-medium">Formation Intra-entreprise</span>
                    <p className="text-ui text-gray-500">La formation se déroule chez le client</p>
                  </div>
                </label>
                
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Lieu</label>
                    <input
                      type="text"
                      value={formData.location}
                      onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                      className="input"
                      placeholder={formData.is_intra ? 'Adresse du client' : 'Adresse ou "Distanciel"'}
                    />
                  </div>
                  <div>
                    <label className="label">Salle</label>
                    <input
                      type="text"
                      value={formData.room}
                      onChange={(e) => setFormData({ ...formData, room: e.target.value })}
                      className="input"
                      placeholder="Salle de réunion, etc."
                    />
                  </div>
                </div>
              </div>
              
              {/* Formateur */}
              <div>
                <label className="label">Formateur(s)</label>
                <select
                  multiple
                  value={formData.trainer_ids}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    trainer_ids: Array.from(e.target.selectedOptions, opt => opt.value) 
                  })}
                  className="input h-24"
                >
                  {trainers.map(trainer => (
                    <option key={trainer.id} value={trainer.id}>
                      {trainer.first_name} {trainer.last_name}
                    </option>
                  ))}
                </select>
                <p className="text-ui-sm text-gray-500 mt-1">Ctrl+clic pour sélectionner plusieurs</p>
              </div>
              
              {/* Stagiaires avec filtres */}
              <div className="border rounded-ui-sm p-4">
                <label className="label mb-3">Stagiaires à inscrire</label>
                
                {/* Filtres stagiaires */}
                <div className="flex gap-2 mb-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Rechercher un stagiaire..."
                      value={traineeSearch}
                      onChange={(e) => setTraineeSearch(e.target.value)}
                      className="input pl-8 py-1.5 text-ui"
                    />
                  </div>
                  <SearchSelect
                    value={traineeClientFilter}
                    onChange={(v) => setTraineeClientFilter(v)}
                    className="w-56"
                    options={clientOptions(clients, { excludeArchived: false })}
                    emptyLabel="Toutes entreprises" searchPlaceholder="Rechercher une entreprise..." aria-label="Filtrer par entreprise" />
                </div>
                
                {/* Liste stagiaires avec checkboxes */}
                <div className="max-h-48 overflow-y-auto border rounded bg-white">
                  {filteredTrainees.length === 0 ? (
                    <p className="text-ui text-gray-500 p-3 text-center">Aucun stagiaire trouvé</p>
                  ) : (
                    filteredTrainees.map(trainee => (
                      <label
                        key={trainee.id}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          checked={formData.trainee_ids.includes(trainee.id)}
                          onChange={() => toggleTrainee(trainee.id)}
                          className="rounded border-gray-300 text-primary-600"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-ui font-medium truncate">
                            {trainee.first_name} {trainee.last_name}
                          </p>
                          {trainee.clients?.name && (
                            <p className="text-ui-sm text-gray-500 truncate">{trainee.clients.name}</p>
                          )}
                        </div>
                      </label>
                    ))
                  )}
                </div>
                <p className="text-ui-sm text-gray-500 mt-2">
                  {formData.trainee_ids.length} stagiaire(s) sélectionné(s)
                </p>
              </div>
              </>)}
              
              {/* Statut */}
              <div>
                <label className="label">Statut</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="input"
                >
                  {Object.entries(statusLabels).map(([value, { label }]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              
              <div className="flex justify-end gap-3 pt-4 border-t">
                <button type="button" onClick={resetForm} className="btn btn-secondary">
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary">
                  {formData.session_type === 'subcontract' && batchMode
                    ? `Créer ${batchLines.filter(l => l.client_ref && l.start_date).length} session${batchLines.filter(l => l.client_ref && l.start_date).length > 1 ? 's' : ''}`
                    : 'Créer la session'
                  }
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {showMultiSiret && d.creer && (
        <MultiSiretWizard
          onClose={() => setShowMultiSiret(false)}
          onCreated={() => setShowMultiSiret(false)}
        />
      )}

      {/* ═══ MODAL IMPORT PLANNING ═══ */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-[60] p-4 overflow-y-auto">
          <div className="bg-white rounded-ui shadow-md w-full max-w-3xl my-8">
            <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white rounded-t-xl z-10">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <ClipboardPaste className="w-5 h-5 text-[rgb(var(--c-warning))]" /> Importer un planning
              </h2>
              <button onClick={() => { setShowImportModal(false); setImportResult(null); setImportText('') }} className="p-2 hover:bg-gray-100 rounded-ui-sm">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Étape 1: Coller */}
              {!importResult && (
                <>
                  <div className="bg-[rgb(var(--c-info-bg))] border border-[rgb(var(--c-info)/0.3)] rounded-ui-sm p-3 text-ui text-[rgb(var(--c-info))]">
                    <strong>1.</strong> Allez sur le planning du donneur d'ordre (Pilocap, AFPI…)<br />
                    <strong>2.</strong> Sélectionnez tout le texte (<kbd className="px-1 py-0.5 bg-[rgb(var(--c-info-bg))] rounded text-ui-sm">Cmd+A</kbd>) puis copiez (<kbd className="px-1 py-0.5 bg-[rgb(var(--c-info-bg))] rounded text-ui-sm">Cmd+C</kbd>)<br />
                    <strong>3.</strong> Collez ci-dessous (<kbd className="px-1 py-0.5 bg-[rgb(var(--c-info-bg))] rounded text-ui-sm">Cmd+V</kbd>)
                  </div>
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    rows={12}
                    className="w-full border rounded-ui-sm px-3 py-2 text-ui font-mono resize-y"
                    placeholder="Collez ici le planning copié..."
                  />
                  <div className="flex justify-between items-center">
                    <p className="text-ui-sm text-gray-400">{importText.length > 0 ? `${importText.length} caractères` : ''}</p>
                    <button
                      type="button"
                      onClick={parseImportText}
                      disabled={importParsing || importText.trim().length < 20}
                      className="btn btn-secondary text-ui font-medium disabled:opacity-50 flex items-center gap-2"
                    >
                      {importParsing ? <><Loader2 className="w-4 h-4 animate-spin" /> Analyse en cours...</> : <><Search className="w-4 h-4" /> Analyser le planning</>}
                    </button>
                  </div>
                </>
              )}

              {/* Étape 2: Preview */}
              {importResult && (
                <>
                  <div className="bg-[rgb(var(--c-success-bg))] border border-[rgb(var(--c-success)/0.3)] rounded-ui-sm p-3 text-ui text-[rgb(var(--c-success))] flex items-center justify-between">
                    <span>
                      <Check className="w-4 h-4 inline mr-1" />
                      <strong>{importResult.days.length}</strong> jour(s) détecté(s) - <strong>{importResult.total_unique_trainees}</strong> stagiaire(s) uniques
                      {importResult.detected_training_type && <span className="ml-2 text-[rgb(var(--c-success))]">({importResult.detected_training_type})</span>}
                    </span>
                    <button type="button" onClick={() => { setImportResult(null) }} className="text-ui-sm text-[rgb(var(--c-success))] hover:text-[rgb(var(--c-success))] underline">
                      ← Recoller
                    </button>
                  </div>

                  {/* Champs obligatoires pour la création */}
                  <div className="bg-gray-50 rounded-ui-sm p-3 space-y-3">
                    <p className="text-ui-sm font-medium text-gray-500 uppercase">Paramètres de création</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-ui-sm text-gray-500 block mb-1">Client *</label>
                        <SearchSelect value={formData.client_id} onChange={(v) => setFormData({ ...formData, client_id: v })}
                          options={[
                          ...clientOptions(clients.filter(c => c.client_type === 'organisme_formation')).map(o => ({ ...o, group: 'Organismes de formation' })),
                          ...clientOptions(clients.filter(c => c.client_type !== 'organisme_formation')).map(o => ({ ...o, group: 'Autres clients' })),
                        ]}
                          emptyLabel="Sélectionner..." searchPlaceholder="Nom, ville, SIRET..." aria-label="Client" />
                      </div>
                      <div>
                        <label className="text-ui-sm text-gray-500 block mb-1">Formateur</label>
                        <select value={formData.trainer_ids[0] || ''} onChange={(e) => setFormData({ ...formData, trainer_ids: e.target.value ? [e.target.value] : [] })} className="w-full border rounded-ui-sm px-3 py-1.5 text-ui">
                          <option value="">Sélectionner...</option>
                          {trainers.map(t => (
                            <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-ui-sm text-gray-500 block mb-1">Intitulé de base</label>
                        <input type="text" value={formData.subcontract_course_title} onChange={(e) => setFormData({ ...formData, subcontract_course_title: e.target.value })} className="w-full border rounded-ui-sm px-3 py-1.5 text-ui" placeholder={importResult.detected_training_type || 'CACES R.489'} />
                      </div>
                      <div>
                        <label className="text-ui-sm text-gray-500 block mb-1">Tarif journalier HT (€) *</label>
                        <input type="number" min="0" step="0.01" value={formData.subcontract_daily_rate} onChange={(e) => setFormData({ ...formData, subcontract_daily_rate: e.target.value })} className="w-full border rounded-ui-sm px-3 py-1.5 text-ui" placeholder="300" />
                      </div>
                    </div>
                    {!formData.client_id && <p className="text-ui-sm text-[rgb(var(--c-danger))]"> Sélectionnez un client pour pouvoir créer</p>}
                  </div>

                  {/* Champs essentiels pour la création */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="text-ui-sm text-gray-500 block mb-1">Client *</label>
                      <SearchSelect value={formData.client_id} onChange={(v) => setFormData({ ...formData, client_id: v })}
                        options={clientOptions(clients.filter(c => c.status !== 'inactif'))}
                        emptyLabel="Sélectionner..." searchPlaceholder="Nom, ville, SIRET..." aria-label="Client" />
                    </div>
                    <div>
                      <label className="text-ui-sm text-gray-500 block mb-1">Formateur</label>
                      <select value={formData.trainer_ids[0] || ''} onChange={(e) => setFormData({ ...formData, trainer_ids: e.target.value ? [e.target.value] : [] })} className="w-full border rounded-ui-sm px-2 py-1.5 text-ui">
                        <option value="">Sélectionner...</option>
                        {trainers.map(t => <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-ui-sm text-gray-500 block mb-1">Tarif/jour HT (€)</label>
                      <input type="number" min="0" step="0.01" value={formData.subcontract_daily_rate}
                        onChange={(e) => setFormData({ ...formData, subcontract_daily_rate: e.target.value })}
                        className="w-full border rounded-ui-sm px-2 py-1.5 text-ui" placeholder="300" />
                    </div>
                    <div>
                      <label className="text-ui-sm text-gray-500 block mb-1">Intitulé de base</label>
                      <input type="text" value={formData.subcontract_course_title}
                        onChange={(e) => setFormData({ ...formData, subcontract_course_title: e.target.value })}
                        className="w-full border rounded-ui-sm px-2 py-1.5 text-ui" placeholder="Intitulé de la formation" />
                    </div>
                  </div>

                  <div className="border rounded-ui-sm overflow-hidden">
                    <table className="w-full text-ui">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 w-10 text-center">
                            <input type="checkbox"
                              checked={importChecked.length === importResult.days.length}
                              onChange={(e) => setImportChecked(e.target.checked ? importResult.days.map((_, i) => i) : [])}
                              className="rounded" />
                          </th>
                          <th className="px-3 py-2 text-left">Date</th>
                          <th className="px-3 py-2 text-left">Réfs sessions</th>
                          <th className="px-3 py-2 text-center">Stag.</th>
                          <th className="px-3 py-2 text-left">Lieu</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importResult.days.map((day, idx) => (
                          <tr key={idx} className={`border-t ${importChecked.includes(idx) ? '' : 'opacity-40'}`}>
                            <td className="px-3 py-2 text-center">
                              <input type="checkbox"
                                checked={importChecked.includes(idx)}
                                onChange={(e) => {
                                  setImportChecked(prev => e.target.checked ? [...prev, idx] : prev.filter(i => i !== idx))
                                }}
                                className="rounded" />
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap font-medium">
                              {day.date ? format(new Date(day.date), 'EEE dd/MM', { locale: fr }) : '?'}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1">
                                {(day.session_refs || []).map((ref, ri) => (
                                  <span key={ri} className="px-1.5 py-0.5 bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] text-ui-sm rounded font-mono">{ref}</span>
                                ))}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-center font-semibold">{day.nb_trainees || 0}</td>
                            <td className="px-3 py-2 text-ui-sm text-gray-500 max-w-[200px] truncate">{day.location || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50 font-semibold">
                        <tr className="border-t">
                          <td></td>
                          <td className="px-3 py-2">{importChecked.length} jour(s)</td>
                          <td></td>
                          <td className="px-3 py-2 text-center">{importResult.total_unique_trainees || '?'}</td>
                          <td className="px-3 py-2 text-right">
                            {formData.subcontract_daily_rate && (
                              <span className="text-[rgb(var(--c-success))]">
                                {importChecked.length} × {parseFloat(formData.subcontract_daily_rate).toFixed(0)}€ = <strong>{(importChecked.length * parseFloat(formData.subcontract_daily_rate)).toFixed(2)}€ HT</strong>
                              </span>
                            )}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {importResult.notes && (
                    <p className="text-ui-sm text-gray-500 italic">{importResult.notes}</p>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-end gap-3 p-4 border-t">
              <button type="button" onClick={() => { setShowImportModal(false); setImportResult(null); setImportText('') }}
                className="px-4 py-2 text-ui text-gray-600 hover:text-gray-800">Annuler</button>
              {importResult && (
                <button type="button" onClick={handleImportCreate}
                  disabled={importChecked.length === 0 || !formData.client_id}
                  className="btn btn-secondary text-ui font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  {!formData.client_id ? 'Sélectionnez un client' : `Créer ${importChecked.length} session${importChecked.length > 1 ? 's' : ''}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
