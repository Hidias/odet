import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useDataStore } from '../store'
import { supabase } from '../supabase'
import { Save, Building2, Image, FileText, BookOpen, Upload, Trash2, Loader2, Check, History, Download, Database, Users, LogOut, ExternalLink, Shield, Users2, Calculator, Lock } from 'lucide-react'
import toast from 'react-hot-toast'
import AuditLogs from '../audit/AuditLogs'

export default function Settings() {
  const { 
    organization, fetchOrganization, updateOrganization,
    sessions, fetchSessions,
    courses, fetchCourses,
    clients, fetchClients,
    trainees, fetchTrainees,
    trainers, fetchTrainers,
    fetchAllEvaluations,
  } = useDataStore()
  
  const [activeTab, setActiveTab] = useState('organization')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportingProspection, setExportingProspection] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importPreview, setImportPreview] = useState(null)
  
  const [form, setForm] = useState({
    name: '',
    address: '',
    postal_code: '',
    city: '',
    phone: '',
    email: '',
    siret: '',
    nda: '',
    logo_base64: '',
    stamp_base64: '',
    reglement_interieur: '',
    reglement_version: 'V1.0',
    livret_accueil: '',
    livret_version: 'V1.0',
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    await fetchOrganization()
    // Charger aussi org_settings pour le comptable
    const { data: orgS } = await supabase
      .from('org_settings')
      .select('comptable_email, comptable_name, comptable_cc, comptable_bcc')
      .limit(1)
      .maybeSingle()
    if (orgS) {
      setComptableForm({
        comptable_email: orgS.comptable_email || '',
        comptable_name: orgS.comptable_name || '',
        comptable_cc: orgS.comptable_cc || '',
        comptable_bcc: orgS.comptable_bcc || '',
      })
    }
    setLoading(false)
  }
  
  useEffect(() => {
    if (organization) {
      setForm({
        name: organization.name || 'Access Formation',
        address: organization.address || '',
        postal_code: organization.postal_code || '',
        city: organization.city || '',
        phone: organization.phone || '',
        email: organization.email || '',
        siret: organization.siret || '',
        nda: organization.nda || '',
        logo_base64: organization.logo_base64 || '',
        stamp_base64: organization.stamp_base64 || '',
        reglement_interieur: organization.reglement_interieur || '',
        reglement_version: organization.reglement_version || 'V1.0',
        livret_accueil: organization.livret_accueil || '',
        livret_version: organization.livret_version || 'V1.0',
      })
    }
  }, [organization])

  const handleSave = async () => {
    setSaving(true)
    try {
      const cleanedForm = {
        ...form,
        siret: form.siret?.replace(/\s/g, '') || '',
        nda: form.nda?.replace(/\s/g, '') || '',
      }
      const { error } = await updateOrganization(cleanedForm)
      if (error) throw error
      toast.success('Paramètres sauvegardés')
    } catch (error) {
      console.error('Error saving:', error)
      toast.error('Erreur lors de la sauvegarde: ' + (error.message || 'Erreur inconnue'))
    } finally {
      setSaving(false)
    }
  }

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 500 * 1024) {
      toast.error('Image trop grande (max 500 KB)')
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      const base64 = event.target?.result
      setForm(prev => ({ ...prev, logo_base64: base64 }))
      toast.success('Logo chargé - Cliquez sur Sauvegarder')
    }
    reader.readAsDataURL(file)
  }

  const handleStampUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 500 * 1024) {
      toast.error('Image trop grande (max 500 KB)')
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      const base64 = event.target?.result
      setForm(prev => ({ ...prev, stamp_base64: base64 }))
      toast.success('Tampon chargé - Cliquez sur Sauvegarder')
    }
    reader.readAsDataURL(file)
  }

  // ============================================================
  // EXPORT MÉTIER — toutes les tables sauf prospection_massive
  // Liste basée sur inventaire réel de la base (mars 2026)
  // ============================================================
  const handleExportMetier = async () => {
    setExporting(true)
    try {
      toast.loading('Chargement des données métier...', { id: 'export' })
      
      const tableNames = [
        // Paramètres organisme
        'organization_settings', 'org_settings', 'app_versions',
        // Formations & catalogue
        'courses', 'course_documents', 'course_equipment', 'course_questions',
        'training_themes', 'positioning_themes', 'theme_questions', 'positioning_questions_ref',
        'equipment_catalog',
        // Clients
        'clients', 'client_contacts', 'client_interactions',
        // Stagiaires
        'trainees', 'trainee_info_sheets', 'trainee_objectives', 'trainee_evaluations',
        'trainee_positioning_tests', 'positioning_results',
        // Formateurs
        'trainers', 'trainer_certificates', 'trainer_qualifications',
        'trainer_interviews', 'trainer_trainings', 'trainer_evaluations',
        // Sessions
        'sessions', 'session_trainees', 'session_trainers', 'session_equipment',
        'session_costs', 'session_checklists', 'session_documents', 'session_document_access',
        'session_emails_sent', 'session_needs_analysis', 'session_attendance',
        // Présences & évaluations
        'attendance_halfdays', 'evaluations_cold', 'sst_certifications',
        // Devis & factures
        'quotes', 'quote_items',
        'invoices', 'invoice_items', 'invoice_payments', 'invoice_emails_sent',
        // Budget (absent de l'ancien export — ajouté)
        'budget_transactions', 'budget_categories', 'budget_rules', 'budget_receipts',
        'budget_settings', 'budget_meal_guests', 'budget_emails_sent',
        // Qualité & conformité
        'non_conformites', 'quality_documents', 'quality_alerts', 'qualiopi_documents',
        'qualiopi_indicators', 'veille_qualiopi', 'veille_sources',
        'programme_versions', 'rgpd_traitements',
        // Processus
        'processes', 'process_steps', 'process_connections',
        'process_responsibles', 'process_categories', 'process_versions',
        // Prospection (hors massive)
        'prospect_rdv', 'prospect_calls', 'prospect_needs_analysis',
        'prospect_email_logs', 'prospect_search_history', 'rdv_emails_sent',
        // Assistant d'appel et suivi commercial
        'call_scripts', 'call_script_steps', 'call_arguments', 'call_objections',
        'client_providers', 'phoning_sessions', 'phoning_session_items', 'rdv_kit_documents',
        'prospect_transfers',
        // Mailing
        'mailing_campaigns', 'mailing_sends', 'mailing_segments', 'mailing_templates',
        'mailing_blocklist', 'mailing_email_status', 'mailing_reply_cursors',
        // DUERP
        'duerp_projects', 'duerp_units', 'duerp_risks', 'duerp_actions',
        'duerp_risk_categories', 'duerp_risk_templates', 'duerp_sector_templates',
        'duerp_equipements', 'duerp_habilitations', 'duerp_formations_reglementaires',
        // Social
        'social_posts', 'social_tokens', 'social_media_library',
        // Documents & signatures
        'document_signatures', 'uploaded_documents',
        // Planning
        'user_planning_events',
        // Suivi complétude
        'completude_alerts', 'completude_tracking',
        // Divers
        'notifications', 'audit_logs', 'user_email_configs',
        'email_sync_cursors', 'dashboard_widget_configs',
      ]
      
      // Lecture complète par pages de 1000 lignes (sinon Supabase s'arrête à 1000)
      const fetchAllRows = async (table) => {
        const pageSize = 1000
        // Tri par id pour une pagination stable ; tables sans colonne id : sans tri
        let useOrder = true
        const probe = await supabase.from(table).select('*').order('id').range(0, 0)
        if (probe.error) useOrder = false
        const rows = []
        for (let from = 0; ; from += pageSize) {
          let q = supabase.from(table).select('*')
          if (useOrder) q = q.order('id')
          const { data, error } = await q.range(from, from + pageSize - 1)
          if (error) return { table, data: rows, error }
          rows.push(...(data || []))
          if (!data || data.length < pageSize) break
        }
        return { table, data: rows, error: null }
      }
      const results = await Promise.all(tableNames.map(table => fetchAllRows(table)))
      
      const exportData = {
        _metadata: {
          exportDate: new Date().toISOString(),
          version: 'V2.8.0',
          type: 'metier',
          description: 'Export métier Access Campus (hors prospection_massive)',
          tables: {},
        },
      }
      
      let totalRecords = 0
      const failedTables = []
      
      results.forEach(({ table, data, error }) => {
        if (error) {
          failedTables.push(table)
        } else {
          exportData[table] = data
          exportData._metadata.tables[table] = data.length
          totalRecords += data.length
        }
      })
      
      exportData._metadata.totalRecords = totalRecords
      exportData._metadata.exportedTables = Object.keys(exportData._metadata.tables).length
      if (failedTables.length > 0) {
        exportData._metadata.skippedTables = failedTables
      }
      
      const json = JSON.stringify(exportData, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const date = new Date().toISOString().split('T')[0]
      const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-')
      a.download = `access-campus-metier-${date}_${time}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      const sizeMB = (json.length / 1024 / 1024).toFixed(1)
      toast.success(
        `Export métier réussi ! ${totalRecords.toLocaleString()} enregistrements, ${exportData._metadata.exportedTables} tables (${sizeMB} MB)`,
        { id: 'export', duration: 5000 }
      )
    } catch (error) {
      console.error('Export error:', error)
      toast.error('Erreur lors de l\'export: ' + (error.message || 'Erreur inconnue'), { id: 'export' })
    } finally {
      setExporting(false)
    }
  }

  // ============================================================
  // EXPORT PROSPECTION — prospection_massive paginée par 10 000
  // ~275 000 lignes, chargement progressif pour éviter timeout
  // ============================================================
  const handleExportProspection = async () => {
    setExportingProspection(true)
    try {
      // Supabase renvoie au plus 1000 lignes par requête : on lit par 1000,
      // triées par id (pagination par clé, stable et rapide).
      // Le fichier est découpé par 50 000 lignes pour ne pas saturer le navigateur.
      const PAGE_SIZE = 1000
      const FILE_ROWS = 50000
      const date = new Date().toISOString().split('T')[0]
      let lastId = null
      let total = 0
      let part = 1
      let buffer = []

      const saveFile = (rows, partNumber, isLast) => {
        const exportData = {
          _metadata: {
            exportDate: new Date().toISOString(),
            version: 'V2.8.0',
            type: 'prospection',
            description: 'Export prospection_massive Access Campus',
            part: partNumber,
            lastPart: isLast,
            tables: { prospection_massive: rows.length },
            totalRecords: rows.length,
            exportedTables: 1,
          },
          prospection_massive: rows,
        }
        const blob = new Blob([JSON.stringify(exportData)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `access-campus-prospection-${date}-partie-${String(partNumber).padStart(2, '0')}.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 10000)
      }

      while (true) {
        toast.loading(`Chargement prospection… ${total.toLocaleString()} lignes (fichier ${part})`, { id: 'export-prosp' })
        let q = supabase.from('prospection_massive').select('*').order('id').limit(PAGE_SIZE)
        if (lastId) q = q.gt('id', lastId)
        const { data, error } = await q
        if (error) throw error
        if (!data || data.length === 0) break
        buffer = buffer.concat(data)
        total += data.length
        lastId = data[data.length - 1].id
        if (buffer.length >= FILE_ROWS) {
          saveFile(buffer, part, false)
          buffer = []
          part++
        }
        if (data.length < PAGE_SIZE) break
      }
      if (buffer.length > 0 || total === 0) {
        saveFile(buffer, part, true)
      } else {
        part--
      }

      toast.success(
        `Export prospection réussi : ${total.toLocaleString()} prospects en ${part} fichier(s)`,
        { id: 'export-prosp', duration: 8000 }
      )
    } catch (error) {
      console.error('Export prospection error:', error)
      toast.error('Erreur export prospection: ' + (error.message || 'Erreur inconnue'), { id: 'export-prosp' })
    } finally {
      setExportingProspection(false)
    }
  }

  // ======== IMPORT / RESTAURATION ========
  const handleImportFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result)
        
        if (!data._metadata || !data._metadata.exportDate) {
          toast.error('Fichier invalide : ce n\'est pas une sauvegarde Access Campus')
          return
        }
        
        const tables = {}
        let total = 0
        Object.entries(data).forEach(([key, value]) => {
          if (key !== '_metadata' && Array.isArray(value) && value.length > 0) {
            tables[key] = value.length
            total += value.length
          }
        })
        
        setImportPreview({
          data,
          fileName: file.name,
          exportDate: data._metadata.exportDate,
          version: data._metadata.version || 'Inconnue',
          type: data._metadata.type || 'metier',
          tables,
          totalRecords: total,
          tableCount: Object.keys(tables).length,
        })
      } catch (err) {
        toast.error('Fichier JSON invalide')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleImportConfirm = async () => {
    if (!importPreview?.data) return
    
    setImporting(true)
    const data = importPreview.data
    
    // Ordre d'insertion : parents d'abord (clés étrangères)
    const insertionOrder = [
      'organization_settings', 'org_settings', 'app_versions',
      'equipment_catalog',
      'training_themes', 'positioning_themes',
      'courses', 'course_documents', 'course_equipment', 'course_questions',
      'theme_questions', 'positioning_questions_ref',
      'clients', 'client_contacts', 'client_interactions',
      'trainees', 'trainee_info_sheets', 'trainee_objectives', 'trainee_evaluations',
      'trainee_positioning_tests', 'positioning_results',
      'trainers', 'trainer_certificates', 'trainer_qualifications',
      'trainer_interviews', 'trainer_trainings', 'trainer_evaluations',
      'sessions', 'session_trainees', 'session_trainers', 'session_equipment',
      'session_costs', 'session_checklists', 'session_documents', 'session_document_access',
      'session_emails_sent', 'session_needs_analysis', 'session_attendance',
      'attendance_halfdays', 'evaluations_cold', 'sst_certifications',
      'quotes', 'quote_items',
      'invoices', 'invoice_items', 'invoice_payments', 'invoice_emails_sent',
      'budget_categories', 'budget_rules', 'budget_settings',
      'budget_transactions', 'budget_receipts', 'budget_meal_guests', 'budget_emails_sent',
      'non_conformites', 'quality_documents', 'quality_alerts', 'qualiopi_documents',
      'qualiopi_indicators', 'veille_qualiopi', 'veille_sources',
      'programme_versions', 'rgpd_traitements',
      'process_categories', 'processes', 'process_steps',
      'process_connections', 'process_responsibles', 'process_versions',
      // Sessions de phoning avant les appels (clé étrangère prospect_calls.phoning_session_id)
      'phoning_sessions',
      'prospect_rdv', 'prospect_calls', 'prospect_needs_analysis',
      'prospect_email_logs', 'prospect_search_history', 'rdv_emails_sent',
      'call_scripts', 'call_script_steps', 'call_arguments', 'call_objections',
      'client_providers', 'phoning_session_items', 'rdv_kit_documents',
      'prospect_transfers',
      // Mailing : sauvegardé mais jamais restauré automatiquement
      // (une campagne ou un envoi restauré « en cours » repartirait tout seul)
      'duerp_risk_categories', 'duerp_risk_templates', 'duerp_sector_templates',
      'duerp_equipements', 'duerp_formations_reglementaires',
      'duerp_projects', 'duerp_units', 'duerp_risks', 'duerp_actions', 'duerp_habilitations',
      'social_posts', 'social_tokens', 'social_media_library',
      'document_signatures', 'uploaded_documents',
      'user_planning_events',
      'completude_alerts', 'completude_tracking',
      'notifications', 'audit_logs', 'user_email_configs',
      'email_sync_cursors', 'dashboard_widget_configs',
      // Prospection en dernier (absent des exports métier)
      'prospection_massive',
    ]
    
    let imported = 0
    let errors = 0
    const errorDetails = []
    
    toast.loading('Import en cours...', { id: 'import' })
    
    for (const table of insertionOrder) {
      const rows = data[table]
      if (!Array.isArray(rows) || rows.length === 0) continue
      
      try {
        const batchSize = 500
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize)
          const { error } = await supabase
            .from(table)
            .upsert(batch, { onConflict: 'id', ignoreDuplicates: false })
          
          if (error) throw error
          imported += batch.length
          toast.loading(`Import en cours... ${imported.toLocaleString()} enregistrements`, { id: 'import' })
        }
      } catch (err) {
        console.error(`Import error on ${table}:`, err)
        errors++
        errorDetails.push(`${table}: ${err.message}`)
      }
    }
    
    setImporting(false)
    setImportPreview(null)
    
    if (errors === 0) {
      toast.success(`Import terminé ! ${imported.toLocaleString()} enregistrements restaurés`, { id: 'import', duration: 5000 })
    } else {
      toast.success(`Import partiel : ${imported.toLocaleString()} enregistrements OK, ${errors} tables en erreur`, { id: 'import', duration: 8000 })
      console.warn('Import errors:', errorDetails)
    }
    
    fetchOrganization()
    fetchCourses()
    fetchClients()
    fetchTrainees()
    fetchTrainers()
    fetchSessions()
  }

  const tabs = [
    { id: 'organization', name: 'Organisation', icon: Building2 },
    { id: 'logo', name: 'Logo & Tampon', icon: Image },
    { id: 'reglement', name: 'Règlement intérieur', icon: FileText },
    { id: 'livret', name: 'Livret d\'accueil', icon: BookOpen },
    { id: 'users', name: 'Utilisateurs', icon: Users },
    { id: 'comptable', name: 'Accès comptable', icon: Calculator },
    { id: 'audit', name: 'Audit RGPD', icon: Shield },
  ]
  
  const [userEmail, setUserEmail] = useState('')
  const [disconnecting, setDisconnecting] = useState(false)

  // ── Espace Comptable ──
  const [comptableForm, setComptableForm] = useState({ comptable_email: '', comptable_name: '', comptable_cc: '', comptable_bcc: '' })
  const [savingComptable, setSavingComptable] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Paramètres</h1>
          <p className="text-gray-500">Configuration de votre organisme de formation</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn btn-primary"
        >
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          {saving ? 'Sauvegarde...' : 'Sauvegarder'}
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b">
        <nav className="flex gap-4 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.name}
            </button>
          ))}
        </nav>
      </div>

      {/* Contenu */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        
        {/* ORGANISATION */}
        {activeTab === 'organization' && (
          <div className="space-y-6">
            <h3 className="font-semibold text-lg">Informations de l'organisme</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="label">Nom de l'organisme</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="label">SIRET</label>
                <input
                  type="text"
                  value={form.siret}
                  onChange={(e) => setForm({ ...form, siret: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="label">N° Déclaration d'activité (NDA)</label>
                <input
                  type="text"
                  value={form.nda}
                  onChange={(e) => setForm({ ...form, nda: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label className="label">Téléphone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="input"
                />
              </div>
            </div>
            <div>
              <label className="label">Adresse</label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="input"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="label">Code postal</label>
                <input
                  type="text"
                  value={form.postal_code}
                  onChange={(e) => setForm({ ...form, postal_code: e.target.value })}
                  className="input"
                  maxLength={5}
                />
              </div>
              <div>
                <label className="label">Ville</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="input"
                />
              </div>
            </div>
          </div>
        )}

        {/* LOGO & TAMPON */}
        {activeTab === 'logo' && (
          <div className="space-y-8">
            <div>
              <h3 className="font-semibold text-lg mb-2">Logo de l'organisme</h3>
              <p className="text-sm text-gray-500 mb-4">Ce logo apparaîtra sur tous les documents PDF générés.</p>
              
              <div className="flex items-start gap-6">
                <div className="w-40 h-40 border-2 border-dashed rounded-lg flex items-center justify-center bg-gray-50">
                  {form.logo_base64 ? (
                    <img src={form.logo_base64} alt="Logo" className="max-w-full max-h-full object-contain p-2" />
                  ) : (
                    <div className="text-center text-gray-400">
                      <Image className="w-10 h-10 mx-auto mb-2" />
                      <p className="text-xs">Aucun logo</p>
                    </div>
                  )}
                </div>
                
                <div className="space-y-3">
                  <label className="btn btn-primary cursor-pointer">
                    <Upload className="w-4 h-4 mr-2" />
                    Téléverser un logo
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                  </label>
                  <p className="text-xs text-gray-500">PNG ou JPG, max 500 KB</p>
                  {form.logo_base64 && (
                    <button
                      onClick={() => setForm(prev => ({ ...prev, logo_base64: '' }))}
                      className="flex items-center gap-2 px-3 py-1.5 text-red-600 border border-red-300 rounded-lg hover:bg-red-50 text-sm"
                    >
                      <Trash2 className="w-3 h-3" />
                      Supprimer
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t pt-8">
              <h3 className="font-semibold text-lg mb-2">Tampon et signature</h3>
              <p className="text-sm text-gray-500 mb-4">Ce tampon apparaîtra sur les conventions, attestations et certificats.</p>
              
              <div className="flex items-start gap-6">
                <div className="w-48 h-28 border-2 border-dashed rounded-lg flex items-center justify-center bg-gray-50">
                  {form.stamp_base64 ? (
                    <img src={form.stamp_base64} alt="Tampon" className="max-w-full max-h-full object-contain p-2" />
                  ) : (
                    <div className="text-center text-gray-400">
                      <FileText className="w-10 h-10 mx-auto mb-2" />
                      <p className="text-xs">Aucun tampon</p>
                    </div>
                  )}
                </div>
                
                <div className="space-y-3">
                  <label className="btn btn-secondary cursor-pointer">
                    <Upload className="w-4 h-4 mr-2" />
                    Téléverser tampon/signature
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      onChange={handleStampUpload}
                      className="hidden"
                    />
                  </label>
                  <p className="text-xs text-gray-500">PNG ou JPG, max 500 KB</p>
                  {form.stamp_base64 && (
                    <button
                      onClick={() => setForm(prev => ({ ...prev, stamp_base64: '' }))}
                      className="flex items-center gap-2 px-3 py-1.5 text-red-600 border border-red-300 rounded-lg hover:bg-red-50 text-sm"
                    >
                      <Trash2 className="w-3 h-3" />
                      Supprimer
                    </button>
                  )}
                </div>
              </div>
            </div>
            
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
              <strong>Important :</strong> Après avoir chargé un logo ou tampon, cliquez sur "Sauvegarder" en haut de page pour enregistrer les modifications.
            </div>
          </div>
        )}

        {/* REGLEMENT INTERIEUR */}
        {activeTab === 'reglement' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg">Règlement intérieur</h3>
                <p className="text-sm text-gray-500">Ce texte sera utilisé pour générer le PDF "Règlement Intérieur"</p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-500">Version</label>
                <input
                  type="text"
                  value={form.reglement_version}
                  onChange={(e) => setForm({ ...form, reglement_version: e.target.value })}
                  className="input w-20 py-1 text-sm"
                />
              </div>
            </div>
            
            <textarea
              className="w-full h-96 px-4 py-3 border rounded-lg font-mono text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              value={form.reglement_interieur}
              onChange={(e) => setForm({ ...form, reglement_interieur: e.target.value })}
              placeholder="Saisissez votre règlement intérieur...

ARTICLE 1 - OBJET ET CHAMP D'APPLICATION
Le présent règlement s'applique à toutes les personnes participant à une action de formation organisée par Access Formation.

ARTICLE 2 - DISCIPLINE
Les stagiaires doivent se conformer aux horaires fixés et communiqués par l'organisme de formation.

..."
            />
          </div>
        )}

        {/* LIVRET D'ACCUEIL */}
        {activeTab === 'livret' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg">Livret d'accueil</h3>
                <p className="text-sm text-gray-500">Ce texte sera utilisé pour générer le PDF "Livret d'Accueil"</p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-500">Version</label>
                <input
                  type="text"
                  value={form.livret_version}
                  onChange={(e) => setForm({ ...form, livret_version: e.target.value })}
                  className="input w-20 py-1 text-sm"
                />
              </div>
            </div>
            
            <textarea
              className="w-full h-96 px-4 py-3 border rounded-lg font-mono text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              value={form.livret_accueil}
              onChange={(e) => setForm({ ...form, livret_accueil: e.target.value })}
              placeholder="Saisissez votre livret d'accueil...

BIENVENUE CHEZ ACCESS FORMATION

Nous sommes heureux de vous accueillir au sein de notre organisme de formation.

QUI SOMMES-NOUS ?
Access Formation est un organisme de formation professionnelle spécialisé dans...

..."
            />
          </div>
        )}
        
        {/* UTILISATEURS */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            <h3 className="font-semibold text-lg">Gestion des utilisateurs</h3>
            
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h4 className="font-medium text-amber-800 mb-3 flex items-center gap-2">
                <LogOut className="w-5 h-5" />
                Déconnecter un utilisateur à distance
              </h4>
              <p className="text-sm text-amber-700 mb-4">
                Saisissez l'email de l'utilisateur pour mettre fin à sa session active.
              </p>
              
              <div className="flex gap-2">
                <input
                  type="email"
                  placeholder="email@example.com"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  className="input flex-1"
                />
                <button
                  onClick={async () => {
                    if (!userEmail) {
                      toast.error('Veuillez saisir un email')
                      return
                    }
                    if (!confirm(`Déconnecter ${userEmail} ?`)) return
                    
                    setDisconnecting(true)
                    try {
                      const { error } = await supabase.rpc('admin_logout_user', { user_email: userEmail })
                      
                      if (error) {
                        if (error.code === '42883') {
                          toast.error('Fonction non installée. Utilisez le Dashboard Supabase.')
                        } else {
                          throw error
                        }
                      } else {
                        toast.success(`${userEmail} a été déconnecté`)
                        setUserEmail('')
                      }
                    } catch (err) {
                      console.error('Erreur déconnexion:', err)
                      toast.error('Erreur - Utilisez le Dashboard Supabase')
                    } finally {
                      setDisconnecting(false)
                    }
                  }}
                  disabled={disconnecting || !userEmail}
                  className="btn btn-primary"
                >
                  {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                  Déconnecter
                </button>
              </div>
            </div>
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-medium text-blue-800 mb-2">Gestion avancée</h4>
              <p className="text-sm text-blue-700 mb-3">
                Pour voir tous les utilisateurs connectés, les bannir ou supprimer leurs comptes, utilisez le Dashboard Supabase.
              </p>
              <a
                href="https://supabase.com/dashboard/project/_/auth/users"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary inline-flex items-center gap-2"
              >
                <ExternalLink className="w-4 h-4" />
                Ouvrir Supabase Dashboard
              </a>
            </div>
            
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h4 className="font-medium text-gray-800 mb-2">Installation de la fonction de déconnexion</h4>
              <p className="text-sm text-gray-600 mb-3">
                Pour activer la déconnexion depuis l'app, exécutez ce SQL dans Supabase :
              </p>
              <pre className="bg-gray-800 text-green-400 p-3 rounded text-xs overflow-x-auto">
{`-- Fonction pour déconnecter un utilisateur par email
CREATE OR REPLACE FUNCTION admin_logout_user(user_email TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  target_user_id UUID;
BEGIN
  SELECT id INTO target_user_id 
  FROM auth.users 
  WHERE email = user_email;
  
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non trouvé';
  END IF;
  
  DELETE FROM auth.sessions 
  WHERE user_id = target_user_id;
END;
$$;`}
              </pre>
            </div>
          </div>
        )}
        

        {/* ACCÈS COMPTABLE */}
        {activeTab === 'comptable' && (
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Calculator className="w-5 h-5 text-violet-600" />
                Accès cabinet comptable
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                L'email renseigné ici sert à deux choses : il autorise la connexion à Access Campus avec un accès
                limité à l'espace comptable, <strong>et il reçoit tous les envois automatiques</strong> (pièces
                comptables, récap factures). Pour changer de cabinet, il suffit de modifier l'email — l'ancien
                accès est révoqué et les envois basculent immédiatement sur le nouveau destinataire.
              </p>
            </div>

            <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 text-sm text-violet-800">
              <strong>Important :</strong> Le compte Supabase Auth correspondant à cet email doit exister.
              Créez-le d'abord dans{' '}
              <a href="https://supabase.com/dashboard/project/_/auth/users" target="_blank" rel="noopener noreferrer" className="underline">
                Supabase Dashboard → Auth → Users
              </a>{' '}
              avant d'activer l'accès.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="label">Nom du cabinet comptable</label>
                <input
                  type="text"
                  value={comptableForm.comptable_name}
                  onChange={e => setComptableForm(f => ({ ...f, comptable_name: e.target.value }))}
                  placeholder="ex: Cabinet FICAMEX"
                  className="input"
                />
              </div>
              <div>
                <label className="label">Email du comptable</label>
                <input
                  type="email"
                  value={comptableForm.comptable_email}
                  onChange={e => setComptableForm(f => ({ ...f, comptable_email: e.target.value }))}
                  placeholder="ex: contact@cabinet.fr"
                  className="input"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Laissez vide pour désactiver l'accès comptable — les envois seront alors bloqués
                </p>
              </div>
              <div>
                <label className="label">Copie (CC)</label>
                <input
                  type="text"
                  value={comptableForm.comptable_cc}
                  onChange={e => setComptableForm(f => ({ ...f, comptable_cc: e.target.value }))}
                  placeholder="ex: fournisseurs@accessformation.pro"
                  className="input"
                />
                <p className="text-xs text-gray-400 mt-1">Plusieurs adresses possibles, séparées par des virgules</p>
              </div>
              <div>
                <label className="label">Copie cachée (BCC)</label>
                <input
                  type="text"
                  value={comptableForm.comptable_bcc}
                  onChange={e => setComptableForm(f => ({ ...f, comptable_bcc: e.target.value }))}
                  placeholder="ex: contact@accessformation.pro"
                  className="input"
                />
                <p className="text-xs text-gray-400 mt-1">Archivage interne — le destinataire ne la voit pas</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={async () => {
                  setSavingComptable(true)
                  try {
                    const { data: existing } = await supabase.from('org_settings').select('id').single()
                    const payload = {
                      comptable_email: comptableForm.comptable_email.trim().toLowerCase() || null,
                      comptable_name: comptableForm.comptable_name.trim() || null,
                      comptable_cc: comptableForm.comptable_cc.trim() || null,
                      comptable_bcc: comptableForm.comptable_bcc.trim() || null,
                    }
                    if (existing) {
                      await supabase.from('org_settings').update(payload).eq('id', existing.id)
                    } else {
                      await supabase.from('org_settings').insert([payload])
                    }
                    toast.success('Accès comptable mis à jour')
                  } catch (e) {
                    toast.error('Erreur : ' + e.message)
                  }
                  setSavingComptable(false)
                }}
                disabled={savingComptable}
                className="btn btn-primary flex items-center gap-2"
              >
                {savingComptable ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Sauvegarder
              </button>

              {comptableForm.comptable_email ? (
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  <Lock className="w-4 h-4" />
                  Accès actif pour <strong className="ml-1">{comptableForm.comptable_email}</strong>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <Lock className="w-4 h-4" />
                  Aucun comptable configuré — les envois automatiques sont bloqués
                </div>
              )}
            </div>

            <div className="border-t pt-4">
              <h4 className="font-medium text-gray-700 mb-2">Ce que le comptable peut faire</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>✅ Consulter la balance âgée (créances par ancienneté)</li>
                <li>✅ Saisir des encaissements sur les factures</li>
                <li>✅ Rapprocher des transactions bancaires aux factures</li>
                <li>✅ Annoter les transactions (note comptable)</li>
                <li>✅ Verrouiller des périodes comptables</li>
                <li>✅ Exporter les données en Excel</li>
                <li>❌ Accès aux sessions, stagiaires, prospection, DUERP...</li>
              </ul>
            </div>

            <div className="border-t pt-4">
              <h4 className="font-medium text-gray-700 mb-2">Ce qui part vers cette adresse</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>📮 Pièces comptables (justificatifs) — Budget → onglet Comptable</li>
                <li>🧾 Récapitulatif mensuel des factures clients + PDF</li>
              </ul>
              {comptableForm.comptable_email && (
                <div className="mt-3 text-xs text-gray-500 bg-gray-50 border rounded-lg px-3 py-2 space-y-0.5">
                  <div>À : <strong>{comptableForm.comptable_email}</strong></div>
                  {comptableForm.comptable_cc && <div>CC : {comptableForm.comptable_cc}</div>}
                  {comptableForm.comptable_bcc && <div>BCC : {comptableForm.comptable_bcc}</div>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* AUDIT RGPD */}
        {activeTab === 'audit' && (
          <div className="-m-6">
            <AuditLogs />
          </div>
        )}
      </div>
      
      {/* Section Sauvegarde */}
      <div className="card bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <Database className="w-5 h-5 text-green-600" />
          Sauvegarde et restauration
        </h2>
        <p className="text-sm text-gray-500 mb-5">
          Les fichiers Storage (PDF, documents, signatures) sont sauvegardés automatiquement par Supabase et ne sont pas inclus dans ces exports JSON.
        </p>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          
          {/* Export Métier */}
          <div className="border rounded-lg p-4">
            <h3 className="font-medium text-gray-800 mb-1 flex items-center gap-2">
              <Download className="w-4 h-4 text-blue-600" />
              Export métier
            </h3>
            <p className="text-sm text-gray-500 mb-1">
              Clients, sessions, stagiaires, factures, devis, budget, DUERP, qualité, social, planning…
            </p>
            <p className="text-xs text-blue-600 mb-3">~5–10 Mo · instantané · à faire chaque semaine</p>
            <button
              onClick={handleExportMetier}
              disabled={exporting || exportingProspection}
              className="btn btn-primary flex items-center gap-2 w-full justify-center"
            >
              {exporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Export en cours...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Exporter les données métier
                </>
              )}
            </button>
          </div>

          {/* Export Prospection */}
          <div className="border rounded-lg p-4">
            <h3 className="font-medium text-gray-800 mb-1 flex items-center gap-2">
              <Users2 className="w-4 h-4 text-purple-600" />
              Export prospection
            </h3>
            <p className="text-sm text-gray-500 mb-1">
              Base prospection_massive (~275 000 entreprises). Lecture par lots de 1 000, fichiers de 50 000 lignes.
            </p>
            <p className="text-xs text-purple-600 mb-3">~150–200 Mo · 2–3 min · à faire 1×/mois</p>
            <button
              onClick={handleExportProspection}
              disabled={exporting || exportingProspection}
              className="btn flex items-center gap-2 w-full justify-center bg-purple-600 text-white hover:bg-purple-700"
            >
              {exportingProspection ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Chargement...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Exporter la prospection
                </>
              )}
            </button>
          </div>
          
          {/* Import */}
          <div className="border rounded-lg p-4">
            <h3 className="font-medium text-gray-800 mb-1 flex items-center gap-2">
              <Upload className="w-4 h-4 text-orange-600" />
              Importer (restauration)
            </h3>
            <p className="text-sm text-gray-500 mb-1">
              Restaurez depuis un fichier de sauvegarde JSON (métier ou prospection).
            </p>
            <p className="text-xs text-orange-600 mb-3">⚠️ Les données existantes avec le même ID seront écrasées.</p>
            <label className="btn btn-secondary flex items-center gap-2 w-full justify-center cursor-pointer">
              <input
                type="file"
                accept=".json"
                onChange={handleImportFile}
                className="hidden"
                disabled={importing}
              />
              <Upload className="w-4 h-4" />
              Charger un fichier de sauvegarde
            </label>
          </div>
        </div>
      </div>
      
      {/* Modal de confirmation d'import */}
      {importPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b bg-orange-50 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Shield className="w-5 h-5 text-orange-600" />
                Confirmer la restauration
              </h3>
              <button onClick={() => setImportPreview(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <p><strong>Fichier :</strong> {importPreview.fileName}</p>
                <p><strong>Type :</strong> {importPreview.type === 'prospection' ? 'Export prospection' : 'Export métier'}</p>
                <p><strong>Date d'export :</strong> {new Date(importPreview.exportDate).toLocaleString('fr-FR')}</p>
                <p><strong>Version :</strong> {importPreview.version}</p>
                <p><strong>Total :</strong> {importPreview.totalRecords.toLocaleString()} enregistrements dans {importPreview.tableCount} tables</p>
              </div>
              
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Détail par table :</p>
                <div className="max-h-48 overflow-y-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <tbody>
                      {Object.entries(importPreview.tables)
                        .sort((a, b) => b[1] - a[1])
                        .map(([table, count]) => (
                          <tr key={table} className="border-b last:border-0">
                            <td className="px-3 py-1.5 font-mono text-xs text-gray-600">{table}</td>
                            <td className="px-3 py-1.5 text-right font-medium">{count.toLocaleString()}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
              
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-800">
                <strong>⚠️ Attention :</strong> Les enregistrements existants avec le même ID seront mis à jour. Les nouveaux seront ajoutés. Aucune donnée ne sera supprimée.
              </div>
            </div>
            <div className="p-4 border-t bg-gray-50 flex gap-3 justify-end">
              <button 
                onClick={() => setImportPreview(null)} 
                className="btn btn-secondary"
                disabled={importing}
              >
                Annuler
              </button>
              <button 
                onClick={handleImportConfirm} 
                disabled={importing}
                className="btn bg-orange-500 text-white hover:bg-orange-600 flex items-center gap-2"
              >
                {importing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Import en cours...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Restaurer les données
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Section À propos */}
      <div className="card bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <History className="w-5 h-5 text-primary" />
          À propos
        </h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-primary-600 font-bold">Access Campus</p>
            <p className="text-sm text-gray-500">Version 2.8.0</p>
          </div>
          <Link to="/changelog" className="btn btn-outline btn-sm flex items-center gap-2">
            <History className="w-4 h-4" />
            Historique des versions
          </Link>
        </div>
      </div>
    </div>
  )
}
