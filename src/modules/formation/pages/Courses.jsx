import { useEffect, useState, useRef } from 'react'
import { useDataStore, useAuthStore } from '../../../core/store'
import { supabase } from '../../../core/supabase'
import { Plus, Search, Edit, Trash2, X, Save, Clock, Users, Euro, Copy, Upload, FileSpreadsheet, Package, ChevronDown, ChevronRight, ClipboardList, GraduationCap, FileText, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import TestsPositionnement from './TestsPositionnement'
import CourseDocumentsList from '../components/CourseDocumentsList'
import CourseSequencesModal from '../../suivi/components/CourseSequencesModal'
import { countSequencesByCourse, canEditCatalog } from '../../suivi/lib/sfData'
import { useDroits } from '../../../core/rights/useDroit'

import { confirmer } from '../../../ui/Confirm'
import { programmeModifie, versionSuivante, effectifTexte, DELAI_ACCES_DEFAUT, TARIF_DEFAUT } from '../pdf/programmePDF'
import { downloadDocument, downloadCatalogue, setOrganization } from '../pdf/pdfGenerator'
import { PICTOGRAMMES } from '../pdf/pictogrammes'
import { fichierDeLInstance } from '../../../core/fichiersInstance'
import { currentUserName } from '../../../core/org/currentOrg'
import { ouvrirFichier, readableUrl } from '../../../core/storageUtils'

// Champs du programme (fiche formation, migration 0048)
const PROGRAMME_VIDE = {
  evaluation_methods: '', min_participants: '', max_participants: '', access_delay: '', validity_kind: 'recyclage',
  validity_text: '', deliverables: '', trainer_profile: '', price_mention: '', modalities: '', program_ref: '', motif_maj: '',
  pictogram: '',
}
// Thèmes du matériel
const EQUIPMENT_THEMES = {
  SECOURISME: { label: 'Secourisme', color: 'green' },
  INCENDIE: { label: 'Incendie', color: 'red' },
  ELECTRIQUE: { label: 'Électrique', color: 'yellow' },
  HAUTEUR: { label: 'Travail en hauteur', color: 'purple' },
  MANUTENTION: { label: 'Manutention', color: 'blue' },
  GENERAL: { label: 'Général', color: 'gray' },
}

// Couleurs des thèmes selon leur nom
const getThemeColor = (themeName) => {
  if (!themeName) return '#6b7280' // Gris par défaut
  const name = themeName.toLowerCase()
  
  if (name.includes('secourisme') || name.includes('sst') || name.includes('psc')) {
    return '#22c55e' // Vert
  }
  if (name.includes('incendie') || name.includes('epi') || name.includes('évacuation')) {
    return '#ef4444' // Rouge
  }
  if (name.includes('électri') || name.includes('habilitation') || name.includes('hab')) {
    return '#eab308' // Jaune
  }
  if (name.includes('r489') || name.includes('r485') || name.includes('chariot') || name.includes('nacelle')) {
    return '#1f2937' // Noir
  }
  if (name.includes('ergonomie') || name.includes('gestes') || name.includes('postures') || name.includes('prap')) {
    return '#3b82f6' // Bleu
  }
  if (name.includes('prévention') || name.includes('prevention')) {
    return '#f97316' // Orange
  }
  
  return '#6b7280' // Gris par défaut
}

// Parser CSV Sellsy pour les formations
const parseSellsyFormationsCSV = (csvText) => {
  const lines = csvText.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  
  // Ignorer la première ligne si c'est le nom du fichier
  const startLine = lines[0].includes('ID Produit') ? 0 : 1
  const headers = lines[startLine].split(';').map(h => h.replace(/"/g, '').trim())
  
  // Trouver les index des colonnes
  const getIdx = (patterns) => headers.findIndex(h => patterns.some(p => h.toLowerCase().includes(p.toLowerCase())))
  const idx = {
    reference: getIdx(['référence', 'reference']),
    name: getIdx(['nom commercial', 'nom']),
    description: getIdx(['description']),
    priceHT: getIdx(['prix référence ht', 'prix ht', 'tarif ht']),
    tags: getIdx(['smart-tags', 'tags', 'catégorie']),
  }
  
  const formations = []
  for (let i = startLine + 1; i < lines.length; i++) {
    const values = lines[i].split(';').map(v => v.replace(/"/g, '').trim())
    if (values.length < 5) continue
    
    const name = values[idx.name] || ''
    const description = values[idx.description] || ''
    const reference = values[idx.reference] || ''
    
    // Extraire la durée depuis la description (ex: "7 heures", "14 heures", "3,5 heures")
    let duration = 7 // défaut
    const durationMatch = description.match(/(\d+(?:,\d+)?)\s*heures?/i)
    if (durationMatch) {
      duration = parseFloat(durationMatch[1].replace(',', '.'))
    }
    
    // Parser le prix (ex: "785,00" -> 785)
    let price = 0
    const priceStr = values[idx.priceHT] || ''
    if (priceStr) {
      price = parseFloat(priceStr.replace(/\s/g, '').replace(',', '.')) || 0
    }
    
    // Tags/catégorie
    const tags = values[idx.tags] || ''
    
    if (name) {
      formations.push({
        reference,
        title: name,
        description,
        duration_hours: duration,
        price_ht: price,
        category: tags,
      })
    }
  }
  
  return formations
}

export default function Courses() {
  const { 
    courses, fetchCourses, createCourse, updateCourse, deleteCourse, duplicateCourse,
    themes, fetchThemes, organization, fetchOrganization
  } = useDataStore()
  useEffect(() => { if (!organization) fetchOrganization?.() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Suivi formatif (module optionnel) : séquences par formation
  const { modules: enabledModules, userRole } = useAuthStore()
  const suiviFormatifOn = (enabledModules || []).includes('suivi_formatif')
  const d = useDroits({ gerer: 'formation.catalogue.gerer' })
  const [sequencesCourse, setSequencesCourse] = useState(null)
  const [sequenceCounts, setSequenceCounts] = useState({})
  const reloadSequenceCounts = () => { countSequencesByCourse().then(setSequenceCounts).catch(() => setSequenceCounts({})) }
  useEffect(() => { if (suiviFormatifOn) reloadSequenceCounts() }, [suiviFormatifOn])
  
  const [search, setSearch] = useState('')
  const [themeFilter, setThemeFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [selectedCourse, setSelectedCourse] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importPreview, setImportPreview] = useState(null)
  const [activeTab, setActiveTab] = useState('formations')
  const fileInputRef = useRef(null)
  const programInputRef = useRef(null)
  const [form, setForm] = useState({
    code: '', title: '', description: '', duration: '', objectives: '', content: '',
    prerequisites: '', target_audience: '', methods: '', price_per_day: '', price_ht: '', 
    material: '', trainer_equipment: '', theme_id: '', program_url: '', ...PROGRAMME_VIDE
  })
  const [uploadingProgram, setUploadingProgram] = useState(false)
  
  // Equipment state
  const [equipmentCatalog, setEquipmentCatalog] = useState([])
  const [selectedEquipment, setSelectedEquipment] = useState([])
  const [expandedThemes, setExpandedThemes] = useState({})
  const [showAddEquipment, setShowAddEquipment] = useState(false)
  const [newEquipment, setNewEquipment] = useState({ name: '', theme: 'GENERAL', ratio_per_persons: null })
  
  useEffect(() => { 
    fetchCourses() 
    fetchThemes()
    loadEquipmentCatalog()
  }, [])
  
  const loadEquipmentCatalog = async () => {
    const { data } = await supabase
      .from('equipment_catalog')
      .select('*')
      .order('theme')
      .order('name')
    setEquipmentCatalog(data || [])
  }
  
  const loadCourseEquipment = async (courseId) => {
    const { data } = await supabase
      .from('course_equipment')
      .select('equipment_id')
      .eq('course_id', courseId)
    setSelectedEquipment(data?.map(e => e.equipment_id) || [])
  }
  
  const filtered = courses.filter(c => {
    const searchFields = `${c.title || ''} ${c.description || ''} ${c.reference || ''} ${c.code || ''} ${c.objectives || ''}`.toLowerCase()
    const matchSearch = !search || searchFields.includes(search.toLowerCase())
    const matchTheme = !themeFilter || c.theme_id === themeFilter
    return matchSearch && matchTheme
  })
  
  const getTheme = (themeId) => themes.find(t => t.id === themeId)
  
  // Import Sellsy
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = event.target?.result
        const parsed = parseSellsyFormationsCSV(text)
        if (parsed.length === 0) {
          toast.error('Aucune formation trouvée dans le fichier')
          return
        }
        setImportPreview(parsed)
      } catch (error) {
        console.error('Parse error:', error)
        toast.error('Erreur lors de la lecture du fichier')
      }
    }
    reader.readAsText(file, 'UTF-8')
    e.target.value = ''
  }
  
  const executeImport = async () => {
    if (!importPreview || importPreview.length === 0) return
    setImporting(true)
    
    let created = 0
    let skipped = 0
    
    for (const formation of importPreview) {
      // Vérifier si la formation existe déjà (par titre)
      const existing = courses.find(c => 
        c.title?.toLowerCase() === formation.title?.toLowerCase()
      )
      
      if (existing) {
        skipped++
        continue
      }
      
      // Créer la formation
      const { error } = await createCourse({
        title: formation.title,
        description: formation.description,
        duration_hours: formation.duration_hours,
        price_ht: formation.price_ht,
        objectives: '',
        program: '',
        prerequisites: '',
        target_audience: '',
        methods: 'Apports théoriques et pratiques, mises en situation, études de cas',
        material: '',
      })
      
      if (!error) created++
    }
    
    await fetchCourses()
    setImporting(false)
    setImportPreview(null)
    toast.success(`Import terminé : ${created} formation(s) créée(s), ${skipped} ignorée(s) (déjà existantes)`)
  }
  
  const handleProgramUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    if (!file.type.includes('pdf')) {
      toast.error('Seuls les fichiers PDF sont acceptés')
      return
    }
    
    setUploadingProgram(true)
    
    const fileExt = file.name.split('.').pop()
    const fileName = `programme_${Date.now()}.${fileExt}`
    const filePath = `programmes/${fileName}`
    
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(filePath, file)
    
    if (uploadError) {
      console.error(uploadError)
      toast.error('Erreur lors de l\'upload')
      setUploadingProgram(false)
      return
    }
    
    const { data: { publicUrl } } = supabase.storage
      .from('documents')
      .getPublicUrl(filePath)
    
    setForm({ ...form, program_url: publicUrl })
    setUploadingProgram(false)
    toast.success('Programme uploadé')
    
    if (programInputRef.current) {
      programInputRef.current.value = ''
    }
  }
  
  const handleRemoveProgram = () => {
    setForm({ ...form, program_url: '' })
  }
  
  // Auto-génération de code formation basé sur le titre
  const suggestCode = (title) => {
    if (!title) return ''
    const t = title.toLowerCase()
    
    // SST
    if (t.includes('mac') && t.includes('sst')) return 'SST-MAC'
    if (t.includes('sst') && (t.includes('initiale') || t.includes('formation initiale'))) return 'SST-FI'
    if (t.includes('premiers secours') && t.includes('initiation')) return 'IGPS'
    if (t.includes('initiation') && t.includes('gestes')) return 'IGPS'
    if (t.includes('premiers secours')) return 'SST-GPS'
    if (t.includes('sst')) return 'SST'
    
    // Incendie
    if (t.includes('extincteur')) return 'INC-EXT'
    if (t.includes('epi') || t.includes('equipier') || t.includes('première intervention')) return 'INC-EPI'
    if (t.includes('evacuation') || t.includes('évacuation')) return 'INC-EVA'
    if (t.includes('incendie')) return 'INC'
    
    // Électrique - habilitations
    if (t.includes('b0') && t.includes('h0v')) return 'B0H0V'
    if (t.includes('b0') && t.includes('h0')) return 'B0H0'
    if (t.includes('bs') && t.includes('habilitation')) return 'BS'
    if (t.includes('br') && t.includes('habilitation')) return 'BR'
    if (t.includes('habilitation') || t.includes('électrique')) return 'ELE'
    
    // Manutention / Chariots
    if (t.includes('r489')) return 'R489'
    if (t.includes('r485')) return 'R485'
    if (t.includes('r486')) return 'R486'
    if (t.includes('r482')) return 'R482'
    if (t.includes('chariot') || t.includes('caces')) return 'MAN'
    
    // Ergonomie
    if (t.includes('prap')) return 'ERG-PRAP'
    if (t.includes('gestes') && t.includes('postures')) return 'ERG-GP'
    if (t.includes('ergonomie')) return 'ERG'
    
    // Travail en hauteur
    if (t.includes('hauteur')) return 'HAU'
    if (t.includes('echafaudage') || t.includes('échafaudage')) return 'HAU-ECH'
    
    return ''
  }

  // Vérifier unicité du code et ajouter un suffixe si nécessaire
  const ensureUniqueCode = (code, currentId = null) => {
    if (!code) return code
    const existing = courses.filter(c => c.id !== currentId)
    const taken = existing.map(c => (c.code || '').toUpperCase())
    let candidate = code.toUpperCase()
    if (!taken.includes(candidate)) return candidate
    // Ajouter un suffixe numérique
    let n = 2
    while (taken.includes(candidate + n)) n++
    return candidate + n
  }

  const openForm = (course = null) => {
    if (course) {
      setForm({
        code: course.code || '',
        title: course.title || '',
        description: course.description || '',
        duration: course.duration_hours || course.duration || '',
        objectives: course.objectives || '',
        content: course.program || course.content || '',
        prerequisites: course.prerequisites || '',
        target_audience: course.target_audience || '',
        methods: course.methods || '',
        price_per_day: course.price_per_day || '',
        price_ht: course.price_ht || '',
        material: course.material || '',
        trainer_equipment: course.trainer_equipment || '',
        theme_id: course.theme_id || '',
        program_url: course.program_url || '',
        evaluation_methods: course.evaluation_methods || '',
        min_participants: course.min_participants ?? '',
        max_participants: course.max_participants ?? '',
        access_delay: course.access_delay || '',
        validity_kind: course.validity_kind || 'recyclage',
        validity_text: course.validity_text || '',
        deliverables: course.deliverables || '',
        trainer_profile: course.trainer_profile || '',
        price_mention: course.price_mention || '',
        modalities: course.modalities || '',
        program_ref: course.program_ref || '',
        motif_maj: '',
        pictogram: course.pictogram || '',
      })
      setSelectedCourse(course)
      loadCourseEquipment(course.id)
    } else {
      setForm({
        code: '', title: '', description: '', duration: '', objectives: '', content: '',
        prerequisites: '', target_audience: '', methods: '', price_per_day: '', price_ht: '', 
        material: '', trainer_equipment: '', theme_id: '', program_url: '', ...PROGRAMME_VIDE
      })
      setSelectedCourse(null)
      setSelectedEquipment([])
    }
    setExpandedThemes({})
    setShowForm(true)
  }
  
  // Programme généré d'une formation du catalogue
  const telechargerProgramme = async (course) => {
    if (organization) setOrganization(organization)
    try { await downloadDocument('programme', { courses: course }) } catch (e) { toast.error('Programme impossible : ' + e.message) }
  }
  // Catalogue complet : page de garde et un programme par page
  const telechargerCatalogue = async () => {
    if (organization) setOrganization(organization)
    try { await downloadCatalogue(courses || []) } catch (e) { toast.error('Catalogue impossible : ' + e.message) }
  }

  // Aperçu du programme avec les valeurs du formulaire (rien n'est enregistré)
  const apercuProgramme = async () => {
    if (organization) setOrganization(organization)
    const course = {
      ...(selectedCourse || {}),
      code: form.code, title: form.title, objectives: form.objectives, program: form.content,
      prerequisites: form.prerequisites, target_audience: form.target_audience, methods: form.methods,
      material: form.material, evaluation_methods: form.evaluation_methods,
      duration_hours: form.duration ? parseFloat(form.duration) : null,
      min_participants: form.min_participants || null, max_participants: form.max_participants || null,
      access_delay: form.access_delay, validity_kind: form.validity_kind, validity_text: form.validity_text,
      deliverables: form.deliverables, trainer_profile: form.trainer_profile, price_mention: form.price_mention,
      modalities: form.modalities, program_ref: form.program_ref, pictogram: form.pictogram || null,
    }
    try { await downloadDocument('programme', { courses: course }) } catch (e) { toast.error('Aperçu impossible : ' + e.message) }
  }

  const handleSave = async () => {
    if (!form.title) return toast.error('Titre requis')
    if (!form.duration) return toast.error('Durée requise')
    
    const data = {
      title: form.title,
      description: form.description || null,
      program: form.content || null,
      objectives: form.objectives || null,
      prerequisites: form.prerequisites || null,
      target_audience: form.target_audience || null,
      duration_hours: form.duration ? parseFloat(form.duration) : 7,
      price_per_day: form.price_per_day ? parseFloat(form.price_per_day) : null,
      price_ht: form.price_ht ? parseFloat(form.price_ht) : null,
      material: form.material || null,
      trainer_equipment: form.trainer_equipment || null,
      theme_id: form.theme_id || null,
      program_url: form.program_url || null,
      methods: form.methods || null,
      evaluation_methods: form.evaluation_methods || null,
      min_participants: form.min_participants === '' ? null : parseInt(form.min_participants, 10),
      max_participants: form.max_participants === '' ? null : parseInt(form.max_participants, 10),
      access_delay: form.access_delay || null,
      validity_kind: form.validity_text ? (form.validity_kind || 'recyclage') : null,
      validity_text: form.validity_text || null,
      deliverables: form.deliverables || null,
      trainer_profile: form.trainer_profile || null,
      price_mention: form.price_mention || null,
      modalities: form.modalities || null,
      program_ref: form.program_ref ? form.program_ref.toUpperCase() : null,
      pictogram: form.pictogram || null,
    }
    if (data.min_participants && data.max_participants && data.min_participants > data.max_participants) {
      return toast.error('Effectif : le minimum dépasse le maximum')
    }

    // Programme modifié : nouvelle version datée, avec son motif (preuve de mise à jour pour Qualiopi)
    const nouvelleVersion = programmeModifie(selectedCourse, data)
    if (nouvelleVersion && selectedCourse && !form.motif_maj?.trim()) {
      return toast.error('Programme modifié : indiquez le motif de la mise à jour (en bas de la fiche)')
    }
    if (nouvelleVersion) {
      data.program_version = versionSuivante(selectedCourse?.program_version)
      data.program_updated_on = new Date().toISOString().slice(0, 10)
    }
    
    // Code formation
    if (form.code) {
      data.code = form.code.toUpperCase()
    } else if (!selectedCourse) {
      // Auto-suggestion si pas de code et nouvelle formation
      const suggested = suggestCode(form.title)
      data.code = ensureUniqueCode(suggested || 'FORM')
    } else {
      data.code = null
    }
    
    try {
      let courseId = selectedCourse?.id
      
      if (selectedCourse) {
        const { error } = await updateCourse(selectedCourse.id, data)
        if (error) throw error
      } else {
        const { data: newCourse, error } = await createCourse(data)
        if (error) throw error
        courseId = newCourse?.id
      }
      
      // Version du programme : une ligne dans l'historique des versions (Qualité)
      if (courseId && nouvelleVersion) {
        const { error: vErr } = await supabase.from('programme_versions').insert({
          ref_doc: data.program_ref || `PROG-${data.code || selectedCourse?.code || 'FORM'}`,
          nom_programme: data.title,
          version: data.program_version,
          date_maj: data.program_updated_on,
          valide_par: currentUserName() || 'Organisme',
          raison_changement: form.motif_maj?.trim() || 'Création du programme',
          course_id: courseId,
        })
        if (vErr) toast.error('Version du programme non enregistrée : ' + vErr.message)
      }

      // Sauvegarder le matériel sélectionné
      if (courseId && selectedEquipment.length > 0) {
        await supabase.from('course_equipment').delete().eq('course_id', courseId)
        await supabase.from('course_equipment').insert(
          selectedEquipment.map(eqId => ({ course_id: courseId, equipment_id: eqId }))
        )
      } else if (courseId) {
        await supabase.from('course_equipment').delete().eq('course_id', courseId)
      }
      
      toast.success(selectedCourse ? 'Formation modifiée' : 'Formation créée')
      setShowForm(false)
      fetchCourses()
    } catch (error) {
      console.error('Erreur:', error)
      toast.error(error.message || 'Erreur lors de la sauvegarde')
    }
  }
  
  // Ajouter un équipement personnalisé
  const handleAddCustomEquipment = async () => {
    if (!newEquipment.name) return toast.error('Nom requis')
    
    const { data, error } = await supabase
      .from('equipment_catalog')
      .insert({
        name: newEquipment.name,
        theme: newEquipment.theme,
        ratio_per_persons: newEquipment.ratio_per_persons || null,
        is_custom: true
      })
      .select()
      .single()
    
    if (error) {
      toast.error('Erreur lors de l\'ajout')
      return
    }
    
    setEquipmentCatalog([...equipmentCatalog, data])
    setSelectedEquipment([...selectedEquipment, data.id])
    setNewEquipment({ name: '', theme: 'GENERAL', ratio_per_persons: null })
    setShowAddEquipment(false)
    toast.success('Équipement ajouté')
  }
  
  // Grouper les équipements par thème
  const equipmentByTheme = equipmentCatalog.reduce((acc, eq) => {
    if (!acc[eq.theme]) acc[eq.theme] = []
    acc[eq.theme].push(eq)
    return acc
  }, {})
  
  const handleDelete = async (id) => {
    if (!await confirmer('Supprimer cette formation ?')) return
    await deleteCourse(id)
    toast.success('Formation supprimée')
  }
  
  const handleDuplicate = async (id) => {
    const { error } = await duplicateCourse(id)
    if (error) {
      toast.error('Erreur lors de la duplication')
    } else {
      toast.success('Formation dupliquée')
      fetchCourses()
    }
  }
  
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Formations</h1>
          <p className="text-gray-500 mt-1">Catalogue et tests de positionnement</p>
        </div>
        {activeTab === 'formations' && (
          <div className="flex flex-wrap gap-2">
            <input 
              ref={fileInputRef}
              type="file" 
              accept=".csv" 
              onChange={handleFileSelect}
              className="hidden"
            />
            {d.gerer && (
            <button 
              onClick={() => fileInputRef.current?.click()} 
              className="btn btn-secondary flex items-center gap-2"
              title="Importer depuis Sellsy"
            >
              <Upload className="w-4 h-4" />Import Sellsy
            </button>
            )}
            <button onClick={telechargerCatalogue} className="btn btn-secondary flex items-center gap-2" title="Tous les programmes en un PDF, avec une page de garde">
              <FileText className="w-4 h-4" />Catalogue PDF
            </button>
            {d.gerer && (
            <button onClick={() => openForm()} className="btn btn-primary">
              <Plus className="w-4 h-4 mr-2" />
              Nouvelle formation
            </button>
            )}
          </div>
        )}
      </div>
      
      {/* Onglets */}
      <div className="border-b border-gray-200">
        <nav className="flex overflow-x-auto whitespace-nowrap gap-4">
          <button
            onClick={() => setActiveTab('formations')}
            className={`pb-3 px-1 border-b-2 font-medium text-ui transition-colors ${
              activeTab === 'formations' 
                ? 'border-primary-500 text-primary-600' 
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <GraduationCap className="w-4 h-4" />
              Catalogue
              <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-ui-sm">{courses.length}</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('tests')}
            className={`pb-3 px-1 border-b-2 font-medium text-ui transition-colors ${
              activeTab === 'tests' 
                ? 'border-primary-500 text-primary-600' 
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4" />
              Tests de positionnement
            </div>
          </button>
          <button
            onClick={() => setActiveTab('documents')}
            className={`pb-3 px-1 border-b-2 font-medium text-ui transition-colors ${
              activeTab === 'documents' 
                ? 'border-primary-500 text-primary-600' 
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Documents de formations
            </div>
          </button>
        </nav>
      </div>
      
      {/* Contenu onglet Tests */}
      {activeTab === 'tests' && (
        <TestsPositionnement />
      )}
      
      {/* Contenu onglet Documents */}
      {activeTab === 'documents' && (
        <CourseDocumentsList />
      )}
      
      {/* Contenu onglet Formations */}
      {activeTab === 'formations' && (
        <>
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
              value={themeFilter}
              onChange={(e) => setThemeFilter(e.target.value)}
              className="input w-full sm:w-48"
            >
              <option value="">Tous les thèmes</option>
              {themes.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
      
          {/* Liste */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.length === 0 ? (
              <div className="col-span-full card p-8 text-center text-gray-500">
                {search || themeFilter ? 'Aucun résultat' : 'Aucune formation - Créez-en une !'}
              </div>
            ) : (
              filtered.map(course => {
                const theme = getTheme(course.theme_id)
            return (
              <div key={course.id} className="card hover:shadow-md transition-shadow group">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      {theme && (
                        <span 
                          className="inline-block px-2 py-0.5 rounded text-ui-sm text-white font-medium"
                          style={{ backgroundColor: getThemeColor(theme.name) }}
                        >
                          {theme.name}
                        </span>
                      )}
                      {course.code && (
                        <span className="inline-block px-2 py-0.5 rounded text-ui-sm font-mono font-bold bg-gray-100 text-gray-700 border">
                          {course.code}
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold text-gray-900">{course.title}</h3>
                  </div>
                  <div className="flex gap-1 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    {d.gerer && (
                    <button onClick={() => handleDuplicate(course.id)} className="p-1.5 hover:bg-gray-100 rounded" title="Dupliquer">
                      <Copy className="w-4 h-4 text-gray-500" />
                    </button>
                    )}
                    {suiviFormatifOn && (
                      <button onClick={() => setSequencesCourse(course)} className="p-1.5 hover:bg-gray-100 rounded" title="Séquences et évaluation formative" aria-label="Séquences et évaluation formative">
                        <ClipboardList className="w-4 h-4 text-gray-500" />
                      </button>
                    )}
                    {d.gerer && (
                    <button onClick={() => openForm(course)} className="p-1.5 hover:bg-gray-100 rounded" title="Modifier">
                      <Edit className="w-4 h-4 text-gray-500" />
                    </button>
                    )}
                    {d.gerer && (
                    <button onClick={() => handleDelete(course.id)} className="p-1.5 hover:bg-[rgb(var(--c-danger-bg))] rounded" title="Supprimer">
                      <Trash2 className="w-4 h-4 text-[rgb(var(--c-danger))]" />
                    </button>
                    )}
                  </div>
                </div>
                
                {course.description && (
                  <p className="text-ui text-gray-600 mb-3 line-clamp-2">{course.description}</p>
                )}
                
                <div className="flex flex-wrap gap-3 text-ui text-gray-500">
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {course.duration_hours || course.duration || '?'}h
                  </span>
                  {suiviFormatifOn && sequenceCounts[course.id] > 0 && (
                    <button type="button" onClick={() => setSequencesCourse(course)} className="flex items-center gap-1 text-primary-600 hover:text-primary-700">
                      <ClipboardList className="w-4 h-4" />
                      {sequenceCounts[course.id]} séquence{sequenceCounts[course.id] > 1 ? 's' : ''}{course.formative_enabled ? '' : ' (suivi désactivé)'}
                    </button>
                  )}
                  {/* Prix masqué - conservé en base de données */}
                  <button
                    type="button"
                    onClick={() => telechargerProgramme(course)}
                    className="flex items-center gap-1 text-primary-600 hover:text-primary-700"
                    title="Télécharger le programme généré"
                  >
                    <FileText className="w-4 h-4" />
                    Programme{course.program_version ? ` v${course.program_version}` : ''}
                  </button>
                  {fichierDeLInstance(course.program_url) && (
                    <a
                      href={fichierDeLInstance(course.program_url)} onClick={(e) => { e.preventDefault(); ouvrirFichier(fichierDeLInstance(course.program_url)).catch((err) => toast.error(err.message)) }}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-gray-500 hover:text-gray-700"
                      title="Programme PDF déposé"
                    >
                      PDF déposé
                    </a>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
        </>
      )}
      
      {/* Séquences et évaluation formative (module Suivi formatif) */}
      {sequencesCourse && (
        <CourseSequencesModal
          course={sequencesCourse}
          canEdit={canEditCatalog(userRole)}
          onClose={() => setSequencesCourse(null)}
          onSaved={() => { reloadSequenceCounts(); fetchCourses() }}
        />
      )}

      {/* Modal formulaire */}
      {showForm && d.gerer && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-ui shadow-md w-full max-w-2xl my-8">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-xl font-semibold">
                {selectedCourse ? 'Modifier la formation' : 'Nouvelle formation'}
              </h2>
              <button onClick={() => setShowForm(false)} className="p-2 hover:bg-gray-100 rounded-ui-sm">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Thème */}
              <div>
                <label className="label">Thème de formation *</label>
                <select
                  className="input"
                  value={form.theme_id}
                  onChange={(e) => setForm({...form, theme_id: e.target.value})}
                >
                  <option value="">Sélectionner un thème...</option>
                  {themes.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              
              {/* Code + Titre */}
              <div className="grid grid-cols-4 gap-4">
                <div className="col-span-1">
                  <label className="label">Code</label>
                  <div className="flex gap-1">
                    <input 
                      type="text" 
                      className="input font-mono text-ui uppercase" 
                      placeholder="SST-FI" 
                      value={form.code} 
                      onChange={(e) => setForm({...form, code: e.target.value.toUpperCase()})} 
                    />
                  </div>
                  {!selectedCourse && !form.code && form.title && suggestCode(form.title) && (
                    <button
                      type="button"
                      onClick={() => setForm({...form, code: ensureUniqueCode(suggestCode(form.title))})}
                      className="text-ui-sm text-[rgb(var(--c-info))] hover:underline mt-1"
                    >
                      Suggestion : {suggestCode(form.title)}
                    </button>
                  )}
                </div>
                <div className="col-span-3">
                  <label className="label">Intitulé *</label>
                  <input type="text" className="input" value={form.title} onChange={(e) => {
                    const newTitle = e.target.value
                    const updates = { title: newTitle }
                    // Auto-suggest code si champ code vide et nouvelle formation
                    if (!selectedCourse && !form.code) {
                      const suggested = suggestCode(newTitle)
                      if (suggested) updates.code = ensureUniqueCode(suggested)
                    }
                    setForm({...form, ...updates})
                  }} />
                </div>
              </div>
              
              {/* Description */}
              <div>
                <label className="label">Description</label>
                <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} />
              </div>
              
              {/* Durée et Prix */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">Durée (heures) *</label>
                  <input type="number" className="input" value={form.duration} onChange={(e) => setForm({...form, duration: e.target.value})} />
                </div>
                <div>
                  <label className="label">Prix/jour (€)</label>
                  <input type="number" className="input" value={form.price_per_day} onChange={(e) => setForm({...form, price_per_day: e.target.value})} />
                </div>
                <div>
                  <label className="label">Prix total HT (€)</label>
                  <input type="number" className="input" value={form.price_ht} onChange={(e) => setForm({...form, price_ht: e.target.value})} />
                </div>
              </div>
              
              {/* Objectifs */}
              <div>
                <label className="label">Objectifs (un par ligne)</label>
                <textarea className="input" rows={3} value={form.objectives} onChange={(e) => setForm({...form, objectives: e.target.value})} placeholder="Objectif 1&#10;Objectif 2&#10;Objectif 3" />
              </div>
              
              {/* Contenu */}
              <div>
                <label className="label">Programme / Contenu</label>
                <textarea className="input" rows={4} value={form.content} onChange={(e) => setForm({...form, content: e.target.value})} />
              </div>
              
              {/* Public et Prérequis */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Public cible</label>
                  <input type="text" className="input" value={form.target_audience} onChange={(e) => setForm({...form, target_audience: e.target.value})} />
                </div>
                <div>
                  <label className="label">Prérequis</label>
                  <input type="text" className="input" value={form.prerequisites} onChange={(e) => setForm({...form, prerequisites: e.target.value})} />
                </div>
              </div>
              
              {/* Matériel stagiaires */}
              <div>
                <label className="label">Matériel requis (stagiaires)</label>
                <input type="text" className="input" placeholder="Ex: Tenue de sport, chaussures de sécurité..." value={form.material} onChange={(e) => setForm({...form, material: e.target.value})} />
              </div>
              
              {/* Matériel formateur - Sélection par checkboxes */}
              <div className="border rounded-ui-sm p-4 bg-gray-50">
                <div className="flex items-center justify-between mb-3">
                  <label className="label flex items-center gap-2 mb-0">
                    <Package className="w-4 h-4" />
                    Matériel requis (formateur)
                  </label>
                  <span className="text-ui text-gray-500">{selectedEquipment.length} sélectionné(s)</span>
                </div>
                
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {Object.entries(EQUIPMENT_THEMES).map(([themeKey, themeInfo]) => {
                    const themeEquipment = equipmentByTheme[themeKey] || []
                    if (themeEquipment.length === 0) return null
                    
                    const isExpanded = expandedThemes[themeKey]
                    const selectedInTheme = themeEquipment.filter(e => selectedEquipment.includes(e.id)).length
                    
                    return (
                      <div key={themeKey} className="border rounded bg-white">
                        <button
                          type="button"
                          onClick={() => setExpandedThemes({...expandedThemes, [themeKey]: !isExpanded})}
                          className="w-full flex items-center justify-between p-2 hover:bg-gray-50"
                        >
                          <span className="font-medium text-ui">{themeInfo.label}</span>
                          <div className="flex items-center gap-2">
                            {selectedInTheme > 0 && (
                              <span className="text-ui-sm bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))] px-2 py-0.5 rounded">{selectedInTheme}</span>
                            )}
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </div>
                        </button>
                        
                        {isExpanded && (
                          <div className="border-t p-2 space-y-1">
                            {themeEquipment.map(eq => (
                              <label key={eq.id} className="flex items-center gap-2 p-1 hover:bg-gray-50 rounded cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={selectedEquipment.includes(eq.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedEquipment([...selectedEquipment, eq.id])
                                    } else {
                                      setSelectedEquipment(selectedEquipment.filter(id => id !== eq.id))
                                    }
                                  }}
                                  className="w-4 h-4 rounded"
                                />
                                <span className="text-ui flex-1">{eq.name}</span>
                                {eq.ratio_per_persons && (
                                  <span className="text-ui-sm text-gray-400">1/{eq.ratio_per_persons} pers.</span>
                                )}
                                {eq.is_consumable && (
                                  <span className="text-ui-sm bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))] px-1 rounded">Conso.</span>
                                )}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                
                {/* Bouton ajouter équipement personnalisé */}
                <div className="mt-3 pt-3 border-t">
                  {!showAddEquipment ? (
                    <button
                      type="button"
                      onClick={() => setShowAddEquipment(true)}
                      className="text-ui text-[rgb(var(--c-info))] hover:underline flex items-center gap-1"
                    >
                      <Plus className="w-4 h-4" />
                      Ajouter un équipement personnalisé
                    </button>
                  ) : (
                    <div className="space-y-2 p-2 bg-[rgb(var(--c-info-bg))] rounded">
                      <input
                        type="text"
                        placeholder="Nom de l'équipement"
                        className="input text-ui"
                        value={newEquipment.name}
                        onChange={(e) => setNewEquipment({...newEquipment, name: e.target.value})}
                      />
                      <div className="flex gap-2">
                        <select
                          className="input text-ui flex-1"
                          value={newEquipment.theme}
                          onChange={(e) => setNewEquipment({...newEquipment, theme: e.target.value})}
                        >
                          {Object.entries(EQUIPMENT_THEMES).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          placeholder="Ratio (vide=1/session)"
                          className="input text-ui w-32"
                          value={newEquipment.ratio_per_persons || ''}
                          onChange={(e) => setNewEquipment({...newEquipment, ratio_per_persons: e.target.value ? parseInt(e.target.value) : null})}
                        />
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setShowAddEquipment(false)} className="btn btn-sm btn-secondary flex-1">Annuler</button>
                        <button type="button" onClick={handleAddCustomEquipment} className="btn btn-sm btn-primary flex-1">Ajouter</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {/* Fiche programme (indicateur 1 de Qualiopi) : tout ce qui figure sur le programme généré */}
            <div className="p-4 border-t space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-ui">Programme de formation</h3>
                  <p className="text-ui-sm text-gray-500">Ces informations figurent sur le programme remis au client, sur une page. Champ vide : texte grisé par défaut.</p>
                </div>
                <button type="button" onClick={apercuProgramme} className="btn btn-secondary flex items-center gap-2 shrink-0">
                  <FileText className="w-4 h-4" /> Aperçu du programme
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="label">Effectif minimum</label>
                  <input type="number" min="1" className="input" value={form.min_participants} onChange={(e) => setForm({ ...form, min_participants: e.target.value })} />
                </div>
                <div>
                  <label className="label">Effectif maximum</label>
                  <input type="number" min="1" className="input" value={form.max_participants} onChange={(e) => setForm({ ...form, max_participants: e.target.value })} />
                </div>
                <div>
                  <label className="label">Recyclage ou validité</label>
                  <select className="input" value={form.validity_kind} onChange={(e) => setForm({ ...form, validity_kind: e.target.value })}>
                    <option value="recyclage">Recyclage conseillé</option>
                    <option value="validite">Durée de validité</option>
                  </select>
                </div>
                <div>
                  <label className="label">Durée</label>
                  <input type="text" className="input" placeholder="Ex : 1 an, 24 mois" value={form.validity_text} onChange={(e) => setForm({ ...form, validity_text: e.target.value })} />
                </div>
              </div>
              {(form.min_participants || form.max_participants) ? (
                <p className="text-ui-sm text-gray-500 -mt-2">Affiché : {effectifTexte(form)}</p>
              ) : null}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Modalités</label>
                  <input type="text" className="input" placeholder="En présentiel" value={form.modalities} onChange={(e) => setForm({ ...form, modalities: e.target.value })} />
                </div>
                <div>
                  <label className="label">Délai d&apos;accès</label>
                  <input type="text" className="input" placeholder={DELAI_ACCES_DEFAUT} value={form.access_delay} onChange={(e) => setForm({ ...form, access_delay: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label">Moyens pédagogiques</label>
                <textarea className="input" rows={3} placeholder={'Formation en présentiel, apports théoriques et mises en situation pratiques\nMatériel fourni : extincteurs, présentation projetée\nRemise d\'un aide-mémoire'} value={form.methods} onChange={(e) => setForm({ ...form, methods: e.target.value })} />
                <p className="text-ui-sm text-gray-500 mt-1">Une ligne par élément (méthodes, matériel fourni, documents remis pendant la formation). Le « Matériel requis (stagiaires) » s&apos;affiche à part, sous « À prévoir par le stagiaire ».</p>
              </div>
              <div>
                <label className="label">Formateur (profil)</label>
                <input type="text" className="input" placeholder="Ex : formateur expert en sécurité incendie" value={form.trainer_profile} onChange={(e) => setForm({ ...form, trainer_profile: e.target.value })} />
              </div>
              <div>
                <label className="label">Modalités d&apos;évaluation</label>
                <textarea className="input" rows={2} placeholder="Évaluation des acquis par le formateur au cours de la formation. Questionnaire de satisfaction en fin de formation." value={form.evaluation_methods} onChange={(e) => setForm({ ...form, evaluation_methods: e.target.value })} />
              </div>
              <div>
                <label className="label">Validation de la formation (documents remis)</label>
                <textarea className="input" rows={2} placeholder="À l'issue de la formation, une attestation de fin de formation est remise au stagiaire." value={form.deliverables} onChange={(e) => setForm({ ...form, deliverables: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <label className="label">Tarif affiché sur le programme</label>
                  <input type="text" className="input" placeholder={TARIF_DEFAUT} value={form.price_mention} onChange={(e) => setForm({ ...form, price_mention: e.target.value })} />
                </div>
                <div>
                  <label className="label">Pictogramme</label>
                  <select className="input" value={form.pictogram} onChange={(e) => setForm({ ...form, pictogram: e.target.value })}>
                    <option value="">Aucun</option>
                    {Object.entries(PICTOGRAMMES).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Référence du programme</label>
                  <input type="text" className="input font-mono uppercase" placeholder={`PROG-${form.code || 'CODE'}`} value={form.program_ref} onChange={(e) => setForm({ ...form, program_ref: e.target.value.toUpperCase() })} />
                </div>
              </div>
              <p className="text-ui-sm text-gray-500">Contenu du programme (champ « Programme / Contenu ») : une ligne par élément, « - » pour une puce, « -- » pour une sous-puce, une ligne sans tiret pour un intertitre (ex. « Partie pratique (1 heure) »).</p>
              {selectedCourse && (
                <div>
                  <label className="label">Motif de la mise à jour du programme</label>
                  <input type="text" className="input" placeholder="Obligatoire si le programme change. Ex : ajout d'un exercice pratique" value={form.motif_maj} onChange={(e) => setForm({ ...form, motif_maj: e.target.value })} />
                  <p className="text-ui-sm text-gray-500 mt-1">
                    {selectedCourse.program_version ? `Version actuelle : ${selectedCourse.program_version}${selectedCourse.program_updated_on ? `, mise à jour le ${new Date(selectedCourse.program_updated_on).toLocaleDateString('fr-FR')}` : ''}. ` : ''}
                    Une modification du programme crée une nouvelle version datée (Qualité › Versions des programmes).
                  </p>
                </div>
              )}
            </div>

            {/* Programme PDF */}
            <div className="p-4 border-t bg-gray-50">
              <label className="label">Programme de formation (PDF)</label>
              <div className="flex items-center gap-3">
                <input
                  ref={programInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={handleProgramUpload}
                  className="hidden"
                />
                {fichierDeLInstance(form.program_url) ? (
                  <div className="flex items-center gap-2 flex-1">
                    <a
                      href={fichierDeLInstance(form.program_url)} onClick={(e) => { e.preventDefault(); ouvrirFichier(fichierDeLInstance(form.program_url)).catch((err) => toast.error(err.message)) }}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-primary-600 hover:underline"
                    >
                      <FileText className="w-4 h-4" />
                      Programme PDF
                    </a>
                    <button
                      type="button"
                      onClick={handleRemoveProgram}
                      className="p-1 hover:bg-[rgb(var(--c-danger-bg))] rounded text-[rgb(var(--c-danger))]"
                      title="Supprimer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => programInputRef.current?.click()}
                    disabled={uploadingProgram}
                    className="btn btn-secondary flex items-center gap-2"
                  >
                    {uploadingProgram ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Upload...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        Uploader un programme PDF
                      </>
                    )}
                  </button>
                )}
              </div>
              <p className="text-ui-sm text-gray-500 mt-1">Facultatif : sans fichier déposé, le programme est généré par l&apos;outil à partir de la fiche.{form.program_url && !fichierDeLInstance(form.program_url) ? ' Le fichier venu de l\'ancien outil est ignoré.' : ''}</p>
            </div>
            
            <div className="flex justify-end gap-3 p-4 border-t">
              <button onClick={() => setShowForm(false)} className="btn btn-secondary">Annuler</button>
              <button onClick={handleSave} className="btn btn-primary">
                <Save className="w-4 h-4 mr-2" />{selectedCourse ? 'Modifier' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Modal Import Sellsy Preview */}
      {importPreview && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={() => !importing && setImportPreview(null)} />
          <div className="relative min-h-full flex items-center justify-center p-4">
            <div className="relative bg-white rounded-ui shadow-md w-full max-w-3xl max-h-[90vh] overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b bg-[rgb(var(--c-success-bg))]">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="w-6 h-6 text-[rgb(var(--c-success))]" />
                  <div>
                    <h2 className="text-lg font-semibold">Import formations Sellsy</h2>
                    <p className="text-ui text-gray-600">{importPreview.length} formation(s) détectée(s)</p>
                  </div>
                </div>
                {!importing && <button onClick={() => setImportPreview(null)}><X className="w-5 h-5" /></button>}
              </div>
              
              <div className="p-4 overflow-y-auto max-h-[60vh]">
                <table className="w-full text-ui">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left py-2 px-3 font-medium">Formation</th>
                      <th className="text-center py-2 px-3 font-medium">Durée</th>
                      <th className="text-right py-2 px-3 font-medium">Prix HT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {importPreview.map((formation, idx) => {
                      const exists = courses.find(c => c.title?.toLowerCase() === formation.title?.toLowerCase())
                      return (
                        <tr key={idx} className={exists ? 'bg-[rgb(var(--c-warning-bg))]' : ''}>
                          <td className="py-2 px-3">
                            <div className="font-medium">{formation.title}</div>
                            <div className="text-ui-sm text-gray-500 truncate max-w-md">{formation.description}</div>
                            {exists && <span className="text-ui-sm text-[rgb(var(--c-warning))]"> Existe déjà</span>}
                          </td>
                          <td className="py-2 px-3 text-center text-gray-600">{formation.duration_hours}h</td>
                          <td className="py-2 px-3 text-right text-gray-900 font-medium">{formation.price_ht?.toLocaleString('fr-FR')} €</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              
              <div className="flex items-center justify-between p-4 border-t bg-gray-50">
                <p className="text-ui text-gray-600">
                  Les formations existantes seront ignorées. Toutes les formations importées sont modifiables.
                </p>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setImportPreview(null)} 
                    className="btn btn-secondary"
                    disabled={importing}
                  >
                    Annuler
                  </button>
                  <button 
                    onClick={executeImport} 
                    className="btn btn-primary flex items-center gap-2"
                    disabled={importing}
                  >
                    {importing ? (
                      <>
                        <span className="animate-spin"></span> Import en cours...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" /> Importer
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
