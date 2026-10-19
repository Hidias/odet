import { teamFirstNameByEmail, currentUserName as fullName, teamNames } from '../../../core/org/currentOrg'
import { useEffect, useState } from 'react'
import { useDataStore, useAuthStore } from '../../../core/store'
import { supabase } from '../../../core/supabase'
import { fetchAll } from '../../../core/fetchAll'
import { 
  AlertTriangle, Plus, Search, X, CheckCircle, Clock, AlertCircle,
  ChevronRight, Edit, Trash2, Save, FileText, Calendar, MessageSquare,
  Phone, Mail, FileInput, Users, Building2, User, Filter
} from 'lucide-react'
import { format, differenceInHours, differenceInBusinessDays } from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'
import SearchSelect from '../../../ui/SearchSelect'

import { confirmer } from '../../../ui/Confirm'
const getUserName = (email) => teamFirstNameByEmail(email) || 'Utilisateur'

// ===== CONFIG NC =====
const ncSourceLabels = {
  evaluation: { label: 'Évaluation stagiaire', icon: FileText },
  audit: { label: 'Audit', icon: Search },
  reclamation: { label: 'Réclamation', icon: AlertCircle },
  interne: { label: 'Constat interne', icon: AlertTriangle },
  autre: { label: 'Autre', icon: FileText },
}

const severityLabels = {
  minor: { label: 'Mineure', class: 'badge-yellow' },
  major: { label: 'Majeure', class: 'badge-orange' },
  critical: { label: 'Critique', class: 'badge-red' },
}

const ncStatusLabels = {
  open: { label: 'Ouverte', class: 'badge-red' },
  in_progress: { label: 'En cours', class: 'badge-yellow' },
  resolved: { label: 'Résolue', class: 'badge-blue' },
  closed: { label: 'Clôturée', class: 'badge-green' },
}

// ===== CONFIG RÉCLAMATIONS =====
const reclSourceLabels = {
  client: { label: 'Client', icon: Building2 },
  stagiaire: { label: 'Stagiaire', icon: User },
  financeur: { label: 'Financeur', icon: Users },
  autre: { label: 'Autre', icon: FileText },
}

const reclCanalLabels = {
  email: { label: 'Email', icon: Mail },
  telephone: { label: 'Téléphone', icon: Phone },
  courrier: { label: 'Courrier', icon: FileText },
  formulaire: { label: 'Formulaire', icon: FileInput },
  autre: { label: 'Autre', icon: MessageSquare },
}

const reclStatusLabels = {
  open: { label: 'Ouverte', class: 'badge-red' },
  acknowledged: { label: 'AR envoyé', class: 'badge-blue' },
  in_progress: { label: 'En traitement', class: 'badge-yellow' },
  resolved: { label: 'Résolue', class: 'badge-purple' },
  closed: { label: 'Clôturée', class: 'badge-green' },
}

export default function NonConformites() {
  const { sessions, fetchSessions } = useDataStore()
  const { user } = useAuthStore()
  const myName = getUserName(user?.email)
  
  // Onglet actif
  const [activeTab, setActiveTab] = useState('nc') // 'nc' ou 'reclamations'
  
  // ===== STATE NC =====
  const [nonConformites, setNonConformites] = useState([])
  const [loadingNC, setLoadingNC] = useState(true)
  const [searchNC, setSearchNC] = useState('')
  const [statusFilterNC, setStatusFilterNC] = useState('')
  const [showFormNC, setShowFormNC] = useState(false)
  const [editingNC, setEditingNC] = useState(null)
  const [formDataNC, setFormDataNC] = useState({
    source: 'evaluation', session_id: '', title: '', description: '',
    critere_qualiopi: '', severity: 'minor', status: 'open',
    cause_analysis: '', corrective_action: '', action_responsible: '',
    action_deadline: '', preventive_action: '',
  })
  
  // ===== STATE RÉCLAMATIONS =====
  const [reclamations, setReclamations] = useState([])
  const [loadingRecl, setLoadingRecl] = useState(true)
  const [searchRecl, setSearchRecl] = useState('')
  const [statusFilterRecl, setStatusFilterRecl] = useState('')
  const [showFormRecl, setShowFormRecl] = useState(false)
  const [editingRecl, setEditingRecl] = useState(null)
  const [formDataRecl, setFormDataRecl] = useState({
    source: 'client', canal: 'email', subject: '', description: '',
    session_id: '', responsable: fullName(), status: 'open',
    cause_analysis: '', solution_proposed: '', action_taken: '', preventive_action: '',
  })
  
  useEffect(() => {
    fetchSessions()
    loadNonConformites()
    loadReclamations()
  }, [])
  
  // ===== CHARGEMENT NC =====
  const loadNonConformites = async () => {
    setLoadingNC(true)
    const { data, error } = await fetchAll(() => supabase.from('non_conformites').select('*').order('created_at', { ascending: false }))
    if (!error) setNonConformites(data || [])
    setLoadingNC(false)
  }
  
  // ===== CHARGEMENT RÉCLAMATIONS =====
  const loadReclamations = async () => {
    setLoadingRecl(true)
    const { data, error } = await fetchAll(() => supabase.from('reclamations').select('*').order('created_at', { ascending: false }))
    if (!error) setReclamations(data || [])
    else console.error('Error loading reclamations:', error)
    setLoadingRecl(false)
  }
  
  // ===== FILTRAGE NC =====
  const filteredNC = nonConformites.filter(nc => {
    const matchSearch = nc.title?.toLowerCase().includes(searchNC.toLowerCase()) ||
      nc.description?.toLowerCase().includes(searchNC.toLowerCase())
    const matchStatus = !statusFilterNC || nc.status === statusFilterNC
    return matchSearch && matchStatus
  })
  
  // ===== FILTRAGE RÉCLAMATIONS =====
  const filteredRecl = reclamations.filter(r => {
    const matchSearch = r.subject?.toLowerCase().includes(searchRecl.toLowerCase()) ||
      r.description?.toLowerCase().includes(searchRecl.toLowerCase()) ||
      r.reference?.toLowerCase().includes(searchRecl.toLowerCase())
    const matchStatus = !statusFilterRecl || r.status === statusFilterRecl
    return matchSearch && matchStatus
  })
  
  // ===== CRUD NC =====
  const handleSubmitNC = async (e) => {
    e.preventDefault()
    if (!formDataNC.title) { toast.error('Titre requis'); return }
    
    try {
      if (editingNC) {
        const { error } = await supabase.from('non_conformites').update({
          ...formDataNC, updated_at: new Date().toISOString()
        }).eq('id', editingNC.id)
        if (error) throw error
        toast.success('NC mise à jour')
      } else {
        const { error } = await supabase.from('non_conformites').insert({
          ...formDataNC, created_by: user?.email
        })
        if (error) throw error
        toast.success('NC créée')
      }
      resetFormNC()
      loadNonConformites()
    } catch (e) { toast.error(e.message) }
  }
  
  const handleDeleteNC = async (id) => {
    if (!await confirmer('Supprimer cette NC ?')) return
    const { error } = await supabase.from('non_conformites').delete().eq('id', id)
    if (!error) { toast.success('NC supprimée'); loadNonConformites() }
    else toast.error(error.message)
  }
  
  const resetFormNC = () => {
    setShowFormNC(false); setEditingNC(null)
    setFormDataNC({
      source: 'evaluation', session_id: '', title: '', description: '',
      critere_qualiopi: '', severity: 'minor', status: 'open',
      cause_analysis: '', corrective_action: '', action_responsible: '',
      action_deadline: '', preventive_action: '',
    })
  }
  
  // ===== CRUD RÉCLAMATIONS =====
  const handleSubmitRecl = async (e) => {
    e.preventDefault()
    if (!formDataRecl.subject) { toast.error('Sujet requis'); return }
    
    try {
      if (editingRecl) {
        const updates = { ...formDataRecl, updated_at: new Date().toISOString() }
        // Mettre à jour les dates selon le statut
        if (formDataRecl.status === 'acknowledged' && !editingRecl.date_accuse) {
          updates.date_accuse = new Date().toISOString()
        }
        if (formDataRecl.status === 'resolved' && !editingRecl.date_resolution) {
          updates.date_resolution = new Date().toISOString()
        }
        if (formDataRecl.status === 'closed' && !editingRecl.date_cloture) {
          updates.date_cloture = new Date().toISOString()
        }
        
        const { error } = await supabase.from('reclamations').update(updates).eq('id', editingRecl.id)
        if (error) throw error
        toast.success('Réclamation mise à jour')
      } else {
        const insertData = {
          source: formDataRecl.source,
          canal: formDataRecl.canal,
          subject: formDataRecl.subject,
          description: formDataRecl.description || null,
          session_id: formDataRecl.session_id || null, // null si vide
          responsable: formDataRecl.responsable,
          status: formDataRecl.status,
          cause_analysis: formDataRecl.cause_analysis || null,
          solution_proposed: formDataRecl.solution_proposed || null,
          action_taken: formDataRecl.action_taken || null,
          preventive_action: formDataRecl.preventive_action || null,
          created_by: user?.email,
          date_reception: new Date().toISOString()
        }
        console.log('Inserting reclamation:', insertData)
        const { data, error } = await supabase.from('reclamations').insert(insertData).select()
        console.log('Insert result:', { data, error })
        if (error) throw error
        toast.success('Réclamation créée')
      }
      resetFormRecl()
      loadReclamations()
    } catch (e) { toast.error(e.message) }
  }
  
  const handleDeleteRecl = async (id) => {
    if (!await confirmer('Supprimer cette réclamation ?')) return
    const { error } = await supabase.from('reclamations').delete().eq('id', id)
    if (!error) { toast.success('Réclamation supprimée'); loadReclamations() }
    else toast.error(error.message)
  }
  
  const resetFormRecl = () => {
    setShowFormRecl(false); setEditingRecl(null)
    setFormDataRecl({
      source: 'client', canal: 'email', subject: '', description: '',
      session_id: '', responsable: fullName(), status: 'open',
      cause_analysis: '', solution_proposed: '', action_taken: '', preventive_action: '',
    })
  }
  
  // ===== CALCUL DÉLAIS RÉCLAMATIONS =====
  const getDelaiStatus = (recl) => {
    if (!recl.date_reception) return null
    const reception = new Date(recl.date_reception)
    const now = new Date()
    
    // Délai AR (48h)
    const heuresDepuisReception = differenceInHours(now, reception)
    const arEnRetard = !recl.date_accuse && heuresDepuisReception > 48
    
    // Délai clôture (5 jours ouvrés)
    const joursOuvres = differenceInBusinessDays(now, reception)
    const clotureEnRetard = recl.status !== 'closed' && joursOuvres > 5
    
    return { arEnRetard, clotureEnRetard, heuresDepuisReception, joursOuvres }
  }
  
  // ===== STATS =====
  const statsNC = {
    total: nonConformites.length,
    open: nonConformites.filter(nc => nc.status === 'open').length,
    inProgress: nonConformites.filter(nc => nc.status === 'in_progress').length,
    closed: nonConformites.filter(nc => nc.status === 'closed').length,
  }
  
  const statsRecl = {
    total: reclamations.length,
    open: reclamations.filter(r => r.status === 'open').length,
    enRetardAR: reclamations.filter(r => getDelaiStatus(r)?.arEnRetard).length,
    enRetardCloture: reclamations.filter(r => getDelaiStatus(r)?.clotureEnRetard).length,
    closed: reclamations.filter(r => r.status === 'closed').length,
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-[rgb(var(--c-danger))]" />
            Qualité & Réclamations
          </h1>
          <p className="text-ui text-gray-500 mt-1">Gestion des NC et réclamations - Indicateurs Qualiopi 31-32</p>
        </div>
      </div>
      
      {/* Onglets */}
      <div className="flex gap-2 border-b">
        <button onClick={() => setActiveTab('nc')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'nc' ? 'border-[rgb(var(--c-danger)/0.3)] text-[rgb(var(--c-danger))]' : 'border-transparent text-gray-500'}`}>
          <AlertTriangle className="w-4 h-4" />
          Non-conformités
          {statsNC.open > 0 && <span className="badge badge-red">{statsNC.open}</span>}
        </button>
        <button onClick={() => setActiveTab('reclamations')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'reclamations' ? 'border-[rgb(var(--c-warning)/0.3)] text-[rgb(var(--c-warning))]' : 'border-transparent text-gray-500'}`}>
          <MessageSquare className="w-4 h-4" />
          Réclamations
          {statsRecl.enRetardAR > 0 && <span className="badge badge-red">{statsRecl.enRetardAR}</span>}
        </button>
      </div>
      
      {/* ===== ONGLET NC ===== */}
      {activeTab === 'nc' && (
        <>
          {/* Stats NC */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card p-4 text-center"><p className="text-2xl font-bold text-gray-900">{statsNC.total}</p><p className="text-ui text-gray-500">Total</p></div>
            <div className="card p-4 text-center bg-[rgb(var(--c-danger-bg))]"><p className="text-2xl font-bold text-[rgb(var(--c-danger))]">{statsNC.open}</p><p className="text-ui text-[rgb(var(--c-danger))]">Ouvertes</p></div>
            <div className="card p-4 text-center bg-[rgb(var(--c-warning-bg))]"><p className="text-2xl font-bold text-[rgb(var(--c-warning))]">{statsNC.inProgress}</p><p className="text-ui text-[rgb(var(--c-warning))]">En cours</p></div>
            <div className="card p-4 text-center bg-[rgb(var(--c-success-bg))]"><p className="text-2xl font-bold text-[rgb(var(--c-success))]">{statsNC.closed}</p><p className="text-ui text-[rgb(var(--c-success))]">Clôturées</p></div>
          </div>
          
          {/* Filtres NC */}
          <div className="card p-4">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" placeholder="Rechercher..." value={searchNC} onChange={e => setSearchNC(e.target.value)} className="input pl-10 w-full" />
              </div>
              <select value={statusFilterNC} onChange={e => setStatusFilterNC(e.target.value)} className="input">
                <option value="">Tous statuts</option>
                {Object.entries(ncStatusLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <button onClick={() => { setShowFormNC(true); setEditingNC(null) }} className="btn btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" /> Nouvelle NC
              </button>
            </div>
          </div>
          
          {/* Liste NC */}
          <div className="card overflow-hidden">
            {loadingNC ? (
              <div className="p-8 text-center text-gray-500">Chargement...</div>
            ) : filteredNC.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <AlertTriangle className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                <p>Aucune non-conformité</p>
              </div>
            ) : (
              <div className="divide-y">
                {filteredNC.map(nc => {
                  const source = ncSourceLabels[nc.source] || ncSourceLabels.autre
                  const SourceIcon = source.icon
                  const severity = severityLabels[nc.severity] || severityLabels.minor
                  const status = ncStatusLabels[nc.status] || ncStatusLabels.open
                  const session = sessions.find(s => s.id === nc.session_id)
                  
                  return (
                    <div key={nc.id} className="p-4 hover:bg-gray-50">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <SourceIcon className="w-4 h-4 text-gray-400" />
                            <span className="font-medium">{nc.title}</span>
                            <span className={`badge ${severity.class}`}>{severity.label}</span>
                            <span className={`badge ${status.class}`}>{status.label}</span>
                          </div>
                          {nc.description && <p className="text-ui text-gray-600 mb-2">{nc.description.substring(0, 100)}...</p>}
                          <div className="flex items-center gap-4 text-ui-sm text-gray-500">
                            <span><Calendar className="w-3 h-3 inline mr-1" />{format(new Date(nc.created_at), 'dd/MM/yyyy', { locale: fr })}</span>
                            {session && <span>Session: {session.reference}</span>}
                            {nc.critere_qualiopi && <span>Indicateur Q{nc.critere_qualiopi}</span>}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => { setEditingNC(nc); setFormDataNC(nc); setShowFormNC(true) }} className="btn btn-sm btn-secondary"><Edit className="w-4 h-4" /></button>
                          <button onClick={() => handleDeleteNC(nc.id)} className="btn btn-sm btn-secondary text-[rgb(var(--c-danger))]"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
      
      {/* ===== ONGLET RÉCLAMATIONS ===== */}
      {activeTab === 'reclamations' && (
        <>
          {/* Stats Réclamations */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="card p-4 text-center"><p className="text-2xl font-bold text-gray-900">{statsRecl.total}</p><p className="text-ui text-gray-500">Total</p></div>
            <div className="card p-4 text-center bg-[rgb(var(--c-danger-bg))]"><p className="text-2xl font-bold text-[rgb(var(--c-danger))]">{statsRecl.open}</p><p className="text-ui text-[rgb(var(--c-danger))]">Ouvertes</p></div>
            <div className="card p-4 text-center bg-[rgb(var(--c-warning-bg))]"><p className="text-2xl font-bold text-[rgb(var(--c-warning))]">{statsRecl.enRetardAR}</p><p className="text-ui text-[rgb(var(--c-warning))]">AR en retard</p></div>
            <div className="card p-4 text-center bg-[rgb(var(--c-warning-bg))]"><p className="text-2xl font-bold text-[rgb(var(--c-warning))]">{statsRecl.enRetardCloture}</p><p className="text-ui text-[rgb(var(--c-warning))]">Clôture en retard</p></div>
            <div className="card p-4 text-center bg-[rgb(var(--c-success-bg))]"><p className="text-2xl font-bold text-[rgb(var(--c-success))]">{statsRecl.closed}</p><p className="text-ui text-[rgb(var(--c-success))]">Clôturées</p></div>
          </div>
          
          {/* Délais de référence */}
          <div className="bg-[rgb(var(--c-info-bg))] border border-[rgb(var(--c-info)/0.3)] rounded-ui-sm p-3 text-ui text-[rgb(var(--c-info))]">
            <strong>Délais Qualiopi :</strong> Accusé réception sous 48h • Clôture sous 5 jours ouvrés
          </div>
          
          {/* Filtres Réclamations */}
          <div className="card p-4">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" placeholder="Rechercher (ref, sujet...)..." value={searchRecl} onChange={e => setSearchRecl(e.target.value)} className="input pl-10 w-full" />
              </div>
              <select value={statusFilterRecl} onChange={e => setStatusFilterRecl(e.target.value)} className="input">
                <option value="">Tous statuts</option>
                {Object.entries(reclStatusLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <button onClick={() => { setShowFormRecl(true); setEditingRecl(null) }} className="btn btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" /> Nouvelle réclamation
              </button>
            </div>
          </div>
          
          {/* Liste Réclamations */}
          <div className="card overflow-hidden">
            {loadingRecl ? (
              <div className="p-8 text-center text-gray-500">Chargement...</div>
            ) : filteredRecl.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <MessageSquare className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                <p>Aucune réclamation</p>
              </div>
            ) : (
              <div className="divide-y">
                {filteredRecl.map(recl => {
                  const source = reclSourceLabels[recl.source] || reclSourceLabels.autre
                  const canal = reclCanalLabels[recl.canal] || reclCanalLabels.autre
                  const SourceIcon = source.icon
                  const CanalIcon = canal.icon
                  const status = reclStatusLabels[recl.status] || reclStatusLabels.open
                  const delais = getDelaiStatus(recl)
                  
                  return (
                    <div key={recl.id} className={`p-4 hover:bg-gray-50 ${delais?.clotureEnRetard ? 'bg-[rgb(var(--c-danger-bg))]' : delais?.arEnRetard ? 'bg-[rgb(var(--c-warning-bg))]' : ''}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-ui-sm font-mono bg-gray-200 px-1.5 py-0.5 rounded">{recl.reference}</span>
                            <span className="font-medium">{recl.subject}</span>
                            <span className={`badge ${status.class}`}>{status.label}</span>
                            {delais?.arEnRetard && <span className="badge badge-orange">AR en retard!</span>}
                            {delais?.clotureEnRetard && <span className="badge badge-red">Clôture en retard!</span>}
                          </div>
                          {recl.description && <p className="text-ui text-gray-600 mb-2">{recl.description.substring(0, 100)}...</p>}
                          <div className="flex items-center gap-4 text-ui-sm text-gray-500">
                            <span><SourceIcon className="w-3 h-3 inline mr-1" />{source.label}</span>
                            <span><CanalIcon className="w-3 h-3 inline mr-1" />{canal.label}</span>
                            <span><Calendar className="w-3 h-3 inline mr-1" />{format(new Date(recl.date_reception || recl.created_at), 'dd/MM/yyyy HH:mm', { locale: fr })}</span>
                            {delais && <span className="text-gray-400">{delais.joursOuvres}j ouvrés</span>}
                          </div>
                          {/* Timeline dates */}
                          <div className="flex items-center gap-3 mt-2 text-ui-sm">
                            <span className={recl.date_accuse ? 'text-[rgb(var(--c-success))]' : 'text-gray-400'}>
                              AR: {recl.date_accuse ? format(new Date(recl.date_accuse), 'dd/MM HH:mm') : '-'}
                            </span>
                            <span className={recl.date_resolution ? 'text-[rgb(var(--c-success))]' : 'text-gray-400'}>
                              Résolution: {recl.date_resolution ? format(new Date(recl.date_resolution), 'dd/MM') : '-'}
                            </span>
                            <span className={recl.date_cloture ? 'text-[rgb(var(--c-success))]' : 'text-gray-400'}>
                              Clôture: {recl.date_cloture ? format(new Date(recl.date_cloture), 'dd/MM') : '-'}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => { setEditingRecl(recl); setFormDataRecl(recl); setShowFormRecl(true) }} className="btn btn-sm btn-secondary"><Edit className="w-4 h-4" /></button>
                          <button onClick={() => handleDeleteRecl(recl.id)} className="btn btn-sm btn-secondary text-[rgb(var(--c-danger))]"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
      
      {/* ===== MODAL NC ===== */}
      {showFormNC && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-ui shadow-md w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b flex items-center justify-between bg-gray-50">
              <h2 className="font-bold text-lg">{editingNC ? 'Modifier la NC' : 'Nouvelle NC'}</h2>
              <button onClick={resetFormNC} className="p-2 hover:bg-gray-200 rounded-ui-sm"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmitNC} className="p-4 overflow-y-auto flex-1 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-ui font-medium mb-1">Source *</label>
                  <select value={formDataNC.source} onChange={e => setFormDataNC({...formDataNC, source: e.target.value})} className="input w-full">
                    {Object.entries(ncSourceLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-ui font-medium mb-1">Gravité</label>
                  <select value={formDataNC.severity} onChange={e => setFormDataNC({...formDataNC, severity: e.target.value})} className="input w-full">
                    {Object.entries(severityLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-ui font-medium mb-1">Titre *</label>
                <input type="text" value={formDataNC.title} onChange={e => setFormDataNC({...formDataNC, title: e.target.value})} className="input w-full" required />
              </div>
              <div>
                <label className="block text-ui font-medium mb-1">Description</label>
                <textarea value={formDataNC.description} onChange={e => setFormDataNC({...formDataNC, description: e.target.value})} className="input w-full h-20" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-ui font-medium mb-1">Session liée</label>
                  <SearchSelect value={formDataNC.session_id} onChange={v => setFormDataNC({...formDataNC, session_id: v})}
                    options={sessions.map(s => ({ value: s.id, label: s.reference, hint: [s.courses?.title, s.start_date].filter(Boolean).join(' · ') }))}
                    emptyLabel="Aucune" searchPlaceholder="Référence de session..." aria-label="Session" />
                </div>
                <div>
                  <label className="block text-ui font-medium mb-1">Indicateur Qualiopi</label>
                  <input type="text" value={formDataNC.critere_qualiopi} onChange={e => setFormDataNC({...formDataNC, critere_qualiopi: e.target.value})} className="input w-full" placeholder="ex: 31" />
                </div>
              </div>
              <div>
                <label className="block text-ui font-medium mb-1">Analyse des causes</label>
                <textarea value={formDataNC.cause_analysis} onChange={e => setFormDataNC({...formDataNC, cause_analysis: e.target.value})} className="input w-full h-16" />
              </div>
              <div>
                <label className="block text-ui font-medium mb-1">Action corrective</label>
                <textarea value={formDataNC.corrective_action} onChange={e => setFormDataNC({...formDataNC, corrective_action: e.target.value})} className="input w-full h-16" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-ui font-medium mb-1">Responsable action</label>
                  <input type="text" value={formDataNC.action_responsible} onChange={e => setFormDataNC({...formDataNC, action_responsible: e.target.value})} className="input w-full" />
                </div>
                <div>
                  <label className="block text-ui font-medium mb-1">Échéance</label>
                  <input type="date" value={formDataNC.action_deadline} onChange={e => setFormDataNC({...formDataNC, action_deadline: e.target.value})} className="input w-full" />
                </div>
              </div>
              <div>
                <label className="block text-ui font-medium mb-1">Statut</label>
                <select value={formDataNC.status} onChange={e => setFormDataNC({...formDataNC, status: e.target.value})} className="input w-full">
                  {Object.entries(ncStatusLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t">
                <button type="button" onClick={resetFormNC} className="btn btn-secondary">Annuler</button>
                <button type="submit" className="btn btn-primary flex items-center gap-2"><Save className="w-4 h-4" /> Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* ===== MODAL RÉCLAMATION ===== */}
      {showFormRecl && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-ui shadow-md w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b flex items-center justify-between bg-gray-50">
              <h2 className="font-bold text-lg">{editingRecl ? 'Modifier la réclamation' : 'Nouvelle réclamation'}</h2>
              <button onClick={resetFormRecl} className="p-2 hover:bg-gray-200 rounded-ui-sm"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmitRecl} className="p-4 overflow-y-auto flex-1 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-ui font-medium mb-1">Source *</label>
                  <select value={formDataRecl.source} onChange={e => setFormDataRecl({...formDataRecl, source: e.target.value})} className="input w-full">
                    {Object.entries(reclSourceLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-ui font-medium mb-1">Canal *</label>
                  <select value={formDataRecl.canal} onChange={e => setFormDataRecl({...formDataRecl, canal: e.target.value})} className="input w-full">
                    {Object.entries(reclCanalLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-ui font-medium mb-1">Sujet *</label>
                <input type="text" value={formDataRecl.subject} onChange={e => setFormDataRecl({...formDataRecl, subject: e.target.value})} className="input w-full" required />
              </div>
              <div>
                <label className="block text-ui font-medium mb-1">Description</label>
                <textarea value={formDataRecl.description} onChange={e => setFormDataRecl({...formDataRecl, description: e.target.value})} className="input w-full h-20" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-ui font-medium mb-1">Session liée</label>
                  <SearchSelect value={formDataRecl.session_id} onChange={v => setFormDataRecl({...formDataRecl, session_id: v})}
                    options={sessions.map(s => ({ value: s.id, label: s.reference, hint: [s.courses?.title, s.start_date].filter(Boolean).join(' · ') }))}
                    emptyLabel="Aucune" searchPlaceholder="Référence de session..." aria-label="Session" />
                </div>
                <div>
                  <label className="block text-ui font-medium mb-1">Responsable</label>
                  <select value={formDataRecl.responsable} onChange={e => setFormDataRecl({...formDataRecl, responsable: e.target.value})} className="input w-full">
                    {teamNames().map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-ui font-medium mb-1">Analyse des causes</label>
                <textarea value={formDataRecl.cause_analysis} onChange={e => setFormDataRecl({...formDataRecl, cause_analysis: e.target.value})} className="input w-full h-16" />
              </div>
              <div>
                <label className="block text-ui font-medium mb-1">Solution proposée</label>
                <textarea value={formDataRecl.solution_proposed} onChange={e => setFormDataRecl({...formDataRecl, solution_proposed: e.target.value})} className="input w-full h-16" />
              </div>
              <div>
                <label className="block text-ui font-medium mb-1">Action réalisée</label>
                <textarea value={formDataRecl.action_taken} onChange={e => setFormDataRecl({...formDataRecl, action_taken: e.target.value})} className="input w-full h-16" />
              </div>
              <div>
                <label className="block text-ui font-medium mb-1">Statut</label>
                <select value={formDataRecl.status} onChange={e => setFormDataRecl({...formDataRecl, status: e.target.value})} className="input w-full">
                  {Object.entries(reclStatusLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <p className="text-ui-sm text-gray-500 mt-1">Le passage à "AR envoyé" enregistre automatiquement la date d'accusé réception</p>
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t">
                <button type="button" onClick={resetFormRecl} className="btn btn-secondary">Annuler</button>
                <button type="submit" className="btn btn-primary flex items-center gap-2"><Save className="w-4 h-4" /> Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
