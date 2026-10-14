import { currentUserName } from '../../../core/org/currentOrg'
import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../core/supabase'
import { fetchAll } from '../../../core/fetchAll'
import { useDataStore } from '../../../core/store'
import {
  Plus, Search, Shield, Building2, Calendar, MapPin, ChevronDown, ChevronUp,
  X, Save, AlertTriangle, CheckCircle, Clock, FileText, Trash2, Copy,
  Eye, MoreVertical, RefreshCw, Loader2, ArrowRight, Filter, Archive
} from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

// ═══════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════
const STATUS_CONFIG = {
  brouillon:       { label: 'Brouillon',       emoji: '', color: 'bg-gray-100 text-gray-700',   dot: 'bg-gray-400' },
  en_cours:        { label: 'En cours',         emoji: '', color: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500' },
  visite_terrain:  { label: 'Visite terrain',   emoji: '', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  finalisation:    { label: 'Finalisation',     emoji: '', color: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  termine:         { label: 'Terminé',          emoji: '', color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  archive:         { label: 'Archivé',          emoji: '', color: 'bg-stone-100 text-stone-600', dot: 'bg-stone-400' },
}

const COTATION_COLORS = {
  faible:   { range: [1, 4],   label: 'Faible',    color: 'bg-green-500',  text: 'text-green-700' },
  moyen:    { range: [5, 8],   label: 'Moyen',     color: 'bg-yellow-500', text: 'text-yellow-700' },
  eleve:    { range: [9, 12],  label: 'Élevé',     color: 'bg-orange-500', text: 'text-orange-700' },
  critique: { range: [13, 16], label: 'Critique',  color: 'bg-red-500',    text: 'text-red-700' },
}

const getRiskLevel = (score) => {
  if (!score) return COTATION_COLORS.faible
  if (score <= 4) return COTATION_COLORS.faible
  if (score <= 8) return COTATION_COLORS.moyen
  if (score <= 12) return COTATION_COLORS.eleve
  return COTATION_COLORS.critique
}

// ═══════════════════════════════════════════════════════════
// ENRICHISSEMENT API ENTREPRISES
// ═══════════════════════════════════════════════════════════
const searchEntreprise = async (query) => {
  try {
    const url = `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(query)}&per_page=5`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    return (data.results || []).map(c => {
      const siege = c.siege || {}
      const addr = [siege.numero_voie, siege.type_voie, siege.libelle_voie].filter(Boolean).join(' ')
      return {
        name: c.nom_complet || c.nom_raison_sociale || '',
        siret: siege.siret || '',
        siren: c.siren || '',
        naf_code: c.activite_principale || siege.activite_principale || '',
        naf_label: c.activite_principale_libelle || '',
        address: addr,
        city: siege.libelle_commune || '',
        postal_code: siege.code_postal || '',
        effectif: c.tranche_effectif_salarie || '',
        legal_form: c.nature_juridique || '',
      }
    })
  } catch { return [] }
}

const getEffectifLabel = (code) => {
  const map = {
    '00': 'NSR', '01': '1-2', '02': '3-5', '03': '6-9', '11': '10-19',
    '12': '20-49', '21': '50-99', '22': '100-199', '31': '200-249',
    '32': '250-499', '41': '500-999', '42': '1000-1999', '51': '2000-4999',
    '52': '5000-9999', '53': '10000+'
  }
  return map[String(code)] || code || ''
}

// ═══════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ═══════════════════════════════════════════════════════════
export default function DuerpProjects() {
  const { clients, fetchClients } = useDataStore()
  
  // Data
  const [projects, setProjects] = useState([])
  const [sectors, setSectors] = useState([])
  const [riskCounts, setRiskCounts] = useState({})
  const [actionCounts, setActionCounts] = useState({})
  const [loading, setLoading] = useState(true)
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  
  // Modal création
  const [showCreate, setShowCreate] = useState(false)
  const [createStep, setCreateStep] = useState(1) // 1: client, 2: secteur, 3: confirm
  const [selectedClient, setSelectedClient] = useState(null)
  const [selectedSectors, setSelectedSectors] = useState([])
  const [clientSearch, setClientSearch] = useState('')
  const [apiSearch, setApiSearch] = useState('')
  const [apiResults, setApiResults] = useState([])
  const [apiSearching, setApiSearching] = useState(false)
  const [newProject, setNewProject] = useState({})
  const [creating, setCreating] = useState(false)

  // Écran rattachement orphelins post-création
  const [showRattachement, setShowRattachement] = useState(false)
  const [rattachementData, setRattachementData] = useState(null) // { projectId, units, orphanRisks }
  const [rattachAssignments, setRattachAssignments] = useState({}) // { riskId: unitId | '__skip' }
  const [rattachSaving, setRattachSaving] = useState(false)

  // Context menu
  const [contextMenu, setContextMenu] = useState(null)

  // ═══════════════════════════════════════════════════════════
  // CHARGEMENT
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    loadAll()
    if (!clients.length) fetchClients()
  }, [])

  const loadAll = async () => {
    setLoading(true)
    try {
      // Projets
      const { data: proj } = await supabase
        .from('duerp_projects')
        .select('*')
        .order('updated_at', { ascending: false })
      setProjects(proj || [])

      // Secteurs templates
      const { data: sec } = await supabase
        .from('duerp_sector_templates')
        .select('*')
        .order('sector_label')
      setSectors(sec || [])

      // Compteurs risques par projet
      if (proj?.length) {
        // fetchAll : compteurs sur TOUS les risques et actions (sinon tronqués à 1 000)
        const { data: risks } = await fetchAll(() => supabase
          .from('duerp_risks')
          .select('project_id, risque_brut'))
        const counts = {}
        ;(risks || []).forEach(r => {
          if (!counts[r.project_id]) counts[r.project_id] = { total: 0, max: 0 }
          counts[r.project_id].total++
          if (r.risque_brut > counts[r.project_id].max) counts[r.project_id].max = r.risque_brut
        })
        setRiskCounts(counts)

        const { data: actions } = await fetchAll(() => supabase
          .from('duerp_actions')
          .select('project_id, statut'))
        const aCounts = {}
        ;(actions || []).forEach(a => {
          if (!aCounts[a.project_id]) aCounts[a.project_id] = { total: 0, done: 0 }
          aCounts[a.project_id].total++
          if (a.statut === 'fait') aCounts[a.project_id].done++
        })
        setActionCounts(aCounts)
      }
    } catch (err) {
      console.error(err)
      toast.error('Erreur chargement')
    }
    setLoading(false)
  }

  // ═══════════════════════════════════════════════════════════
  // RECHERCHE API ENTREPRISES
  // ═══════════════════════════════════════════════════════════
  const doApiSearch = useCallback(async () => {
    if (apiSearch.length < 2) return
    setApiSearching(true)
    const results = await searchEntreprise(apiSearch)
    setApiResults(results)
    setApiSearching(false)
  }, [apiSearch])

  // ═══════════════════════════════════════════════════════════
  // CRÉATION PROJET
  // ═══════════════════════════════════════════════════════════
  const selectExistingClient = (client) => {
    setSelectedClient(client)
    setNewProject({
      company_name: client.name,
      siret: client.siret || '',
      naf_code: client.naf_code || '',
      naf_label: client.naf_label || '',
      address: client.address || '',
      city: client.city || '',
      postal_code: client.postal_code || '',
      effectif: client.effectif || '',
      contact_name: client.contact_name || '',
      contact_function: client.contact_function || '',
      client_id: client.id,
    })
    setCreateStep(2)
  }

  const selectApiResult = (company) => {
    setSelectedClient(null)
    setNewProject({
      company_name: company.name,
      siret: company.siret,
      naf_code: company.naf_code,
      naf_label: company.naf_label,
      address: company.address,
      city: company.city,
      postal_code: company.postal_code,
      effectif: getEffectifLabel(company.effectif),
      contact_name: '',
      contact_function: '',
      client_id: null,
    })
    // Auto-detect sector from NAF
    if (company.naf_code && sectors.length) {
      const prefix2 = company.naf_code.substring(0, 2)
      const match = sectors.find(s => s.naf_prefix === prefix2)
      if (match) setSelectedSectors([match])
    }
    setCreateStep(2)
  }

  const toggleSector = (sector) => {
    setSelectedSectors(prev => {
      const exists = prev.find(s => s.sector_code === sector.sector_code)
      if (exists) return prev.filter(s => s.sector_code !== sector.sector_code)
      return [...prev, sector]
    })
  }

  const generateReference = () => {
    const year = new Date().getFullYear()
    const month = String(new Date().getMonth() + 1).padStart(2, '0')
    const rand = String(Math.floor(Math.random() * 9000) + 1000)
    return `DU-${year}${month}-${rand}`
  }

  const createProject = async () => {
    if (!newProject.company_name) return toast.error('Nom entreprise requis')
    if (!selectedSectors.length) return toast.error('Sélectionnez au moins un secteur')
    
    setCreating(true)
    try {
      const ref = generateReference()
      const { data: project, error } = await supabase
        .from('duerp_projects')
        .insert({
          ...newProject,
          sector_template: selectedSectors.map(s => s.sector_code).join(','),
          reference: ref,
          status: 'brouillon',
          date_elaboration: new Date().toISOString().split('T')[0],
          evaluateur: currentUserName(),
          participants: [],
        })
        .select()
        .single()
      
      if (error) throw error

      // Fusionner les unités de travail de tous les secteurs (dédupliquées par code)
      const allUnits = []
      const seenCodes = new Set()
      for (const sector of selectedSectors) {
        for (const u of (sector.default_units || [])) {
          if (!seenCodes.has(u.code)) {
            seenCodes.add(u.code)
            allUnits.push(u)
          }
        }
      }
      if (allUnits.length) {
        const units = allUnits.map((u, i) => ({
          project_id: project.id,
          code: u.code,
          name: u.name,
          sort_order: i,
        }))
        await supabase.from('duerp_units').insert(units)
      }

      // Fusionner les catégories de risques de tous les secteurs (dédupliquées)
      const allRiskCodes = [...new Set(selectedSectors.flatMap(s => s.default_risk_codes || []))]
      if (allRiskCodes.length) {
        const { data: templates } = await supabase
          .from('duerp_risk_templates')
          .select('*')
          .in('category_code', allRiskCodes)
          .order('sort_order')
        
        if (templates?.length) {
          const risks = templates.map((t, i) => ({
            project_id: project.id,
            template_id: t.id,
            category_code: t.category_code,
            danger: t.label,
            situation: t.situations,
            consequences: t.consequences,
            prevention_existante: t.prevention_suggestions,
            sort_order: i,
          }))
          await supabase.from('duerp_risks').insert(risks)
        }
      }

      // Si client existant, mettre à jour le naf_code
      if (newProject.client_id && newProject.naf_code) {
        await supabase.from('clients').update({
          naf_code: newProject.naf_code,
          naf_label: newProject.naf_label,
          effectif: newProject.effectif,
        }).eq('id', newProject.client_id)
      }

      toast.success(`Projet DUERP créé : ${ref}`)
      resetCreateForm()
      loadAll()

      // Si des risques orphelins ont été injectés → écran de rattachement
      if (templates?.length) {
        const { data: createdUnits } = await supabase.from('duerp_units').select('*').eq('project_id', project.id).order('sort_order')
        const { data: orphanRisks } = await supabase.from('duerp_risks').select('*').eq('project_id', project.id).is('unit_id', null)
        if (orphanRisks?.length && createdUnits?.length) {
          const initAssignments = {}
          orphanRisks.forEach(r => { initAssignments[r.id] = '' })
          setRattachAssignments(initAssignments)
          setRattachementData({ projectId: project.id, units: createdUnits, orphanRisks })
          setShowRattachement(true)
        }
      }
    } catch (err) {
      console.error(err)
      toast.error('Erreur création : ' + (err.message || ''))
    }
    setCreating(false)
  }

  const resetCreateForm = () => {
    setShowCreate(false)
    setCreateStep(1)
    setSelectedClient(null)
    setSelectedSectors([])
    setClientSearch('')
    setApiSearch('')
    setApiResults([])
    setNewProject({})
  }

  // Sauvegarde du rattachement des risques orphelins
  const saveRattachement = async () => {
    if (!rattachementData) return
    setRattachSaving(true)
    try {
      const updates = Object.entries(rattachAssignments).filter(([, unitId]) => unitId && unitId !== '__skip')
      const toDelete = Object.entries(rattachAssignments).filter(([, unitId]) => unitId === '__skip').map(([riskId]) => riskId)

      for (const [riskId, unitId] of updates) {
        await supabase.from('duerp_risks').update({ unit_id: unitId }).eq('id', riskId)
      }
      if (toDelete.length) {
        // Supprimer les actions liées aux risques ignorés avant de supprimer les risques
        await supabase.from('duerp_actions').delete().in('risk_id', toDelete)
        await supabase.from('duerp_risks').delete().in('id', toDelete)
      }
      toast.success(`Rattachement enregistré - ${updates.length} risque(s) affecté(s)${toDelete.length ? `, ${toDelete.length} supprimé(s)` : ''}`)
      setShowRattachement(false)
      setRattachementData(null)
      setRattachAssignments({})
    } catch (err) {
      toast.error('Erreur : ' + err.message)
    }
    setRattachSaving(false)
  }

  // ═══════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════
  const deleteProject = async (id) => {
    if (!confirm('Supprimer ce projet DUERP et toutes ses données ?')) return
    await supabase.from('duerp_projects').delete().eq('id', id)
    toast.success('Projet supprimé')
    setContextMenu(null)
    loadAll()
  }

  const duplicateProject = async (project) => {
    const ref = generateReference()
    const { data: newP } = await supabase
      .from('duerp_projects')
      .insert({
        client_id: project.client_id,
        company_name: project.company_name,
        siret: project.siret,
        naf_code: project.naf_code,
        naf_label: project.naf_label,
        address: project.address,
        city: project.city,
        postal_code: project.postal_code,
        effectif: project.effectif,
        contact_name: project.contact_name,
        contact_function: project.contact_function,
        sector_template: project.sector_template,
        reference: ref,
        version: (project.version || 1) + 1,
        status: 'brouillon',
        date_elaboration: new Date().toISOString().split('T')[0],
        evaluateur: project.evaluateur,
      })
      .select().single()

    if (newP) {
      // Copier unités
      const { data: units } = await supabase.from('duerp_units').select('*').eq('project_id', project.id)
      if (units?.length) {
        const unitMap = {}
        for (const u of units) {
          const { data: nu } = await supabase.from('duerp_units').insert({
            project_id: newP.id, code: u.code, name: u.name, description: u.description,
            effectif: u.effectif, metiers: u.metiers, sort_order: u.sort_order
          }).select().single()
          if (nu) unitMap[u.id] = nu.id
        }
        // Copier risques
        const { data: risks } = await supabase.from('duerp_risks').select('*').eq('project_id', project.id)
        if (risks?.length) {
          await supabase.from('duerp_risks').insert(risks.map(r => ({
            project_id: newP.id, unit_id: unitMap[r.unit_id] || null,
            template_id: r.template_id, category_code: r.category_code,
            danger: r.danger, situation: r.situation, consequences: r.consequences,
            description_travail: r.description_travail,
            frequence: r.frequence, gravite: r.gravite,
            prevention_existante: r.prevention_existante, maitrise: r.maitrise,
            notes: r.notes, sort_order: r.sort_order
          })))
        }
      }
      toast.success(`Projet dupliqué : ${ref}`)
      loadAll()
    }
    setContextMenu(null)
  }

  const archiveProject = async (id) => {
    await supabase.from('duerp_projects').update({ status: 'archive' }).eq('id', id)
    toast.success('Projet archivé')
    setContextMenu(null)
    loadAll()
  }

  // ═══════════════════════════════════════════════════════════
  // FILTRAGE
  // ═══════════════════════════════════════════════════════════
  const filteredProjects = projects.filter(p => {
    if (!showArchived && p.status === 'archive') return false
    if (statusFilter && p.status !== statusFilter) return false
    if (searchTerm) {
      const s = searchTerm.toLowerCase()
      return (p.company_name || '').toLowerCase().includes(s)
        || (p.reference || '').toLowerCase().includes(s)
        || (p.city || '').toLowerCase().includes(s)
        || (p.siret || '').includes(s)
    }
    return true
  })

  // Clients filtrés pour le modal
  const filteredClients = clients.filter(c => {
    if (!clientSearch) return true
    const s = clientSearch.toLowerCase()
    return (c.name || '').toLowerCase().includes(s)
      || (c.city || '').toLowerCase().includes(s)
      || (c.siret || '').includes(s)
  }).slice(0, 10)

  // ═══════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════
  const stats = {
    total: projects.filter(p => p.status !== 'archive').length,
    en_cours: projects.filter(p => ['en_cours', 'visite_terrain', 'finalisation'].includes(p.status)).length,
    termines: projects.filter(p => p.status === 'termine').length,
    brouillons: projects.filter(p => p.status === 'brouillon').length,
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* HEADER */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Shield className="w-7 h-7 text-amber-600" />
            DUERP - Documents Uniques
          </h1>
          <p className="text-gray-500 text-sm mt-1">Évaluation des Risques Professionnels</p>
        </div>
        <button onClick={() => { resetCreateForm(); setShowCreate(true) }}
          className="flex items-center gap-2 px-4 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition font-medium shadow-sm">
          <Plus className="w-5 h-5" /> Nouveau DUERP
        </button>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total', value: stats.total, icon: '', color: 'border-gray-300' },
          { label: 'En cours', value: stats.en_cours, icon: '', color: 'border-blue-400' },
          { label: 'Terminés', value: stats.termines, icon: '', color: 'border-green-400' },
          { label: 'Brouillons', value: stats.brouillons, icon: '', color: 'border-gray-400' },
        ].map(s => (
          <div key={s.label} className={`bg-white rounded-xl border-l-4 ${s.color} p-4 shadow-sm`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                <p className="text-xs text-gray-500">{s.label}</p>
              </div>
              <span className="text-2xl">{s.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* FILTRES */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="Rechercher entreprise, référence, ville..."
            className="w-full pl-10 pr-3 py-2 border rounded-lg text-sm" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 border rounded-lg text-sm">
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS_CONFIG).filter(([k]) => k !== 'archive').map(([k, v]) => (
            <option key={k} value={k}>{v.emoji} {v.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer">
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)}
            className="rounded" />
          Archivés
        </label>
      </div>

      {/* LISTE PROJETS */}
      {filteredProjects.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">Aucun projet DUERP</h3>
          <p className="text-gray-400 mb-6">Créez votre premier Document Unique d'Évaluation des Risques Professionnels</p>
          <button onClick={() => { resetCreateForm(); setShowCreate(true) }}
            className="px-6 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition">
            <Plus className="w-4 h-4 inline mr-2" /> Créer un DUERP
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredProjects.map(p => {
            const st = STATUS_CONFIG[p.status] || STATUS_CONFIG.brouillon
            const rc = riskCounts[p.id] || { total: 0, max: 0 }
            const ac = actionCounts[p.id] || { total: 0, done: 0 }
            const maxLevel = getRiskLevel(rc.max)
            const sectorLabels = (p.sector_template || '').split(',').map(code => sectors.find(s => s.sector_code === code.trim())?.sector_label).filter(Boolean)

            return (
              <div key={p.id} className="bg-white rounded-xl shadow-sm border hover:shadow-md transition group relative">
                <Link to={`/duerp/${p.id}`} className="block p-4">
                  <div className="flex items-start justify-between">
                    {/* Gauche */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>
                          {st.emoji} {st.label}
                        </span>
                        <span className="text-xs text-gray-400 font-mono">{p.reference}</span>
                        {p.version > 1 && <span className="text-xs bg-blue-50 text-blue-600 px-1.5 rounded">v{p.version}</span>}
                      </div>
                      
                      <h3 className="font-semibold text-gray-900 truncate">{p.company_name}</h3>
                      
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-gray-500">
                        {p.city && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {p.postal_code} {p.city}
                          </span>
                        )}
                        {p.siret && <span className="font-mono">{p.siret}</span>}
                        {sectorLabels.length > 0 && <span className="text-amber-600">{sectorLabels.join(' + ')}</span>}
                        {p.effectif && <span> {p.effectif}</span>}
                      </div>
                    </div>

                    {/* Droite - métriques */}
                    <div className="flex items-center gap-4 ml-4 shrink-0">
                      {/* Risques */}
                      <div className="text-center">
                        <div className="flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 text-gray-400" />
                          <span className="text-lg font-bold text-gray-700">{rc.total}</span>
                        </div>
                        <p className="text-[10px] text-gray-400">risques</p>
                        {rc.max > 0 && (
                          <div className={`w-full h-1 rounded mt-0.5 ${maxLevel.color}`} />
                        )}
                      </div>

                      {/* Actions */}
                      <div className="text-center">
                        <div className="flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5 text-gray-400" />
                          <span className="text-lg font-bold text-gray-700">
                            {ac.total > 0 ? `${ac.done}/${ac.total}` : '-'}
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-400">actions</p>
                      </div>

                      {/* Date */}
                      <div className="text-center hidden md:block">
                        <div className="flex items-center gap-1 text-xs text-gray-400">
                          <Calendar className="w-3 h-3" />
                          {p.updated_at ? format(new Date(p.updated_at), 'dd/MM/yy', { locale: fr }) : '-'}
                        </div>
                        <p className="text-[10px] text-gray-400">modifié</p>
                      </div>

                      {/* Menu contextuel */}
                      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu(contextMenu === p.id ? null : p.id) }}
                        className="p-1.5 rounded-lg hover:bg-gray-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 transition">
                        <MoreVertical className="w-4 h-4 text-gray-400" />
                      </button>
                    </div>
                  </div>
                </Link>

                {/* Menu contextuel */}
                {contextMenu === p.id && (
                  <div className="absolute right-4 top-14 bg-white rounded-lg shadow-xl border py-1 z-20 min-w-[160px]"
                    onClick={() => setContextMenu(null)}>
                    <button onClick={() => duplicateProject(p)}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50">
                      <Copy className="w-4 h-4" /> Dupliquer
                    </button>
                    {p.status !== 'archive' && (
                      <button onClick={() => archiveProject(p.id)}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50">
                        <Archive className="w-4 h-4" /> Archiver
                      </button>
                    )}
                    <hr className="my-1" />
                    <button onClick={() => deleteProject(p.id)}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                      <Trash2 className="w-4 h-4" /> Supprimer
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* MODAL CRÉATION                                           */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) resetCreateForm() }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-amber-50 to-orange-50">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Nouveau DUERP</h2>
                <div className="flex items-center gap-2 mt-1">
                  {[1, 2, 3].map(step => (
                    <div key={step} className="flex items-center gap-1">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                        ${createStep >= step ? 'bg-amber-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                        {step}
                      </div>
                      <span className={`text-xs ${createStep >= step ? 'text-amber-700' : 'text-gray-400'}`}>
                        {step === 1 ? 'Entreprise' : step === 2 ? 'Secteur' : 'Validation'}
                      </span>
                      {step < 3 && <ChevronDown className="w-3 h-3 text-gray-300 rotate-[-90deg]" />}
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={resetCreateForm} className="p-2 hover:bg-white/80 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6">
              
              {/* ÉTAPE 1 : Sélection entreprise */}
              {createStep === 1 && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600 mb-4">
                    Sélectionnez un client existant ou recherchez une entreprise par nom/SIRET.
                  </p>
                  
                  {/* Clients existants */}
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-2 block">
                      <Building2 className="w-4 h-4 inline mr-1" /> Clients existants
                    </label>
                    <input value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                      placeholder="Filtrer vos clients..."
                      className="w-full px-3 py-2 border rounded-lg text-sm mb-2" />
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {filteredClients.map(c => (
                        <button key={c.id} onClick={() => selectExistingClient(c)}
                          className="w-full text-left p-2.5 rounded-lg hover:bg-amber-50 border border-transparent hover:border-amber-200 transition flex items-center justify-between">
                          <div>
                            <span className="font-medium text-sm">{c.name}</span>
                            <span className="text-xs text-gray-400 ml-2">{c.city}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {c.siret && <span className="text-xs text-gray-400 font-mono">{c.siret}</span>}
                            <ArrowRight className="w-4 h-4 text-amber-500" />
                          </div>
                        </button>
                      ))}
                      {filteredClients.length === 0 && clientSearch && (
                        <p className="text-xs text-gray-400 text-center py-2">Aucun client trouvé</p>
                      )}
                    </div>
                  </div>

                  <div className="relative py-3">
                    <hr />
                    <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-3 text-xs text-gray-400">
                      ou recherche externe
                    </span>
                  </div>

                  {/* Recherche API */}
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-2 block">
                      <Search className="w-4 h-4 inline mr-1" /> Recherche entreprise (API gouv)
                    </label>
                    <div className="flex gap-2">
                      <input value={apiSearch} onChange={e => setApiSearch(e.target.value)}
                        placeholder="Nom ou SIRET de l'entreprise..."
                        className="flex-1 px-3 py-2 border rounded-lg text-sm"
                        onKeyDown={e => e.key === 'Enter' && doApiSearch()} />
                      <button onClick={doApiSearch} disabled={apiSearching || apiSearch.length < 2}
                        className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm hover:bg-gray-700 disabled:opacity-50 flex items-center gap-1">
                        {apiSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                        Chercher
                      </button>
                    </div>
                    {apiResults.length > 0 && (
                      <div className="mt-2 max-h-48 overflow-y-auto space-y-1 border rounded-lg p-2">
                        {apiResults.map((r, i) => (
                          <button key={i} onClick={() => selectApiResult(r)}
                            className="w-full text-left p-2.5 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-200 transition">
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-sm">{r.name}</span>
                              <ArrowRight className="w-4 h-4 text-blue-500" />
                            </div>
                            <div className="flex flex-wrap gap-2 mt-1 text-xs text-gray-500">
                              {r.siret && <span className="font-mono">{r.siret}</span>}
                              {r.city && <span>{r.postal_code} {r.city}</span>}
                              {r.naf_code && <span className="text-amber-600">NAF {r.naf_code}</span>}
                              {r.effectif && <span> {getEffectifLabel(r.effectif)}</span>}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ÉTAPE 2 : Sélection secteur */}
              {createStep === 2 && (
                <div className="space-y-4">
                  {/* Résumé entreprise */}
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-sm">{newProject.company_name}</p>
                        <p className="text-xs text-gray-500">
                          {[newProject.postal_code, newProject.city].filter(Boolean).join(' ')}
                          {newProject.siret && <span className="ml-2 font-mono">SIRET {newProject.siret}</span>}
                        </p>
                      </div>
                      <button onClick={() => setCreateStep(1)} className="text-xs text-amber-600 hover:underline">Modifier</button>
                    </div>
                  </div>

                  <p className="text-sm text-gray-600">
                    Sélectionnez un ou plusieurs secteurs d'activité pour pré-remplir les risques et unités.
                    {newProject.naf_code && (
                      <span className="ml-1 text-amber-600 font-medium">
                        (NAF détecté : {newProject.naf_code} - {newProject.naf_label})
                      </span>
                    )}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {sectors.map(s => {
                      const isAutoDetected = newProject.naf_code && s.naf_prefix === newProject.naf_code?.substring(0, 2)
                      const isSelected = selectedSectors.some(sel => sel.sector_code === s.sector_code)
                      return (
                        <button key={s.sector_code} onClick={() => toggleSector(s)}
                          className={`text-left p-3 rounded-lg border-2 transition
                            ${isSelected ? 'border-amber-500 bg-amber-50' :
                              isAutoDetected ? 'border-amber-300 bg-amber-50/50' :
                              'border-gray-200 hover:border-gray-300'}`}>
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">{s.sector_label}</span>
                            {isAutoDetected && !isSelected && (
                              <span className="text-[10px] bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full">Suggéré</span>
                            )}
                            {isSelected && <CheckCircle className="w-5 h-5 text-amber-600" />}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-[10px] text-gray-400">
                              {(s.default_units || []).length} unités • {(s.default_risk_codes || []).length} catégories de risques
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                  {selectedSectors.length > 0 && (
                    <div className="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
                      <p className="text-sm text-amber-800 font-medium">
                        {selectedSectors.length} secteur(s) : {selectedSectors.map(s => s.sector_label).join(' + ')}
                      </p>
                      <p className="text-xs text-amber-600 mt-1">
                        {(() => { const seen = new Set(); selectedSectors.forEach(s => (s.default_units || []).forEach(u => seen.add(u.code))); return seen.size })()} unités • {[...new Set(selectedSectors.flatMap(s => s.default_risk_codes || []))].length} catégories de risques (fusionnés)
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ÉTAPE 3 : Validation / infos complémentaires */}
              {createStep === 3 && (
                <div className="space-y-4">
                  <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-200">
                    <h3 className="font-bold text-gray-900 mb-2">{newProject.company_name}</h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-gray-500">SIRET :</span> <span className="font-mono">{newProject.siret || '-'}</span></div>
                      <div><span className="text-gray-500">NAF :</span> {newProject.naf_code || '-'}</div>
                      <div><span className="text-gray-500">Ville :</span> {newProject.postal_code} {newProject.city || '-'}</div>
                      <div><span className="text-gray-500">Effectif :</span> {newProject.effectif || '-'}</div>
                      <div className="col-span-2"><span className="text-gray-500">Secteur(s) :</span> <span className="text-amber-700 font-medium">{selectedSectors.map(s => s.sector_label).join(' + ')}</span></div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500">Contact sur site</label>
                      <input value={newProject.contact_name || ''} onChange={e => setNewProject({ ...newProject, contact_name: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Nom du contact" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Fonction</label>
                      <input value={newProject.contact_function || ''} onChange={e => setNewProject({ ...newProject, contact_function: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Directeur, RH..." />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Date de visite prévue</label>
                      <input type="date" value={newProject.date_visite || ''}
                        onChange={e => setNewProject({ ...newProject, date_visite: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Effectif (préciser)</label>
                      <input value={newProject.effectif || ''} onChange={e => setNewProject({ ...newProject, effectif: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Ex: 12 salariés" />
                    </div>
                  </div>

                  <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
                    <p className="font-medium mb-1">Ce qui sera créé automatiquement :</p>
                    <ul className="text-xs space-y-0.5 ml-4 list-disc">
                      <li>{(() => { const seen = new Set(); selectedSectors.forEach(s => (s.default_units || []).forEach(u => seen.add(u.code))); return seen.size })() } unités de travail pré-configurées</li>
                      <li>Risques types des secteurs « {selectedSectors.map(s => s.sector_label).join(' + ')} » pré-chargés</li>
                      <li>Grille de cotation F×G avec maîtrise → risque résiduel</li>
                      {newProject.client_id && <li>Lié à la fiche client existante</li>}
                    </ul>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
              <button onClick={() => createStep > 1 ? setCreateStep(createStep - 1) : resetCreateForm()}
                className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg text-sm">
                {createStep === 1 ? 'Annuler' : '← Retour'}
              </button>
              
              {createStep < 3 ? (
                <button onClick={() => {
                  if (createStep === 1 && !newProject.company_name) return toast.error('Sélectionnez une entreprise')
                  if (createStep === 2 && !selectedSectors.length) return toast.error('Sélectionnez au moins un secteur')
                  setCreateStep(createStep + 1)
                }}
                  disabled={createStep === 2 && !selectedSectors.length}
                  className="px-6 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 text-sm font-medium flex items-center gap-1">
                  Suivant <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button onClick={createProject} disabled={creating}
                  className="px-6 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 text-sm font-medium flex items-center gap-2">
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Créer le DUERP
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Overlay pour fermer le context menu */}
      {contextMenu && (
        <div className="fixed inset-0 z-10" onClick={() => setContextMenu(null)} />
      )}

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* MODAL RATTACHEMENT ORPHELINS (post-création)                   */}
      {/* ════════════════════════════════════════════════════════════════ */}
      {showRattachement && rattachementData && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Rattachement des risques types</h2>
                <p className="text-sm text-gray-500 mt-0.5">{rattachementData.orphanRisks.length} risques pré-chargés depuis les templates - à affecter aux unités ou à supprimer</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-medium">Étape obligatoire</span>
              </div>
            </div>

            {/* Corps */}
            <div className="flex-1 overflow-y-auto p-5 space-y-2">
              {/* Actions rapides */}
              <div className="flex gap-2 mb-3 flex-wrap">
                <span className="text-xs font-medium text-gray-500 self-center">Tout affecter à :</span>
                {rattachementData.units.map(u => (
                  <button key={u.id} onClick={() => {
                    const all = {}
                    rattachementData.orphanRisks.forEach(r => { all[r.id] = u.id })
                    setRattachAssignments(all)
                  }} className="text-xs px-2.5 py-1 bg-teal-50 text-teal-700 border border-teal-200 rounded-lg hover:bg-teal-100 transition">
                    {u.name}
                  </button>
                ))}
                <button onClick={() => {
                  const all = {}
                  rattachementData.orphanRisks.forEach(r => { all[r.id] = '__skip' })
                  setRattachAssignments(all)
                }} className="text-xs px-2.5 py-1 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition">
                  Tout supprimer
                </button>
              </div>

              {rattachementData.orphanRisks.map(risk => (
                <div key={risk.id} className={`flex items-center gap-3 p-3 rounded-xl border transition ${rattachAssignments[risk.id] === '__skip' ? 'opacity-40 bg-red-50 border-red-200' : rattachAssignments[risk.id] ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{risk.danger}</p>
                    {risk.situation && <p className="text-xs text-gray-400 truncate">{risk.situation}</p>}
                  </div>
                  <select
                    value={rattachAssignments[risk.id] || ''}
                    onChange={e => setRattachAssignments(prev => ({ ...prev, [risk.id]: e.target.value }))}
                    className="text-xs border rounded-lg px-2 py-1.5 bg-white min-w-[160px] focus:ring-1 focus:ring-teal-400"
                  >
                    <option value="">- Affecter à... -</option>
                    {rattachementData.units.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                    <option value="__skip"> Supprimer ce risque</option>
                  </select>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="p-5 border-t flex items-center justify-between gap-3">
              <div className="text-xs text-gray-400">
                {Object.values(rattachAssignments).filter(v => v && v !== '__skip').length} affecté(s) · {Object.values(rattachAssignments).filter(v => v === '__skip').length} à supprimer · {Object.values(rattachAssignments).filter(v => !v).length} en attente
              </div>
              <div className="flex gap-3">
                <Link to={`/duerp/${rattachementData.projectId}`}
                  onClick={() => { setShowRattachement(false); setRattachementData(null) }}
                  className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg transition">
                  Passer - gérer dans le projet
                </Link>
                <button onClick={saveRattachement} disabled={rattachSaving}
                  className="px-6 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-medium hover:bg-teal-700 disabled:opacity-50 flex items-center gap-2">
                  {rattachSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Enregistrer et ouvrir le projet
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
