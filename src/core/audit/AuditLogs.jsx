import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { 
  Search, Filter, RefreshCw, User, Calendar, Eye, Edit, Trash2, Plus,
  Download, LogIn, LogOut, Printer, FileText, Shield
} from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

const ACTION_CONFIG = {
  view: { label: 'Consultation', icon: Eye, color: 'blue' },
  create: { label: 'Création', icon: Plus, color: 'green' },
  update: { label: 'Modification', icon: Edit, color: 'yellow' },
  delete: { label: 'Suppression', icon: Trash2, color: 'red' },
  export: { label: 'Export', icon: Download, color: 'purple' },
  login: { label: 'Connexion', icon: LogIn, color: 'green' },
  logout: { label: 'Déconnexion', icon: LogOut, color: 'gray' },
  print: { label: 'Impression', icon: Printer, color: 'blue' },
  download: { label: 'Téléchargement', icon: Download, color: 'purple' },
}

const ENTITY_CONFIG = {
  trainee: { label: 'Stagiaire', emoji: '' },
  session: { label: 'Session', emoji: '' },
  client: { label: 'Client', emoji: '' },
  trainer: { label: 'Formateur', emoji: '' },
  course: { label: 'Formation', emoji: '' },
  document: { label: 'Document', emoji: '' },
  nc: { label: 'Non-conformité', emoji: '' },
  veille: { label: 'Veille', emoji: '' },
  evaluation: { label: 'Évaluation', emoji: '' },
  attendance: { label: 'Émargement', emoji: '' },
  system: { label: 'Système', emoji: '' },
}

export default function AuditLogs() {
  const [auditLogs, setAuditLogs] = useState([])
  const [auditLogsLoading, setAuditLogsLoading] = useState(true)
  
  const [search, setSearch] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [filterEntity, setFilterEntity] = useState('')
  const [filterFromDate, setFilterFromDate] = useState('')
  const [filterToDate, setFilterToDate] = useState('')
  
  useEffect(() => {
    loadLogs()
  }, [])
  
  const loadLogs = async () => {
    setAuditLogsLoading(true)
    
    // Construire la requête directement
    let query = supabase
      .from('audit_logs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(200)
    
    if (filterAction) {
      query = query.eq('action', filterAction)
    }
    if (filterEntity) {
      query = query.eq('entity_type', filterEntity)
    }
    if (filterFromDate) {
      query = query.gte('timestamp', new Date(filterFromDate).toISOString())
    }
    if (filterToDate) {
      query = query.lte('timestamp', new Date(filterToDate + 'T23:59:59').toISOString())
    }
    
    const { data, error } = await query
    
    if (error) {
      console.error('Error loading audit logs:', error)
    }
    
    setAuditLogs(data || [])
    setAuditLogsLoading(false)
  }
  
  const handleFilter = () => {
    loadLogs()
  }
  
  const handleReset = () => {
    setSearch('')
    setFilterAction('')
    setFilterEntity('')
    setFilterFromDate('')
    setFilterToDate('')
    // Recharger sans filtres
    setAuditLogsLoading(true)
    supabase
      .from('audit_logs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(200)
      .then(({ data }) => {
        setAuditLogs(data || [])
        setAuditLogsLoading(false)
      })
  }
  
  // Filtrage local par recherche texte
  const filteredLogs = (auditLogs || []).filter(log => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      log.user_email?.toLowerCase().includes(s) ||
      log.entity_name?.toLowerCase().includes(s)
    )
  })
  
  // Stats
  const stats = {
    total: auditLogs?.length || 0,
    views: auditLogs?.filter(l => l.action === 'view').length || 0,
    creates: auditLogs?.filter(l => l.action === 'create').length || 0,
    updates: auditLogs?.filter(l => l.action === 'update').length || 0,
    deletes: auditLogs?.filter(l => l.action === 'delete').length || 0,
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary-500" />
            Journal d'audit RGPD
          </h1>
          <p className="text-sm text-gray-500 mt-1">Traçabilité des accès et modifications</p>
        </div>
        <button 
          onClick={loadLogs} 
          className="btn btn-secondary flex items-center gap-2"
          disabled={auditLogsLoading}
        >
          <RefreshCw className={`w-4 h-4 ${auditLogsLoading ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </div>
      
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="card p-3 text-center">
          <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
          <p className="text-xs text-gray-500">Total logs</p>
        </div>
        <div className="card p-3 text-center bg-blue-50 border-blue-200">
          <p className="text-2xl font-bold text-blue-600">{stats.views}</p>
          <p className="text-xs text-blue-600">Consultations</p>
        </div>
        <div className="card p-3 text-center bg-green-50 border-green-200">
          <p className="text-2xl font-bold text-green-600">{stats.creates}</p>
          <p className="text-xs text-green-600">Créations</p>
        </div>
        <div className="card p-3 text-center bg-yellow-50 border-yellow-200">
          <p className="text-2xl font-bold text-yellow-600">{stats.updates}</p>
          <p className="text-xs text-yellow-600">Modifications</p>
        </div>
        <div className="card p-3 text-center bg-red-50 border-red-200">
          <p className="text-2xl font-bold text-red-600">{stats.deletes}</p>
          <p className="text-xs text-red-600">Suppressions</p>
        </div>
      </div>
      
      {/* Filtres */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-gray-500" />
          <span className="font-medium text-gray-700">Filtres</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Rechercher..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="input"
          >
            <option value="">Toutes actions</option>
            {Object.entries(ACTION_CONFIG).map(([key, config]) => (
              <option key={key} value={key}>{config.label}</option>
            ))}
          </select>
          <select
            value={filterEntity}
            onChange={(e) => setFilterEntity(e.target.value)}
            className="input"
          >
            <option value="">Toutes entités</option>
            {Object.entries(ENTITY_CONFIG).map(([key, config]) => (
              <option key={key} value={key}>{config.emoji} {config.label}</option>
            ))}
          </select>
          <input
            type="date"
            value={filterFromDate}
            onChange={(e) => setFilterFromDate(e.target.value)}
            className="input"
            placeholder="Du"
          />
          <input
            type="date"
            value={filterToDate}
            onChange={(e) => setFilterToDate(e.target.value)}
            className="input"
            placeholder="Au"
          />
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={handleReset} className="btn btn-secondary text-sm">Réinitialiser</button>
          <button onClick={handleFilter} className="btn btn-primary text-sm">Appliquer</button>
        </div>
      </div>
      
      {/* Liste des logs */}
      <div className="card overflow-hidden">
        {auditLogsLoading ? (
          <div className="p-8 text-center">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-primary-500" />
            <p className="text-gray-500 mt-2">Chargement...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Shield className="w-12 h-12 mx-auto text-gray-300 mb-2" />
            <p>Aucun log d'audit</p>
            <p className="text-sm mt-1">Les actions seront enregistrées automatiquement</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Date/Heure</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Utilisateur</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Action</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Entité</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Élément</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredLogs.map(log => {
                  const actionConfig = ACTION_CONFIG[log.action] || { label: log.action, color: 'gray' }
                  const ActionIcon = actionConfig.icon || Eye
                  const entityConfig = ENTITY_CONFIG[log.entity_type] || { label: log.entity_type, emoji: '' }
                  
                  return (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div className="text-sm text-gray-900">
                          {format(new Date(log.log_timestamp || log.timestamp), 'dd/MM/yyyy', { locale: fr })}
                        </div>
                        <div className="text-xs text-gray-500">
                          {format(new Date(log.log_timestamp || log.timestamp), 'HH:mm:ss', { locale: fr })}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-gray-400" />
                          <span className="text-sm">{log.user_email || 'Anonyme'}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium
                          ${actionConfig.color === 'blue' ? 'bg-blue-100 text-blue-700' : ''}
                          ${actionConfig.color === 'green' ? 'bg-green-100 text-green-700' : ''}
                          ${actionConfig.color === 'yellow' ? 'bg-yellow-100 text-yellow-700' : ''}
                          ${actionConfig.color === 'red' ? 'bg-red-100 text-red-700' : ''}
                          ${actionConfig.color === 'purple' ? 'bg-purple-100 text-purple-700' : ''}
                          ${actionConfig.color === 'gray' ? 'bg-gray-100 text-gray-700' : ''}
                        `}>
                          <ActionIcon className="w-3 h-3" />
                          {actionConfig.label}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm">
                          {entityConfig.emoji} {entityConfig.label}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-gray-900">{log.entity_name || '-'}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      
      {/* Info RGPD */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700">
        <p className="font-medium mb-1"> Conformité RGPD</p>
        <p>Ce journal trace toutes les consultations et modifications de données personnelles. Les logs sont conservés 2 ans puis purgés automatiquement.</p>
      </div>
    </div>
  )
}
