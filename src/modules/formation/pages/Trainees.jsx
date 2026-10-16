import { useEffect, useState, useMemo, useRef } from 'react'
import { useDataStore, useAuthStore } from '../../../core/store'
import PasseportTraineeBlock from '../../passeport/components/PasseportTraineeBlock'
import { PP_ROLES } from '../../passeport/lib/ppData'
import { supabase } from '../../../core/supabase'
import { Plus, Search, Edit, Trash2, X, Save, FileText, Upload, Eye, Building2, Download, CheckSquare } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import SearchSelect, { clientOptions } from '../../../ui/SearchSelect'

// Fonction de formatage des noms
const formatName = (value, type) => {
  if (!value) return ''
  // Remplacer les caractères accentués pour les majuscules
  const upperAccents = { 'é': 'É', 'è': 'È', 'ê': 'Ê', 'ë': 'Ë', 'à': 'À', 'â': 'Â', 'ä': 'Ä', 'ù': 'Ù', 'û': 'Û', 'ü': 'Ü', 'ô': 'Ô', 'ö': 'Ö', 'î': 'Î', 'ï': 'Ï', 'ç': 'Ç', 'ñ': 'Ñ' }
  const upperAccentsSimple = { 'é': 'E', 'è': 'E', 'ê': 'E', 'ë': 'E', 'à': 'A', 'â': 'A', 'ä': 'A', 'ù': 'U', 'û': 'U', 'ü': 'U', 'ô': 'O', 'ö': 'O', 'î': 'I', 'ï': 'I', 'ç': 'C', 'ñ': 'N' }
  
  if (type === 'last') {
    // NOM en majuscules
    return value.split('').map(c => upperAccentsSimple[c.toLowerCase()] || c.toUpperCase()).join('')
  } else {
    // Prénom composé : Jean-Pierre, Marie Claire
    // Capitaliser après tiret ou espace
    return value
      .toLowerCase()
      .split(/(-|\s)/) // Sépare par tiret ou espace, garde le séparateur
      .map(part => {
        if (part === '-' || part === ' ') return part
        if (part.length === 0) return part
        const firstChar = part.charAt(0)
        const upperFirst = upperAccents[firstChar] || firstChar.toUpperCase()
        return upperFirst + part.slice(1)
      })
      .join('')
  }
}

// Modal de confirmation
const ConfirmModal = ({ show, onConfirm, onCancel, message }) => {
  if (!show) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white rounded-ui shadow-md p-6 max-w-sm mx-4">
        <p className="text-gray-700 mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn btn-secondary">Annuler</button>
          <button onClick={onConfirm} className="btn bg-[rgb(var(--c-danger))] text-white hover:bg-[rgb(var(--c-danger))]">Supprimer</button>
        </div>
      </div>
    </div>
  )
}

export default function Trainees() {
  // Module Passeport de prévention actif : nom de naissance et numéro gérés par le bloc Passeport (numéro chiffré, jamais affiché)
  const { modules: ppModules, userRole: ppRole } = useAuthStore()
  const passeportOn = (ppModules || []).includes('passeport')
  const passeportEdit = passeportOn && PP_ROLES.includes(ppRole)
  const { 
    trainees, fetchTrainees, createTrainee, updateTrainee, deleteTrainee, getTraineeWithSSN,
    clients, fetchClients,
    fetchTraineeDocuments, uploadTraineeDocument, deleteTraineeDocument, getSessionDocumentUrl,
    logAudit, exportTraineeData
  } = useDataStore()
  
  const [search, setSearch] = useState('')
  const [filterClient, setFilterClient] = useState('')
  const [sortBy, setSortBy] = useState('name') // name, client, created
  const [showForm, setShowForm] = useState(false)
  const [showDocs, setShowDocs] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [selectedTrainee, setSelectedTrainee] = useState(null)
  const [loadingSSN, setLoadingSSN] = useState(false)
  const [decryptedSSN, setDecryptedSSN] = useState(null)
  const [traineeDocuments, setTraineeDocuments] = useState([])
  const [uploading, setUploading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [showBulkAdd, setShowBulkAdd] = useState(false)
  const [bulkClientId, setBulkClientId] = useState('')
  const [bulkTrainees, setBulkTrainees] = useState([
    { first_name: '', last_name: '', email: '', phone: '', social_security_number: '' }
  ])
  const [duplicateWarning, setDuplicateWarning] = useState(null) // { type: 'single'|'bulk', duplicates: [], onConfirm: fn }
  
  // Sélection en masse
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [showBulkActions, setShowBulkActions] = useState(false)
  const [bulkGender, setBulkGender] = useState('')
  const [bulkCsp, setBulkCsp] = useState('')
  const [massClientId, setMassClientId] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  
  // Recherche entreprise dans filtre
  const [clientSearch, setClientSearch] = useState('')
  const [showClientDropdown, setShowClientDropdown] = useState(false)
  const clientDropdownRef = useRef(null)
  
  const filteredClients = useMemo(() => {
    if (!clientSearch) return clients
    return clients.filter(c => c.name?.toLowerCase().includes(clientSearch.toLowerCase()))
  }, [clients, clientSearch])
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '', 
    social_security_number: '', client_id: '', notes: '',
    birth_date: '', refused_ssn: false,
    has_disability: false, disability_details: '', disability_adaptations: '',
    csp: '', job_title: '', gender: ''
  })
  
  useEffect(() => {
    fetchTrainees()
    fetchClients()
  }, [])
  
  const filtered = trainees
    .filter(t => {
      const clientName = clients.find(c => c.id === t.client_id)?.name || ''
      const searchFields = `${t.first_name} ${t.last_name} ${t.email} ${t.phone || ''} ${clientName}`.toLowerCase()
      const matchSearch = !search || searchFields.includes(search.toLowerCase())
      const matchClient = !filterClient || t.client_id === filterClient
      return matchSearch && matchClient
    })
    .sort((a, b) => {
      if (sortBy === 'created') {
        // Tri par date de création (plus récent en premier)
        return new Date(b.created_at || 0) - new Date(a.created_at || 0)
      }
      if (sortBy === 'client') {
        const clientA = clients.find(c => c.id === a.client_id)?.name || 'zzz'
        const clientB = clients.find(c => c.id === b.client_id)?.name || 'zzz'
        if (clientA !== clientB) return clientA.localeCompare(clientB)
        // Sous-tri par nom
        return (a.last_name || '').localeCompare(b.last_name || '')
      }
      // Tri par nom (défaut)
      return (a.last_name || '').localeCompare(b.last_name || '')
    })
  
  const openForm = (trainee = null) => {
    if (trainee) {
      setForm({
        first_name: trainee.first_name || '',
        last_name: trainee.last_name || '',
        email: trainee.email || '',
        phone: trainee.phone || '',
        social_security_number: trainee.social_security_number || '',
        client_id: trainee.client_id || '',
        notes: trainee.notes || '',
        birth_date: trainee.birth_date || '',
        refused_ssn: trainee.refused_ssn || false,
        has_disability: trainee.has_disability || false,
        disability_details: trainee.disability_details || '',
        disability_adaptations: trainee.disability_adaptations || '',
        csp: trainee.csp || '',
        job_title: trainee.job_title || '',
        gender: trainee.gender || '',
      })
      setSelectedTrainee(trainee)
    } else {
      setForm({ first_name: '', last_name: '', email: '', phone: '', social_security_number: '', client_id: '', notes: '', birth_date: '', refused_ssn: false, has_disability: false, disability_details: '', disability_adaptations: '', csp: '', job_title: '', gender: '' })
      setSelectedTrainee(null)
    }
    setShowForm(true)
  }
  
  const openPreview = async (trainee) => {
    setSelectedTrainee(trainee)
    setDecryptedSSN(null)
    setShowPreview(true)
    
    // Log d'audit : consultation fiche stagiaire
    logAudit('view', 'trainee', trainee.id, `${trainee.first_name} ${trainee.last_name}`)
    
    // Charger le N° sécu déchiffré si le stagiaire en a un
    if (!passeportOn && (trainee.social_security_number || trainee.ssn_encrypted)) {
      setLoadingSSN(true)
      const { data } = await getTraineeWithSSN(trainee.id)
      if (data?.social_security_number) {
        setDecryptedSSN(data.social_security_number)
      } else if (trainee.social_security_number) {
        // Fallback : N° non chiffré (ancien format)
        setDecryptedSSN(trainee.social_security_number)
      }
      setLoadingSSN(false)
    }
  }
  
  const handleNameChange = (field, value) => {
    const formatted = formatName(value, field === 'last_name' ? 'last' : 'first')
    setForm({...form, [field]: formatted})
  }
  
  // Fonction de vérification des doublons
  const checkDuplicates = (firstName, lastName, clientId) => {
    const normalizedFirst = firstName.toLowerCase().trim()
    const normalizedLast = lastName.toLowerCase().trim()
    
    return trainees.filter(t => {
      const matchName = t.first_name?.toLowerCase().trim() === normalizedFirst && 
                        t.last_name?.toLowerCase().trim() === normalizedLast
      
      // Si client spécifié, vérifier pour ce client
      if (clientId) {
        return matchName && t.client_id === clientId
      }
      // Si pas de client, vérifier parmi les stagiaires sans client
      return matchName && !t.client_id
    })
  }
  
  const handleSave = async (forceCreate = false) => {
    if (!form.first_name || !form.last_name) return toast.error('Nom et prénom obligatoires')
    if (!form.gender) return toast.error('Genre obligatoire (Homme / Femme / Non genré)')
    
    // Vérification des doublons (seulement à la création)
    if (!selectedTrainee && !forceCreate) {
      const duplicates = checkDuplicates(form.first_name, form.last_name, form.client_id)
      if (duplicates.length > 0) {
        setDuplicateWarning({
          type: 'single',
          duplicates,
          onConfirm: () => {
            setDuplicateWarning(null)
            handleSave(true) // Force la création
          }
        })
        return
      }
    }
    
    // Préparer les données en convertissant les chaînes vides en null
    const dataToSave = {
      first_name: form.first_name,
      last_name: form.last_name,
      email: form.email || null,
      phone: form.phone || null,
      social_security_number: form.social_security_number || null,
      client_id: form.client_id || null,
      notes: form.notes || null,
      birth_date: form.birth_date || null,
      refused_ssn: form.refused_ssn || false,
      has_disability: form.has_disability || false,
      disability_details: form.disability_details || null,
      disability_adaptations: form.disability_adaptations || null,
      csp: form.csp || null,
      job_title: form.job_title || null,
      gender: form.gender || null,
    }
    
    if (passeportOn) {
      // Le numéro et le refus passent par le module Passeport : jamais en clair dans la fiche
      delete dataToSave.social_security_number
      delete dataToSave.refused_ssn
    }
    console.log('Sauvegarde stagiaire avec:', dataToSave)
    
    const traineeName = `${form.first_name} ${form.last_name}`
    
    if (selectedTrainee) {
      const { error } = await updateTrainee(selectedTrainee.id, dataToSave)
      console.log('Résultat updateTrainee:', { error })
      if (error) {
        console.error('Erreur modification:', error)
        toast.error('Erreur lors de la modification')
        return
      }
      // Log d'audit : modification
      logAudit('update', 'trainee', selectedTrainee.id, traineeName)
      toast.success('Modifications enregistrées')
    } else {
      const { data, error } = await createTrainee(dataToSave)
      console.log('Résultat createTrainee:', { data, error })
      if (error) {
        console.error('Erreur création:', error)
        toast.error('Erreur lors de la création')
        return
      }
      // Log d'audit : création
      logAudit('create', 'trainee', data?.id, traineeName)
      toast.success('Stagiaire créé')
    }
    
    // Rafraîchir la liste pour récupérer les données à jour
    console.log('Rechargement des stagiaires...')
    await fetchTrainees()
    console.log('Stagiaires rechargés')
    setShowForm(false)
    setSelectedTrainee(null)
  }
  
  const handleDelete = async () => {
    if (!confirmDelete) return
    
    // Récupérer le nom avant suppression pour le log
    const traineeToDelete = trainees.find(t => t.id === confirmDelete)
    const traineeName = traineeToDelete ? `${traineeToDelete.first_name} ${traineeToDelete.last_name}` : 'Inconnu'
    
    await deleteTrainee(confirmDelete)
    
    // Log d'audit : suppression
    logAudit('delete', 'trainee', confirmDelete, traineeName)
    
    toast.success('Stagiaire supprimé')
    setConfirmDelete(null)
  }
  
  // Export RGPD des données du stagiaire
  const handleExportData = async (trainee) => {
    toast.loading('Export en cours...')
    
    const { data, error } = await exportTraineeData(trainee.id)
    
    toast.dismiss()
    
    if (error) {
      toast.error('Erreur lors de l\'export')
      return
    }
    
    // Log d'audit : export
    logAudit('export', 'trainee', trainee.id, `${trainee.first_name} ${trainee.last_name}`, { type: 'RGPD_EXPORT' })
    
    // Télécharger le fichier JSON
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `export-rgpd-${trainee.first_name}-${trainee.last_name}-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    
    toast.success('Export RGPD téléchargé')
  }
  
  // Fonctions pour ajout multiple
  const closeBulkModal = () => {
    setBulkTrainees([{ first_name: '', last_name: '', email: '', phone: '', social_security_number: '' }])
    setBulkClientId('')
    setShowBulkAdd(false)
  }
  
  const addBulkRow = () => {
    setBulkTrainees([...bulkTrainees, { first_name: '', last_name: '', email: '', phone: '', social_security_number: '' }])
  }
  
  const removeBulkRow = (index) => {
    if (bulkTrainees.length > 1) {
      setBulkTrainees(bulkTrainees.filter((_, i) => i !== index))
    }
  }
  
  const updateBulkRow = (index, field, value) => {
    const updated = [...bulkTrainees]
    if (field === 'first_name') {
      updated[index][field] = formatName(value, 'first')
    } else if (field === 'last_name') {
      updated[index][field] = formatName(value, 'last')
    } else {
      updated[index][field] = value
    }
    setBulkTrainees(updated)
  }
  
  const handleBulkSave = async (forceCreate = false) => {
    const validTrainees = bulkTrainees.filter(t => t.first_name && t.last_name)
    if (validTrainees.length === 0) {
      toast.error('Au moins un stagiaire avec nom et prénom requis')
      return
    }
    
    // Vérification des doublons si pas forcé
    if (!forceCreate) {
      const allDuplicates = []
      const seen = new Map() // Pour détecter les doublons entre les lignes saisies
      
      for (let i = 0; i < validTrainees.length; i++) {
        const trainee = validTrainees[i]
        const key = `${trainee.first_name.toLowerCase().trim()}|${trainee.last_name.toLowerCase().trim()}`
        
        // Vérifier si doublon dans les lignes actuelles
        if (seen.has(key)) {
          allDuplicates.push({
            trainee,
            reason: `Doublon dans la liste (ligne ${seen.get(key) + 1} et ${i + 1})`,
            type: 'internal'
          })
        } else {
          seen.set(key, i)
        }
        
        // Vérifier si existe déjà en base
        const existing = checkDuplicates(trainee.first_name, trainee.last_name, bulkClientId)
        if (existing.length > 0) {
          const clientName = clients.find(c => c.id === bulkClientId)?.name || 'Sans entreprise'
          allDuplicates.push({
            trainee,
            reason: `"${trainee.first_name} ${trainee.last_name}" existe déjà pour ${clientName}`,
            type: 'existing',
            existing: existing[0]
          })
        }
      }
      
      if (allDuplicates.length > 0) {
        setDuplicateWarning({
          type: 'bulk',
          duplicates: allDuplicates,
          onConfirm: () => {
            setDuplicateWarning(null)
            handleBulkSave(true) // Force la création
          }
        })
        return
      }
    }
    
    let created = 0
    let errors = 0
    
    for (let i = 0; i < validTrainees.length; i++) {
      const trainee = validTrainees[i]
      const { error } = await createTrainee({
        first_name: trainee.first_name,
        last_name: trainee.last_name,
        email: trainee.email || null,
        phone: trainee.phone || null,
        social_security_number: passeportOn ? null : (trainee.social_security_number || null),
        client_id: bulkClientId || null,
      })
      if (error) {
        console.error('Erreur création stagiaire:', error)
        errors++
      } else {
        created++
      }
    }
    
    if (errors > 0) {
      toast.error(`${errors} erreur(s) lors de la création`)
    }
    if (created > 0) {
      toast.success(`${created} stagiaire(s) créé(s)`)
    }
    
    // Rafraîchir la liste et fermer
    await fetchTrainees()
    closeBulkModal()
  }
  
  const openDocs = async (trainee) => {
    setSelectedTrainee(trainee)
    const { data } = await fetchTraineeDocuments(trainee.id)
    setTraineeDocuments(data || [])
    setShowDocs(true)
  }
  
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !selectedTrainee) return
    setUploading(true)
    const { error } = await uploadTraineeDocument(selectedTrainee.id, file, 'document')
    if (error) toast.error('Erreur upload')
    else {
      toast.success('Document uploadé')
      const { data } = await fetchTraineeDocuments(selectedTrainee.id)
      setTraineeDocuments(data || [])
    }
    setUploading(false)
    e.target.value = ''
  }
  
  const handleDeleteDoc = async (doc) => {
    await deleteTraineeDocument(doc.id, doc.file_path)
    setTraineeDocuments(prev => prev.filter(d => d.id !== doc.id))
    toast.success('Document supprimé')
  }
  
  const viewDoc = async (doc) => {
    const url = await getSessionDocumentUrl(doc.file_path)
    if (url) window.open(url, '_blank')
  }
  
  // Fermer le dropdown entreprise au clic extérieur
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target)) {
        setShowClientDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])
  
  // Sélection en masse
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  
  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(t => t.id)))
    }
  }
  
  const handleBulkUpdate = async () => {
    if (selectedIds.size === 0) return
    setBulkSaving(true)
    try {
      const updates = {}
      if (bulkGender) updates.gender = bulkGender
      if (bulkCsp) updates.csp = bulkCsp
      if (massClientId) updates.client_id = massClientId
      
      if (Object.keys(updates).length === 0) {
        toast.error('Aucune modification sélectionnée')
        setBulkSaving(false)
        return
      }
      
      const { error } = await supabase
        .from('trainees')
        .update(updates)
        .in('id', Array.from(selectedIds))
      
      if (error) throw error
      
      toast.success(`${selectedIds.size} stagiaire(s) mis à jour`)
      setSelectedIds(new Set())
      setShowBulkActions(false)
      setBulkGender('')
      setBulkCsp('')
      setMassClientId('')
      fetchTrainees()
    } catch (err) {
      console.error('Erreur mise à jour en masse:', err)
      toast.error('Erreur lors de la mise à jour')
    }
    setBulkSaving(false)
  }
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stagiaires</h1>
          <p className="text-gray-500">{trainees.length} stagiaire(s)</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowBulkAdd(true)} className="btn btn-secondary flex items-center gap-2">
            <Plus className="w-4 h-4" />Ajouter plusieurs
          </button>
          <button onClick={() => openForm()} className="btn btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />Nouveau
          </button>
        </div>
      </div>
      
      <div className="flex gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Rechercher..." className="input pl-10 w-full" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {/* Dropdown entreprise avec recherche */}
        <div className="relative w-56" ref={clientDropdownRef}>
          <div 
            className="input w-full cursor-pointer flex items-center justify-between gap-2"
            onClick={() => setShowClientDropdown(!showClientDropdown)}
          >
            <span className={filterClient ? 'text-gray-900' : 'text-gray-400'}>
              {filterClient ? clients.find(c => c.id === filterClient)?.name || 'Entreprise' : 'Toutes entreprises'}
            </span>
            {filterClient && (
              <button 
                onClick={(e) => { e.stopPropagation(); setFilterClient(''); setClientSearch('') }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {showClientDropdown && (
            <div className="absolute z-30 top-full mt-1 w-full bg-white border rounded-ui-sm shadow-md max-h-60 overflow-hidden">
              <div className="p-2 border-b">
                <input
                  type="text"
                  placeholder="Rechercher entreprise..."
                  className="input w-full text-ui"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="overflow-y-auto max-h-48">
                <button
                  className="w-full text-left px-3 py-2 text-ui hover:bg-gray-50 text-gray-500"
                  onClick={() => { setFilterClient(''); setClientSearch(''); setShowClientDropdown(false) }}
                >
                  Toutes entreprises
                </button>
                {filteredClients.map(c => (
                  <button
                    key={c.id}
                    className={`w-full text-left px-3 py-2 text-ui hover:bg-primary-50 ${filterClient === c.id ? 'bg-primary-50 text-primary-700 font-medium' : ''}`}
                    onClick={() => { setFilterClient(c.id); setClientSearch(''); setShowClientDropdown(false) }}
                  >
                    {c.name}
                  </button>
                ))}
                {filteredClients.length === 0 && (
                  <p className="px-3 py-2 text-ui text-gray-400">Aucun résultat</p>
                )}
              </div>
            </div>
          )}
        </div>
        <select className="input w-40" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="name">Tri par nom</option>
          <option value="client">Tri par entreprise</option>
          <option value="created">Tri par date création</option>
        </select>
      </div>
      
      {/* Barre d'actions en masse */}
      {selectedIds.size > 0 && (
        <div className="bg-primary-50 border border-primary-200 rounded-ui-sm p-3 flex items-center justify-between">
          <span className="text-ui font-medium text-primary-700">
            <CheckSquare className="w-4 h-4 inline mr-1" />
            {selectedIds.size} stagiaire(s) sélectionné(s)
          </span>
          <div className="flex gap-2">
            <button onClick={() => setShowBulkActions(true)} className="btn btn-primary text-ui py-1.5">
              Modifier en masse
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="btn btn-secondary text-ui py-1.5">
              Désélectionner
            </button>
          </div>
        </div>
      )}
      
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead className="bg-gray-50">
            <tr>
              <th className="w-10 py-3 px-2">
                <input 
                  type="checkbox" 
                  checked={filtered.length > 0 && selectedIds.size === filtered.length}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 text-primary-500 rounded"
                />
              </th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Prénom NOM</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600 hidden sm:table-cell">Email</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600 hidden md:table-cell">Téléphone</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">Entreprise</th>
              <th className="text-right py-3 px-4 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map(t => (
              <tr key={t.id} className={`hover:bg-gray-50 ${selectedIds.has(t.id) ? 'bg-primary-50' : ''}`}>
                <td className="py-3 px-2">
                  <input 
                    type="checkbox"
                    checked={selectedIds.has(t.id)}
                    onChange={() => toggleSelect(t.id)}
                    className="w-4 h-4 text-primary-500 rounded"
                  />
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <button onClick={() => openPreview(t)} className="font-medium text-primary hover:underline">
                      {t.first_name} {t.last_name?.toUpperCase()}
                    </button>
                    {t.has_disability && (
                      <span className="px-1.5 py-0.5 bg-gray-100 text-gray-800 text-ui-sm rounded" title="Situation de handicap"></span>
                    )}
                  </div>
                </td>
                <td className="py-3 px-4 text-gray-600 hidden sm:table-cell">{t.email || '-'}</td>
                <td className="py-3 px-4 text-gray-600 hidden md:table-cell">{t.phone || '-'}</td>
                <td className="py-3 px-4 text-gray-600">{t.clients?.name || '-'}</td>
                <td className="py-3 px-4 text-right">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => openPreview(t)} className="p-2 hover:bg-gray-100 rounded" title="Aperçu"><Eye className="w-4 h-4 text-[rgb(var(--c-info))]" /></button>
                    <button onClick={() => openDocs(t)} className="p-2 hover:bg-gray-100 rounded" title="Documents"><FileText className="w-4 h-4 text-gray-500" /></button>
                    <button onClick={() => openForm(t)} className="p-2 hover:bg-gray-100 rounded" title="Modifier"><Edit className="w-4 h-4 text-gray-500" /></button>
                    <button onClick={() => setConfirmDelete(t.id)} className="p-2 hover:bg-gray-100 rounded" title="Supprimer"><Trash2 className="w-4 h-4 text-[rgb(var(--c-danger))]" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-gray-500">Aucun stagiaire</td></tr>}
          </tbody>
        </table>
        </div>
      </div>
      
      {/* Modal Aperçu */}
      {showPreview && selectedTrainee && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowPreview(false)} />
          <div className="relative min-h-full flex items-center justify-center p-4">
            <div className="relative bg-white rounded-ui shadow-md w-full max-w-md">
              <div className="flex items-center justify-between p-4 border-b">
                <h2 className="text-lg font-semibold">Fiche stagiaire</h2>
                <button onClick={() => setShowPreview(false)}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 space-y-3">
                <div className="text-center pb-3 border-b">
                  <h3 className="text-xl font-bold">{selectedTrainee.first_name} {selectedTrainee.last_name?.toUpperCase()}</h3>
                  {selectedTrainee.clients?.name && (
                    <p className="text-gray-500 flex items-center justify-center gap-1 mt-1">
                      <Building2 className="w-4 h-4" />{selectedTrainee.clients.name}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 text-ui">
                  <div>
                    <p className="text-gray-500">Email</p>
                    <p className="font-medium">{selectedTrainee.email || '-'}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Téléphone</p>
                    <p className="font-medium">{selectedTrainee.phone || '-'}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Date de naissance</p>
                    <p className="font-medium">
                      {selectedTrainee.birth_date 
                        ? format(new Date(selectedTrainee.birth_date), 'dd/MM/yyyy')
                        : '-'}
                    </p>
                  </div>
                </div>
                {passeportOn ? (passeportEdit ? <PasseportTraineeBlock trainee={selectedTrainee} onChange={fetchTrainees} /> : null) : (
                <div className="bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] rounded-ui-sm p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-ui-sm text-[rgb(var(--c-warning))] font-medium mb-1">N° Sécurité Sociale (Passeport Prévention)</p>
                    <span className="text-ui-sm text-[rgb(var(--c-success))] flex items-center gap-1"> Chiffré</span>
                  </div>
                  {selectedTrainee.refused_ssn ? (
                    <p className="text-ui text-[rgb(var(--c-danger))] font-medium">A refusé de communiquer son numéro</p>
                  ) : loadingSSN ? (
                    <p className="font-mono text-lg text-[rgb(var(--c-warning))]">Déchiffrement...</p>
                  ) : (
                    <p className="font-mono text-lg font-bold text-[rgb(var(--c-warning))]">{decryptedSSN || selectedTrainee.social_security_number || 'Non renseigné'}</p>
                  )}
                </div>
                )}
                {selectedTrainee.notes && (
                  <div>
                    <p className="text-gray-500 text-ui">Notes</p>
                    <p className="text-ui">{selectedTrainee.notes}</p>
                  </div>
                )}
                
                {/* Handicap */}
                {selectedTrainee.has_disability && (
                  <div className="col-span-2 mt-2 p-3 bg-gray-50 border border-gray-200 rounded-ui-sm">
                    <p className="text-gray-800 font-medium text-ui mb-2"> Situation de handicap</p>
                    {selectedTrainee.disability_details && (
                      <div className="mb-2">
                        <p className="text-gray-500 text-ui-sm">Besoins identifiés :</p>
                        <p className="text-ui">{selectedTrainee.disability_details}</p>
                      </div>
                    )}
                    {selectedTrainee.disability_adaptations && (
                      <div>
                        <p className="text-gray-500 text-ui-sm">Adaptations :</p>
                        <p className="text-ui">{selectedTrainee.disability_adaptations}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex justify-between gap-2 p-4 border-t">
                <button 
                  onClick={() => handleExportData(selectedTrainee)} 
                  className="btn btn-secondary text-ui flex items-center gap-1"
                  title="Export RGPD - Droit d'accès"
                >
                  <Download className="w-4 h-4" />
                  Export RGPD
                </button>
                <button onClick={() => { setShowPreview(false); openForm(selectedTrainee) }} className="btn btn-primary">
                  <Edit className="w-4 h-4 mr-2" />Modifier
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Modal Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowForm(false)} />
          <div className="relative min-h-full flex items-center justify-center p-4">
            <div className="relative bg-white rounded-ui shadow-md w-full max-w-lg">
              <div className="flex items-center justify-between p-4 border-b">
                <h2 className="text-lg font-semibold">{selectedTrainee ? 'Modifier' : 'Nouveau'} stagiaire</h2>
                <button onClick={() => setShowForm(false)}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Prénom *</label>
                    <input type="text" className="input" value={form.first_name} onChange={(e) => handleNameChange('first_name', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">NOM *</label>
                    <input type="text" className="input uppercase" value={form.last_name} onChange={(e) => handleNameChange('last_name', e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Date de naissance</label>
                    <input type="date" className="input" value={form.birth_date} onChange={(e) => setForm({...form, birth_date: e.target.value})} />
                  </div>
                  <div>
                    <label className="label">Genre *</label>
                    <select className="input" value={form.gender} onChange={(e) => setForm({...form, gender: e.target.value})}>
                      <option value="">-- Choisir --</option>
                      <option value="male">Homme</option>
                      <option value="female">Femme</option>
                      <option value="non_binary">Non genré</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Téléphone</label>
                    <input type="tel" className="input" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} />
                  </div>
                  <div>
                    <label className="label">Email</label>
                    <input type="email" className="input" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} />
                  </div>
                </div>
                {passeportOn ? (
                  <p className="text-ui text-gray-600">Nom de naissance et numéro de sécurité sociale : bloc « Passeport de prévention » de la fiche (aperçu du stagiaire).</p>
                ) : (
                <div>
                  <label className="label">N° Sécurité Sociale</label>
                  <input 
                    type="text" 
                    className="input font-mono" 
                    placeholder="X XX XX XX XXX XXX XX" 
                    value={form.social_security_number} 
                    onChange={(e) => setForm({...form, social_security_number: e.target.value})}
                    disabled={form.refused_ssn}
                  />
                  <label className="flex items-center gap-2 mt-2 text-ui text-gray-600">
                    <input 
                      type="checkbox" 
                      checked={form.refused_ssn} 
                      onChange={(e) => setForm({...form, refused_ssn: e.target.checked, social_security_number: e.target.checked ? '' : form.social_security_number})}
                    />
                    A refusé de communiquer son numéro
                  </label>
                </div>
                )}
                <div>
                  <label className="label">Entreprise</label>
                  <SearchSelect value={form.client_id} onChange={(v) => setForm({...form, client_id: v})}
                    options={clientOptions(clients)} emptyLabel="Sélectionner..." searchPlaceholder="Rechercher une entreprise..." aria-label="Entreprise" />
                </div>
                <div>
                  <label className="label">Notes</label>
                  <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} />
                </div>
                
                {/* Section Situation professionnelle */}
                <div className="col-span-2 border-t pt-4 mt-2">
                  <h4 className="font-medium text-gray-700 mb-3">Situation professionnelle</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Catégorie socio-professionnelle (CSP)</label>
                      <select className="input" value={form.csp} onChange={(e) => setForm({...form, csp: e.target.value})}>
                        <option value="">Sélectionner...</option>
                        <option value="Agriculteurs exploitants">Agriculteurs exploitants</option>
                        <option value="Artisans, commerçants, chefs d'entreprise">Artisans, commerçants, chefs d'entreprise</option>
                        <option value="Cadres et professions intellectuelles supérieures">Cadres et professions intellectuelles supérieures</option>
                        <option value="Professions intermédiaires">Professions intermédiaires</option>
                        <option value="Employés">Employés</option>
                        <option value="Ouvriers">Ouvriers</option>
                        <option value="Retraités">Retraités</option>
                        <option value="Autres sans activité professionnelle">Autres sans activité professionnelle</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Poste / Fonction</label>
                      <input 
                        type="text" 
                        className="input" 
                        value={form.job_title} 
                        onChange={(e) => setForm({...form, job_title: e.target.value})}
                        placeholder="Ex: Technicien, Manager..."
                      />
                    </div>
                  </div>
                </div>
                
                {/* Section Handicap */}
                <div className="col-span-2 border-t pt-4 mt-2">
                  <div className="flex items-center gap-3 mb-3">
                    <input 
                      type="checkbox" 
                      id="has_disability"
                      checked={form.has_disability} 
                      onChange={(e) => setForm({...form, has_disability: e.target.checked})}
                      className="w-4 h-4 text-accent-500 rounded"
                    />
                    <label htmlFor="has_disability" className="font-medium text-gray-700">
                      Situation de handicap déclarée
                    </label>
                  </div>
                  
                  {form.has_disability && (
                    <div className="space-y-3 pl-7 border-l-2 border-accent-200">
                      <div>
                        <label className="label">Nature du handicap / besoins spécifiques</label>
                        <textarea 
                          className="input" 
                          rows={2} 
                          value={form.disability_details} 
                          onChange={(e) => setForm({...form, disability_details: e.target.value})}
                          placeholder="Décrivez la situation et les besoins identifiés..."
                        />
                      </div>
                      <div>
                        <label className="label">Adaptations mises en place</label>
                        <textarea 
                          className="input" 
                          rows={2} 
                          value={form.disability_adaptations} 
                          onChange={(e) => setForm({...form, disability_adaptations: e.target.value})}
                          placeholder="Adaptations pédagogiques, matérielles, organisationnelles..."
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2 p-4 border-t">
                <button onClick={() => setShowForm(false)} className="btn btn-secondary">Annuler</button>
                <button onClick={handleSave} className="btn btn-primary"><Save className="w-4 h-4 mr-2" />Enregistrer</button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Modal Documents */}
      {showDocs && selectedTrainee && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowDocs(false)} />
          <div className="relative min-h-full flex items-center justify-center p-4">
            <div className="relative bg-white rounded-ui shadow-md w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between p-4 border-b">
                <h2 className="text-lg font-semibold">Documents - {selectedTrainee.first_name} {selectedTrainee.last_name}</h2>
                <button onClick={() => setShowDocs(false)}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 border-b">
                <label className="btn btn-primary w-full flex items-center justify-center gap-2 cursor-pointer">
                  <Upload className="w-4 h-4" />{uploading ? 'Upload...' : 'Ajouter un document'}
                  <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading} />
                </label>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {traineeDocuments.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">Aucun document</p>
                ) : (
                  <div className="space-y-2">
                    {traineeDocuments.map(doc => (
                      <div key={doc.id} className="flex items-center justify-between p-3 border rounded-ui-sm">
                        <div>
                          <p className="font-medium">{doc.name}</p>
                          <p className="text-ui text-gray-500">{format(new Date(doc.created_at), 'dd/MM/yyyy HH:mm')}</p>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => viewDoc(doc)} className="p-2 hover:bg-gray-100 rounded"><Eye className="w-4 h-4" /></button>
                          <button onClick={() => handleDeleteDoc(doc)} className="p-2 hover:bg-gray-100 rounded text-[rgb(var(--c-danger))]"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Modal Confirmation suppression */}
      <ConfirmModal 
        show={!!confirmDelete}
        message="Êtes-vous sûr de vouloir supprimer ce stagiaire ?"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />
      
      {/* Modal Avertissement Doublons */}
      {duplicateWarning && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setDuplicateWarning(null)} />
          <div className="relative bg-white rounded-ui shadow-md p-6 max-w-md mx-4">
            <h3 className="text-lg font-semibold text-[rgb(var(--c-warning))] mb-3 flex items-center gap-2">
               Doublons détectés
            </h3>
            <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
              {duplicateWarning.duplicates.map((d, i) => (
                <div key={i} className="p-2 bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] rounded text-ui">
                  {d.type === 'internal' ? (
                    <p>{d.reason}</p>
                  ) : d.type === 'existing' ? (
                    <p>{d.reason}</p>
                  ) : (
                    <p>"{d.trainee?.first_name} {d.trainee?.last_name}" existe déjà</p>
                  )}
                </div>
              ))}
            </div>
            <p className="text-ui text-gray-600 mb-4">
              Voulez-vous quand même créer {duplicateWarning.type === 'single' ? 'ce stagiaire' : 'ces stagiaires'} ?
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDuplicateWarning(null)} className="btn btn-secondary">Annuler</button>
              <button onClick={duplicateWarning.onConfirm} className="btn bg-[rgb(var(--c-warning))] text-white hover:bg-[rgb(var(--c-warning))]">
                Créer quand même
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Modal Ajout Multiple */}
      {showBulkAdd && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={closeBulkModal} />
          <div className="relative min-h-full flex items-center justify-center p-4">
            <div className="relative bg-white rounded-ui shadow-md w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between p-4 border-b">
                <h2 className="text-lg font-semibold">Ajouter plusieurs stagiaires</h2>
                <button onClick={closeBulkModal}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 overflow-y-auto flex-1">
                <div className="mb-4">
                  <label className="label">Entreprise (pour tous)</label>
                  <SearchSelect
                    className="w-64"
                    value={bulkClientId}
                    onChange={(v) => setBulkClientId(v)}
                    options={clientOptions(clients)} emptyLabel="Sélectionner..." searchPlaceholder="Rechercher une entreprise..." aria-label="Entreprise" />
                </div>
                
                <div className="space-y-2">
                  <div className="grid grid-cols-12 gap-2 text-ui font-medium text-gray-600 px-1">
                    <div className="col-span-2">Prénom *</div>
                    <div className="col-span-2">NOM *</div>
                    <div className="col-span-3">Email</div>
                    <div className="col-span-2">Téléphone</div>
                    <div className="col-span-2">N° SS</div>
                    <div className="col-span-1"></div>
                  </div>
                  
                  {bulkTrainees.map((trainee, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2 items-center">
                      <input 
                        type="text" 
                        className="input col-span-2" 
                        placeholder="Prénom"
                        value={trainee.first_name}
                        onChange={(e) => updateBulkRow(index, 'first_name', e.target.value)}
                      />
                      <input 
                        type="text" 
                        className="input col-span-2 uppercase" 
                        placeholder="NOM"
                        value={trainee.last_name}
                        onChange={(e) => updateBulkRow(index, 'last_name', e.target.value)}
                      />
                      <input 
                        type="email" 
                        className="input col-span-3" 
                        placeholder="email@exemple.com"
                        value={trainee.email}
                        onChange={(e) => updateBulkRow(index, 'email', e.target.value)}
                      />
                      <input 
                        type="tel" 
                        className="input col-span-2" 
                        placeholder="06 XX XX XX XX"
                        value={trainee.phone}
                        onChange={(e) => updateBulkRow(index, 'phone', e.target.value)}
                      />
                      <input 
                        type="text" 
                        className="input col-span-2 font-mono text-ui-sm" 
                        placeholder={passeportOn ? 'N° Sécu : fiche' : 'N° Sécu'}
                        disabled={passeportOn}
                        value={passeportOn ? '' : (trainee.social_security_number || '')}
                        onChange={(e) => updateBulkRow(index, 'social_security_number', e.target.value)}
                      />
                      <button 
                        onClick={() => removeBulkRow(index)} 
                        className="col-span-1 p-2 text-[rgb(var(--c-danger))] hover:text-[rgb(var(--c-danger))] disabled:opacity-30"
                        disabled={bulkTrainees.length === 1}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
                
                <button onClick={addBulkRow} className="mt-4 text-primary-600 hover:text-primary-700 flex items-center gap-1 text-ui">
                  <Plus className="w-4 h-4" /> Ajouter une ligne
                </button>
              </div>
              <div className="flex justify-between items-center gap-2 p-4 border-t">
                <p className="text-ui text-gray-500">
                  {bulkTrainees.filter(t => t.first_name && t.last_name).length} stagiaire(s) à créer
                </p>
                <div className="flex gap-2">
                  <button onClick={closeBulkModal} className="btn btn-secondary">Annuler</button>
                  <button onClick={handleBulkSave} className="btn btn-primary">
                    <Save className="w-4 h-4 mr-2" />Créer tous
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Modal Actions en masse */}
      {showBulkActions && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowBulkActions(false)} />
          <div className="relative min-h-full flex items-center justify-center p-4">
            <div className="relative bg-white rounded-ui shadow-md w-full max-w-md">
              <div className="flex items-center justify-between p-4 border-b">
                <h2 className="text-lg font-semibold">Modifier {selectedIds.size} stagiaire(s)</h2>
                <button onClick={() => setShowBulkActions(false)}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 space-y-4">
                <p className="text-ui text-gray-500">Laissez vide les champs que vous ne souhaitez pas modifier.</p>
                
                <div>
                  <label className="label">Genre</label>
                  <select className="input w-full" value={bulkGender} onChange={(e) => setBulkGender(e.target.value)}>
                    <option value="">- Ne pas modifier -</option>
                    <option value="male">Homme</option>
                    <option value="female">Femme</option>
                    <option value="non_binary">Non genré</option>
                  </select>
                </div>
                
                <div>
                  <label className="label">CSP</label>
                  <select className="input w-full" value={bulkCsp} onChange={(e) => setBulkCsp(e.target.value)}>
                    <option value="">- Ne pas modifier -</option>
                    <option value="Agriculteurs exploitants">Agriculteurs exploitants</option>
                    <option value="Artisans, commerçants, chefs d'entreprise">Artisans, commerçants, chefs d'entreprise</option>
                    <option value="Cadres et professions intellectuelles supérieures">Cadres et professions intellectuelles supérieures</option>
                    <option value="Professions intermédiaires">Professions intermédiaires</option>
                    <option value="Employés">Employés</option>
                    <option value="Ouvriers">Ouvriers</option>
                    <option value="Retraités">Retraités</option>
                    <option value="Autres sans activité professionnelle">Autres sans activité professionnelle</option>
                  </select>
                </div>
                
                <div>
                  <label className="label">Entreprise</label>
                  <SearchSelect value={massClientId} onChange={(v) => setMassClientId(v)}
                    options={clientOptions(clients)} emptyLabel="- Ne pas modifier -" searchPlaceholder="Rechercher une entreprise..." aria-label="Entreprise" />
                </div>
              </div>
              <div className="flex justify-end gap-2 p-4 border-t">
                <button onClick={() => setShowBulkActions(false)} className="btn btn-secondary">Annuler</button>
                <button onClick={handleBulkUpdate} disabled={bulkSaving} className="btn btn-primary flex items-center gap-2">
                  {bulkSaving ? 'Mise à jour...' : `Appliquer à ${selectedIds.size} stagiaire(s)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
