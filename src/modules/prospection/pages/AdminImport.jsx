/**
 * ============================================================================
 * PAGE ADMIN - IMPORT PROSPECTS & ENRICHISSEMENT
 * ============================================================================
 *
 * 3 onglets :
 *   1. Import INSEE   — import par tranche d'effectif × département (inchangé)
 *   2. Enrichissement — scraping sites web (inchangé)
 *   3. Import fichier — xlsx/csv → prospection_massive ou clients
 * ============================================================================
 */

import { useState, useRef } from 'react'
import {
  Play, Check, X, Loader, RefreshCw, Square,
  ChevronDown, ChevronUp, Upload, FileSpreadsheet,
  CheckCircle, Trash2
} from 'lucide-react'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx-js-style'
import { supabase } from '../../../core/supabase'
import { useAuthStore } from '../../../core/store'

// ─── Constantes INSEE ─────────────────────────────────────────────────────────

const DEPARTEMENTS = {
  '22': "Côtes-d'Armor", '29': 'Finistère',       '35': 'Ille-et-Vilaine',
  '56': 'Morbihan',      '44': 'Loire-Atlantique', '49': 'Maine-et-Loire',
  '53': 'Mayenne',       '72': 'Sarthe',            '85': 'Vendée',
}

const TRANCHES = [
  { code: '53', label: '10000+ sal.' }, { code: '52', label: '5000-9999' },
  { code: '51', label: '2000-4999' },  { code: '42', label: '1000-1999' },
  { code: '41', label: '500-999' },    { code: '32', label: '250-499' },
  { code: '31', label: '200-249' },    { code: '22', label: '100-199' },
  { code: '21', label: '50-99' },      { code: '12', label: '20-49' },
  { code: '11', label: '10-19' },      { code: '03', label: '6-9' },
  { code: '02', label: '3-5' },        { code: '01', label: '1-2' },
]

// ─── Constantes Import fichier ────────────────────────────────────────────────

const PM_FIELDS = [
  { value: '',                 label: '— Ignorer —' },
  { value: 'name',             label: 'Raison sociale / Nom' },
  { value: 'email',            label: 'Email' },
  { value: 'phone',            label: 'Téléphone' },
  { value: 'siret',            label: 'SIRET' },
  { value: 'siren',            label: 'SIREN' },
  { value: 'address',          label: 'Adresse' },
  { value: 'city',             label: 'Ville' },
  { value: 'postal_code',      label: 'Code postal' },
  { value: 'departement',      label: 'Département' },
  { value: 'naf',              label: 'Code NAF' },
  { value: 'effectif',         label: 'Effectif (code INSEE)' },
  { value: 'site_web',         label: 'Site web' },
  { value: 'dirigeant_nom',    label: 'Nom dirigeant' },
  { value: 'dirigeant_prenom', label: 'Prénom dirigeant' },
  { value: 'enrichment_notes', label: 'Notes' },
]

const CLIENTS_FIELDS = [
  { value: '',            label: '— Ignorer —' },
  { value: 'name',        label: 'Raison sociale / Nom' },
  { value: 'email',       label: 'Email principal' },
  { value: 'mobile',      label: 'Téléphone / Mobile' },
  { value: 'siret',       label: 'SIRET' },
  { value: 'siren',       label: 'SIREN' },
  { value: 'address',     label: 'Adresse' },
  { value: 'city',        label: 'Ville' },
  { value: 'postal_code', label: 'Code postal' },
  { value: 'naf_code',    label: 'Code NAF' },
  { value: 'naf_label',   label: 'Libellé NAF' },
  { value: 'effectif',    label: 'Effectif' },
  { value: 'website',     label: 'Site web' },
  { value: 'notes',       label: 'Notes' },
]

const DETECT_RULES = [
  { keywords: ['raison', 'nom', 'entreprise', 'societe', 'société', 'camping', 'etablissement', 'établissement'], target: 'name' },
  { keywords: ['email', 'mail', 'courriel', 'e-mail'], target: 'email' },
  { keywords: ['tel', 'tél', 'telephone', 'téléphone', 'phone', 'fixe'], target: 'phone' },
  { keywords: ['siret'], target: 'siret' },
  { keywords: ['siren'], target: 'siren' },
  { keywords: ['adresse', 'address'], target: 'address' },
  { keywords: ['ville', 'city', 'commune'], target: 'city' },
  { keywords: ['cp', 'code postal', 'codepostal', 'postal'], target: 'postal_code' },
  { keywords: ['departement', 'département'], target: 'departement' },
  { keywords: ['naf', 'ape'], target: 'naf' },
  { keywords: ['effectif', 'salaries', 'salariés'], target: 'effectif' },
  { keywords: ['site', 'web', 'url', 'internet'], target: 'site_web' },
  { keywords: ['note', 'notes', 'commentaire', 'classement', 'type', 'remarque'], target: 'enrichment_notes' },
  { keywords: ['dirigeant', 'gérant', 'gerant', 'directeur'], target: 'dirigeant_nom' },
  { keywords: ['prenom', 'prénom'], target: 'dirigeant_prenom' },
]

// ─── Normalisation ────────────────────────────────────────────────────────────

function normalizePhone(v) {
  if (!v && v !== 0) return null
  const s = String(v).trim().replace(/[\s.\-()]/g, '').replace(/^0033/, '0').replace(/^\+33/, '0')
  return /^\d{10}$/.test(s) ? s : (s.length >= 8 ? s : null)
}
function normalizeSiret(v) {
  if (!v && v !== 0) return null
  const s = String(v).trim().replace(/[\s.]/g, '')
  return s.length === 14 && /^\d+$/.test(s) ? s : null
}
function normalizeEmail(v) {
  if (!v) return null
  const s = String(v).toLowerCase().trim()
  return s.includes('@') ? s : null
}
function normalizePostalCode(v) {
  if (!v && v !== 0) return null
  const s = String(v).trim().replace(/\s/g, '').padStart(5, '0')
  return /^\d{5}$/.test(s) ? s : String(v).trim()
}
function extractDept(postalCode) {
  if (!postalCode) return null
  const s = String(postalCode).padStart(5, '0')
  return s.startsWith('97') || s.startsWith('98') ? s.slice(0, 3) : s.slice(0, 2)
}
function normalizeUrl(v) {
  if (!v) return null
  const s = String(v).trim()
  if (!s) return null
  return s.startsWith('http') ? s : 'https://' + s
}
function cleanStr(v) {
  if (!v && v !== 0) return null
  return String(v).trim() || null
}

function autoDetect(headers) {
  const used = new Set()
  const mapping = {}
  for (const h of headers) {
    const normalized = String(h).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ').trim()
    let matched = ''
    for (const rule of DETECT_RULES) {
      if (rule.keywords.some(k => normalized.includes(k) || k.includes(normalized))) {
        if (!used.has(rule.target)) { matched = rule.target; used.add(rule.target); break }
      }
    }
    mapping[h] = matched
  }
  return mapping
}

function buildRow(rawRow, mapping, target, globalNaf) {
  const row = {}
  for (const [col, field] of Object.entries(mapping)) {
    if (!field) continue
    const raw = rawRow[col]
    if (field === 'email')                         row[field] = normalizeEmail(raw)
    else if (field === 'phone' || field === 'mobile') row[field] = normalizePhone(raw)
    else if (field === 'siret')                    row[field] = normalizeSiret(raw)
    else if (field === 'siren')                    row[field] = raw ? String(raw).trim().replace(/\s/g, '').slice(0, 9) : null
    else if (field === 'postal_code')              row[field] = normalizePostalCode(raw)
    else if (field === 'site_web' || field === 'website') row[field] = normalizeUrl(raw)
    else if (field === 'enrichment_notes' || field === 'notes') {
      const v = cleanStr(raw)
      if (v) row[field] = row[field] ? `${row[field]} | ${v}` : v
    }
    else row[field] = cleanStr(raw)
  }
  if (!row.departement && row.postal_code) row.departement = extractDept(row.postal_code)
  if (globalNaf && !row.naf) row.naf = globalNaf.trim()
  // Auto-dériver siren depuis siret (9 premiers chiffres)
  if (!row.siren && row.siret && String(row.siret).length >= 9) {
    row.siren = String(row.siret).slice(0, 9)
  }

  if (target === 'prospection_massive') {
    row.enrichment_status = 'pending'; row.enrichment_attempts = 0
    row.contacted = false; row.do_not_call = false; row.is_siege = false
  }
  if (target === 'clients') { row.type = 'prospect'; row.status = 'actif' }
  return row
}

// ─── Composant ────────────────────────────────────────────────────────────────

export default function AdminImport() {
  const { user } = useAuthStore()
  const [activeTab, setActiveTab] = useState('import-api')

  // ── Import INSEE ──
  const [importing, setImporting]           = useState(false)
  const [currentDept, setCurrentDept]       = useState(null)
  const [currentTranche, setCurrentTranche] = useState(null)
  const [deptProgress, setDeptProgress]     = useState({})
  const [totalStats, setTotalStats]         = useState({ recupere: 0, filtre: 0, insere: 0, doublons: 0 })
  const [expandedDepts, setExpandedDepts]   = useState({})
  const [selectedDepts, setSelectedDepts]   = useState(Object.keys(DEPARTEMENTS))
  const stopRef = useRef(false)

  // ── Enrichissement ──
  const [enriching, setEnriching]           = useState(false)
  const [enrichBatchSize, setEnrichBatchSize] = useState(20)
  const [enrichStats, setEnrichStats]       = useState(null)
  const [enrichHistory, setEnrichHistory]   = useState([])

  // ── Import fichier ──
  const fileInputRef = useRef(null)
  const [fileStep, setFileStep]       = useState(0)
  const [groupeTag, setGroupeTag]     = useState('')
  const [fileName, setFileName]       = useState('')
  const [sheets, setSheets]           = useState([])
  const [activeSheet, setActiveSheet] = useState('')
  const [rawHeaders, setRawHeaders]   = useState([])
  const [rawRows, setRawRows]         = useState([])
  const [colMapping, setColMapping]   = useState({})
  const [targetTable, setTargetTable] = useState('prospection_massive')
  const [globalNaf, setGlobalNaf]     = useState('')
  const [builtRows, setBuiltRows]     = useState([])
  const [duplicates, setDuplicates]   = useState([])
  const [newRows, setNewRows]         = useState([])
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0, errors: 0 })
  const [importLog, setImportLog]     = useState(null)

  // ════════════════════════ IMPORT INSEE ════════════════════════

  function toggleDept(code) {
    setSelectedDepts(prev => prev.includes(code) ? prev.filter(d => d !== code) : [...prev, code])
  }
  function toggleExpand(code) { setExpandedDepts(prev => ({ ...prev, [code]: !prev[code] })) }

  async function importTrancheForDept(dept, trancheCode) {
    try {
      const response = await fetch('/api/import-departement', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departement: dept, tranche_effectif: trancheCode })
      })
      return await response.json()
    } catch (error) { return { success: false, error: error.message } }
  }

  async function lancerImport() {
    setImporting(true); stopRef.current = false
    setDeptProgress({}); setTotalStats({ recupere: 0, filtre: 0, insere: 0, doublons: 0 })
    const deptsToImport = selectedDepts.sort()
    toast(`🚀 Import lancé : ${deptsToImport.length} départements × ${TRANCHES.length} tranches`, { duration: 5000 })
    let grandTotal = { recupere: 0, filtre: 0, insere: 0, doublons: 0 }
    for (const dept of deptsToImport) {
      if (stopRef.current) break
      setCurrentDept(dept); setExpandedDepts(prev => ({ ...prev, [dept]: true }))
      setDeptProgress(prev => ({ ...prev, [dept]: { status: 'loading', tranches: {}, total: { recupere: 0, filtre: 0, insere: 0 } } }))
      let deptTotal = { recupere: 0, filtre: 0, insere: 0, doublons: 0 }
      for (const tranche of TRANCHES) {
        if (stopRef.current) break
        setCurrentTranche(tranche.code)
        setDeptProgress(prev => ({ ...prev, [dept]: { ...prev[dept], tranches: { ...prev[dept].tranches, [tranche.code]: { status: 'loading' } } } }))
        const result = await importTrancheForDept(dept, tranche.code)
        if (result.success) {
          deptTotal.recupere += result.recupere || 0; deptTotal.filtre += result.filtre || 0
          deptTotal.insere   += result.insere   || 0; deptTotal.doublons += result.doublons || 0
          setDeptProgress(prev => ({ ...prev, [dept]: { ...prev[dept],
            tranches: { ...prev[dept].tranches, [tranche.code]: { status: 'success', recupere: result.recupere||0, filtre: result.filtre||0, insere: result.insere||0 } },
            total: { ...deptTotal }
          }}))
        } else {
          setDeptProgress(prev => ({ ...prev, [dept]: { ...prev[dept], tranches: { ...prev[dept].tranches, [tranche.code]: { status: 'error', error: result.error } } } }))
        }
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      grandTotal.recupere += deptTotal.recupere; grandTotal.filtre += deptTotal.filtre
      grandTotal.insere += deptTotal.insere; grandTotal.doublons += deptTotal.doublons
      setTotalStats({ ...grandTotal })
      setDeptProgress(prev => ({ ...prev, [dept]: { ...prev[dept], status: stopRef.current ? 'stopped' : 'success' } }))
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    setCurrentDept(null); setCurrentTranche(null); setImporting(false)
    stopRef.current ? toast('⏹ Import arrêté', { duration: 3000 }) : toast.success(`✅ Import terminé ! ${grandTotal.insere.toLocaleString()} prospects insérés`)
  }

  function arreterImport() { stopRef.current = true; toast('⏹ Arrêt demandé, fin de la tranche en cours...', { duration: 3000 }) }

  // ════════════════════════ ENRICHISSEMENT ════════════════════════

  async function lancerEnrichissement() {
    setEnriching(true); setEnrichStats(null); toast('🔍 Enrichissement lancé...', { duration: 3000 })
    try {
      const response = await fetch('/api/enrich-prospects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch_size: enrichBatchSize }) })
      const data = await response.json()
      setEnrichStats(data); setEnrichHistory(prev => [...prev, data])
      data.success ? toast.success(data.message) : toast.error('Erreur: ' + (data.error || 'inconnue'))
    } catch (error) { toast.error('Erreur: ' + error.message) }
    setEnriching(false)
  }

  async function lancerEnrichissementBoucle() {
    setEnriching(true); setEnrichHistory([]); toast('🔄 Enrichissement en boucle (5 batchs)...', { duration: 5000 })
    for (let i = 0; i < 5; i++) {
      try {
        const response = await fetch('/api/enrich-prospects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch_size: enrichBatchSize }) })
        const data = await response.json()
        setEnrichStats(data); setEnrichHistory(prev => [...prev, data])
        if (!data.success || data.stats?.total === 0) break
        await new Promise(resolve => setTimeout(resolve, 2000))
      } catch (error) { toast.error('Erreur batch ' + (i + 1) + ': ' + error.message); break }
    }
    toast.success('✅ Enrichissement en boucle terminé !'); setEnriching(false)
  }

  // ════════════════════════ IMPORT FICHIER ════════════════════════

  function resetFileImport() {
    setFileStep(0); setFileName(''); setSheets([]); setActiveSheet('')
    setRawHeaders([]); setRawRows([]); setColMapping({}); setTargetTable('prospection_massive'); setGroupeTag('')
    setGlobalNaf(''); setBuiltRows([]); setDuplicates([]); setNewRows([])
    setImportProgress({ done: 0, total: 0, errors: 0 }); setImportLog(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext)) { toast.error('Format non supporté (xlsx, xls, csv)'); return }
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' })
        setSheets(wb.SheetNames)
        // Auto-sélectionner la feuille avec le plus de lignes (évite les feuilles README/Lisez-moi)
        let bestSheet = wb.SheetNames[0]
        let bestCount = 0
        for (const sName of wb.SheetNames) {
          const n = XLSX.utils.sheet_to_json(wb.Sheets[sName], { defval: '' }).length
          if (n > bestCount) { bestCount = n; bestSheet = sName }
        }
        loadSheetFromWb(wb, bestSheet)
        setFileStep(1)
      } catch (err) { toast.error('Erreur lecture fichier : ' + err.message) }
    }
    reader.readAsArrayBuffer(file)
  }

  function loadSheetFromWb(wb, sheetName) {
    setActiveSheet(sheetName)
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
    if (rows.length === 0) { toast.error('Feuille vide'); return }
    const headers = Object.keys(rows[0])
    setRawHeaders(headers); setRawRows(rows); setColMapping(autoDetect(headers))
  }

  function handleSheetChange(sheetName) {
    const file = fileInputRef.current?.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' })
      loadSheetFromWb(wb, sheetName)
    }
    reader.readAsArrayBuffer(file)
  }

  async function checkDuplicates() {
    if (!rawRows.length) { toast.error('Aucune donnée'); return }
    const built = rawRows.map(row => buildRow(row, colMapping, targetTable, globalNaf))
    setBuiltRows(built)
    const sirets = [...new Set(built.map(r => r.siret).filter(Boolean))]
    const emails = [...new Set(built.map(r => r.email).filter(Boolean))]
    toast.loading('Vérification des doublons...', { id: 'dedup' })
    let existingSirets = new Set(); let existingEmails = new Set()
    try {
      if (sirets.length > 0) {
        const { data } = await supabase.from(targetTable).select('siret').in('siret', sirets)
        ;(data || []).forEach(r => existingSirets.add(r.siret))
      }
      if (emails.length > 0) {
        const { data } = await supabase.from(targetTable).select('email').in('email', emails)
        ;(data || []).forEach(r => existingEmails.add(r.email))
      }
    } catch (err) { toast.error('Erreur vérification : ' + err.message, { id: 'dedup' }); return }
    toast.dismiss('dedup')
    const dups = []; const fresh = []
    built.forEach((row, idx) => {
      const siretMatch = row.siret && existingSirets.has(row.siret)
      const emailMatch = row.email && existingEmails.has(row.email)
      if (siretMatch || emailMatch) {
        const reasons = []
        if (siretMatch) reasons.push('SIRET')
        if (emailMatch) reasons.push('Email')
        dups.push({ index: idx, row, reason: reasons.join(' + '), action: 'skip' })
      } else { fresh.push({ index: idx, row }) }
    })
    setDuplicates(dups); setNewRows(fresh); setFileStep(2)
    toast.success(`${fresh.length} nouvelles lignes · ${dups.length} doublon${dups.length > 1 ? 's' : ''}`)
  }

  function setDupAction(idx, action) { setDuplicates(prev => prev.map(d => d.index === idx ? { ...d, action } : d)) }
  function setAllDupAction(action)   { setDuplicates(prev => prev.map(d => ({ ...d, action }))) }

  async function runImport() {
    const allToInsert = newRows.map(r => r.row)
    const toUpdate    = duplicates.filter(d => d.action === 'update').map(d => d.row)

    if (toUpdate.length > 0) {
      const s = toUpdate[0]
    }
    if (duplicates.length > 0) {
    }

    // Déduplication + filtrage intra-fichier
    const seenSirets = new Set()
    const toInsert = allToInsert.filter(row => {
      // Ligne inutilisable : pas de nom, pas de siret, pas d'email
      if (!row.name && !row.siret && !row.email) return false
      if (!row.siret) return true          // pas de SIRET → insérer quand même
      if (seenSirets.has(row.siret)) return false  // doublon intra-fichier → ignorer
      seenSirets.add(row.siret); return true
    })

    const total = toInsert.length + toUpdate.length
    if (total === 0) { toast.error('Rien à importer'); return }
    setFileStep(3); setImportProgress({ done: 0, total, errors: 0 })
    let done = 0; let errors = 0

    // Appliquer le groupe à toutes les lignes si renseigné
    if (groupeTag.trim() && targetTable === 'prospection_massive') {
      toInsert.forEach(r => { r.mailing_groupe = groupeTag.trim() })
    }

    // Insert par batch de 50 (plus petit pour réduire l'impact des erreurs partielles)
    for (let i = 0; i < toInsert.length; i += 50) {
      const chunk = toInsert.slice(i, i + 50)
      try {
        const { error } = await supabase.from(targetTable).insert(chunk)
        if (error) {
          console.error('Insert batch error:', error.message)
          // Fallback : insérer ligne par ligne pour récupérer le maximum
          for (const row of chunk) {
            try {
              const { error: rowErr } = await supabase.from(targetTable).insert(row)
              rowErr ? errors++ : done++
            } catch { errors++ }
          }
        } else { done += chunk.length }
      } catch { errors += chunk.length }
      setImportProgress({ done: done + errors, total, errors })
      await new Promise(r => setTimeout(r, 200))
    }
    // Appliquer le groupe aux mises à jour également
    if (groupeTag.trim() && targetTable === 'prospection_massive') {
      toUpdate.forEach(r => { r.mailing_groupe = groupeTag.trim() })
    }

    for (const row of toUpdate) {
      try {
        const matchField = row.siret ? 'siret' : 'email'
        const matchVal   = row.siret || row.email
        if (!matchVal) { errors++; setImportProgress(p => ({ ...p, done: p.done + 1, errors: p.errors + 1 })); continue }
        // Strip null/undefined : ne jamais écraser des données existantes avec null
        const updatePayload = Object.fromEntries(
          Object.entries(row).filter(([, v]) => v !== null && v !== undefined && v !== '')
        )
        if (Object.keys(updatePayload).length === 0) { done++; setImportProgress({ done: done + errors, total, errors }); continue }
        const { error } = await supabase.from(targetTable).update(updatePayload).eq(matchField, matchVal)
        if (error) { errors++ } else done++
      } catch(e) { errors++ }
      setImportProgress({ done: done + errors, total, errors })
    }
    try {
      await supabase.from('import_logs').insert({
        file_name: fileName, target_table: targetTable,
        naf_code_applied: globalNaf || null, total_rows: rawRows.length,
        inserted: done, updated: toUpdate.length,
        skipped: duplicates.filter(d => d.action === 'skip').length,
        errors, created_by: user?.email || 'admin',
      })
    } catch (err) { console.warn('import_logs failed:', err.message) }
    setImportLog({ inserted: done, updated: toUpdate.length, skipped: duplicates.filter(d => d.action === 'skip').length, errors })
    setFileStep(4)
    errors === 0 ? toast.success(`Import terminé — ${done} ligne${done > 1 ? 's' : ''} traitée${done > 1 ? 's' : ''}`) : toast.error(`Import terminé avec ${errors} erreur${errors > 1 ? 's' : ''}`)
  }

  // ── Calculs ──
  const completedTranches = Object.values(deptProgress).reduce((sum, dept) => sum + Object.values(dept.tranches || {}).filter(t => t.status === 'success' || t.status === 'error').length, 0)
  const totalTranches     = selectedDepts.length * TRANCHES.length
  const progressPercent   = totalTranches > 0 ? Math.round((completedTranches / totalTranches) * 100) : 0
  const availableFields   = targetTable === 'clients' ? CLIENTS_FIELDS : PM_FIELDS

  // ════════════════════════ RENDU ════════════════════════

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">

        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">🔧 Import &amp; Enrichissement</h1>
          <p className="text-gray-600">Import API INSEE, enrichissement sites web, et import depuis fichier</p>
        </div>

        {/* Onglets */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex gap-6">
            {[
              { id: 'import-api',     label: '🌐 Import INSEE' },
              { id: 'enrichissement', label: '🔍 Enrichissement' },
              { id: 'import-fichier', label: '📂 Import fichier' },
            ].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* ══════════════════ ONGLET IMPORT INSEE ══════════════════ */}
        {activeTab === 'import-api' && (
          <>
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4">📍 Départements à importer</h2>
              <div className="flex flex-wrap gap-2 mb-4">
                {Object.entries(DEPARTEMENTS).map(([code, name]) => (
                  <button key={code} onClick={() => toggleDept(code)} disabled={importing}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${selectedDepts.includes(code) ? 'bg-blue-100 text-blue-800 border-2 border-blue-300' : 'bg-gray-100 text-gray-500 border-2 border-transparent'} ${importing ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:opacity-80'}`}
                  >
                    {code} - {name}
                  </button>
                ))}
              </div>
              <div className="text-sm text-gray-500 mb-4">
                {selectedDepts.length} départements × {TRANCHES.length} tranches = {selectedDepts.length * TRANCHES.length} appels API
                <span className="ml-2 text-gray-400">• SCI et auto-entrepreneurs exclus</span>
              </div>
              <div className="flex gap-3">
                {!importing ? (
                  <button onClick={lancerImport} disabled={selectedDepts.length === 0}
                    className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium ${selectedDepts.length === 0 ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                  >
                    <Play className="w-5 h-5" /> Lancer l&apos;import
                  </button>
                ) : (
                  <button onClick={arreterImport} className="flex items-center gap-2 px-6 py-3 rounded-lg font-medium bg-red-600 hover:bg-red-700 text-white">
                    <Square className="w-5 h-5" /> Arrêter
                  </button>
                )}
              </div>
            </div>

            {(importing || completedTranches > 0) && (
              <div className="bg-white rounded-lg shadow p-6 mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold">📊 Progression</h2>
                  <div className="flex items-center gap-4 text-sm">
                    {importing && currentDept && (
                      <span className="text-blue-600 flex items-center gap-1">
                        <Loader className="w-4 h-4 animate-spin" />
                        {DEPARTEMENTS[currentDept]} — {TRANCHES.find(t => t.code === currentTranche)?.label || '...'}
                      </span>
                    )}
                    <span className="font-mono text-gray-600">{completedTranches}/{totalTranches} ({progressPercent}%)</span>
                  </div>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-4 mb-4">
                  <div className="bg-blue-600 h-4 rounded-full transition-all duration-500" style={{ width: `${progressPercent}%` }} />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  {[
                    { label: 'Récupérés API', value: totalStats.recupere, cls: 'bg-blue-50 text-blue-600 text-blue-900' },
                    { label: 'Après filtres',  value: totalStats.filtre,   cls: 'bg-green-50 text-green-600 text-green-900' },
                    { label: 'Nouveaux',        value: totalStats.insere,   cls: 'bg-emerald-50 text-emerald-600 text-emerald-900' },
                    { label: 'Doublons',        value: totalStats.doublons, cls: 'bg-gray-50 text-gray-600 text-gray-700' },
                  ].map(({ label, value, cls }) => {
                    const [bg, label_c, val_c] = cls.split(' ')
                    return (
                      <div key={label} className={`${bg} rounded-lg p-3 text-center`}>
                        <p className={`text-xs ${label_c}`}>{label}</p>
                        <p className={`text-xl font-bold ${val_c}`}>{value.toLocaleString()}</p>
                      </div>
                    )
                  })}
                </div>
                <div className="space-y-2">
                  {Object.entries(DEPARTEMENTS).filter(([code]) => selectedDepts.includes(code)).map(([code, name]) => {
                    const dept = deptProgress[code]
                    if (!dept) return <div key={code} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg text-gray-400"><div className="w-5 h-5" /><span className="font-medium">{code} - {name}</span><span className="text-xs ml-auto">En attente</span></div>
                    const done_t  = Object.values(dept.tranches || {}).filter(t => t.status === 'success').length
                    const err_t   = Object.values(dept.tranches || {}).filter(t => t.status === 'error').length
                    const expanded = expandedDepts[code]
                    return (
                      <div key={code}>
                        <div onClick={() => toggleExpand(code)} className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${dept.status === 'loading' ? 'bg-blue-50' : dept.status === 'success' ? 'bg-green-50' : dept.status === 'stopped' ? 'bg-yellow-50' : 'bg-gray-50'}`}>
                          {dept.status === 'loading' && <Loader className="w-5 h-5 animate-spin text-blue-500" />}
                          {dept.status === 'success' && <Check className="w-5 h-5 text-green-500" />}
                          {dept.status === 'stopped' && <Square className="w-5 h-5 text-yellow-500" />}
                          <span className="font-medium">{code} - {name}</span>
                          <div className="flex items-center gap-2 ml-auto text-sm">
                            {dept.total?.insere > 0 && <span className="text-green-700 font-medium">{dept.total.insere.toLocaleString()} insérés</span>}
                            <span className="text-gray-500">{done_t}/{TRANCHES.length}{err_t > 0 && <span className="text-red-500 ml-1">({err_t} err)</span>}</span>
                            {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                          </div>
                        </div>
                        {expanded && (
                          <div className="ml-8 mt-1 mb-2 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-1">
                            {TRANCHES.map(tranche => {
                              const t = dept.tranches?.[tranche.code]
                              return (
                                <div key={tranche.code} className={`text-xs px-2 py-1.5 rounded text-center ${!t ? 'bg-gray-100 text-gray-400' : t.status === 'loading' ? 'bg-blue-100 text-blue-700' : t.status === 'success' ? (t.insere > 0 ? 'bg-green-100 text-green-800' : 'bg-green-50 text-green-600') : 'bg-red-100 text-red-700'}`}>
                                  <div className="font-medium">{tranche.label}</div>
                                  {t?.status === 'loading' && <Loader className="w-3 h-3 animate-spin mx-auto mt-0.5" />}
                                  {t?.status === 'success' && <div>{t.insere > 0 ? `+${t.insere}` : '0 new'}</div>}
                                  {t?.status === 'error'   && <div>❌</div>}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-6">
              <h3 className="font-semibold text-blue-900 mb-2">💡 Infos</h3>
              <p className="text-sm text-blue-800 mb-1"><strong>Import :</strong> 14 tranches d'effectif par département — SCI et auto-entrepreneurs exclus</p>
              <p className="text-sm text-blue-800 mb-1"><strong>Enrichissement :</strong> Cron automatique à 3h du matin (20 prospects/nuit)</p>
              <p className="text-sm text-blue-800"><strong>Rapport phoning :</strong> Email hebdo chaque lundi à 8h</p>
            </div>
          </>
        )}

        {/* ══════════════════ ONGLET ENRICHISSEMENT ══════════════════ */}
        {activeTab === 'enrichissement' && (
          <>
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold mb-4">🔍 Enrichissement - Scraping Sites Web</h2>
              <p className="text-sm text-gray-600 mb-2">• Scrape les sites web des prospects pour extraire emails &amp; téléphones</p>
              <p className="text-sm text-gray-600 mb-2">• Traite {enrichBatchSize} prospects par batch (~2-3 minutes)</p>
              <p className="text-sm text-gray-600 mb-4">• ⏰ Cron automatique chaque nuit à 3h du matin</p>
              <div className="flex items-center gap-3 mb-4">
                <label className="text-sm text-gray-700">Batch size :</label>
                <select value={enrichBatchSize} onChange={(e) => setEnrichBatchSize(Number(e.target.value))} className="border rounded px-3 py-1 text-sm" disabled={enriching}>
                  <option value={10}>10 (rapide ~1 min)</option>
                  <option value={20}>20 (normal ~2 min)</option>
                  <option value={50}>50 (long ~5 min)</option>
                </select>
              </div>
              <div className="flex gap-3">
                <button onClick={lancerEnrichissement} disabled={enriching}
                  className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium ${enriching ? 'bg-gray-300 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700 text-white'}`}
                >
                  {enriching ? <><Loader className="w-5 h-5 animate-spin" /> Enrichissement...</> : <><RefreshCw className="w-5 h-5" /> Lancer l&apos;enrichissement</>}
                </button>
                <button onClick={lancerEnrichissementBoucle} disabled={enriching}
                  className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium ${enriching ? 'bg-gray-300 cursor-not-allowed' : 'bg-orange-600 hover:bg-orange-700 text-white'}`}
                >
                  🔄 Enrichir en boucle (5 batchs)
                </button>
              </div>
            </div>
            {enrichStats && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-6 mt-4">
                <h2 className="text-lg font-semibold text-purple-900 mb-4">{enrichStats.message}</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div><p className="text-sm text-purple-700">Traités</p><p className="text-2xl font-bold text-purple-900">{enrichStats.stats?.total || 0}</p></div>
                  <div><p className="text-sm text-purple-700">📧 Emails</p><p className="text-2xl font-bold text-green-700">{enrichStats.stats?.emails_found || 0}</p></div>
                  <div><p className="text-sm text-purple-700">📞 Téléphones</p><p className="text-2xl font-bold text-green-700">{enrichStats.stats?.phones_found || 0}</p></div>
                  <div><p className="text-sm text-purple-700">❌ Échecs</p><p className="text-2xl font-bold text-red-700">{enrichStats.stats?.failed || 0}</p></div>
                </div>
                {enrichHistory.length > 1 && (
                  <div className="mt-4 pt-4 border-t border-purple-200">
                    <p className="text-sm font-semibold text-purple-800 mb-2">Historique des batchs :</p>
                    {enrichHistory.map((h, i) => (
                      <p key={i} className="text-xs text-purple-700">Batch {i + 1}: {h.stats?.emails_found || 0} emails, {h.stats?.phones_found || 0} tels sur {h.stats?.total || 0} prospects</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ══════════════════ ONGLET IMPORT FICHIER ══════════════════ */}
        {activeTab === 'import-fichier' && (
          <div className="space-y-6">

            {/* Étape 0 : Upload */}
            {fileStep === 0 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold mb-2">📂 Import depuis fichier</h2>
                <p className="text-sm text-gray-500 mb-6">
                  Importe n&apos;importe quel fichier Excel (.xlsx, .xls) ou CSV dans la base prospects ou clients.
                  Les colonnes sont détectées automatiquement — tu peux ajuster le mapping avant l&apos;import.
                </p>
                <div onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 hover:border-blue-400 rounded-xl p-12 text-center cursor-pointer transition-colors group"
                >
                  <FileSpreadsheet className="w-12 h-12 text-gray-300 group-hover:text-blue-400 mx-auto mb-3 transition-colors" />
                  <p className="text-gray-600 font-medium mb-1">Clique pour choisir un fichier</p>
                  <p className="text-sm text-gray-400">.xlsx · .xls · .csv</p>
                </div>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
              </div>
            )}

            {/* Étape 1 : Mapping */}
            {fileStep === 1 && (
              <div className="bg-white rounded-lg shadow p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">🗂 Correspondance des colonnes</h2>
                    <p className="text-sm text-gray-500 mt-0.5">{fileName} · {rawRows.length} ligne{rawRows.length > 1 ? 's' : ''}</p>
                  </div>
                  <button onClick={resetFileImport} className="text-gray-400 hover:text-red-500 transition-colors" title="Recommencer">
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

                {sheets.length > 1 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Feuille</label>
                    <select value={activeSheet} onChange={e => handleSheetChange(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
                      {sheets.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Importer dans</label>
                    <select value={targetTable} onChange={e => { setTargetTable(e.target.value); setColMapping(autoDetect(rawHeaders)) }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                      <option value="prospection_massive">Base prospects (prospection_massive)</option>
                      <option value="clients">Clients</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Code NAF global <span className="text-gray-400 font-normal text-xs">(optionnel — toutes les lignes)</span>
                    </label>
                    <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Ex : 5530Z (Terrains de camping)" value={globalNaf} onChange={e => setGlobalNaf(e.target.value)} />
                  </div>
                </div>

                <div>
                  {/* Étiquette groupe (optionnel) */}
                  {targetTable === 'prospection_massive' && (
                    <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                      <label className="block text-sm font-medium text-purple-700 mb-1">
                        Groupe / Étiquette <span className="text-purple-400 font-normal">(optionnel — permet de retrouver ces contacts dans Mailing)</span>
                      </label>
                      <input
                        className="w-full border border-purple-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                        placeholder="Ex : Campings, Hôtels Bretagne, Transport 2026..."
                        value={groupeTag}
                        onChange={e => setGroupeTag(e.target.value)}
                      />
                    </div>
                  )}

                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Correspondance colonnes → champs
                    <span className="ml-2 text-xs text-gray-400 font-normal">Détection auto — modifie si besoin</span>
                  </p>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-4 py-2.5 text-gray-500 font-medium w-1/3">Colonne fichier</th>
                          <th className="text-left px-4 py-2.5 text-gray-500 font-medium w-1/4">Exemple</th>
                          <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Champ Campus</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {rawHeaders.map(h => (
                          <tr key={h} className="hover:bg-gray-50">
                            <td className="px-4 py-2 font-medium text-gray-700 text-xs truncate max-w-xs">{h}</td>
                            <td className="px-4 py-2 text-gray-400 text-xs truncate max-w-xs">{String(rawRows[0]?.[h] ?? '').slice(0, 35) || '—'}</td>
                            <td className="px-4 py-2">
                              <select value={colMapping[h] || ''} onChange={e => setColMapping(prev => ({ ...prev, [h]: e.target.value }))} className="border border-gray-200 rounded px-2 py-1 text-xs w-full">
                                {availableFields.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Aperçu 3 lignes normalisées */}
                {Object.values(colMapping).some(Boolean) && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">Aperçu (3 premières lignes normalisées)</p>
                    <div className="border border-gray-100 rounded-lg overflow-x-auto">
                      <table className="text-xs w-full">
                        <thead className="bg-gray-50">
                          <tr>{Object.entries(colMapping).filter(([, v]) => v).map(([col, field]) => <th key={col} className="text-left px-3 py-2 text-gray-500 whitespace-nowrap font-medium">{field}</th>)}</tr>
                        </thead>
                        <tbody>
                          {rawRows.slice(0, 3).map((row, i) => {
                            const built = buildRow(row, colMapping, targetTable, globalNaf)
                            return (
                              <tr key={i} className="border-t border-gray-100">
                                {Object.entries(colMapping).filter(([, v]) => v).map(([, field]) => (
                                  <td key={field} className="px-3 py-1.5 text-gray-600 truncate max-w-32">{String(built[field] ?? '—')}</td>
                                ))}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {!Object.values(colMapping).some(Boolean) && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                    ⚠️ Aucune colonne n&apos;est mappée. Si le fichier a plusieurs feuilles, sélectionne la bonne ci-dessus (ex: "TOUS" ou "Données").
                  </div>
                )}
                <div className="flex justify-end pt-2">
                  <button onClick={checkDuplicates} disabled={!Object.values(colMapping).some(Boolean)}
                    className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-40"
                  >
                    Vérifier les doublons →
                  </button>
                </div>
              </div>
            )}

            {/* Étape 2 : Doublons */}
            {fileStep === 2 && (
              <div className="bg-white rounded-lg shadow p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">
                    {duplicates.length > 0 ? '⚠️ Doublons détectés' : '✅ Aucun doublon'}
                  </h2>
                  <button onClick={resetFileImport} className="text-gray-400 hover:text-red-500 transition-colors"><Trash2 className="w-5 h-5" /></button>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-green-50 border border-green-100 rounded-lg p-4 text-center">
                    <p className="text-xs text-green-600">Nouvelles lignes</p>
                    <p className="text-2xl font-bold text-green-900">{newRows.length}</p>
                  </div>
                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 text-center">
                    <p className="text-xs text-amber-600">Doublons</p>
                    <p className="text-2xl font-bold text-amber-900">{duplicates.length}</p>
                  </div>
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-center">
                    <p className="text-xs text-blue-600">Total fichier</p>
                    <p className="text-2xl font-bold text-blue-900">{rawRows.length}</p>
                  </div>
                </div>

                {duplicates.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-gray-700">Choisir l&apos;action pour chaque doublon</p>
                      <div className="flex gap-2">
                        <button onClick={() => setAllDupAction('skip')} className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700">Tout ignorer</button>
                        <button onClick={() => setAllDupAction('update')} className="px-3 py-1.5 text-xs bg-blue-100 hover:bg-blue-200 rounded-lg text-blue-700">Tout mettre à jour</button>
                      </div>
                    </div>
                    <div className="border border-amber-100 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-amber-50 sticky top-0">
                          <tr>
                            <th className="text-left px-3 py-2 text-amber-700 font-medium">Entreprise</th>
                            <th className="text-left px-3 py-2 text-amber-700 font-medium">Email / SIRET</th>
                            <th className="text-left px-3 py-2 text-amber-700 font-medium">Doublon</th>
                            <th className="text-center px-3 py-2 text-amber-700 font-medium">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-amber-50">
                          {duplicates.map(d => (
                            <tr key={d.index} className="bg-white hover:bg-amber-50">
                              <td className="px-3 py-2 text-gray-700 truncate max-w-xs">{d.row.name || '—'}</td>
                              <td className="px-3 py-2 text-gray-500">{d.row.email || d.row.siret || '—'}</td>
                              <td className="px-3 py-2"><span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">{d.reason}</span></td>
                              <td className="px-3 py-2">
                                <div className="flex items-center justify-center gap-1">
                                  <button onClick={() => setDupAction(d.index, 'skip')} className={`px-2 py-1 rounded text-xs font-medium transition-colors ${d.action === 'skip' ? 'bg-gray-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>Ignorer</button>
                                  <button onClick={() => setDupAction(d.index, 'update')} className={`px-2 py-1 rounded text-xs font-medium transition-colors ${d.action === 'update' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}>Mettre à jour</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="flex justify-between pt-2">
                  <button onClick={() => setFileStep(1)} className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm">← Retour au mapping</button>
                  <button onClick={runImport} disabled={newRows.length === 0 && duplicates.every(d => d.action === 'skip')}
                    className="flex items-center gap-2 px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold disabled:opacity-40"
                  >
                    <Upload className="w-4 h-4" />
                    Lancer ({newRows.length + duplicates.filter(d => d.action === 'update').length} lignes)
                  </button>
                </div>
              </div>
            )}

            {/* Étape 3 : Progression */}
            {fileStep === 3 && (
              <div className="bg-white rounded-lg shadow p-8 text-center">
                <Loader className="w-10 h-10 animate-spin text-blue-500 mx-auto mb-4" />
                <h2 className="text-lg font-semibold mb-3">Import en cours…</h2>
                <div className="w-full bg-gray-200 rounded-full h-3 mb-3 max-w-md mx-auto">
                  <div className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                    style={{ width: importProgress.total > 0 ? `${Math.round((importProgress.done / importProgress.total) * 100)}%` : '0%' }} />
                </div>
                <p className="text-sm text-gray-500">{importProgress.done} / {importProgress.total} lignes</p>
                {importProgress.errors > 0 && <p className="text-xs text-red-500 mt-1">{importProgress.errors} erreur{importProgress.errors > 1 ? 's' : ''}</p>}
              </div>
            )}

            {/* Étape 4 : Résultat */}
            {fileStep === 4 && importLog && (
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex items-center gap-3 mb-6">
                  <CheckCircle className="w-8 h-8 text-green-500" />
                  <h2 className="text-xl font-bold text-gray-900">Import terminé</h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-green-50 rounded-lg p-4 text-center"><p className="text-xs text-green-600">Insérées</p><p className="text-2xl font-bold text-green-900">{importLog.inserted}</p></div>
                  <div className="bg-blue-50 rounded-lg p-4 text-center"><p className="text-xs text-blue-600">Mises à jour</p><p className="text-2xl font-bold text-blue-900">{importLog.updated}</p></div>
                  <div className="bg-gray-50 rounded-lg p-4 text-center"><p className="text-xs text-gray-600">Ignorées</p><p className="text-2xl font-bold text-gray-700">{importLog.skipped}</p></div>
                  <div className="bg-red-50 rounded-lg p-4 text-center"><p className="text-xs text-red-600">Erreurs</p><p className="text-2xl font-bold text-red-900">{importLog.errors}</p></div>
                </div>
                <p className="text-sm text-gray-500 mb-4">Résultat enregistré dans les logs d&apos;import.</p>
                <button onClick={resetFileImport} className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-sm font-medium">
                  <Upload className="w-4 h-4" /> Importer un autre fichier
                </button>
              </div>
            )}

          </div>
        )}

      </div>
    </div>
  )
}
