import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../../core/supabase'
import { useDataStore } from '../../../core/store'
import {
  ArrowLeft, Shield, Building2, Calendar, MapPin, ChevronDown, ChevronUp,
  X, Save, AlertTriangle, CheckCircle, Clock, FileText, Trash2, Plus,
  Edit, Loader2, Target, Users, BarChart3, Filter, Search, Copy,
  Briefcase, GraduationCap, RefreshCw, Info, Zap, Eye, Hash, Bot, Sparkles, ThumbsUp, ThumbsDown, Download
} from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { generateDuerpPDF, generateDuerpExcel } from '../lib/duerpExport'
import DuerpConformiteTab from '../components/DuerpConformiteTab'

// ═══════════════════════════════════════════════════════════
// CONSTANTES — alignées sur le schéma SQL déployé
// ═══════════════════════════════════════════════════════════
const STATUS_CONFIG = {
  brouillon:       { label: 'Brouillon',       emoji: '📝', color: 'bg-gray-100 text-gray-700' },
  en_cours:        { label: 'En cours',         emoji: '🔄', color: 'bg-blue-100 text-blue-700' },
  visite_terrain:  { label: 'Visite terrain',   emoji: '👷', color: 'bg-amber-100 text-amber-700' },
  finalisation:    { label: 'Finalisation',     emoji: '✏️', color: 'bg-purple-100 text-purple-700' },
  termine:         { label: 'Terminé',          emoji: '✅', color: 'bg-green-100 text-green-700' },
  archive:         { label: 'Archivé',          emoji: '📁', color: 'bg-stone-100 text-stone-600' },
}

const FREQUENCE_LABELS = [
  { value: 1, label: 'Occasionnel', short: '1', desc: 'Quelques fois/mois',    color: 'bg-green-100 text-green-800 border-green-300' },
  { value: 2, label: 'Fréquent',    short: '2', desc: 'Plusieurs fois/jour',   color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  { value: 3, label: 'Très fréquent', short: '3', desc: 'Plusieurs fois/heure', color: 'bg-orange-100 text-orange-800 border-orange-300' },
  { value: 4, label: 'Permanent',   short: '4', desc: 'Plusieurs fois/min',    color: 'bg-red-100 text-red-800 border-red-300' },
]

const GRAVITE_LABELS = [
  { value: 1, label: 'Minime',      short: '1', desc: '1er soin, incident',   color: 'bg-green-100 text-green-800 border-green-300' },
  { value: 2, label: 'Significatif', short: '2', desc: 'AT sans arrêt',       color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  { value: 3, label: 'Grave',       short: '3', desc: 'AT avec arrêt / MP',   color: 'bg-orange-100 text-orange-800 border-orange-300' },
  { value: 4, label: 'Très grave',  short: '4', desc: 'IPP / décès',          color: 'bg-red-100 text-red-800 border-red-300' },
]

const MAITRISE_LABELS = [
  { value: 0.5,  label: 'Totale',       desc: 'Action 100% en place, efficace', color: 'bg-green-100 text-green-800 border-green-300' },
  { value: 0.75, label: 'Partielle',    desc: 'Action partiellement en place',  color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  { value: 1,    label: 'Insuffisante', desc: 'Action non mise en place',       color: 'bg-red-100 text-red-800 border-red-300' },
]

// Types d'actions — CHECK constraint SQL : prevention, protection, formation, organisationnelle, technique
const ACTION_TYPES = [
  { value: 'prevention',        label: 'Prévention',        emoji: '🛡️' },
  { value: 'protection',        label: 'Protection',        emoji: '🦺' },
  { value: 'formation',         label: 'Formation',         emoji: '🎓' },
  { value: 'organisationnelle', label: 'Organisationnelle', emoji: '📋' },
  { value: 'technique',         label: 'Technique',         emoji: '🔧' },
]

// Priorités — CHECK constraint SQL : critique, haute, moyenne, basse
const ACTION_PRIORITES = [
  { value: 'critique', label: 'Critique', color: 'bg-red-200 text-red-800' },
  { value: 'haute',    label: 'Haute',    color: 'bg-red-100 text-red-700' },
  { value: 'moyenne',  label: 'Moyenne',  color: 'bg-yellow-100 text-yellow-700' },
  { value: 'basse',    label: 'Basse',    color: 'bg-green-100 text-green-700' },
]

// Statuts — CHECK constraint SQL : a_faire, en_cours, fait, annule
const ACTION_STATUTS = [
  { value: 'a_faire',  label: 'À faire',  emoji: '⬜', color: 'bg-gray-100 text-gray-700' },
  { value: 'en_cours', label: 'En cours', emoji: '🔄', color: 'bg-blue-100 text-blue-700' },
  { value: 'fait',     label: 'Fait',     emoji: '✅', color: 'bg-green-100 text-green-700' },
  { value: 'annule',   label: 'Annulé',   emoji: '❌', color: 'bg-stone-100 text-stone-600' },
]

// ═══════════════════════════════════════════════════════════
// HELPERS COTATION
// risque_brut et risque_residuel sont GENERATED ALWAYS dans PostgreSQL
// → on ne les écrit JAMAIS, on les affiche seulement côté client
// ═══════════════════════════════════════════════════════════
const computeDisplayScores = (r) => {
  const f = r.frequence || 0
  const g = r.gravite || 0
  const m = r.maitrise || 1
  const brut = f * g
  const residuel = Math.round(brut * m * 100) / 100
  return { brut, residuel }
}

const getRiskLevel = (score) => {
  if (!score || score <= 0) return { label: 'Non évalué', color: 'bg-gray-200', text: 'text-gray-500', badge: 'bg-gray-100 text-gray-600' }
  if (score <= 4)  return { label: 'Faible',   color: 'bg-green-500',  text: 'text-green-700',  badge: 'bg-green-100 text-green-700' }
  if (score <= 8)  return { label: 'Moyen',    color: 'bg-yellow-500', text: 'text-yellow-700', badge: 'bg-yellow-100 text-yellow-700' }
  if (score <= 12) return { label: 'Élevé',    color: 'bg-orange-500', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-700' }
  return { label: 'Critique', color: 'bg-red-500', text: 'text-red-700', badge: 'bg-red-100 text-red-700' }
}

// ═══════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ═══════════════════════════════════════════════════════════
export default function DuerpDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { courses, fetchCourses } = useDataStore()

  // Data
  const [project, setProject] = useState(null)
  const [units, setUnits] = useState([])
  const [risks, setRisks] = useState([])
  const [actions, setActions] = useState([])
  const [categories, setCategories] = useState([])
  const [templates, setTemplates] = useState([])
  const [formations, setFormations] = useState([])
  const [loading, setLoading] = useState(true)

  // UI
  const [activeTab, setActiveTab] = useState('units')
  const [showInfoPanel, setShowInfoPanel] = useState(false)
  const [editingProject, setEditingProject] = useState(null)

  // Unités
  const [editingUnit, setEditingUnit] = useState(null)
  const [unitForm, setUnitForm] = useState({})

  // Risques
  const [editingRisk, setEditingRisk] = useState(null)
  const [riskFilter, setRiskFilter] = useState({ category: '', unit: '', level: '', search: '' })
  const [showTemplateLibrary, setShowTemplateLibrary] = useState(false)
  const [templateSearch, setTemplateSearch] = useState('')
  const [templateCatFilter, setTemplateCatFilter] = useState('')

  // Actions
  const [editingAction, setEditingAction] = useState(null)
  const [actionForm, setActionForm] = useState({})

  // IA Évaluation
  const [aiLoading, setAiLoading] = useState(false)
  const [aiRiskId, setAiRiskId] = useState(null)           // Mode 1: risque en cours d'évaluation
  const [aiDescription, setAiDescription] = useState('')     // Description terrain
  const [aiResult, setAiResult] = useState(null)             // Résultat IA (risk ou unit)
  const [showAiUnitModal, setShowAiUnitModal] = useState(null) // Mode 2: unit_id en analyse
  const [aiUnitDescription, setAiUnitDescription] = useState('')
  const [showAiGeneralModal, setShowAiGeneralModal] = useState(false) // Mode 3: saisie libre
  const [aiGeneralDescription, setAiGeneralDescription] = useState('')
  const [showAiAuditModal, setShowAiAuditModal] = useState(false)    // Mode 4: audit complétude
  const aiGeneralRunning = useRef(false) // Guard anti double-clic (synchrone, sans attendre re-render)

  // ═══════════════════════════════════════════════════════════
  // CHARGEMENT
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    loadAll()
    if (!courses.length) fetchCourses()
  }, [id])

  const loadAll = async () => {
    setLoading(true)
    try {
      const [
        { data: proj },
        { data: u },
        { data: r },
        { data: a },
        { data: cats },
        { data: tmpl },
        { data: form },
      ] = await Promise.all([
        supabase.from('duerp_projects').select('*').eq('id', id).single(),
        supabase.from('duerp_units').select('*').eq('project_id', id).order('sort_order'),
        supabase.from('duerp_risks').select('*').eq('project_id', id).order('sort_order'),
        supabase.from('duerp_actions').select('*').eq('project_id', id).order('created_at', { ascending: false }),
        supabase.from('duerp_risk_categories').select('*').order('sort_order'),
        supabase.from('duerp_risk_templates').select('*').order('sort_order'),
        supabase.from('duerp_formations_reglementaires').select('*').order('sort_order'),
      ])
      if (!proj) { navigate('/duerp'); return }
      setProject(proj)
      setUnits(u || [])
      setRisks(r || [])
      setActions(a || [])
      setCategories(cats || [])
      setTemplates(tmpl || [])
      setFormations(form || [])
    } catch (err) {
      console.error(err)
      toast.error('Erreur chargement projet')
      navigate('/duerp')
    }
    setLoading(false)
  }

  // ═══════════════════════════════════════════════════════════
  // PROJET — STATUT & INFOS
  // ═══════════════════════════════════════════════════════════
  const updateProjectStatus = async (newStatus) => {
    const { error } = await supabase.from('duerp_projects').update({ status: newStatus }).eq('id', id)
    if (error) return toast.error('Erreur mise à jour statut')
    setProject(p => ({ ...p, status: newStatus }))
    toast.success(`Statut → ${STATUS_CONFIG[newStatus]?.label}`)
  }

  const saveProjectInfo = async () => {
    if (!editingProject) return
    const { id: _id, created_at, updated_at, created_by, ...fields } = editingProject
    const { error } = await supabase.from('duerp_projects').update(fields).eq('id', id)
    if (error) return toast.error('Erreur sauvegarde : ' + error.message)
    setProject(p => ({ ...p, ...fields }))
    setEditingProject(null)
    toast.success('Informations mises à jour')
  }

  // ═══════════════════════════════════════════════════════════
  // UNITÉS DE TRAVAIL — CRUD
  // Note schéma : effectif est INTEGER (pas text)
  // Note schéma : ON DELETE CASCADE sur risks → supprime les risques liés
  // ═══════════════════════════════════════════════════════════
  const saveUnit = async () => {
    if (!unitForm.name) return toast.error('Nom requis')
    const effectifInt = unitForm.effectif ? parseInt(unitForm.effectif, 10) || null : null
    if (editingUnit === 'new') {
      const { error } = await supabase.from('duerp_units').insert({
        project_id: id,
        code: unitForm.code || `UT${units.length + 1}`,
        name: unitForm.name,
        description: unitForm.description || '',
        effectif: effectifInt,
        metiers: unitForm.metiers || '',
        sort_order: units.length,
      })
      if (error) return toast.error('Erreur création : ' + error.message)
      toast.success('Unité créée')
    } else {
      const { error } = await supabase.from('duerp_units').update({
        code: unitForm.code, name: unitForm.name,
        description: unitForm.description, effectif: effectifInt, metiers: unitForm.metiers,
      }).eq('id', editingUnit)
      if (error) return toast.error('Erreur modification : ' + error.message)
      toast.success('Unité modifiée')
    }
    setEditingUnit(null)
    setUnitForm({})
    loadAll()
  }

  const deleteUnit = async (unitId) => {
    const linkedRisks = risks.filter(r => r.unit_id === unitId).length
    if (linkedRisks > 0) {
      if (!confirm(`⚠️ ATTENTION : ${linkedRisks} risque(s) lié(s) à cette unité seront DÉFINITIVEMENT SUPPRIMÉS (cascade SQL).\n\nPour les conserver, rattachez-les d'abord à une autre unité.\n\nContinuer ?`)) return
    } else {
      if (!confirm('Supprimer cette unité de travail ?')) return
    }
    const { error } = await supabase.from('duerp_units').delete().eq('id', unitId)
    if (error) return toast.error('Erreur suppression : ' + error.message)
    toast.success('Unité supprimée')
    loadAll()
  }

  // ═══════════════════════════════════════════════════════════
  // RISQUES — CRUD & COTATION
  // ⚠️ CRITIQUE : risque_brut et risque_residuel sont
  //    GENERATED ALWAYS dans PostgreSQL → NE JAMAIS les écrire
  // ═══════════════════════════════════════════════════════════
  const saveRisk = async (riskData) => {
    const payload = {
      danger: riskData.danger,
      situation: riskData.situation,
      consequences: riskData.consequences,
      description_travail: riskData.description_travail,
      category_code: riskData.category_code,
      unit_id: riskData.unit_id || null,
      template_id: riskData.template_id || null,
      frequence: riskData.frequence || null,
      gravite: riskData.gravite || null,
      maitrise: riskData.maitrise || 1,
      prevention_existante: riskData.prevention_existante,
      notes: riskData.notes,
    }
    if (riskData.id) {
      const { error } = await supabase.from('duerp_risks').update(payload).eq('id', riskData.id)
      if (error) return toast.error('Erreur modification risque : ' + error.message)
      toast.success('Risque mis à jour')
    } else {
      const { error } = await supabase.from('duerp_risks').insert({
        ...payload, project_id: id, sort_order: risks.length,
      })
      if (error) return toast.error('Erreur création risque : ' + error.message)
      toast.success('Risque ajouté')
    }
    setEditingRisk(null)
    loadAll()
  }

  const deleteRisk = async (riskId) => {
    if (!confirm('Supprimer ce risque ?')) return
    const { error } = await supabase.from('duerp_risks').delete().eq('id', riskId)
    if (error) return toast.error('Erreur : ' + error.message)
    toast.success('Risque supprimé')
    loadAll()
  }

  const addRiskFromTemplate = async (tmpl) => {
    const { error } = await supabase.from('duerp_risks').insert({
      project_id: id,
      template_id: tmpl.id,
      category_code: tmpl.category_code,
      danger: tmpl.label,
      situation: tmpl.situations,
      consequences: tmpl.consequences,
      prevention_existante: tmpl.prevention_suggestions,
      sort_order: risks.length,
    })
    if (error) return toast.error('Erreur ajout risque : ' + error.message)
    toast.success(`Risque ajouté : ${tmpl.label}`)
    loadAll()
  }

  // Cotation tactile inline — écrit UNIQUEMENT le champ modifié
  const updateRiskField = async (riskId, field, value) => {
    const { error } = await supabase.from('duerp_risks').update({ [field]: value }).eq('id', riskId)
    if (error) return toast.error('Erreur : ' + error.message)
    setRisks(prev => prev.map(r => {
      if (r.id !== riskId) return r
      const updated = { ...r, [field]: value }
      const scores = computeDisplayScores(updated)
      return { ...updated, risque_brut: scores.brut, risque_residuel: scores.residuel }
    }))
  }

  const addFreeRisk = async () => {
    const { error } = await supabase.from('duerp_risks').insert({
      project_id: id, danger: 'Nouveau risque', sort_order: risks.length,
    })
    if (error) return toast.error('Erreur : ' + error.message)
    toast.success('Risque ajouté — complétez les informations')
    loadAll()
  }

  // ═══════════════════════════════════════════════════════════
  // ACTIONS — CRUD
  // ⚠️ Schéma SQL : colonne "action" (pas "titre"),
  //    "type_action" (pas "type"), statut inclut "annule"
  // ═══════════════════════════════════════════════════════════
  const saveAction = async () => {
    if (!actionForm.action) return toast.error('Description de l\'action requise')
    const payload = {
      action: actionForm.action,
      type_action: actionForm.type_action || 'prevention',
      priorite: actionForm.priorite || 'moyenne',
      responsable: actionForm.responsable || null,
      echeance: actionForm.echeance || null,
      cout_estime: actionForm.cout_estime || null,
      date_realisation: actionForm.date_realisation || null,
      statut: actionForm.statut || 'a_faire',
      risk_id: actionForm.risk_id || null,
      course_id: actionForm.course_id || null,
      notes: actionForm.notes || null,
    }
    if (editingAction === 'new') {
      const { error } = await supabase.from('duerp_actions').insert({ project_id: id, ...payload })
      if (error) return toast.error('Erreur création action : ' + error.message)
      toast.success('Action créée')
    } else {
      const { error } = await supabase.from('duerp_actions').update(payload).eq('id', editingAction)
      if (error) return toast.error('Erreur modification : ' + error.message)
      toast.success('Action modifiée')
    }
    setEditingAction(null)
    setActionForm({})
    loadAll()
  }

  const deleteAction = async (actionId) => {
    if (!confirm('Supprimer cette action ?')) return
    const { error } = await supabase.from('duerp_actions').delete().eq('id', actionId)
    if (error) return toast.error('Erreur : ' + error.message)
    toast.success('Action supprimée')
    loadAll()
  }

  const updateActionStatus = async (actionId, newStatus) => {
    const updates = { statut: newStatus }
    if (newStatus === 'fait') updates.date_realisation = new Date().toISOString().split('T')[0]
    const { error } = await supabase.from('duerp_actions').update(updates).eq('id', actionId)
    if (error) return toast.error('Erreur : ' + error.message)
    setActions(prev => prev.map(a => a.id === actionId ? { ...a, ...updates } : a))
    toast.success('Statut mis à jour')
  }

  // ═══════════════════════════════════════════════════════════
  // IA — MODE 1 : Évaluation d'un risque individuel
  // ═══════════════════════════════════════════════════════════
  const evaluateRiskWithAI = async (risk) => {
    if (!aiDescription.trim() && !risk.situation) {
      return toast.error('Décrivez la situation terrain avant de lancer l\'IA')
    }
    setAiLoading(true)
    setAiRiskId(risk.id)
    setAiResult(null)
    try {
      const unit = units.find(u => u.id === risk.unit_id)
      const cat = categories.find(c => c.code === risk.category_code)
      const res = await fetch('/api/duerp-ai-evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'risk',
          context: {
            company_name: project.company_name,
            sector: project.sector_template,
            naf_code: project.naf_code,
            naf_label: project.naf_label,
            effectif: project.effectif,
            unit_name: unit?.name || '',
            danger: risk.danger,
            category: cat?.label || '',
            situation: risk.situation || '',
            consequences: risk.consequences || '',
            prevention_existante: risk.prevention_existante || '',
            description: aiDescription || risk.situation || '',
          }
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur API')
      setAiResult({ mode: 'risk', riskId: risk.id, ...data.result })
      toast.success('Évaluation IA terminée')
    } catch (err) {
      console.error(err)
      toast.error('Erreur IA : ' + (err.message || 'Réessayez'))
    }
    setAiLoading(false)
  }

  const applyAiRiskResult = async (risk) => {
    if (!aiResult || aiResult.riskId !== risk.id) return
    // Appliquer les scores
    const updates = {
      frequence: aiResult.frequence,
      gravite: aiResult.gravite,
      maitrise: aiResult.maitrise,
    }
    if (aiResult.situation_completee) updates.situation = aiResult.situation_completee
    if (aiResult.consequences_completees) updates.consequences = aiResult.consequences_completees
    if (aiResult.description_travail) updates.description_travail = aiResult.description_travail

    const { error } = await supabase.from('duerp_risks').update(updates).eq('id', risk.id)
    if (error) return toast.error('Erreur sauvegarde : ' + error.message)

    // Créer les actions proposées
    if (aiResult.actions?.length) {
      for (const a of aiResult.actions) {
        await supabase.from('duerp_actions').insert({
          project_id: id,
          risk_id: risk.id,
          action: a.action,
          type_action: a.type_action || 'prevention',
          priorite: a.priorite || 'moyenne',
          cout_estime: a.cout_estime || null,
          statut: 'a_faire',
        })
      }
    }
    setAiResult(null)
    setAiRiskId(null)
    setAiDescription('')
    toast.success(`Cotation appliquée + ${aiResult.actions?.length || 0} action(s) créée(s)`)
    loadAll()
  }

  // ═══════════════════════════════════════════════════════════
  // IA — MODE 2 : Analyse complète d'une unité de travail
  // ═══════════════════════════════════════════════════════════
  const evaluateUnitWithAI = async (unitId) => {
    if (!aiUnitDescription.trim()) {
      return toast.error('Décrivez ce que vous observez dans cette unité')
    }
    setAiLoading(true)
    setAiResult(null)
    try {
      const unit = units.find(u => u.id === unitId)
      const existingRisks = risks.filter(r => r.unit_id === unitId).map(r => ({
        danger: r.danger,
        category: categories.find(c => c.code === r.category_code)?.label || '',
      }))
      const res = await fetch('/api/duerp-ai-evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'unit',
          context: {
            company_name: project.company_name,
            sector: project.sector_template,
            naf_code: project.naf_code,
            naf_label: project.naf_label,
            effectif: project.effectif,
            unit_name: unit?.name || '',
            unit_code: unit?.code || '',
            unit_effectif: unit?.effectif || '',
            unit_metiers: unit?.metiers || '',
            existing_risks: existingRisks,
            available_categories: categories.map(c => ({ code: c.code, label: c.label })),
            description: aiUnitDescription,
          }
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur API')
      setAiResult({ mode: 'unit', unitId, ...data.result })
      toast.success(`${data.result.risques?.length || 0} risque(s) identifié(s) par l'IA`)
    } catch (err) {
      console.error(err)
      toast.error('Erreur IA : ' + (err.message || 'Réessayez'))
    }
    setAiLoading(false)
  }

  const applyAiUnitResults = async (unitId) => {
    if (!aiResult || aiResult.mode !== 'unit' || !aiResult.risques?.length) return
    let createdRisks = 0
    let createdActions = 0
    for (const r of aiResult.risques) {
      if (r._skip) continue // risques décochés par l'utilisateur
      const { data: newRisk, error } = await supabase.from('duerp_risks').insert({
        project_id: id,
        unit_id: unitId,
        category_code: r.category_code || null,
        danger: r.danger,
        situation: r.situation,
        consequences: r.consequences,
        description_travail: r.description_travail || '',
        frequence: r.frequence,
        gravite: r.gravite,
        maitrise: r.maitrise,
        prevention_existante: r.prevention_existante || '',
        sort_order: risks.length + createdRisks,
      }).select().single()
      if (error) { console.error(error); continue }
      createdRisks++
      // Créer les actions liées
      if (r.actions?.length && newRisk) {
        for (const a of r.actions) {
          await supabase.from('duerp_actions').insert({
            project_id: id,
            risk_id: newRisk.id,
            action: a.action,
            type_action: a.type_action || 'prevention',
            priorite: a.priorite || 'moyenne',
            cout_estime: a.cout_estime || null,
            statut: 'a_faire',
          })
          createdActions++
        }
      }
    }
    setAiResult(null)
    setShowAiUnitModal(null)
    setAiUnitDescription('')
    toast.success(`${createdRisks} risque(s) + ${createdActions} action(s) créé(s)`)
    loadAll()
  }

  // ═══════════════════════════════════════════════════════════
  // IA — MODE 3 : Saisie libre générale (multi-unités)
  // ═══════════════════════════════════════════════════════════
  const evaluateGeneralWithAI = async () => {
    if (!aiGeneralDescription.trim()) return toast.error('Décrivez vos observations terrain')
    if (aiGeneralRunning.current) return // Guard synchrone anti double-clic
    aiGeneralRunning.current = true
    setAiLoading(true)
    setAiResult(null)
    try {
      const existingRisks = risks.map(r => ({
        danger: r.danger,
        category: categories.find(c => c.code === r.category_code)?.label || '',
        unit: units.find(u => u.id === r.unit_id)?.name || '',
      }))
      const res = await fetch('/api/duerp-ai-evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'general',
          context: {
            company_name: project.company_name,
            sector: project.sector_template,
            naf_code: project.naf_code,
            naf_label: project.naf_label,
            effectif: project.effectif,
            units: units.map(u => ({ id: u.id, code: u.code, name: u.name })),
            existing_risks: existingRisks,
            available_categories: categories.map(c => ({ code: c.code, label: c.label })),
            description: aiGeneralDescription,
          }
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur API')
      setAiResult({ mode: 'general', ...data.result })
      toast.success(`${data.result.risques?.length || 0} risque(s) identifié(s)`)
    } catch (err) {
      toast.error('Erreur IA : ' + (err.message || 'Réessayez'))
    }
    aiGeneralRunning.current = false
    setAiLoading(false)
  }

  const applyAiGeneralResults = async () => {
    if (!aiResult || aiResult.mode !== 'general') return
    let createdUnits = 0, createdRisks = 0, createdActions = 0, skippedDupes = 0

    // Sauvegarder les observations terrain dans duerp_projects.notes
    if (aiGeneralDescription.trim()) {
      const existing = project.notes ? project.notes.trim() : ''
      const datePrefix = new Date().toLocaleDateString('fr-FR')
      const newNote = `[${datePrefix}] ${aiGeneralDescription.trim()}`
      const merged = existing ? `${existing}\n\n${newNote}` : newNote
      await supabase.from('duerp_projects').update({ notes: merged }).eq('id', id)
      setProject(p => ({ ...p, notes: merged }))
    }

    // Créer les nouvelles unités si proposées
    const unitCodeMap = {}
    units.forEach(u => { unitCodeMap[u.code] = u.id })
    if (aiResult.nouvelles_unites?.length) {
      for (const nu of aiResult.nouvelles_unites) {
        const { data, error } = await supabase.from('duerp_units').insert({
          project_id: id, code: nu.code, name: nu.name, description: nu.description || '', sort_order: units.length + createdUnits,
        }).select().single()
        if (!error && data) { unitCodeMap[nu.code] = data.id; createdUnits++ }
      }
    }

    // Construire le set de clés existantes pour dédoublonnage (danger normalisé + unit_id)
    const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    const existingKeys = new Set(risks.map(r => `${norm(r.danger)}__${r.unit_id || ''}`))

    // Créer les risques (avec dédoublonnage)
    for (const r of (aiResult.risques || [])) {
      if (r._skip) continue
      const unitId = unitCodeMap[r.unit_code] || null
      const dedupeKey = `${norm(r.danger)}__${unitId || ''}`
      if (existingKeys.has(dedupeKey)) { skippedDupes++; continue }
      existingKeys.add(dedupeKey)
      const { data: newRisk, error } = await supabase.from('duerp_risks').insert({
        project_id: id, unit_id: unitId, category_code: r.category_code || null,
        danger: r.danger, situation: r.situation, consequences: r.consequences,
        description_travail: r.description_travail || '', frequence: r.frequence, gravite: r.gravite,
        maitrise: r.maitrise, prevention_existante: r.prevention_existante || '', sort_order: risks.length + createdRisks,
      }).select().single()
      if (error) continue
      createdRisks++
      if (r.actions?.length && newRisk) {
        for (const a of r.actions) {
          await supabase.from('duerp_actions').insert({
            project_id: id, risk_id: newRisk.id, action: a.action,
            type_action: a.type_action || 'prevention', priorite: a.priorite || 'moyenne',
            cout_estime: a.cout_estime || null, statut: 'a_faire',
          })
          createdActions++
        }
      }
    }
    setAiResult(null); setShowAiGeneralModal(false); setAiGeneralDescription('')
    const dupeMsg = skippedDupes > 0 ? ` (${skippedDupes} doublon(s) ignoré(s))` : ''
    toast.success(`${createdUnits} unité(s), ${createdRisks} risque(s), ${createdActions} action(s) créé(s)${dupeMsg}`)
    loadAll()
  }

  // ═══════════════════════════════════════════════════════════
  // IA — MODE 4 : Audit de complétude
  // ═══════════════════════════════════════════════════════════
  const runAiAudit = async () => {
    setAiLoading(true)
    setAiResult(null)
    try {
      const risksWithDetails = risks.map(r => ({
        danger: r.danger,
        category_code: r.category_code,
        category: categories.find(c => c.code === r.category_code)?.label || '',
        unit_id: r.unit_id,
        unit_name: units.find(u => u.id === r.unit_id)?.name || '',
        unit_code: units.find(u => u.id === r.unit_id)?.code || '',
        frequence: r.frequence, gravite: r.gravite, maitrise: r.maitrise,
      }))
      const risksWithActionIds = new Set(actions.map(a => a.risk_id).filter(Boolean))
      const res = await fetch('/api/duerp-ai-evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'audit',
          context: {
            company_name: project.company_name,
            sector: project.sector_template,
            naf_code: project.naf_code,
            naf_label: project.naf_label,
            effectif: project.effectif,
            units: units.map(u => ({ id: u.id, code: u.code, name: u.name, effectif: u.effectif, metiers: u.metiers })),
            risks: risksWithDetails,
            available_categories: categories.map(c => ({ code: c.code, label: c.label })),
            actions_count: actions.length,
            risks_with_actions: risksWithActionIds.size,
          }
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur API')
      setAiResult({ mode: 'audit', ...data.result })
      toast.success('Audit de complétude terminé')
    } catch (err) {
      toast.error('Erreur IA : ' + (err.message || 'Réessayez'))
    }
    setAiLoading(false)
  }

  const applyAuditSuggestion = async (manque) => {
    if (!manque.risques_suggeres?.length) return
    let created = 0
    for (const r of manque.risques_suggeres) {
      if (r._skip) continue
      const unitId = units.find(u => u.code === r.unit_code)?.id || null
      const { data: newRisk, error } = await supabase.from('duerp_risks').insert({
        project_id: id, unit_id: unitId, category_code: r.category_code || null,
        danger: r.danger, situation: r.situation, consequences: r.consequences,
        frequence: r.frequence, gravite: r.gravite, maitrise: r.maitrise,
        sort_order: risks.length + created,
      }).select().single()
      if (error) continue
      created++
      if (r.actions?.length && newRisk) {
        for (const a of r.actions) {
          await supabase.from('duerp_actions').insert({
            project_id: id, risk_id: newRisk.id, action: a.action,
            type_action: a.type_action || 'prevention', priorite: a.priorite || 'moyenne',
            statut: 'a_faire',
          })
        }
      }
    }
    toast.success(`${created} risque(s) + actions créé(s)`)
    // Retirer ce manque de la liste pour qu'il disparaisse après ajout
    setAiResult(prev => prev ? {
      ...prev,
      manques: (prev.manques || []).filter(m => m !== manque)
    } : null)
    loadAll()
  }

  // ═══════════════════════════════════════════════════════════
  // DONNÉES CALCULÉES
  // ═══════════════════════════════════════════════════════════
  const filteredRisks = useMemo(() => {
    return risks.filter(r => {
      if (riskFilter.category && r.category_code !== riskFilter.category) return false
      if (riskFilter.unit) {
        if (riskFilter.unit === '__none__' && r.unit_id) return false
        if (riskFilter.unit !== '__none__' && r.unit_id !== riskFilter.unit) return false
      }
      if (riskFilter.level) {
        const score = r.risque_residuel || r.risque_brut || 0
        if (riskFilter.level === 'non_evalue' && r.frequence && r.gravite) return false
        if (riskFilter.level === 'non_evalue' && (!r.frequence || !r.gravite)) return true
        if (!r.frequence || !r.gravite) return false
        if (riskFilter.level === 'critique' && score <= 12) return false
        if (riskFilter.level === 'eleve' && (score <= 8 || score > 12)) return false
        if (riskFilter.level === 'moyen' && (score <= 4 || score > 8)) return false
        if (riskFilter.level === 'faible' && score > 4) return false
      }
      if (riskFilter.search) {
        const s = riskFilter.search.toLowerCase()
        return (r.danger || '').toLowerCase().includes(s)
          || (r.situation || '').toLowerCase().includes(s)
          || (r.consequences || '').toLowerCase().includes(s)
          || (r.prevention_existante || '').toLowerCase().includes(s)
      }
      return true
    })
  }, [risks, riskFilter])

  const riskStats = useMemo(() => {
    const getScore = r => r.risque_residuel || r.risque_brut || 0
    const evaluated = risks.filter(r => r.frequence && r.gravite)
    return {
      total: risks.length,
      evaluated: evaluated.length,
      nonEvaluated: risks.length - evaluated.length,
      critique: evaluated.filter(r => getScore(r) > 12).length,
      eleve: evaluated.filter(r => getScore(r) > 8 && getScore(r) <= 12).length,
      moyen: evaluated.filter(r => getScore(r) > 4 && getScore(r) <= 8).length,
      faible: evaluated.filter(r => getScore(r) >= 1 && getScore(r) <= 4).length,
    }
  }, [risks])

  const actionStats = useMemo(() => ({
    total: actions.length,
    fait: actions.filter(a => a.statut === 'fait').length,
    en_cours: actions.filter(a => a.statut === 'en_cours').length,
    a_faire: actions.filter(a => a.statut === 'a_faire' || !a.statut).length,
    annule: actions.filter(a => a.statut === 'annule').length,
  }), [actions])

  const usedCategories = useMemo(() => {
    const codes = [...new Set(risks.map(r => r.category_code).filter(Boolean))]
    return categories.filter(c => codes.includes(c.code))
  }, [risks, categories])

  const filteredTemplates = useMemo(() => {
    const existingTemplateIds = new Set(risks.map(r => r.template_id).filter(Boolean))
    let list = templates.filter(t => !existingTemplateIds.has(t.id))
    if (templateCatFilter) list = list.filter(t => t.category_code === templateCatFilter)
    if (templateSearch) {
      const s = templateSearch.toLowerCase()
      list = list.filter(t => (t.label || '').toLowerCase().includes(s)
        || (t.situations || '').toLowerCase().includes(s)
        || (t.consequences || '').toLowerCase().includes(s))
    }
    return list
  }, [templates, risks, templateSearch, templateCatFilter])

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  if (loading || !project) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
      </div>
    )
  }

  const st = STATUS_CONFIG[project.status] || STATUS_CONFIG.brouillon

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6">

      {/* ═══════════ HEADER ═══════════ */}
      <div className="mb-4">
        <Link to="/duerp" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-amber-600 mb-2">
          <ArrowLeft className="w-4 h-4" /> Retour aux projets
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2 truncate">
              <Shield className="w-6 h-6 text-amber-600 shrink-0" />
              {project.company_name}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-gray-500">
              <span className="font-mono text-xs">{project.reference}</span>
              {project.version > 1 && <span className="text-xs bg-blue-50 text-blue-600 px-1.5 rounded">v{project.version}</span>}
              {project.city && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{project.postal_code} {project.city}</span>}
              {project.effectif && <span>👥 {project.effectif}</span>}
              {project.naf_code && <span className="text-amber-600 text-xs">NAF {project.naf_code}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setShowInfoPanel(!showInfoPanel); setEditingProject(null) }}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500" title="Infos projet">
              <Info className="w-5 h-5" />
            </button>
            <select value={project.status} onChange={e => updateProjectStatus(e.target.value)}
              className={`px-3 py-2 rounded-lg text-sm font-medium border cursor-pointer ${st.color}`}>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.emoji} {v.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ═══════════ BARRE PROGRESSION RISQUES ═══════════ */}
      <div className="bg-white rounded-xl border shadow-sm p-3 mb-4">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
          <span>{riskStats.total} risques identifiés — {riskStats.evaluated} évalués</span>
          <span>{actionStats.fait}/{actionStats.total} actions réalisées</span>
        </div>
        <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
          {riskStats.total > 0 && (<>
            {riskStats.critique > 0 && <div className="bg-red-500 transition-all" style={{ width: `${(riskStats.critique / riskStats.total) * 100}%` }} />}
            {riskStats.eleve > 0 && <div className="bg-orange-500 transition-all" style={{ width: `${(riskStats.eleve / riskStats.total) * 100}%` }} />}
            {riskStats.moyen > 0 && <div className="bg-yellow-500 transition-all" style={{ width: `${(riskStats.moyen / riskStats.total) * 100}%` }} />}
            {riskStats.faible > 0 && <div className="bg-green-500 transition-all" style={{ width: `${(riskStats.faible / riskStats.total) * 100}%` }} />}
            {riskStats.nonEvaluated > 0 && <div className="bg-gray-300 transition-all" style={{ width: `${(riskStats.nonEvaluated / riskStats.total) * 100}%` }} />}
          </>)}
        </div>
        <div className="flex flex-wrap gap-3 mt-2">
          {[
            { label: 'Critique', count: riskStats.critique, color: 'bg-red-500' },
            { label: 'Élevé', count: riskStats.eleve, color: 'bg-orange-500' },
            { label: 'Moyen', count: riskStats.moyen, color: 'bg-yellow-500' },
            { label: 'Faible', count: riskStats.faible, color: 'bg-green-500' },
            { label: 'Non évalué', count: riskStats.nonEvaluated, color: 'bg-gray-300' },
          ].filter(i => i.count > 0).map(i => (
            <span key={i.label} className="flex items-center gap-1 text-xs text-gray-600">
              <span className={`w-2.5 h-2.5 rounded-full ${i.color}`} />{i.count} {i.label}
            </span>
          ))}
        </div>
      </div>

      {/* ═══════════ PANEL INFOS PROJET ═══════════ */}
      {showInfoPanel && (
        <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-6 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Informations du projet</h3>
            <div className="flex gap-2">
              {editingProject ? (<>
                <button onClick={saveProjectInfo} className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 flex items-center gap-1">
                  <Save className="w-3.5 h-3.5" /> Enregistrer
                </button>
                <button onClick={() => setEditingProject(null)} className="px-3 py-1.5 text-gray-500 hover:bg-gray-100 rounded-lg text-sm">Annuler</button>
              </>) : (
                <button onClick={() => setEditingProject({ ...project })} className="px-3 py-1.5 text-amber-600 hover:bg-amber-50 rounded-lg text-sm flex items-center gap-1">
                  <Edit className="w-3.5 h-3.5" /> Modifier
                </button>
              )}
            </div>
          </div>
          {editingProject ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                { key: 'company_name', label: 'Entreprise' },
                { key: 'siret', label: 'SIRET' },
                { key: 'naf_code', label: 'Code NAF' },
                { key: 'naf_label', label: 'Libellé NAF' },
                { key: 'address', label: 'Adresse' },
                { key: 'city', label: 'Ville' },
                { key: 'postal_code', label: 'Code postal' },
                { key: 'effectif', label: 'Effectif' },
                { key: 'contact_name', label: 'Contact sur site' },
                { key: 'contact_function', label: 'Fonction contact' },
                { key: 'evaluateur', label: 'Évaluateur' },
                { key: 'date_elaboration', label: 'Date élaboration', type: 'date' },
                { key: 'date_visite', label: 'Date visite', type: 'date' },
                { key: 'date_finalisation', label: 'Date finalisation', type: 'date' },
                { key: 'date_prochaine_maj', label: 'Prochaine mise à jour', type: 'date' },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-xs text-gray-500">{f.label}</label>
                  <input type={f.type || 'text'} value={editingProject[f.key] || ''}
                    onChange={e => setEditingProject({ ...editingProject, [f.key]: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              ))}
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="text-xs text-gray-500">Notes</label>
                <textarea value={editingProject.notes || ''} rows={3}
                  onChange={e => setEditingProject({ ...editingProject, notes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
              {[
                { label: 'SIRET', value: project.siret },
                { label: 'NAF', value: project.naf_code ? `${project.naf_code} — ${project.naf_label || ''}` : null },
                { label: 'Adresse', value: [project.address, project.postal_code, project.city].filter(Boolean).join(', ') },
                { label: 'Effectif', value: project.effectif },
                { label: 'Contact', value: project.contact_name },
                { label: 'Fonction', value: project.contact_function },
                { label: 'Évaluateur', value: project.evaluateur },
                { label: 'Élaboration', value: project.date_elaboration ? format(new Date(project.date_elaboration), 'dd/MM/yyyy') : null },
                { label: 'Visite', value: project.date_visite ? format(new Date(project.date_visite), 'dd/MM/yyyy') : null },
                { label: 'Finalisation', value: project.date_finalisation ? format(new Date(project.date_finalisation), 'dd/MM/yyyy') : null },
                { label: 'Prochaine MAJ', value: project.date_prochaine_maj ? format(new Date(project.date_prochaine_maj), 'dd/MM/yyyy') : null },
              ].filter(i => i.value).map(i => (
                <div key={i.label}>
                  <p className="text-xs text-gray-400">{i.label}</p>
                  <p className="font-medium text-gray-700">{i.value}</p>
                </div>
              ))}
              {project.notes && (
                <div className="col-span-full">
                  <p className="text-xs text-gray-400">Notes</p>
                  <p className="text-gray-600 whitespace-pre-line">{project.notes}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════ ONGLETS ═══════════ */}
      <div className="border-b border-gray-200 mb-4 overflow-x-auto">
        <div className="flex min-w-max">
          {[
            { id: 'units',    label: '🏢 Unités',     count: units.length },
            { id: 'risks',    label: '⚠️ Risques',    count: risks.length },
            { id: 'actions',  label: '🎯 Actions',    count: actions.length },
            { id: 'conformite', label: '🛡️ Conformité' },
            { id: 'synthese', label: '📊 Synthèse' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`pb-3 pt-2 px-3 sm:px-4 text-sm font-medium border-b-2 whitespace-nowrap transition ${
                activeTab === tab.id ? 'border-amber-600 text-amber-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {tab.label}
              {tab.count !== undefined && (
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.id ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
                }`}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* ONGLET 1 : UNITÉS DE TRAVAIL                                   */}
      {/* ════════════════════════════════════════════════════════════════ */}
      {activeTab === 'units' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">Regroupez les postes par exposition homogène aux risques.</p>
            <button onClick={() => { setEditingUnit('new'); setUnitForm({ code: `UT${units.length + 1}` }) }}
              className="flex items-center gap-1 px-3 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700">
              <Plus className="w-4 h-4" /> Ajouter
            </button>
          </div>

          {editingUnit && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
              <h4 className="font-medium text-sm mb-3">{editingUnit === 'new' ? 'Nouvelle unité de travail' : 'Modifier l\'unité'}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Code</label>
                  <input value={unitForm.code || ''} onChange={e => setUnitForm({ ...unitForm, code: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="UT1" />
                </div>
                <div className="sm:col-span-1 lg:col-span-2">
                  <label className="text-xs text-gray-500">Nom *</label>
                  <input value={unitForm.name || ''} onChange={e => setUnitForm({ ...unitForm, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Bureau, Atelier, Chantier..." />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Effectif</label>
                  <input type="number" min="0" value={unitForm.effectif || ''} onChange={e => setUnitForm({ ...unitForm, effectif: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="3" />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-gray-500">Métiers / postes concernés</label>
                  <input value={unitForm.metiers || ''} onChange={e => setUnitForm({ ...unitForm, metiers: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Vendeur, Caissier, Magasinier..." />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-gray-500">Description</label>
                  <input value={unitForm.description || ''} onChange={e => setUnitForm({ ...unitForm, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Description de l'unité..." />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-3">
                <button onClick={() => { setEditingUnit(null); setUnitForm({}) }}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Annuler</button>
                <button onClick={saveUnit}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 flex items-center gap-1">
                  <Save className="w-4 h-4" /> Enregistrer
                </button>
              </div>
            </div>
          )}

          {units.length === 0 ? (
            <div className="bg-white rounded-xl border p-8 text-center">
              <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 mb-2">Aucune unité de travail définie</p>
              <p className="text-xs text-gray-400">Les unités regroupent des situations d'exposition homogènes</p>
            </div>
          ) : (
            <div className="space-y-2">
              {units.map(u => {
                const unitRisks = risks.filter(r => r.unit_id === u.id)
                const maxScore = Math.max(0, ...unitRisks.map(r => r.risque_residuel || r.risque_brut || 0))
                const lvl = getRiskLevel(maxScore)
                return (
                  <div key={u.id} className="bg-white rounded-xl border shadow-sm p-4 hover:shadow-md transition">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{u.code}</span>
                          <h4 className="font-semibold text-gray-900">{u.name}</h4>
                          {unitRisks.length > 0 && (
                            <span className={`text-xs px-2 py-0.5 rounded-full ${lvl.badge}`}>{unitRisks.length} risque{unitRisks.length > 1 ? 's' : ''}</span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                          {u.effectif && <span>👥 {u.effectif} salarié{u.effectif > 1 ? 's' : ''}</span>}
                          {u.metiers && <span>💼 {u.metiers}</span>}
                          {u.description && <span className="text-gray-400">{u.description}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        <button onClick={() => { setShowAiUnitModal(u.id); setAiUnitDescription(''); setAiResult(null) }}
                          className="p-1.5 rounded hover:bg-purple-50 text-gray-400 hover:text-purple-600" title="IA : analyser cette unité">
                          <Bot className="w-4 h-4" />
                        </button>
                        <button onClick={() => { setActiveTab('risks'); setRiskFilter({ ...riskFilter, unit: u.id }) }}
                          className="p-1.5 rounded hover:bg-amber-50 text-gray-400 hover:text-amber-600" title="Voir les risques">
                          <AlertTriangle className="w-4 h-4" />
                        </button>
                        <button onClick={() => { setEditingUnit(u.id); setUnitForm({ code: u.code, name: u.name, description: u.description, effectif: u.effectif || '', metiers: u.metiers }) }}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-400"><Edit className="w-4 h-4" /></button>
                        <button onClick={() => deleteUnit(u.id)}
                          className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ═══ MODAL IA — Analyse complète unité (Mode 2) ═══ */}
          {showAiUnitModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) { setShowAiUnitModal(null); setAiResult(null) } }}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-purple-50 to-amber-50">
                  <div className="flex items-center gap-2">
                    <Bot className="w-6 h-6 text-purple-600" />
                    <div>
                      <h3 className="font-bold text-gray-900">IA — Analyse de l'unité</h3>
                      <p className="text-xs text-gray-500">{units.find(u => u.id === showAiUnitModal)?.name || ''}</p>
                    </div>
                  </div>
                  <button onClick={() => { setShowAiUnitModal(null); setAiResult(null) }} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                  {/* Zone de saisie description terrain */}
                  {!aiResult && (
                    <div>
                      <label className="text-sm font-medium text-gray-700 block mb-2">
                        📝 Décrivez ce que vous observez dans cette unité de travail
                      </label>
                      <textarea value={aiUnitDescription} onChange={e => setAiUnitDescription(e.target.value)}
                        rows={6} autoFocus
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-purple-400 focus:ring-1 focus:ring-purple-200 transition"
                        placeholder={"Exemple : Les salariés réceptionnent les palettes avec un transpalette manuel. Le sol est irrégulier avec des trous devant le quai. Pas de zone de déchargement balisée. Les cartons lourds (+15kg) sont portés à la main jusqu'aux racks. Les racks font 3 mètres de haut, ils utilisent un escabeau en mauvais état pour les niveaux hauts. Éclairage faible dans le fond de la réserve. Produits chimiques de nettoyage stockés à côté des denrées alimentaires..."} />
                      <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> Plus votre description est détaillée, plus l'IA sera précise.
                        Décrivez les lieux, équipements, gestes, ambiance, organisation...
                      </p>
                      <button onClick={() => evaluateUnitWithAI(showAiUnitModal)} disabled={aiLoading || !aiUnitDescription.trim()}
                        className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition">
                        {aiLoading ? <><Loader2 className="w-5 h-5 animate-spin" /> Analyse en cours...</>
                          : <><Bot className="w-5 h-5" /> Lancer l'analyse IA</>}
                      </button>
                    </div>
                  )}

                  {/* Résultats IA */}
                  {aiResult?.mode === 'unit' && (
                    <div>
                      {aiResult.analyse_resume && (
                        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-4">
                          <p className="text-sm text-purple-800 flex items-center gap-2">
                            <Sparkles className="w-4 h-4 shrink-0" />
                            {aiResult.analyse_resume}
                          </p>
                        </div>
                      )}
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold text-sm text-gray-900">{aiResult.risques?.length || 0} risques identifiés par l'IA</h4>
                        <button onClick={() => setAiResult(null)} className="text-xs text-gray-400 hover:underline">← Modifier la description</button>
                      </div>
                      <div className="space-y-3">
                        {(aiResult.risques || []).map((r, idx) => {
                          const scores = { brut: (r.frequence || 0) * (r.gravite || 0), residuel: (r.frequence || 0) * (r.gravite || 0) * (r.maitrise || 1) }
                          const lvl = getRiskLevel(scores.residuel || scores.brut)
                          const cat = categories.find(c => c.code === r.category_code)
                          return (
                            <div key={idx} className={`border rounded-xl p-4 transition ${r._skip ? 'opacity-40 bg-gray-50' : 'bg-white hover:shadow-sm'}`}>
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-wrap items-center gap-2 mb-1">
                                    <input type="checkbox" checked={!r._skip} onChange={e => {
                                      setAiResult(prev => ({
                                        ...prev,
                                        risques: prev.risques.map((x, i) => i === idx ? { ...x, _skip: !e.target.checked } : x)
                                      }))
                                    }} className="rounded text-purple-600" />
                                    {cat && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{cat.icon} {cat.label}</span>}
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${lvl.badge}`}>
                                      F{r.frequence}×G{r.gravite}×M{r.maitrise} = {scores.residuel} ({lvl.label})
                                    </span>
                                  </div>
                                  <h5 className="font-semibold text-sm text-gray-900">{r.danger}</h5>
                                  <p className="text-xs text-gray-500 mt-0.5">{r.situation}</p>
                                  {r.consequences && <p className="text-xs text-red-400 mt-0.5">→ {r.consequences}</p>}
                                  {r.justification && <p className="text-xs text-purple-500 mt-1 italic">💡 {r.justification}</p>}
                                  {r.actions?.length > 0 && (
                                    <div className="mt-2 pl-3 border-l-2 border-purple-200 space-y-1">
                                      {r.actions.map((a, ai) => (
                                        <p key={ai} className="text-xs text-gray-600">
                                          🎯 <strong>{a.action}</strong>
                                          <span className="text-gray-400 ml-1">({a.type_action}, {a.priorite}{a.cout_estime ? `, ~${a.cout_estime}` : ''})</span>
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
                        <button onClick={() => { setShowAiUnitModal(null); setAiResult(null) }}
                          className="px-4 py-2.5 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Annuler</button>
                        <button onClick={() => applyAiUnitResults(showAiUnitModal)}
                          className="px-6 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 flex items-center gap-2">
                          <ThumbsUp className="w-4 h-4" />
                          Créer {(aiResult.risques || []).filter(r => !r._skip).length} risque(s) + actions
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {/* ════════════════════════════════════════════════════════════════ */}
      {activeTab === 'risks' && (
        <div>
          {/* Toolbar filtres */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={riskFilter.search} onChange={e => setRiskFilter({ ...riskFilter, search: e.target.value })}
                placeholder="Rechercher..." className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm" />
            </div>
            <select value={riskFilter.category} onChange={e => setRiskFilter({ ...riskFilter, category: e.target.value })}
              className="px-3 py-2 border rounded-lg text-sm">
              <option value="">Catégorie</option>
              {usedCategories.map(c => <option key={c.code} value={c.code}>{c.icon} {c.label}</option>)}
            </select>
            <select value={riskFilter.unit} onChange={e => setRiskFilter({ ...riskFilter, unit: e.target.value })}
              className="px-3 py-2 border rounded-lg text-sm">
              <option value="">Unité</option>
              <option value="__none__">Sans unité</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
            </select>
            <select value={riskFilter.level} onChange={e => setRiskFilter({ ...riskFilter, level: e.target.value })}
              className="px-3 py-2 border rounded-lg text-sm">
              <option value="">Niveau</option>
              <option value="critique">🔴 Critique</option>
              <option value="eleve">🟠 Élevé</option>
              <option value="moyen">🟡 Moyen</option>
              <option value="faible">🟢 Faible</option>
              <option value="non_evalue">⬜ Non évalué</option>
            </select>
            <div className="flex gap-1">
              <button onClick={() => setShowTemplateLibrary(true)}
                className="flex items-center gap-1 px-3 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700">
                <Plus className="w-4 h-4" /> INRS
              </button>
              <button onClick={addFreeRisk}
                className="flex items-center gap-1 px-3 py-2 bg-gray-600 text-white rounded-lg text-sm hover:bg-gray-700">
                <Plus className="w-4 h-4" /> Libre
              </button>
              <button onClick={() => { setShowAiGeneralModal(true); setAiGeneralDescription(''); setAiResult(null) }}
                className="flex items-center gap-1 px-3 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700">
                <Bot className="w-4 h-4" /> IA Terrain
              </button>
            </div>
          </div>

          {(riskFilter.category || riskFilter.unit || riskFilter.level || riskFilter.search) && (
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-gray-500">{filteredRisks.length}/{risks.length} affiché(s)</span>
              <button onClick={() => setRiskFilter({ category: '', unit: '', level: '', search: '' })}
                className="text-xs text-amber-600 hover:underline">Réinitialiser</button>
            </div>
          )}

          {filteredRisks.length === 0 ? (
            <div className="bg-white rounded-xl border p-8 text-center">
              <AlertTriangle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">{risks.length === 0 ? 'Aucun risque — ajoutez depuis la bibliothèque INRS' : 'Aucun risque ne correspond aux filtres'}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRisks.map(r => {
                const scores = computeDisplayScores(r)
                const lvlBrut = getRiskLevel(scores.brut)
                const lvlRes = getRiskLevel(scores.residuel)
                const unit = units.find(u => u.id === r.unit_id)
                const cat = categories.find(c => c.code === r.category_code)
                const isEditing = editingRisk === r.id

                return (
                  <div key={r.id} className={`bg-white rounded-xl border shadow-sm transition ${isEditing ? 'ring-2 ring-amber-400' : 'hover:shadow-md'}`}>
                    <div className="p-4">
                      {/* En-tête */}
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            {cat && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{cat.icon} {cat.label}</span>}
                            {unit && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{unit.code}</span>}
                            {scores.brut > 0 && (<>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${lvlBrut.badge}`}>Brut {scores.brut}</span>
                              {r.maitrise && r.maitrise < 1 && (
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${lvlRes.badge}`}>Résiduel {scores.residuel}</span>
                              )}
                            </>)}
                          </div>
                          <h4 className="font-semibold text-gray-900 text-sm">{r.danger || 'Risque sans titre'}</h4>
                          {r.situation && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{r.situation}</p>}
                          {r.prevention_existante && !isEditing && (
                            <p className="text-xs text-green-600 mt-0.5 line-clamp-1">🛡️ {r.prevention_existante}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 ml-2 shrink-0">
                          <button onClick={() => {
                            if (aiRiskId === r.id) { setAiRiskId(null); setAiDescription(''); setAiResult(null) }
                            else { setAiRiskId(r.id); setAiDescription(''); setAiResult(null) }
                          }}
                            className={`p-1.5 rounded ${aiRiskId === r.id ? 'bg-purple-100 text-purple-700' : 'hover:bg-purple-50 text-gray-400 hover:text-purple-600'}`}
                            title="IA : évaluer ce risque">
                            <Bot className="w-4 h-4" />
                          </button>
                          <button onClick={() => setEditingRisk(isEditing ? null : r.id)}
                            className={`p-1.5 rounded ${isEditing ? 'bg-amber-100 text-amber-700' : 'hover:bg-gray-100 text-gray-400'}`}>
                            <Edit className="w-4 h-4" />
                          </button>
                          <button onClick={() => deleteRisk(r.id)}
                            className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* ═══ COTATION TACTILE iPad-friendly ═══ */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-1 block">Fréquence</label>
                          <div className="grid grid-cols-4 gap-1">
                            {FREQUENCE_LABELS.map(f => (
                              <button key={f.value} onClick={() => updateRiskField(r.id, 'frequence', f.value)}
                                className={`py-2.5 px-1 rounded-lg border-2 text-center transition-all touch-manipulation ${
                                  r.frequence === f.value ? `${f.color} font-bold shadow-sm scale-[1.02]` : 'border-gray-200 text-gray-400 hover:border-gray-300'
                                }`} title={`${f.label} — ${f.desc}`}>
                                <span className="block text-lg leading-none">{f.short}</span>
                                <span className="block text-[8px] mt-0.5 leading-tight">{f.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-1 block">Gravité</label>
                          <div className="grid grid-cols-4 gap-1">
                            {GRAVITE_LABELS.map(g => (
                              <button key={g.value} onClick={() => updateRiskField(r.id, 'gravite', g.value)}
                                className={`py-2.5 px-1 rounded-lg border-2 text-center transition-all touch-manipulation ${
                                  r.gravite === g.value ? `${g.color} font-bold shadow-sm scale-[1.02]` : 'border-gray-200 text-gray-400 hover:border-gray-300'
                                }`} title={`${g.label} — ${g.desc}`}>
                                <span className="block text-lg leading-none">{g.short}</span>
                                <span className="block text-[8px] mt-0.5 leading-tight">{g.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-1 block">Maîtrise</label>
                          <div className="grid grid-cols-3 gap-1">
                            {MAITRISE_LABELS.map(m => (
                              <button key={m.value} onClick={() => updateRiskField(r.id, 'maitrise', m.value)}
                                className={`py-2.5 px-1 rounded-lg border-2 text-center transition-all touch-manipulation ${
                                  r.maitrise === m.value ? `${m.color} font-bold shadow-sm scale-[1.02]` : 'border-gray-200 text-gray-400 hover:border-gray-300'
                                }`} title={m.desc}>
                                <span className="block text-sm leading-none font-medium">{m.value === 0.5 ? '×0.5' : m.value === 0.75 ? '×0.75' : '×1'}</span>
                                <span className="block text-[8px] mt-0.5 leading-tight">{m.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* ═══ PANNEAU IA — Évaluation risque (Mode 1) ═══ */}
                      {aiRiskId === r.id && (
                        <div className="mt-3 p-4 bg-gradient-to-r from-purple-50 to-amber-50 rounded-xl border border-purple-200">
                          <div className="flex items-center gap-2 mb-3">
                            <Bot className="w-5 h-5 text-purple-600" />
                            <span className="font-semibold text-sm text-purple-800">IA — Évaluation de ce risque</span>
                          </div>

                          {!aiResult?.riskId && (
                            <>
                              <textarea value={aiDescription} onChange={e => setAiDescription(e.target.value)}
                                rows={3} autoFocus
                                className="w-full px-3 py-2 border border-purple-200 rounded-lg text-sm bg-white focus:border-purple-400 focus:ring-1 focus:ring-purple-200"
                                placeholder="Décrivez la situation terrain : ce que vous voyez, les gestes, les équipements, les incidents passés..." />
                              <div className="flex items-center justify-between mt-2">
                                <p className="text-[10px] text-gray-400 flex items-center gap-1">
                                  <Sparkles className="w-3 h-3" /> L'IA cotera F/G/M et proposera des actions
                                </p>
                                <button onClick={() => evaluateRiskWithAI(r)} disabled={aiLoading}
                                  className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2">
                                  {aiLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Analyse...</>
                                    : <><Bot className="w-4 h-4" /> Évaluer</>}
                                </button>
                              </div>
                            </>
                          )}

                          {aiResult?.riskId === r.id && (
                            <div className="space-y-3">
                              {/* Scores proposés */}
                              <div className="grid grid-cols-3 gap-2">
                                <div className="bg-white rounded-lg p-2 text-center border">
                                  <div className="text-lg font-bold text-gray-900">F={aiResult.frequence}</div>
                                  <p className="text-[10px] text-gray-500">{aiResult.justification?.frequence}</p>
                                </div>
                                <div className="bg-white rounded-lg p-2 text-center border">
                                  <div className="text-lg font-bold text-gray-900">G={aiResult.gravite}</div>
                                  <p className="text-[10px] text-gray-500">{aiResult.justification?.gravite}</p>
                                </div>
                                <div className="bg-white rounded-lg p-2 text-center border">
                                  <div className="text-lg font-bold text-gray-900">M=×{aiResult.maitrise}</div>
                                  <p className="text-[10px] text-gray-500">{aiResult.justification?.maitrise}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 text-sm">
                                {(() => {
                                  const b = aiResult.frequence * aiResult.gravite
                                  const res = b * aiResult.maitrise
                                  const lvl = getRiskLevel(res)
                                  return <span className={`px-3 py-1 rounded-full font-medium text-xs ${lvl.badge}`}>
                                    Brut {b} → Résiduel {res} ({lvl.label})
                                  </span>
                                })()}
                              </div>

                              {/* Actions proposées */}
                              {aiResult.actions?.length > 0 && (
                                <div>
                                  <h5 className="text-xs font-semibold text-gray-700 mb-1">🎯 Actions proposées :</h5>
                                  <div className="space-y-1">
                                    {aiResult.actions.map((a, i) => (
                                      <div key={i} className="bg-white rounded-lg p-2 border text-xs">
                                        <strong>{a.action}</strong>
                                        <span className="text-gray-400 ml-1">({a.type_action}, {a.priorite}{a.cout_estime ? `, ~${a.cout_estime}` : ''})</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="flex justify-end gap-2 pt-2">
                                <button onClick={() => { setAiResult(null); setAiDescription('') }}
                                  className="px-3 py-2 text-gray-500 hover:bg-gray-100 rounded-lg text-sm flex items-center gap-1">
                                  <RefreshCw className="w-3.5 h-3.5" /> Réessayer
                                </button>
                                <button onClick={() => { setAiRiskId(null); setAiResult(null); setAiDescription('') }}
                                  className="px-3 py-2 text-gray-500 hover:bg-gray-100 rounded-lg text-sm">
                                  Ignorer
                                </button>
                                <button onClick={() => applyAiRiskResult(r)}
                                  className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 flex items-center gap-2">
                                  <ThumbsUp className="w-4 h-4" /> Appliquer cotation + actions
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ═══ ÉDITION DÉTAILLÉE ═══ */}
                      {isEditing && (
                        <div className="mt-4 pt-4 border-t border-dashed border-gray-200 space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs text-gray-500">Danger / Risque identifié</label>
                              <input value={r.danger || ''} onChange={e => {
                                setRisks(prev => prev.map(x => x.id === r.id ? { ...x, danger: e.target.value } : x))
                              }} className="w-full px-3 py-2 border rounded-lg text-sm" />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500">Unité de travail</label>
                              <select value={r.unit_id || ''} onChange={e => updateRiskField(r.id, 'unit_id', e.target.value || null)}
                                className="w-full px-3 py-2 border rounded-lg text-sm">
                                <option value="">— Aucune —</option>
                                {units.map(u => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-gray-500">Description du travail réalisé</label>
                              <textarea value={r.description_travail || ''} rows={2} onChange={e => {
                                setRisks(prev => prev.map(x => x.id === r.id ? { ...x, description_travail: e.target.value } : x))
                              }} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Décolisage, mise en rayon..." />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500">Situations à risque</label>
                              <textarea value={r.situation || ''} rows={2} onChange={e => {
                                setRisks(prev => prev.map(x => x.id === r.id ? { ...x, situation: e.target.value } : x))
                              }} className="w-full px-3 py-2 border rounded-lg text-sm" />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500">Conséquences</label>
                              <textarea value={r.consequences || ''} rows={2} onChange={e => {
                                setRisks(prev => prev.map(x => x.id === r.id ? { ...x, consequences: e.target.value } : x))
                              }} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Brûlures, TMS, fractures..." />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500">Prévention existante</label>
                              <textarea value={r.prevention_existante || ''} rows={2} onChange={e => {
                                setRisks(prev => prev.map(x => x.id === r.id ? { ...x, prevention_existante: e.target.value } : x))
                              }} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Mesures déjà en place..." />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="text-xs text-gray-500">Notes terrain</label>
                              <textarea value={r.notes || ''} rows={2} onChange={e => {
                                setRisks(prev => prev.map(x => x.id === r.id ? { ...x, notes: e.target.value } : x))
                              }} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Observations visite..." />
                            </div>
                          </div>
                          <div className="flex justify-between">
                            <button onClick={() => {
                              setEditingAction('new')
                              setActionForm({ statut: 'a_faire', priorite: 'haute', type_action: 'prevention', risk_id: r.id, action: '' })
                              setActiveTab('actions')
                            }} className="text-xs text-amber-600 hover:underline flex items-center gap-1">
                              <Target className="w-3.5 h-3.5" /> Créer une action pour ce risque
                            </button>
                            <div className="flex gap-2">
                              <button onClick={() => setEditingRisk(null)} className="px-3 py-1.5 text-gray-500 hover:bg-gray-100 rounded-lg text-sm">Fermer</button>
                              <button onClick={() => saveRisk(risks.find(x => x.id === r.id))}
                                className="px-4 py-1.5 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 flex items-center gap-1">
                                <Save className="w-3.5 h-3.5" /> Enregistrer
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Modal bibliothèque INRS */}
          {showTemplateLibrary && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setShowTemplateLibrary(false) }}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b">
                  <div>
                    <h3 className="font-bold text-gray-900">Bibliothèque de risques INRS</h3>
                    <p className="text-xs text-gray-500">{filteredTemplates.length} disponibles (déjà ajoutés masqués)</p>
                  </div>
                  <button onClick={() => setShowTemplateLibrary(false)} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
                </div>
                <div className="px-6 pt-3 flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input value={templateSearch} onChange={e => setTemplateSearch(e.target.value)}
                      placeholder="Rechercher..." className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm" autoFocus />
                  </div>
                  <select value={templateCatFilter} onChange={e => setTemplateCatFilter(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm">
                    <option value="">Toutes familles</option>
                    {categories.map(c => <option key={c.code} value={c.code}>{c.icon} {c.label}</option>)}
                  </select>
                </div>
                <div className="flex-1 overflow-y-auto p-6 pt-3">
                  {filteredTemplates.length === 0 ? (
                    <p className="text-center text-gray-400 py-8">Aucun risque type disponible</p>
                  ) : (
                    <div className="space-y-2">
                      {filteredTemplates.map(t => {
                        const cat = categories.find(c => c.code === t.category_code)
                        return (
                          <div key={t.id} className="flex items-start justify-between p-3 rounded-lg border hover:bg-amber-50 hover:border-amber-200 transition">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                {cat && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{cat.icon} {cat.label}</span>}
                                <span className="font-medium text-sm text-gray-900">{t.label}</span>
                              </div>
                              {t.situations && <p className="text-xs text-gray-500 line-clamp-2">{t.situations}</p>}
                              {t.consequences && <p className="text-xs text-red-400 line-clamp-1 mt-0.5">→ {t.consequences}</p>}
                            </div>
                            <button onClick={() => addRiskFromTemplate(t)}
                              className="ml-3 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs hover:bg-amber-700 shrink-0">
                              + Ajouter
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ═══ MODAL IA — Saisie libre générale (Mode 3) ═══ */}
          {showAiGeneralModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) { setShowAiGeneralModal(false); setAiResult(null) } }}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-purple-50 to-amber-50">
                  <div className="flex items-center gap-2">
                    <Bot className="w-6 h-6 text-purple-600" />
                    <div>
                      <h3 className="font-bold text-gray-900">IA — Observations terrain libres</h3>
                      <p className="text-xs text-gray-500">Décrivez tout ce que vous voyez, l'IA identifie et ventile les risques par unité</p>
                    </div>
                  </div>
                  <button onClick={() => { setShowAiGeneralModal(false); setAiResult(null) }} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                  {!aiResult?.mode && (
                    <div>
                      <textarea value={aiGeneralDescription} onChange={e => setAiGeneralDescription(e.target.value)}
                        rows={8} autoFocus
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-purple-400 focus:ring-1 focus:ring-purple-200 transition"
                        placeholder={"Dictez ou notez vos observations en vrac, même si ça concerne plusieurs zones/unités.\n\nExemple : En arrivant j'ai remarqué que le parking n'est pas éclairé le soir. À la caisse, les salariées sont assises sur des chaises non ergonomiques, elles se plaignent de maux de dos. En réserve, les produits chimiques ne sont pas dans une armoire ventilée. Il y a un escabeau bancal. Le four en cuisine n'a pas de gant anti-chaleur à proximité. Les cartons arrivent par palette de 800kg et sont déchargés à la main..."} />
                      <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> L'IA créera les risques et les rattachera aux bonnes unités, ou proposera de nouvelles unités si nécessaire.
                      </p>
                      <button onClick={evaluateGeneralWithAI} disabled={aiLoading || !aiGeneralDescription.trim()}
                        className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition">
                        {aiLoading ? <><Loader2 className="w-5 h-5 animate-spin" /> Analyse en cours...</>
                          : <><Bot className="w-5 h-5" /> Analyser mes observations</>}
                      </button>
                    </div>
                  )}

                  {aiResult?.mode === 'general' && (
                    <div>
                      {aiResult.analyse_resume && (
                        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-4">
                          <p className="text-sm text-purple-800 flex items-center gap-2"><Sparkles className="w-4 h-4 shrink-0" /> {aiResult.analyse_resume}</p>
                        </div>
                      )}
                      {aiResult.nouvelles_unites?.length > 0 && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                          <p className="text-xs font-medium text-blue-800 mb-1">🏢 Nouvelles unités proposées :</p>
                          {aiResult.nouvelles_unites.map((nu, i) => (
                            <span key={i} className="inline-block text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded mr-1 mb-1">{nu.code} — {nu.name}</span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold text-sm">{aiResult.risques?.length || 0} risques identifiés</h4>
                        <button onClick={() => setAiResult(null)} className="text-xs text-gray-400 hover:underline">← Modifier</button>
                      </div>
                      <div className="space-y-3">
                        {(aiResult.risques || []).map((r, idx) => {
                          const scores = { brut: (r.frequence||0) * (r.gravite||0), residuel: (r.frequence||0) * (r.gravite||0) * (r.maitrise||1) }
                          const lvl = getRiskLevel(scores.residuel || scores.brut)
                          const cat = categories.find(c => c.code === r.category_code)
                          const unitName = units.find(u => u.code === r.unit_code)?.name || r.unit_code || '?'
                          return (
                            <div key={idx} className={`border rounded-xl p-4 transition ${r._skip ? 'opacity-40 bg-gray-50' : 'bg-white hover:shadow-sm'}`}>
                              <div className="flex items-start gap-2">
                                <input type="checkbox" checked={!r._skip} onChange={e => {
                                  setAiResult(prev => ({ ...prev, risques: prev.risques.map((x, i) => i === idx ? { ...x, _skip: !e.target.checked } : x) }))
                                }} className="mt-1 rounded text-purple-600" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-wrap items-center gap-2 mb-1">
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">📍 {unitName}</span>
                                    {cat && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{cat.label}</span>}
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${lvl.badge}`}>{lvl.label} ({scores.residuel})</span>
                                  </div>
                                  <h5 className="font-semibold text-sm text-gray-900">{r.danger}</h5>
                                  <p className="text-xs text-gray-500 mt-0.5">{r.situation}</p>
                                  {r.actions?.map((a, ai) => (
                                    <p key={ai} className="text-xs text-gray-600 mt-1">🎯 <strong>{a.action}</strong> <span className="text-gray-400">({a.type_action}, {a.priorite})</span></p>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
                        <button onClick={() => { setShowAiGeneralModal(false); setAiResult(null) }} className="px-4 py-2.5 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Annuler</button>
                        <button onClick={applyAiGeneralResults}
                          className="px-6 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 flex items-center gap-2">
                          <ThumbsUp className="w-4 h-4" /> Tout créer
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* ONGLET 3 : PLAN D'ACTION                                       */}
      {/* ════════════════════════════════════════════════════════════════ */}
      {activeTab === 'actions' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3 flex-wrap">
              {[
                { label: 'Total', value: actionStats.total, color: 'text-gray-700' },
                { label: 'À faire', value: actionStats.a_faire, color: 'text-gray-500' },
                { label: 'En cours', value: actionStats.en_cours, color: 'text-blue-600' },
                { label: 'Fait', value: actionStats.fait, color: 'text-green-600' },
              ].map(s => (
                <span key={s.label} className={`text-sm ${s.color}`}><strong>{s.value}</strong> {s.label}</span>
              ))}
            </div>
            <button onClick={() => { setEditingAction('new'); setActionForm({ statut: 'a_faire', priorite: 'moyenne', type_action: 'prevention' }) }}
              className="flex items-center gap-1 px-3 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700">
              <Plus className="w-4 h-4" /> Nouvelle action
            </button>
          </div>

          {/* Formulaire action */}
          {editingAction && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
              <h4 className="font-medium text-sm mb-3">{editingAction === 'new' ? 'Nouvelle action de prévention' : 'Modifier l\'action'}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-xs text-gray-500">Action de prévention *</label>
                  <textarea value={actionForm.action || ''} rows={2}
                    onChange={e => setActionForm({ ...actionForm, action: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Ex: Formation SST, installation garde-corps..." />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Type d'action</label>
                  <select value={actionForm.type_action || 'prevention'} onChange={e => setActionForm({ ...actionForm, type_action: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    {ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Priorité</label>
                  <select value={actionForm.priorite || 'moyenne'} onChange={e => setActionForm({ ...actionForm, priorite: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    {ACTION_PRIORITES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Responsable</label>
                  <input value={actionForm.responsable || ''} onChange={e => setActionForm({ ...actionForm, responsable: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Nom / fonction" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Échéance</label>
                  <input type="date" value={actionForm.echeance || ''} onChange={e => setActionForm({ ...actionForm, echeance: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Coût estimé</label>
                  <input value={actionForm.cout_estime || ''} onChange={e => setActionForm({ ...actionForm, cout_estime: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="500€, interne, à chiffrer..." />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Risque lié</label>
                  <select value={actionForm.risk_id || ''} onChange={e => setActionForm({ ...actionForm, risk_id: e.target.value || null })}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="">— Aucun —</option>
                    {risks.map(r => <option key={r.id} value={r.id}>{r.danger}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Formation liée (catalogue Access)</label>
                  <select value={actionForm.course_id || ''} onChange={e => setActionForm({ ...actionForm, course_id: e.target.value || null })}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="">— Aucune —</option>
                    {courses.map(c => <option key={c.id} value={c.id}>🎓 {c.title}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Statut</label>
                  <select value={actionForm.statut || 'a_faire'} onChange={e => setActionForm({ ...actionForm, statut: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    {ACTION_STATUTS.map(s => <option key={s.value} value={s.value}>{s.emoji} {s.label}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-gray-500">Notes</label>
                  <textarea value={actionForm.notes || ''} rows={2}
                    onChange={e => setActionForm({ ...actionForm, notes: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>
              {/* Formations réglementaires suggérées quand risque sélectionné */}
              {actionForm.risk_id && (() => {
                const risk = risks.find(r => r.id === actionForm.risk_id)
                if (!risk?.category_code) return null
                const relatedFormations = formations.filter(f => f.category_code === risk.category_code)
                if (relatedFormations.length === 0) return null
                return (
                  <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-xs font-medium text-blue-800 mb-1">📘 Formations réglementaires liées :</p>
                    {relatedFormations.map(f => (
                      <div key={f.id} className="text-xs text-blue-700 flex items-center gap-2 mt-0.5">
                        <span>🎓 <strong>{f.formation_label}</strong></span>
                        {f.periodicite && <span className="text-blue-500">— {f.periodicite}</span>}
                        {f.reglementation && <span className="text-blue-400 text-[10px]">({f.reglementation})</span>}
                      </div>
                    ))}
                  </div>
                )
              })()}
              <div className="flex justify-end gap-2 mt-3">
                <button onClick={() => { setEditingAction(null); setActionForm({}) }}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Annuler</button>
                <button onClick={saveAction}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 flex items-center gap-1">
                  <Save className="w-4 h-4" /> Enregistrer
                </button>
              </div>
            </div>
          )}

          {/* Liste actions */}
          {actions.length === 0 ? (
            <div className="bg-white rounded-xl border p-8 text-center">
              <Target className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 mb-2">Aucune action de prévention</p>
              <p className="text-xs text-gray-400">Définissez des mesures pour réduire les risques identifiés.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {actions.map(a => {
                const ast = ACTION_STATUTS.find(s => s.value === a.statut) || ACTION_STATUTS[0]
                const pr = ACTION_PRIORITES.find(p => p.value === a.priorite)
                const tp = ACTION_TYPES.find(t => t.value === a.type_action)
                const linkedRisk = risks.find(r => r.id === a.risk_id)
                const linkedCourse = courses.find(c => c.id === a.course_id)
                const isOverdue = a.echeance && a.statut !== 'fait' && a.statut !== 'annule' && new Date(a.echeance) < new Date()

                return (
                  <div key={a.id} className={`bg-white rounded-xl border shadow-sm p-4 ${isOverdue ? 'border-red-300 bg-red-50/30' : ''}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <select value={a.statut || 'a_faire'} onChange={e => updateActionStatus(a.id, e.target.value)}
                            className={`text-xs px-2 py-1 rounded-full font-medium border-0 cursor-pointer ${ast.color}`}>
                            {ACTION_STATUTS.map(s => <option key={s.value} value={s.value}>{s.emoji} {s.label}</option>)}
                          </select>
                          {pr && <span className={`text-[10px] px-1.5 py-0.5 rounded ${pr.color}`}>{pr.label}</span>}
                          {tp && <span className="text-[10px] text-gray-500">{tp.emoji} {tp.label}</span>}
                          {isOverdue && <span className="text-[10px] text-red-600 font-medium">⏰ En retard</span>}
                        </div>
                        <h4 className={`font-semibold text-sm ${a.statut === 'fait' ? 'text-gray-400 line-through' : a.statut === 'annule' ? 'text-gray-400' : 'text-gray-900'}`}>
                          {a.action}
                        </h4>
                        <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-gray-400">
                          {a.responsable && <span>👤 {a.responsable}</span>}
                          {a.echeance && <span>📅 {format(new Date(a.echeance), 'dd/MM/yyyy')}</span>}
                          {a.date_realisation && <span className="text-green-600">✅ Réalisé {format(new Date(a.date_realisation), 'dd/MM/yyyy')}</span>}
                          {a.cout_estime && <span>💰 {a.cout_estime}</span>}
                          {linkedRisk && <span className="text-amber-600">⚠️ {linkedRisk.danger}</span>}
                          {linkedCourse && <span className="text-blue-600">🎓 {linkedCourse.title}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-2 shrink-0">
                        <button onClick={() => {
                          setEditingAction(a.id)
                          setActionForm({
                            action: a.action, type_action: a.type_action, priorite: a.priorite,
                            responsable: a.responsable, echeance: a.echeance, cout_estime: a.cout_estime,
                            date_realisation: a.date_realisation, risk_id: a.risk_id,
                            course_id: a.course_id, statut: a.statut, notes: a.notes,
                          })
                        }} className="p-1.5 rounded hover:bg-gray-100 text-gray-400"><Edit className="w-4 h-4" /></button>
                        <button onClick={() => deleteAction(a.id)}
                          className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Suggestions risques élevés/critiques sans action */}
          {(() => {
            const risksWithoutAction = risks.filter(r => {
              const score = r.risque_residuel || r.risque_brut || 0
              return score > 8 && !actions.some(a => a.risk_id === r.id)
            })
            if (risksWithoutAction.length === 0) return null
            return (
              <div className="mt-6 bg-orange-50 border border-orange-200 rounded-xl p-4">
                <h4 className="font-medium text-sm text-orange-800 mb-2 flex items-center gap-1">
                  <Zap className="w-4 h-4" /> Risques élevés/critiques sans action ({risksWithoutAction.length})
                </h4>
                <div className="space-y-1.5">
                  {risksWithoutAction.slice(0, 8).map(r => {
                    const lvl = getRiskLevel(r.risque_residuel || r.risque_brut)
                    const relatedFormations = formations.filter(f => f.category_code === r.category_code)
                    return (
                      <div key={r.id} className="flex items-center justify-between text-sm bg-white rounded-lg p-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${lvl.badge}`}>{r.risque_residuel || r.risque_brut}</span>
                          <span className="text-gray-700 truncate">{r.danger}</span>
                          {relatedFormations.length > 0 && (
                            <span className="text-[10px] text-blue-600 shrink-0">🎓 {relatedFormations[0].formation_label}</span>
                          )}
                        </div>
                        <button onClick={() => {
                          setEditingAction('new')
                          setActionForm({
                            statut: 'a_faire',
                            priorite: lvl.label === 'Critique' ? 'critique' : 'haute',
                            type_action: relatedFormations.length > 0 ? 'formation' : 'prevention',
                            risk_id: r.id,
                            action: relatedFormations.length > 0 ? relatedFormations[0].formation_label : `Action corrective : ${r.danger}`,
                          })
                        }} className="text-xs text-amber-600 hover:underline shrink-0 ml-2">+ Action</button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* ONGLET 4 : SYNTHÈSE                                            */}
      {/* ════════════════════════════════════════════════════════════════ */}
      {activeTab === 'conformite' && (
        <DuerpConformiteTab
          projectId={id}
          project={project}
          risks={risks}
          units={units}
        />
      )}

      {activeTab === 'synthese' && (
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Risques identifiés', value: riskStats.total, icon: '⚠️', border: 'border-gray-300' },
              { label: 'Évalués', value: `${riskStats.evaluated}/${riskStats.total}`, icon: '📊', border: 'border-blue-400' },
              { label: 'Critiques + Élevés', value: riskStats.critique + riskStats.eleve, icon: '🔴', border: 'border-red-400' },
              { label: 'Actions terminées', value: `${actionStats.fait}/${actionStats.total}`, icon: '✅', border: 'border-green-400' },
            ].map(k => (
              <div key={k.label} className={`bg-white rounded-xl border-l-4 ${k.border} p-4 shadow-sm`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-bold text-gray-900">{k.value}</p>
                    <p className="text-xs text-gray-500">{k.label}</p>
                  </div>
                  <span className="text-2xl">{k.icon}</span>
                </div>
              </div>
            ))}
          </div>

          {/* ═══ IA AUDIT DE COMPLÉTUDE (Mode 4) ═══ */}
          <div className="bg-gradient-to-r from-purple-50 to-amber-50 rounded-xl border border-purple-200 p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                  <Bot className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Audit IA de complétude</h3>
                  <p className="text-xs text-gray-500">L'IA vérifie que vous n'avez rien oublié, basé sur votre secteur et vos unités</p>
                </div>
              </div>
              <button onClick={() => { setShowAiAuditModal(true); setAiResult(null); runAiAudit() }}
                disabled={aiLoading}
                className="px-5 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2">
                {aiLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Analyse...</>
                  : <><Sparkles className="w-4 h-4" /> Vérifier mon DUERP</>}
              </button>
            </div>
          </div>

          {/* ═══ MODAL RÉSULTATS AUDIT ═══ */}
          {showAiAuditModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) { setShowAiAuditModal(false); setAiResult(null) } }}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-purple-50 to-amber-50">
                  <div className="flex items-center gap-2">
                    <Bot className="w-6 h-6 text-purple-600" />
                    <h3 className="font-bold text-gray-900">Audit IA — Complétude du DUERP</h3>
                  </div>
                  <button onClick={() => { setShowAiAuditModal(false); setAiResult(null) }} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                  {aiLoading && (
                    <div className="flex flex-col items-center justify-center py-16">
                      <Loader2 className="w-10 h-10 animate-spin text-purple-600 mb-4" />
                      <p className="text-gray-500 font-medium">L'IA analyse votre DUERP...</p>
                      <p className="text-xs text-gray-400 mt-1">Vérification des {risks.length} risques dans {units.length} unités</p>
                    </div>
                  )}

                  {aiResult?.mode === 'audit' && (
                    <div className="space-y-6">
                      {/* Score de complétude */}
                      <div className="flex items-center gap-6">
                        <div className="relative w-24 h-24">
                          <svg viewBox="0 0 36 36" className="w-24 h-24 transform -rotate-90">
                            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                              fill="none" stroke="#e5e7eb" strokeWidth="3" />
                            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                              fill="none"
                              stroke={aiResult.score_completude >= 80 ? '#22c55e' : aiResult.score_completude >= 50 ? '#f59e0b' : '#ef4444'}
                              strokeWidth="3"
                              strokeDasharray={`${aiResult.score_completude}, 100`} />
                          </svg>
                          <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-gray-900">
                            {aiResult.score_completude}%
                          </span>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm text-gray-700">{aiResult.resume}</p>
                          {aiResult.points_forts?.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {aiResult.points_forts.map((pf, i) => (
                                <p key={i} className="text-xs text-green-600 flex items-center gap-1">
                                  <CheckCircle className="w-3.5 h-3.5 shrink-0" /> {pf}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Manques identifiés */}
                      {aiResult.manques?.length > 0 && (
                        <div>
                          <h4 className="font-semibold text-sm text-gray-900 mb-3">
                            ⚠️ {aiResult.manques.length} manque(s) identifié(s)
                          </h4>
                          <div className="space-y-4">
                            {aiResult.manques.map((m, idx) => {
                              const gravColors = { critique: 'bg-red-50 border-red-300', important: 'bg-orange-50 border-orange-300', mineur: 'bg-yellow-50 border-yellow-300' }
                              const gravBadge = { critique: 'bg-red-100 text-red-700', important: 'bg-orange-100 text-orange-700', mineur: 'bg-yellow-100 text-yellow-700' }
                              return (
                                <div key={idx} className={`rounded-xl border-2 p-4 ${gravColors[m.gravite_manque] || 'bg-gray-50 border-gray-200'}`}>
                                  <div className="flex items-start justify-between mb-2">
                                    <div>
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${gravBadge[m.gravite_manque] || 'bg-gray-100 text-gray-600'}`}>
                                          {m.gravite_manque}
                                        </span>
                                        <span className="text-xs text-gray-400">{m.unite_concernee}</span>
                                      </div>
                                      <h5 className="font-semibold text-sm text-gray-900">{m.titre}</h5>
                                      <p className="text-xs text-gray-600 mt-0.5">{m.explication}</p>
                                    </div>
                                  </div>
                                  {m.risques_suggeres?.length > 0 && (
                                    <div className="mt-3 space-y-2">
                                      <p className="text-xs font-medium text-gray-500">Risques suggérés :</p>
                                      {m.risques_suggeres.map((r, ri) => {
                                        const sc = (r.frequence||0) * (r.gravite||0) * (r.maitrise||1)
                                        const lvl = getRiskLevel(sc)
                                        return (
                                          <div key={ri} className="bg-white rounded-lg p-2 border text-xs flex items-center justify-between">
                                            <div className="flex-1 min-w-0">
                                              <span className="font-medium text-gray-900">{r.danger}</span>
                                              <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${lvl.badge}`}>{lvl.label}</span>
                                              {r.actions?.map((a, ai) => (
                                                <p key={ai} className="text-gray-400 mt-0.5 pl-2">🎯 {a.action}</p>
                                              ))}
                                            </div>
                                          </div>
                                        )
                                      })}
                                      <button onClick={() => applyAuditSuggestion(m)}
                                        className="mt-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 flex items-center gap-1">
                                        <Plus className="w-3.5 h-3.5" /> Ajouter ces {m.risques_suggeres.length} risque(s)
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Recommandations générales */}
                      {aiResult.recommandations_generales?.length > 0 && (
                        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                          <h4 className="font-semibold text-sm text-blue-800 mb-2">💡 Recommandations générales</h4>
                          <ul className="space-y-1">
                            {aiResult.recommandations_generales.map((rec, i) => (
                              <li key={i} className="text-xs text-blue-700 flex items-start gap-1">
                                <span className="mt-1">•</span> {rec}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="flex justify-end pt-4 border-t">
                        <button onClick={() => { setShowAiAuditModal(false); setAiResult(null) }}
                          className="px-5 py-2.5 bg-gray-600 text-white rounded-lg text-sm font-medium hover:bg-gray-700">
                          Fermer
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ═══ EXPORT PDF / EXCEL ═══ */}
          <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-amber-600" /> Exporter le DUERP
                </h3>
                <p className="text-xs text-gray-500 mt-1">Rapport complet avec inventaire, plan d'action et mentions légales</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => {
                  try {
                    generateDuerpPDF({ project, units, risks, actions, categories })
                    toast.success('PDF généré et téléchargé')
                  } catch (err) { console.error(err); toast.error('Erreur génération PDF') }
                }}
                  className="flex items-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">
                  <Download className="w-4 h-4" /> PDF
                </button>
                <button onClick={() => {
                  try {
                    generateDuerpExcel({ project, units, risks, actions, categories })
                    toast.success('Excel généré et téléchargé')
                  } catch (err) { console.error(err); toast.error('Erreur génération Excel') }
                }}
                  className="flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
                  <Download className="w-4 h-4" /> Excel
                </button>
              </div>
            </div>
          </div>

          {/* Matrice F × G */}
          <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-amber-600" /> Matrice Fréquence × Gravité
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-center text-sm">
                <thead>
                  <tr>
                    <th className="p-2 text-xs text-gray-400">F \ G</th>
                    {GRAVITE_LABELS.map(g => <th key={g.value} className="p-2 text-xs text-gray-500">{g.value} — {g.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[...FREQUENCE_LABELS].reverse().map(f => (
                    <tr key={f.value}>
                      <td className="p-2 text-xs text-gray-500 font-medium text-left">{f.value} — {f.label}</td>
                      {GRAVITE_LABELS.map(g => {
                        const score = f.value * g.value
                        const lvl = getRiskLevel(score)
                        const count = risks.filter(r => r.frequence === f.value && r.gravite === g.value).length
                        return (
                          <td key={g.value} className="p-1">
                            <div className={`rounded-lg p-2 min-h-[48px] min-w-[48px] flex items-center justify-center ${
                              count > 0 ? lvl.badge : 'bg-gray-50 text-gray-300'
                            }`}>
                              {count > 0 ? (
                                <div><span className="font-bold text-lg block">{count}</span><span className="text-[9px] opacity-70">= {score}</span></div>
                              ) : <span className="text-xs">{score}</span>}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Risques par catégorie */}
          <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Risques par catégorie</h3>
            {usedCategories.length === 0 ? (
              <p className="text-gray-400 text-sm">Aucune catégorie</p>
            ) : (
              <div className="space-y-2">
                {usedCategories.map(cat => {
                  const catRisks = risks.filter(r => r.category_code === cat.code)
                  const maxScore = Math.max(0, ...catRisks.map(r => r.risque_residuel || r.risque_brut || 0))
                  const lvl = getRiskLevel(maxScore)
                  return (
                    <div key={cat.code} className="flex items-center gap-3">
                      <span className="text-sm shrink-0">{cat.icon}</span>
                      <span className={`w-3 h-3 rounded-full shrink-0 ${lvl.color}`} />
                      <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">{cat.label}</span>
                      <span className="text-sm font-bold text-gray-900">{catRisks.length}</span>
                      <div className="w-24 h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div className={`h-full rounded-full ${lvl.color}`}
                          style={{ width: `${Math.min(100, (catRisks.length / Math.max(1, risks.length)) * 100)}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Risques par unité */}
          <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Risques par unité de travail</h3>
            {units.length === 0 ? (
              <p className="text-gray-400 text-sm">Aucune unité définie</p>
            ) : (
              <div className="space-y-3">
                {units.map(u => {
                  const unitRisks = risks.filter(r => r.unit_id === u.id)
                  const getScore = r => r.risque_residuel || r.risque_brut || 0
                  const crit = unitRisks.filter(r => getScore(r) > 12).length
                  const elev = unitRisks.filter(r => getScore(r) > 8 && getScore(r) <= 12).length
                  const moy = unitRisks.filter(r => getScore(r) > 4 && getScore(r) <= 8).length
                  const faib = unitRisks.filter(r => getScore(r) >= 1 && getScore(r) <= 4).length
                  const ne = unitRisks.filter(r => !r.frequence || !r.gravite).length
                  if (unitRisks.length === 0) return null
                  return (
                    <div key={u.id} className="bg-gray-50 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm text-gray-900">{u.code} — {u.name}</span>
                        <span className="text-xs text-gray-500">{unitRisks.length} risque{unitRisks.length > 1 ? 's' : ''} {u.effectif ? `• 👥 ${u.effectif}` : ''}</span>
                      </div>
                      <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-200">
                        {crit > 0 && <div className="bg-red-500" style={{ width: `${(crit / unitRisks.length) * 100}%` }} />}
                        {elev > 0 && <div className="bg-orange-500" style={{ width: `${(elev / unitRisks.length) * 100}%` }} />}
                        {moy > 0 && <div className="bg-yellow-500" style={{ width: `${(moy / unitRisks.length) * 100}%` }} />}
                        {faib > 0 && <div className="bg-green-500" style={{ width: `${(faib / unitRisks.length) * 100}%` }} />}
                        {ne > 0 && <div className="bg-gray-300" style={{ width: `${(ne / unitRisks.length) * 100}%` }} />}
                      </div>
                    </div>
                  )
                })}
                {(() => {
                  const orphans = risks.filter(r => !r.unit_id)
                  if (orphans.length === 0) return null
                  return (
                    <div className="bg-gray-50 rounded-lg p-3 border-dashed border-2 border-gray-200">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm text-gray-500">⚠️ Sans unité</span>
                        <span className="text-xs text-orange-500 font-medium">{orphans.length} à affecter</span>
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>

          {/* Avancement actions */}
          <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Avancement du plan d'action</h3>
            {actionStats.total === 0 ? (
              <p className="text-gray-400 text-sm">Aucune action définie</p>
            ) : (<>
              <div className="flex h-4 rounded-full overflow-hidden bg-gray-100 mb-3">
                {actionStats.fait > 0 && <div className="bg-green-500 transition-all" style={{ width: `${(actionStats.fait / actionStats.total) * 100}%` }} />}
                {actionStats.en_cours > 0 && <div className="bg-blue-500 transition-all" style={{ width: `${(actionStats.en_cours / actionStats.total) * 100}%` }} />}
                {actionStats.a_faire > 0 && <div className="bg-gray-300 transition-all" style={{ width: `${(actionStats.a_faire / actionStats.total) * 100}%` }} />}
                {actionStats.annule > 0 && <div className="bg-stone-300 transition-all" style={{ width: `${(actionStats.annule / actionStats.total) * 100}%` }} />}
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500" /> {actionStats.fait} terminée{actionStats.fait > 1 ? 's' : ''}</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-500" /> {actionStats.en_cours} en cours</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-gray-300" /> {actionStats.a_faire} à faire</span>
                {actionStats.annule > 0 && <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-stone-300" /> {actionStats.annule} annulée{actionStats.annule > 1 ? 's' : ''}</span>}
              </div>
              <p className="text-2xl font-bold text-gray-900 mt-3">
                {actionStats.total > 0 ? Math.round((actionStats.fait / actionStats.total) * 100) : 0}%
                <span className="text-sm font-normal text-gray-500 ml-2">d'avancement</span>
              </p>
            </>)}
          </div>

          {/* Rappels réglementaires */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <h4 className="font-medium text-sm text-blue-800 mb-2">📘 Rappels réglementaires</h4>
            <div className="text-xs text-blue-700 space-y-1">
              <p>• <strong>Conservation obligatoire 40 ans</strong> (Art. L.4121-3-1 V — loi du 2 août 2021)</p>
              <p>• Mise à jour : {project.effectif && parseInt(project.effectif) >= 11
                ? 'au minimum annuelle (obligatoire ≥11 salariés)'
                : 'recommandée annuellement (<11 salariés)'}, + après aménagement important ou info nouvelle sur les risques</p>
              <p>• Consultation du CSE obligatoire sur le DUERP et ses mises à jour</p>
              <p>• Évaluation : impact différencié selon le sexe (Art. L.4121-3)</p>
              <p>• {parseInt(project.effectif) >= 50
                ? '⚠️ PAPRIPACT obligatoire (≥50 sal.) : programme annuel avec coûts, indicateurs, calendrier'
                : 'Liste des actions de prévention obligatoire dans le DUERP (<50 sal.)'}</p>
              <p>• Transmission médecine du travail à chaque mise à jour</p>
              <p>• Dépôt dématérialisé obligatoire prévu (calendrier échelonné par effectif)</p>
            </div>
          </div>

          {/* Formations réglementaires identifiées */}
          {(() => {
            const riskCats = [...new Set(risks.map(r => r.category_code).filter(Boolean))]
            const relevantFormations = formations.filter(f => riskCats.includes(f.category_code))
            if (relevantFormations.length === 0) return null
            return (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <h4 className="font-medium text-sm text-amber-800 mb-2">🎓 Formations réglementaires identifiées ({relevantFormations.length})</h4>
                <div className="space-y-1.5">
                  {relevantFormations.map(f => {
                    const cat = categories.find(c => c.code === f.category_code)
                    return (
                      <div key={f.id} className="flex items-start gap-2 text-sm bg-white rounded-lg p-2.5">
                        <span className="shrink-0">{cat?.icon || '📋'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900">{f.formation_label}</p>
                          <div className="flex flex-wrap gap-2 text-xs text-gray-500 mt-0.5">
                            {f.periodicite && <span>🔄 {f.periodicite}</span>}
                            {f.reglementation && <span>📕 {f.reglementation}</span>}
                            {f.course_code && <span className="text-amber-600 font-medium">Réf: {f.course_code}</span>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
