import { teamFirstNames } from '../../../core/org/currentOrg'
import { useEffect, useState } from 'react'
import { supabase } from '../../../core/supabase'
import { fetchAll } from '../../../core/fetchAll'
import { 
  Plus, Search, Edit, Trash2, X, Save, Eye, FileText, 
  Scale, Briefcase, BookOpen, AlertTriangle, CheckCircle, Clock, Archive,
  Calendar, User, ExternalLink
} from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

const VEILLE_TYPES = {
  legale: { 
    label: 'Veille légale et réglementaire', 
    icon: Scale, 
    color: 'blue',
    description: 'Suivi des évolutions législatives et réglementaires impactant la formation professionnelle'
  },
  metiers: { 
    label: 'Veille emplois et métiers', 
    icon: Briefcase, 
    color: 'green',
    description: 'Évolution des métiers, compétences attendues, besoins du marché'
  },
  pedagogique: { 
    label: 'Veille pédagogique et technologique', 
    icon: BookOpen, 
    color: 'purple',
    description: 'Nouvelles méthodes pédagogiques, outils numériques, innovations'
  }
}

const STATUTS = {
  a_traiter: { label: 'À traiter', color: 'red', icon: AlertTriangle },
  en_cours: { label: 'En cours', color: 'yellow', icon: Clock },
  traite: { label: 'Traité', color: 'green', icon: CheckCircle },
  archive: { label: 'Archivé', color: 'gray', icon: Archive }
}

const IMPACTS = {
  faible: { label: 'Faible', color: 'gray' },
  moyen: { label: 'Moyen', color: 'yellow' },
  fort: { label: 'Fort', color: 'red' }
}

export default function VeilleQualiopi() {
  const [veilles, setVeilles] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('legale')
  const [search, setSearch] = useState('')
  const [filterStatut, setFilterStatut] = useState('')
  
  // Modal
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({
    type: 'legale',
    date: new Date().toISOString().split('T')[0],
    source: '',
    sujet: '',
    description: '',
    action_menee: '',
    impact: 'moyen',
    statut: 'a_traiter',
    responsable: '',
    date_traitement: ''
  })
  
  // Preview modal
  const [showPreview, setShowPreview] = useState(null)

  useEffect(() => {
    fetchVeilles()
  }, [])

  const fetchVeilles = async () => {
    const { data, error } = await fetchAll(() => supabase
      .from('veille_qualiopi')
      .select('*')
      .order('date', { ascending: false }))
    
    if (error) {
      console.error('Erreur chargement veilles:', error)
      toast.error('Erreur lors du chargement')
    } else {
      setVeilles(data || [])
    }
    setLoading(false)
  }

  const handleSave = async () => {
    if (!form.sujet.trim()) {
      toast.error('Sujet obligatoire')
      return
    }

    const dataToSave = {
      type: form.type,
      date: form.date,
      source: form.source || null,
      sujet: form.sujet,
      description: form.description || null,
      action_menee: form.action_menee || null,
      impact: form.impact || 'moyen',
      statut: form.statut || 'a_traiter',
      responsable: form.responsable || null,
      date_traitement: form.date_traitement || null
    }

    if (editingId) {
      const { error } = await supabase
        .from('veille_qualiopi')
        .update(dataToSave)
        .eq('id', editingId)
      
      if (error) {
        console.error('Erreur modification:', error)
        toast.error('Erreur lors de la modification')
      } else {
        toast.success('Modifications enregistrées')
        fetchVeilles()
        closeModal()
      }
    } else {
      const { error } = await supabase
        .from('veille_qualiopi')
        .insert([dataToSave])
      
      if (error) {
        console.error('Erreur création:', error)
        toast.error('Erreur lors de la création')
      } else {
        toast.success('Entrée de veille créée')
        fetchVeilles()
        closeModal()
      }
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Supprimer cette entrée ?')) return
    
    const { error } = await supabase
      .from('veille_qualiopi')
      .delete()
      .eq('id', id)
    
    if (error) {
      toast.error('Erreur lors de la suppression')
    } else {
      toast.success('Entrée supprimée')
      fetchVeilles()
    }
  }

  const openModal = (veille = null) => {
    if (veille) {
      setEditingId(veille.id)
      setForm({
        type: veille.type,
        date: veille.date,
        source: veille.source || '',
        sujet: veille.sujet,
        description: veille.description || '',
        action_menee: veille.action_menee || '',
        impact: veille.impact || 'moyen',
        statut: veille.statut || 'a_traiter',
        responsable: veille.responsable || '',
        date_traitement: veille.date_traitement || ''
      })
    } else {
      setEditingId(null)
      setForm({
        type: activeTab,
        date: new Date().toISOString().split('T')[0],
        source: '',
        sujet: '',
        description: '',
        action_menee: '',
        impact: 'moyen',
        statut: 'a_traiter',
        responsable: '',
        date_traitement: ''
      })
    }
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingId(null)
  }

  const updateStatut = async (id, newStatut) => {
    const updates = { statut: newStatut }
    if (newStatut === 'traite' && !veilles.find(v => v.id === id)?.date_traitement) {
      updates.date_traitement = new Date().toISOString().split('T')[0]
    }
    
    const { error } = await supabase
      .from('veille_qualiopi')
      .update(updates)
      .eq('id', id)
    
    if (error) {
      toast.error('Erreur lors de la mise à jour')
    } else {
      toast.success('Statut mis à jour')
      fetchVeilles()
    }
  }

  // Filtrage
  const filtered = veilles.filter(v => {
    if (v.type !== activeTab) return false
    if (filterStatut && v.statut !== filterStatut) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        v.sujet?.toLowerCase().includes(s) ||
        v.source?.toLowerCase().includes(s) ||
        v.description?.toLowerCase().includes(s)
      )
    }
    return true
  })

  // Stats par onglet
  const getStats = (type) => {
    const items = veilles.filter(v => v.type === type)
    return {
      total: items.length,
      aTraiter: items.filter(v => v.statut === 'a_traiter').length,
      enCours: items.filter(v => v.statut === 'en_cours').length
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-500"></div>
      </div>
    )
  }

  const TypeConfig = VEILLE_TYPES[activeTab]
  const TypeIcon = TypeConfig.icon

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="page-title">Veille Qualiopi</h1>
          <p className="text-ui text-gray-500 mt-1">Suivi des veilles légale, métiers et pédagogique</p>
        </div>
        <button onClick={() => openModal()} className="btn btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Nouvelle entrée
        </button>
      </div>

      {/* Onglets */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(VEILLE_TYPES).map(([key, config]) => {
          const Icon = config.icon
          const stats = getStats(key)
          const isActive = activeTab === key
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-ui-sm font-medium transition-all ${
                isActive 
                  ? `bg-${config.color}-100 text-${config.color}-700 ring-2 ring-${config.color}-500` 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              style={isActive ? { 
                backgroundColor: config.color === 'blue' ? '#dbeafe' : config.color === 'green' ? '#dcfce7' : '#f3e8ff',
                color: config.color === 'blue' ? '#1d4ed8' : config.color === 'green' ? '#15803d' : '#7e22ce'
              } : {}}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{config.label.split(' ')[1]}</span>
              <span className="sm:hidden">{config.label.split(' ')[1].substring(0, 3)}</span>
              {stats.aTraiter > 0 && (
                <span className="bg-[rgb(var(--c-danger))] text-white text-ui-sm px-1.5 py-0.5 rounded-full">
                  {stats.aTraiter}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Description du type */}
      <div className={`p-4 rounded-ui-sm border-l-4`} style={{ 
        backgroundColor: TypeConfig.color === 'blue' ? '#eff6ff' : TypeConfig.color === 'green' ? '#f0fdf4' : '#faf5ff',
        borderColor: TypeConfig.color === 'blue' ? '#3b82f6' : TypeConfig.color === 'green' ? '#22c55e' : '#a855f7'
      }}>
        <div className="flex items-start gap-3">
          <TypeIcon className="w-5 h-5 mt-0.5" style={{ 
            color: TypeConfig.color === 'blue' ? '#3b82f6' : TypeConfig.color === 'green' ? '#22c55e' : '#a855f7'
          }} />
          <div>
            <h3 className="font-semibold text-gray-900">{TypeConfig.label}</h3>
            <p className="text-ui text-gray-600 mt-1">{TypeConfig.description}</p>
          </div>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
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
          value={filterStatut}
          onChange={(e) => setFilterStatut(e.target.value)}
          className="input w-auto"
        >
          <option value="">Tous les statuts</option>
          {Object.entries(STATUTS).map(([key, config]) => (
            <option key={key} value={key}>{config.label}</option>
          ))}
        </select>
      </div>

      {/* Liste */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="card p-8 text-center text-gray-500">
            {search || filterStatut ? 'Aucun résultat' : 'Aucune entrée de veille - Ajoutez-en une !'}
          </div>
        ) : (
          filtered.map(veille => {
            const StatutConfig = STATUTS[veille.statut]
            const StatutIcon = StatutConfig.icon
            const ImpactConfig = IMPACTS[veille.impact]
            
            return (
              <div key={veille.id} className="card hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-ui-sm font-medium`}
                        style={{ 
                          backgroundColor: StatutConfig.color === 'red' ? '#fef2f2' : StatutConfig.color === 'yellow' ? '#fefce8' : StatutConfig.color === 'green' ? '#f0fdf4' : '#f3f4f6',
                          color: StatutConfig.color === 'red' ? '#dc2626' : StatutConfig.color === 'yellow' ? '#ca8a04' : StatutConfig.color === 'green' ? '#16a34a' : '#6b7280'
                        }}
                      >
                        <StatutIcon className="w-3 h-3" />
                        {StatutConfig.label}
                      </span>
                      {veille.impact && (
                        <span className={`px-2 py-0.5 rounded text-ui-sm`}
                          style={{ 
                            backgroundColor: ImpactConfig.color === 'red' ? '#fef2f2' : ImpactConfig.color === 'yellow' ? '#fefce8' : '#f3f4f6',
                            color: ImpactConfig.color === 'red' ? '#dc2626' : ImpactConfig.color === 'yellow' ? '#ca8a04' : '#6b7280'
                          }}
                        >
                          Impact {ImpactConfig.label.toLowerCase()}
                        </span>
                      )}
                      <span className="text-ui-sm text-gray-500">
                        {format(new Date(veille.date), 'd MMM yyyy', { locale: fr })}
                      </span>
                    </div>
                    
                    <h3 className="font-semibold text-gray-900 mb-1">{veille.sujet}</h3>
                    
                    {veille.source && (
                      <p className="text-ui text-gray-500 flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" />
                        Source : {veille.source}
                      </p>
                    )}
                    
                    {veille.description && (
                      <p className="text-ui text-gray-600 mt-2 line-clamp-2">{veille.description}</p>
                    )}
                    
                    {veille.action_menee && (
                      <div className="mt-2 p-2 bg-[rgb(var(--c-success-bg))] rounded text-ui text-[rgb(var(--c-success))]">
                        <strong>Action :</strong> {veille.action_menee}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex flex-col gap-1">
                    <button onClick={() => setShowPreview(veille)} className="p-2 hover:bg-gray-100 rounded" title="Voir">
                      <Eye className="w-4 h-4 text-gray-500" />
                    </button>
                    <button onClick={() => openModal(veille)} className="p-2 hover:bg-gray-100 rounded" title="Modifier">
                      <Edit className="w-4 h-4 text-gray-500" />
                    </button>
                    <button onClick={() => handleDelete(veille.id)} className="p-2 hover:bg-[rgb(var(--c-danger-bg))] rounded" title="Supprimer">
                      <Trash2 className="w-4 h-4 text-[rgb(var(--c-danger))]" />
                    </button>
                  </div>
                </div>
                
                {/* Actions rapides statut */}
                {veille.statut !== 'traite' && veille.statut !== 'archive' && (
                  <div className="mt-3 pt-3 border-t flex gap-2">
                    {veille.statut === 'a_traiter' && (
                      <button 
                        onClick={() => updateStatut(veille.id, 'en_cours')}
                        className="text-ui-sm px-2 py-1 bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] rounded hover:bg-[rgb(var(--c-warning-bg))]"
                      >
                        Marquer en cours
                      </button>
                    )}
                    <button 
                      onClick={() => updateStatut(veille.id, 'traite')}
                      className="text-ui-sm px-2 py-1 bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))] rounded hover:bg-[rgb(var(--c-success-bg))]"
                    >
                      Marquer traité
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* MODAL: Création/Édition */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-ui shadow-md max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b bg-primary-500 text-white rounded-t-xl">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                {editingId ? <Edit className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                {editingId ? 'Modifier l\'entrée' : 'Nouvelle entrée de veille'}
              </h2>
            </div>
            
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Type de veille *</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="input"
                  >
                    {Object.entries(VEILLE_TYPES).map(([key, config]) => (
                      <option key={key} value={key}>{config.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Date *</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="input"
                  />
                </div>
              </div>
              
              <div>
                <label className="label">Sujet *</label>
                <input
                  type="text"
                  value={form.sujet}
                  onChange={(e) => setForm({ ...form, sujet: e.target.value })}
                  className="input"
                  placeholder="Ex: Nouvelle réglementation RNCP..."
                />
              </div>
              
              <div>
                <label className="label">Source</label>
                <input
                  type="text"
                  value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                  className="input"
                  placeholder="Ex: Journal Officiel, OPCO, Site ministère..."
                />
              </div>
              
              <div>
                <label className="label">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="input min-h-[80px]"
                  placeholder="Détail de l'information..."
                />
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Impact</label>
                  <select
                    value={form.impact}
                    onChange={(e) => setForm({ ...form, impact: e.target.value })}
                    className="input"
                  >
                    {Object.entries(IMPACTS).map(([key, config]) => (
                      <option key={key} value={key}>{config.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Statut</label>
                  <select
                    value={form.statut}
                    onChange={(e) => setForm({ ...form, statut: e.target.value })}
                    className="input"
                  >
                    {Object.entries(STATUTS).map(([key, config]) => (
                      <option key={key} value={key}>{config.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div>
                <label className="label">Action menée / à mener</label>
                <textarea
                  value={form.action_menee}
                  onChange={(e) => setForm({ ...form, action_menee: e.target.value })}
                  className="input min-h-[80px]"
                  placeholder="Décrivez les actions prises ou à prendre..."
                />
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Responsable</label>
                  <select
                    value={form.responsable}
                    onChange={(e) => setForm({ ...form, responsable: e.target.value })}
                    className="input"
                  >
                    <option value="">-- Sélectionner --</option>
                    {teamFirstNames().map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Date de traitement</label>
                  <input
                    type="date"
                    value={form.date_traitement}
                    onChange={(e) => setForm({ ...form, date_traitement: e.target.value })}
                    className="input"
                  />
                </div>
              </div>
            </div>
            
            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-xl">
              <button onClick={closeModal} className="btn btn-secondary">Annuler</button>
              <button onClick={handleSave} className="btn btn-primary flex items-center gap-2">
                <Save className="w-4 h-4" />
                {editingId ? 'Enregistrer' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Preview */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-ui shadow-md max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold">{showPreview.sujet}</h2>
              <button onClick={() => setShowPreview(null)} className="p-2 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-ui">
                <div>
                  <span className="text-gray-500">Type :</span>
                  <span className="ml-2 font-medium">{VEILLE_TYPES[showPreview.type]?.label}</span>
                </div>
                <div>
                  <span className="text-gray-500">Date :</span>
                  <span className="ml-2 font-medium">{format(new Date(showPreview.date), 'd MMMM yyyy', { locale: fr })}</span>
                </div>
                <div>
                  <span className="text-gray-500">Statut :</span>
                  <span className="ml-2 font-medium">{STATUTS[showPreview.statut]?.label}</span>
                </div>
                <div>
                  <span className="text-gray-500">Impact :</span>
                  <span className="ml-2 font-medium">{IMPACTS[showPreview.impact]?.label}</span>
                </div>
              </div>
              
              {showPreview.source && (
                <div>
                  <h4 className="text-ui font-medium text-gray-500 mb-1">Source</h4>
                  <p>{showPreview.source}</p>
                </div>
              )}
              
              {showPreview.description && (
                <div>
                  <h4 className="text-ui font-medium text-gray-500 mb-1">Description</h4>
                  <p className="whitespace-pre-wrap">{showPreview.description}</p>
                </div>
              )}
              
              {showPreview.action_menee && (
                <div className="p-3 bg-[rgb(var(--c-success-bg))] rounded-ui-sm">
                  <h4 className="text-ui font-medium text-[rgb(var(--c-success))] mb-1">Action menée</h4>
                  <p className="text-[rgb(var(--c-success))] whitespace-pre-wrap">{showPreview.action_menee}</p>
                </div>
              )}
              
              {showPreview.responsable && (
                <div>
                  <h4 className="text-ui font-medium text-gray-500 mb-1">Responsable</h4>
                  <p>{showPreview.responsable}</p>
                </div>
              )}
              
              {showPreview.date_traitement && (
                <div>
                  <h4 className="text-ui font-medium text-gray-500 mb-1">Date de traitement</h4>
                  <p>{format(new Date(showPreview.date_traitement), 'd MMMM yyyy', { locale: fr })}</p>
                </div>
              )}
            </div>
            
            <div className="flex justify-end gap-2 p-4 border-t">
              <button onClick={() => { setShowPreview(null); openModal(showPreview); }} className="btn btn-secondary flex items-center gap-2">
                <Edit className="w-4 h-4" />
                Modifier
              </button>
              <button onClick={() => setShowPreview(null)} className="btn btn-primary">Fermer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
