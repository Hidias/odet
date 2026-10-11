import { useEffect, useState } from 'react'
import { supabase } from '../../../core/supabase'
import { useDataStore } from '../../../core/store'
import { 
  Award, FileText, Scale, BookOpen, Briefcase, TrendingUp, 
  Plus, Edit, Trash2, Save, X, Eye, ExternalLink, Rss, RefreshCw,
  CheckCircle, AlertTriangle, Clock, Archive, Users, Star, Target,
  ThumbsUp, UserCheck, Calendar, Building, ChevronDown, ChevronUp,
  Globe, Link2, AlertCircle, Download, Info
} from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import ProcessEditor from './ProcessEditor'

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const DOCUMENT_TYPES = {
  cgv: { label: 'Conditions Générales de Vente', icon: FileText, required: true },
  reglement: { label: 'Règlement Intérieur', icon: Scale, required: true },
  livret: { label: 'Livret d\'accueil', icon: BookOpen, required: true },
  procedure_reclamation: { label: 'Procédure de réclamation', icon: AlertTriangle, required: true },
  procedure_veille: { label: 'Procédure de veille', icon: Eye, required: true },
  procedure_handicap: { label: 'Procédure handicap', icon: Users, required: true },
  politique_qualite: { label: 'Politique qualité', icon: Award, required: false },
  charte_deontologie: { label: 'Charte de déontologie', icon: CheckCircle, required: false }
}

const VEILLE_TYPES = {
  legale: { label: 'Légale & Réglementaire', icon: Scale, color: 'blue' },
  metiers: { label: 'Emplois & Métiers', icon: Briefcase, color: 'green' },
  pedagogique: { label: 'Pédagogique & Technologique', icon: BookOpen, color: 'purple' }
}

const VEILLE_SOURCES = [
  { id: 'inrs', name: 'INRS', url: 'https://www.inrs.fr', type: 'legale', description: 'Institut National de Recherche et de Sécurité' },
  { id: 'legifrance', name: 'Légifrance', url: 'https://www.legifrance.gouv.fr', type: 'legale', description: 'Service public de diffusion du droit' },
  { id: 'france_competences', name: 'France Compétences', url: 'https://www.francecompetences.fr', type: 'legale', description: 'Autorité nationale de financement et régulation' },
  { id: 'oppbtp', name: 'OPPBTP', url: 'https://www.preventionbtp.fr', type: 'legale', description: 'Organisme Professionnel de Prévention du BTP' },
  { id: 'carif_oref', name: 'CARIF-OREF Bretagne', url: 'https://www.gref-bretagne.com', type: 'metiers', description: 'Centre Animation Ressources Information Formation' },
  { id: 'centre_inffo', name: 'Centre Inffo', url: 'https://www.centre-inffo.fr', type: 'pedagogique', description: 'Centre pour le développement de l\'information sur la formation' }
]

const STATUTS = {
  a_traiter: { label: 'À traiter', color: 'red', icon: AlertTriangle },
  en_cours: { label: 'En cours', color: 'yellow', icon: Clock },
  traite: { label: 'Traité', color: 'green', icon: CheckCircle },
  archive: { label: 'Archivé', color: 'gray', icon: Archive }
}

// ═══════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ═══════════════════════════════════════════════════════════════════

export default function Qualiopi() {
  const { sessions, fetchSessions } = useDataStore()
  
  const [activeTab, setActiveTab] = useState('dashboard') // dashboard, documents, veille, sources
  const [loading, setLoading] = useState(true)
  
  // Documents Qualiopi
  const [documents, setDocuments] = useState([])
  const [showDocModal, setShowDocModal] = useState(false)
  const [editingDoc, setEditingDoc] = useState(null)
  const [docForm, setDocForm] = useState({ type: 'cgv', title: '', content: '', version: '1.0' })
  
  // Veilles
  const [veilles, setVeilles] = useState([])
  const [veilleStats, setVeilleStats] = useState({ total: 0, a_traiter: 0, en_cours: 0, traite: 0 })
  
  // Sources de veille
  const [sources, setSources] = useState([])
  const [showSourceModal, setShowSourceModal] = useState(false)
  const [sourceForm, setSourceForm] = useState({ name: '', url: '', type: 'legale', description: '' })
  
  // Indicateurs
  const [indicators, setIndicators] = useState({
    satisfaction: null,
    reussite: null,
    presence: null,
    recommandation: null,
    formations: 0,
    stagiaires: 0,
    reclamations: 0
  })
  
  // Réclamations
  const [reclamations, setReclamations] = useState([])

  useEffect(() => {
    loadAllData()
  }, [])

  // Mise à jour automatique du statut des sessions terminées
  useEffect(() => {
    const updateCompletedSessions = async () => {
      if (sessions.length === 0) return
      
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      
      const sessionsToComplete = sessions.filter(s => {
        if (s.status === 'completed' || s.status_locked) return false
        if (!s.end_date) return false
        
        const endDate = new Date(s.end_date)
        endDate.setHours(0, 0, 0, 0)
        const dayAfterEnd = new Date(endDate)
        dayAfterEnd.setDate(dayAfterEnd.getDate() + 1)
        
        return today >= dayAfterEnd
      })
      
      for (const session of sessionsToComplete) {
        await supabase
          .from('sessions')
          .update({ status: 'completed' })
          .eq('id', session.id)
      }
      
      if (sessionsToComplete.length > 0) {
        await fetchSessions()
        loadIndicators() // Recharger les indicateurs
      }
    }
    
    updateCompletedSessions()
  }, [sessions.length])

  const loadAllData = async () => {
    setLoading(true)
    await Promise.all([
      fetchSessions(),
      loadDocuments(),
      loadVeilles(),
      loadSources(),
      loadIndicators(),
      loadReclamations()
    ])
    setLoading(false)
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHARGEMENT DES DONNÉES
  // ═══════════════════════════════════════════════════════════════════

  const loadDocuments = async () => {
    const { data, error } = await supabase
      .from('qualiopi_documents')
      .select('*')
      .order('type')
    
    if (!error) setDocuments(data || [])
  }

  const loadVeilles = async () => {
    const { data, error } = await supabase
      .from('veille_qualiopi')
      .select('*')
      .order('date', { ascending: false })
      .limit(10)
    
    if (!error) {
      setVeilles(data || [])
      // Calculer les stats
      const { data: allVeilles } = await supabase.from('veille_qualiopi').select('statut')
      if (allVeilles) {
        setVeilleStats({
          total: allVeilles.length,
          a_traiter: allVeilles.filter(v => v.statut === 'a_traiter').length,
          en_cours: allVeilles.filter(v => v.statut === 'en_cours').length,
          traite: allVeilles.filter(v => v.statut === 'traite').length
        })
      }
    }
  }

  const loadSources = async () => {
    const { data, error } = await supabase
      .from('veille_sources')
      .select('*')
      .order('name')
    
    if (!error && data?.length > 0) {
      setSources(data)
    } else {
      // Utiliser les sources par défaut si aucune en BDD
      setSources(VEILLE_SOURCES)
    }
  }

  const loadIndicators = async () => {
    try {
      // 1. Charger les sessions complétées
      const { data: allSessions } = await supabase.from('sessions').select('id, status')
      const completedSessionIds = (allSessions || []).filter(s => s.status === 'completed').map(s => s.id)
      
      // 2. Charger les évaluations à chaud (trainee_evaluations)
      const { data: hotEvals } = await supabase.from('trainee_evaluations').select('*')
      const filteredHotEvals = (hotEvals || []).filter(e => completedSessionIds.includes(e.session_id))
      
      // Calcul satisfaction (moyenne des NOUVELLES colonnes uniquement)
      let avgSatisfaction = null
      if (filteredHotEvals.length > 0) {
        // Uniquement les nouvelles colonnes (pas les anciennes qui ont des valeurs par défaut à 5)
        const newScoreKeys = [
          'q_org_accueil', 'q_org_documents', 'q_org_locaux', 'q_org_materiel',
          'q_contenu_supports', 'q_contenu_programme', 'q_contenu_organisation', 'q_contenu_duree',
          'q_formateur_pedagogie', 'q_formateur_expertise', 'q_formateur_progression', 'q_formateur_moyens',
          'q_global_adequation', 'q_global_competences'
        ]
        
        const allScores = []
        filteredHotEvals.forEach(e => {
          newScoreKeys.forEach(key => {
            if (e[key] !== null && e[key] !== undefined && !isNaN(e[key])) {
              allScores.push(Number(e[key]))
            }
          })
        })
        
        if (allScores.length > 0) {
          avgSatisfaction = (allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(2)
        }
      }

      // 3. Charger les résultats des stagiaires
      const { data: traineeResults } = await supabase.from('session_trainees').select('session_id, trainee_id, result, presence_complete')
      const filteredResults = (traineeResults || []).filter(r => completedSessionIds.includes(r.session_id))
      
      // Calcul taux de réussite (result === 'acquired' comme dans Indicateurs.jsx)
      let tauxReussite = null
      const resultsWithValue = filteredResults.filter(r => r.result && r.result !== '')
      if (resultsWithValue.length > 0) {
        const acquiredCount = resultsWithValue.filter(r => r.result === 'acquired' || r.result === 'Acquis').length
        tauxReussite = Math.round((acquiredCount / resultsWithValue.length) * 100)
      }
      
      // Calcul taux de présence (presence_complete === true)
      let tauxPresence = null
      if (filteredResults.length > 0) {
        const presentCount = filteredResults.filter(r => r.presence_complete === true).length
        tauxPresence = Math.round((presentCount / filteredResults.length) * 100)
      }

      // 4. Calcul recommandation (would_recommend === true, c'est un %)
      let tauxRecommandation = null
      const evalsWithRecommend = filteredHotEvals.filter(e => e.would_recommend !== null && e.would_recommend !== undefined)
      if (evalsWithRecommend.length > 0) {
        const recommendCount = evalsWithRecommend.filter(e => e.would_recommend === true).length
        tauxRecommandation = Math.round((recommendCount / evalsWithRecommend.length) * 100)
      }

      // 5. Stats supplémentaires
      const uniqueTrainees = new Set(filteredResults.map(t => t.trainee_id))
      const { data: reclam } = await supabase.from('reclamations').select('id')

      setIndicators({
        satisfaction: avgSatisfaction !== null ? parseFloat(avgSatisfaction) : null,
        reussite: tauxReussite,
        presence: tauxPresence,
        recommandation: tauxRecommandation,  // C'est un % maintenant, pas /5
        formations: completedSessionIds.length,
        stagiaires: uniqueTrainees.size,
        reclamations: (reclam || []).length
      })
    } catch (err) {
      console.error('Erreur chargement indicateurs:', err)
    }
  }

  const loadReclamations = async () => {
    const { data } = await supabase
      .from('reclamations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5)
    
    setReclamations(data || [])
  }

  // ═══════════════════════════════════════════════════════════════════
  // GESTION DES DOCUMENTS
  // ═══════════════════════════════════════════════════════════════════

  const openDocModal = (doc = null, newType = null) => {
    if (doc) {
      setEditingDoc(doc.id)
      setDocForm({
        type: doc.type,
        title: doc.title || DOCUMENT_TYPES[doc.type]?.label || '',
        content: doc.content || '',
        version: doc.version || '1.0'
      })
    } else {
      setEditingDoc(null)
      const type = newType || 'cgv'
      setDocForm({ 
        type: type, 
        title: DOCUMENT_TYPES[type]?.label || '', 
        content: '', 
        version: '1.0' 
      })
    }
    setShowDocModal(true)
  }

  const saveDocument = async () => {
    if (!docForm.content.trim()) {
      toast.error('Le contenu du document est requis')
      return
    }

    const dataToSave = {
      type: docForm.type,
      title: docForm.title || DOCUMENT_TYPES[docForm.type]?.label,
      content: docForm.content,
      version: docForm.version,
      updated_at: new Date().toISOString()
    }

    if (editingDoc) {
      const { error } = await supabase
        .from('qualiopi_documents')
        .update(dataToSave)
        .eq('id', editingDoc)
      
      if (error) {
        toast.error('Erreur lors de la sauvegarde')
      } else {
        toast.success('Document mis à jour')
        loadDocuments()
        setShowDocModal(false)
      }
    } else {
      // Vérifier si le type existe déjà
      const { data: existing } = await supabase
        .from('qualiopi_documents')
        .select('id')
        .eq('type', docForm.type)
        .maybeSingle()
      
      if (existing) {
        // Mettre à jour le document existant
        const { error } = await supabase
          .from('qualiopi_documents')
          .update(dataToSave)
          .eq('id', existing.id)
        
        if (error) {
          console.error(error)
          toast.error('Erreur lors de la mise à jour')
        } else {
          toast.success('Document mis à jour')
          loadDocuments()
          setShowDocModal(false)
        }
      } else {
        // Créer un nouveau document
        const { error } = await supabase
          .from('qualiopi_documents')
          .insert([dataToSave])
        
        if (error) {
          console.error(error)
          toast.error('Erreur lors de la création')
        } else {
          toast.success('Document créé')
          loadDocuments()
          setShowDocModal(false)
        }
      }
    }
  }

  const deleteDocument = async (id) => {
    if (!confirm('Supprimer ce document ?')) return
    
    const { error } = await supabase.from('qualiopi_documents').delete().eq('id', id)
    if (error) {
      toast.error('Erreur lors de la suppression')
    } else {
      toast.success('Document supprimé')
      loadDocuments()
    }
  }

  // Prévisualiser un document
  const previewDocument = (doc) => {
    const config = DOCUMENT_TYPES[doc.type]
    const content = doc.content || ''
    
    // Si le contenu est déjà du HTML complet, l'afficher directement
    if (content.trim().startsWith('<!DOCTYPE') || content.trim().startsWith('<html') || content.trim().startsWith('<HTML')) {
      const previewWindow = window.open('', '_blank')
      // Ajouter une barre d'outils au HTML existant
      const htmlWithToolbar = content.replace('</body>', `
        <div style="position:fixed;top:20px;right:20px;display:flex;gap:10px;z-index:1000;">
          <button onclick="window.print()" style="background:#1a5276;color:white;border:none;padding:12px 20px;border-radius:8px;cursor:pointer;font-size:14px;box-shadow:0 4px 15px rgba(0,0,0,0.2);">🖨️ Imprimer / PDF</button>
          <button onclick="window.close()" style="background:#1a5276;color:white;border:none;padding:12px 20px;border-radius:8px;cursor:pointer;font-size:14px;box-shadow:0 4px 15px rgba(0,0,0,0.2);">✕ Fermer</button>
        </div>
      </body>`)
      previewWindow.document.write(htmlWithToolbar)
      previewWindow.document.close()
      return
    }
    
    // Sinon, générer le HTML avec le template standard
    const htmlContent = `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>${doc.title || config?.label} - Access Formation</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.7; color: #333; background: #f5f5f5; }
        .container { max-width: 900px; margin: 0 auto; background: white; box-shadow: 0 0 30px rgba(0,0,0,0.1); min-height: 100vh; }
        .header { background: linear-gradient(135deg, #1a5276 0%, #2980b9 100%); color: white; padding: 40px; text-align: center; }
        .header h1 { font-size: 2em; margin-bottom: 8px; }
        .header .subtitle { font-size: 1em; opacity: 0.9; }
        .header .version { margin-top: 12px; font-size: 0.85em; opacity: 0.8; }
        .content { padding: 40px 50px; white-space: pre-wrap; font-size: 11pt; line-height: 1.8; }
        .footer { background: #2c3e50; color: white; padding: 25px; text-align: center; font-size: 0.9em; }
        .footer p { margin: 4px 0; }
        .toolbar { position: fixed; top: 20px; right: 20px; display: flex; gap: 10px; z-index: 1000; }
        .toolbar button { background: #1a5276; color: white; border: none; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
        .toolbar button:hover { background: #2980b9; }
        @media print { .toolbar { display: none; } body { background: white; } .container { box-shadow: none; } }
    </style>
</head>
<body>
    <div class="toolbar">
        <button onclick="window.print()">🖨️ Imprimer / PDF</button>
        <button onclick="window.close()">✕ Fermer</button>
    </div>
    <div class="container">
        <div class="header">
            <h1>${doc.title || config?.label}</h1>
            <div class="subtitle">Access Formation - Organisme de formation professionnelle</div>
            <div class="version">Version ${doc.version || '1.0'} | NDA : 53291026129</div>
        </div>
        <div class="content">${content.replace(/\n/g, '<br>')}</div>
        <div class="footer">
            <p><strong>ACCESS FORMATION</strong></p>
            <p>24 rue Kerbleiz - 29900 Concarneau</p>
            <p>Tél : 02 98 90 30 24 | Email : contact@accessformation.pro</p>
        </div>
    </div>
</body>
</html>`

    const previewWindow = window.open('', '_blank')
    previewWindow.document.write(htmlContent)
    previewWindow.document.close()
  }

  // Télécharger un document en PDF
  const downloadDocumentAsPDF = (doc) => {
    const config = DOCUMENT_TYPES[doc.type]
    const content = doc.content || ''
    
    // Si le contenu est déjà du HTML complet, l'utiliser directement
    if (content.trim().startsWith('<!DOCTYPE') || content.trim().startsWith('<html') || content.trim().startsWith('<HTML')) {
      const printWindow = window.open('', '_blank')
      printWindow.document.write(content)
      printWindow.document.close()
      printWindow.onload = () => {
        setTimeout(() => { printWindow.print() }, 250)
      }
      return
    }
    
    // Sinon, générer le HTML avec le template standard
    const htmlContent = `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>${doc.title || config?.label}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; padding: 40px; max-width: 800px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #1a5276 0%, #2980b9 100%); color: white; padding: 30px; margin: -40px -40px 30px -40px; text-align: center; }
        .header h1 { font-size: 1.8em; margin-bottom: 5px; }
        .header .subtitle { font-size: 0.95em; opacity: 0.9; }
        .header .version { margin-top: 10px; font-size: 0.85em; opacity: 0.8; }
        .content { white-space: pre-wrap; font-size: 11pt; }
        .content h2, .content h3 { color: #1a5276; margin: 20px 0 10px 0; }
        .content ul, .content ol { margin-left: 25px; }
        .content li { margin: 5px 0; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e0e0e0; text-align: center; font-size: 0.85em; color: #666; }
        @media print { 
            body { padding: 20px; } 
            .header { margin: -20px -20px 20px -20px; padding: 20px; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${doc.title || config?.label}</h1>
        <div class="subtitle">Access Formation - Organisme de formation professionnelle</div>
        <div class="version">Version ${doc.version || '1.0'} | NDA : 53291026129</div>
    </div>
    <div class="content">${content.replace(/\n/g, '<br>')}</div>
    <div class="footer">
        <p><strong>ACCESS FORMATION</strong></p>
        <p>24 rue Kerbleiz - 29900 Concarneau</p>
        <p>Tél : 02 98 90 30 24 | Email : contact@accessformation.pro</p>
    </div>
</body>
</html>`

    const printWindow = window.open('', '_blank')
    printWindow.document.write(htmlContent)
    printWindow.document.close()
    
    // Attendre que le contenu soit chargé puis lancer l'impression
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print()
      }, 250)
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // GESTION DES SOURCES DE VEILLE
  // ═══════════════════════════════════════════════════════════════════

  const saveSource = async () => {
    if (!sourceForm.name || !sourceForm.url) {
      toast.error('Nom et URL requis')
      return
    }

    const { error } = await supabase
      .from('veille_sources')
      .insert([sourceForm])
    
    if (error) {
      toast.error('Erreur lors de l\'ajout')
    } else {
      toast.success('Source ajoutée')
      loadSources()
      setShowSourceModal(false)
      setSourceForm({ name: '', url: '', type: 'legale', description: '' })
    }
  }

  const deleteSource = async (id) => {
    if (!confirm('Supprimer cette source ?')) return
    
    const { error } = await supabase.from('veille_sources').delete().eq('id', id)
    if (!error) {
      toast.success('Source supprimée')
      loadSources()
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <Award className="w-8 h-8 text-primary-600" />
            Espace Qualiopi
          </h1>
          <p className="text-gray-600 mt-1">Gestion qualité et conformité Qualiopi</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium flex items-center gap-1">
            <CheckCircle className="w-4 h-4" />
            Habilitation INRS : H37007/2025/SST-1/O/13
          </span>
        </div>
      </div>

      {/* Navigation par onglets */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-4">
          {[
            { id: 'dashboard', label: 'Tableau de bord', icon: TrendingUp },
            { id: 'documents', label: 'Documents', icon: FileText },
            { id: 'process', label: 'Process', icon: Target },
            { id: 'veille', label: 'Veille', icon: Eye },
            { id: 'sources', label: 'Sources', icon: Rss }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-600 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <tab.icon className="w-5 h-5" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ONGLET: Tableau de bord */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Indicateurs clés */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            <IndicatorCard 
              icon={Star} 
              label="Satisfaction" 
              value={indicators.satisfaction !== null ? `${indicators.satisfaction}/5` : 'N/A'}
              color={indicators.satisfaction !== null ? (indicators.satisfaction >= 4 ? 'green' : indicators.satisfaction >= 3 ? 'yellow' : 'red') : 'gray'}
            />
            <IndicatorCard 
              icon={Target} 
              label="Réussite" 
              value={indicators.reussite !== null ? `${indicators.reussite}%` : 'N/A'}
              color={indicators.reussite !== null ? (indicators.reussite >= 80 ? 'green' : indicators.reussite >= 60 ? 'yellow' : 'red') : 'gray'}
            />
            <IndicatorCard 
              icon={UserCheck} 
              label="Présence" 
              value={indicators.presence !== null ? `${indicators.presence}%` : 'N/A'}
              color={indicators.presence !== null ? (indicators.presence >= 90 ? 'green' : indicators.presence >= 75 ? 'yellow' : 'red') : 'gray'}
            />
            <IndicatorCard 
              icon={ThumbsUp} 
              label="Recommandation" 
              value={indicators.recommandation !== null ? `${indicators.recommandation}%` : 'N/A'}
              color={indicators.recommandation !== null ? (indicators.recommandation >= 80 ? 'green' : indicators.recommandation >= 60 ? 'yellow' : 'red') : 'gray'}
            />
            <IndicatorCard 
              icon={BookOpen} 
              label="Formations" 
              value={indicators.formations}
              color="blue"
            />
            <IndicatorCard 
              icon={Users} 
              label="Stagiaires" 
              value={indicators.stagiaires}
              color="blue"
            />
            <IndicatorCard 
              icon={AlertTriangle} 
              label="Réclamations" 
              value={indicators.reclamations}
              color={indicators.reclamations === 0 ? 'green' : 'orange'}
            />
          </div>

          {/* État des documents et veilles */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Documents */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary-600" />
                  Documents obligatoires
                </h3>
                <button onClick={() => setActiveTab('documents')} className="text-sm text-primary-600 hover:underline">
                  Voir tout →
                </button>
              </div>
              <div className="space-y-2">
                {Object.entries(DOCUMENT_TYPES).filter(([_, v]) => v.required).map(([key, config]) => {
                  const doc = documents.find(d => d.type === key)
                  return (
                    <div key={key} className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50">
                      <div className="flex items-center gap-2">
                        <config.icon className="w-4 h-4 text-gray-400" />
                        <span className="text-sm">{config.label}</span>
                      </div>
                      {doc ? (
                        <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" /> v{doc.version}
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> Manquant
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Veilles */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Eye className="w-5 h-5 text-primary-600" />
                  État des veilles
                </h3>
                <button onClick={() => setActiveTab('veille')} className="text-sm text-primary-600 hover:underline">
                  Voir tout →
                </button>
              </div>
              <div className="grid grid-cols-4 gap-3 mb-4">
                <div className="text-center p-2 bg-gray-50 rounded-lg">
                  <div className="text-2xl font-bold text-gray-900">{veilleStats.total}</div>
                  <div className="text-xs text-gray-500">Total</div>
                </div>
                <div className="text-center p-2 bg-red-50 rounded-lg">
                  <div className="text-2xl font-bold text-red-600">{veilleStats.a_traiter}</div>
                  <div className="text-xs text-red-600">À traiter</div>
                </div>
                <div className="text-center p-2 bg-yellow-50 rounded-lg">
                  <div className="text-2xl font-bold text-yellow-600">{veilleStats.en_cours}</div>
                  <div className="text-xs text-yellow-600">En cours</div>
                </div>
                <div className="text-center p-2 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{veilleStats.traite}</div>
                  <div className="text-xs text-green-600">Traités</div>
                </div>
              </div>
              {veilles.slice(0, 3).map(v => (
                <div key={v.id} className="flex items-center justify-between p-2 border-b last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{v.sujet}</p>
                    <p className="text-xs text-gray-500">{v.source}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    v.statut === 'traite' ? 'bg-green-100 text-green-700' :
                    v.statut === 'en_cours' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {STATUTS[v.statut]?.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Réclamations récentes */}
          {reclamations.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
                <AlertTriangle className="w-5 h-5 text-orange-500" />
                Réclamations récentes
              </h3>
              <div className="space-y-2">
                {reclamations.map(r => (
                  <div key={r.id} className="flex items-center justify-between p-3 bg-orange-50 rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">{r.subject}</p>
                      <p className="text-sm text-gray-500">{format(new Date(r.created_at), 'd MMM yyyy', { locale: fr })}</p>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      r.status === 'resolved' ? 'bg-green-100 text-green-700' :
                      r.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {r.status === 'resolved' ? 'Résolu' : r.status === 'in_progress' ? 'En cours' : 'Nouveau'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ONGLET: Documents */}
      {activeTab === 'documents' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Documents Qualiopi</h2>
            <button onClick={() => openDocModal()} className="btn btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Nouveau document
            </button>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(DOCUMENT_TYPES).map(([key, config]) => {
              const doc = documents.find(d => d.type === key)
              return (
                <div key={key} className={`card border-2 ${doc ? 'border-green-200' : config.required ? 'border-red-200' : 'border-gray-200'}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`p-2 rounded-lg ${doc ? 'bg-green-100' : config.required ? 'bg-red-100' : 'bg-gray-100'}`}>
                        <config.icon className={`w-5 h-5 ${doc ? 'text-green-600' : config.required ? 'text-red-600' : 'text-gray-600'}`} />
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">{config.label}</h3>
                        {config.required && <span className="text-xs text-red-500">Obligatoire</span>}
                      </div>
                    </div>
                    {doc && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                        v{doc.version}
                      </span>
                    )}
                  </div>
                  
                  {doc ? (
                    <div className="space-y-2">
                      <p className="text-sm text-gray-500 line-clamp-2">{doc.content?.substring(0, 100)}...</p>
                      <p className="text-xs text-gray-400">
                        Mis à jour le {format(new Date(doc.updated_at), 'd MMM yyyy', { locale: fr })}
                      </p>
                      <div className="flex gap-1 pt-2">
                        <button onClick={() => previewDocument(doc)} className="btn btn-sm btn-secondary flex-1 flex items-center justify-center gap-1" title="Afficher">
                          <Eye className="w-3 h-3" /> Afficher
                        </button>
                        <button onClick={() => downloadDocumentAsPDF(doc)} className="btn btn-sm btn-primary flex-1 flex items-center justify-center gap-1" title="Télécharger en PDF">
                          <Download className="w-3 h-3" /> PDF
                        </button>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => openDocModal(doc)} className="btn btn-sm btn-outline flex-1 flex items-center justify-center gap-1">
                          <Edit className="w-3 h-3" /> Modifier
                        </button>
                        <button onClick={() => deleteDocument(doc.id)} className="btn btn-sm text-red-600 hover:bg-red-50 px-3">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => openDocModal(null, key)} className="w-full btn btn-secondary flex items-center justify-center gap-2">
                      <Plus className="w-4 h-4" />
                      Créer ce document
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ONGLET: Process */}
      {activeTab === 'process' && (
        <div className="bg-white rounded-xl shadow-sm border" style={{ height: 'calc(100vh - 280px)' }}>
          <ProcessEditor />
        </div>
      )}

      {/* ONGLET: Veille */}
      {activeTab === 'veille' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Veille Qualiopi</h2>
            <a href="#/veille-qualiopi" className="btn btn-primary flex items-center gap-2">
              <ExternalLink className="w-4 h-4" />
              Ouvrir le gestionnaire complet
            </a>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {Object.entries(VEILLE_TYPES).map(([key, config]) => {
              const count = veilles.filter(v => v.type === key).length
              const pending = veilles.filter(v => v.type === key && v.statut === 'a_traiter').length
              return (
                <div key={key} className="card">
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`p-2 rounded-lg bg-${config.color}-100`}>
                      <config.icon className={`w-5 h-5 text-${config.color}-600`} />
                    </div>
                    <div>
                      <h3 className="font-medium">{config.label}</h3>
                      <p className="text-sm text-gray-500">{count} entrées</p>
                    </div>
                  </div>
                  {pending > 0 && (
                    <div className="text-sm text-red-600 bg-red-50 p-2 rounded-lg flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      {pending} à traiter
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Liste des veilles récentes */}
          <div className="card">
            <h3 className="font-semibold mb-4">Dernières entrées de veille</h3>
            <div className="space-y-3">
              {veilles.length === 0 ? (
                <p className="text-gray-500 text-center py-4">Aucune entrée de veille</p>
              ) : (
                veilles.map(v => (
                  <div key={v.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      {VEILLE_TYPES[v.type] && (() => {
                        const Icon = VEILLE_TYPES[v.type].icon;
                        return <Icon className={`w-5 h-5 text-${VEILLE_TYPES[v.type].color}-500`} />;
                      })()}
                      <div>
                        <p className="font-medium">{v.sujet}</p>
                        <p className="text-sm text-gray-500">{v.source} • {format(new Date(v.date), 'd MMM yyyy', { locale: fr })}</p>
                      </div>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      v.statut === 'traite' ? 'bg-green-100 text-green-700' :
                      v.statut === 'en_cours' ? 'bg-yellow-100 text-yellow-700' :
                      v.statut === 'archive' ? 'bg-gray-100 text-gray-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {STATUTS[v.statut]?.label}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ONGLET: Sources */}
      {activeTab === 'sources' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Sources de veille</h2>
            <button onClick={() => setShowSourceModal(true)} className="btn btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Ajouter une source
            </button>
          </div>

          <p className="text-gray-600">
            Configurez vos sources de veille pour rester informé des évolutions réglementaires, pédagogiques et métiers.
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sources.map(source => (
              <div key={source.id || source.name} className="card border hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${
                      source.type === 'legale' ? 'bg-blue-100' :
                      source.type === 'metiers' ? 'bg-green-100' : 'bg-purple-100'
                    }`}>
                      <Globe className={`w-5 h-5 ${
                        source.type === 'legale' ? 'text-blue-600' :
                        source.type === 'metiers' ? 'text-green-600' : 'text-purple-600'
                      }`} />
                    </div>
                    <div>
                      <h3 className="font-medium">{source.name}</h3>
                      <span className="text-xs text-gray-500">{VEILLE_TYPES[source.type]?.label}</span>
                    </div>
                  </div>
                  {source.id && typeof source.id === 'string' && source.id.includes('-') && (
                    <button onClick={() => deleteSource(source.id)} className="text-gray-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                
                {source.description && (
                  <p className="text-sm text-gray-500 mt-2">{source.description}</p>
                )}
                
                <a 
                  href={source.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="mt-3 flex items-center gap-2 text-sm text-primary-600 hover:underline"
                >
                  <Link2 className="w-4 h-4" />
                  Accéder au site
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL: Document */}
      {showDocModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b bg-primary-500 text-white flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <FileText className="w-5 h-5" />
                {editingDoc ? 'Modifier le document' : 'Nouveau document'}
              </h2>
              <button onClick={() => setShowDocModal(false)} className="p-1 hover:bg-white/20 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4 space-y-4 flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Type de document</label>
                  <select
                    value={docForm.type}
                    onChange={(e) => setDocForm({ ...docForm, type: e.target.value, title: DOCUMENT_TYPES[e.target.value]?.label || '' })}
                    className="input"
                  >
                    {Object.entries(DOCUMENT_TYPES).map(([key, config]) => (
                      <option key={key} value={key}>{config.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Version</label>
                  <input
                    type="text"
                    value={docForm.version}
                    onChange={(e) => setDocForm({ ...docForm, version: e.target.value })}
                    className="input"
                    placeholder="Ex: 1.0, 2.1..."
                  />
                </div>
              </div>
              
              <div>
                <label className="label">Titre</label>
                <input
                  type="text"
                  value={docForm.title}
                  onChange={(e) => setDocForm({ ...docForm, title: e.target.value })}
                  className="input"
                  placeholder="Titre du document"
                />
              </div>
              
              <div className="flex-1">
                <label className="label">Contenu du document</label>
                <textarea
                  value={docForm.content}
                  onChange={(e) => setDocForm({ ...docForm, content: e.target.value })}
                  className="input min-h-[400px] font-mono text-sm"
                  placeholder="Saisissez le contenu du document..."
                />
              </div>
            </div>
            
            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50">
              <button onClick={() => setShowDocModal(false)} className="btn btn-secondary">Annuler</button>
              <button onClick={saveDocument} className="btn btn-primary flex items-center gap-2">
                <Save className="w-4 h-4" />
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Source */}
      {/* Texte explicatif Qualiopi */}
      <div className="card p-6 bg-purple-50 border border-purple-200 mt-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Info className="w-5 h-5 text-purple-500" />
          Indicateurs Qualiopi - certification Qualiopi
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm text-gray-700">
          <div>
            <h4 className="font-semibold text-purple-800 mb-2">Taux de Satisfaction (Indicateur 32)</h4>
            <p className="mb-2">Moyenne des évaluations à chaud sur 14 critères :</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li><strong>Organisation</strong> : documents, accueil, locaux, matériel</li>
              <li><strong>Contenu</strong> : organisation, supports, durée, programme</li>
              <li><strong>Formateur</strong> : pédagogie, expertise, progression, moyens</li>
              <li><strong>Perception</strong> : adéquation métier, amélioration compétences</li>
            </ul>
            <p className="mt-2 text-xs italic">Objectif Qualiopi : ≥ 4/5 (80%)</p>
          </div>
          <div>
            <h4 className="font-semibold text-purple-800 mb-2">Taux de Réussite (Indicateur 3)</h4>
            <p className="mb-2">Pourcentage de stagiaires ayant atteint les objectifs :</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>Tous les objectifs pédagogiques validés</li>
              <li>Présence complète (100% des demi-journées)</li>
            </ul>
            <p className="mt-2 text-xs italic">Objectif Qualiopi : ≥ 80%</p>
          </div>
          <div>
            <h4 className="font-semibold text-purple-800 mb-2">Taux de Présence (Indicateur 11)</h4>
            <p className="mb-2">Suivi de l'assiduité des stagiaires :</p>
            <p className="text-xs">= Stagiaires avec 100% présence / Total stagiaires</p>
            <p className="mt-2 text-xs italic">Objectif Qualiopi : ≥ 90%</p>
          </div>
          <div>
            <h4 className="font-semibold text-purple-800 mb-2">Taux de Recommandation (Indicateur 32)</h4>
            <p className="mb-2">Mesure de la satisfaction client :</p>
            <p className="text-xs">Question : "Recommanderiez-vous cette formation ?"</p>
            <p className="mt-2 text-xs italic">Objectif Qualiopi : ≥ 90%</p>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-purple-200 text-xs text-purple-700">
          <p><strong>Note :</strong> Ces indicateurs sont calculés uniquement sur les sessions terminées (statut "Completed"). Les notes de 1 à 3/5 génèrent des alertes qualité à traiter pour démontrer l'amélioration continue.</p>
        </div>
      </div>
      
      {showSourceModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full">
            <div className="p-4 border-b bg-primary-500 text-white flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Rss className="w-5 h-5" />
                Ajouter une source de veille
              </h2>
              <button onClick={() => setShowSourceModal(false)} className="p-1 hover:bg-white/20 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              <div>
                <label className="label">Nom de la source *</label>
                <input
                  type="text"
                  value={sourceForm.name}
                  onChange={(e) => setSourceForm({ ...sourceForm, name: e.target.value })}
                  className="input"
                  placeholder="Ex: INRS, OPPBTP..."
                />
              </div>
              
              <div>
                <label className="label">URL du site *</label>
                <input
                  type="url"
                  value={sourceForm.url}
                  onChange={(e) => setSourceForm({ ...sourceForm, url: e.target.value })}
                  className="input"
                  placeholder="https://..."
                />
              </div>
              
              <div>
                <label className="label">Type de veille</label>
                <select
                  value={sourceForm.type}
                  onChange={(e) => setSourceForm({ ...sourceForm, type: e.target.value })}
                  className="input"
                >
                  {Object.entries(VEILLE_TYPES).map(([key, config]) => (
                    <option key={key} value={key}>{config.label}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="label">Description</label>
                <textarea
                  value={sourceForm.description}
                  onChange={(e) => setSourceForm({ ...sourceForm, description: e.target.value })}
                  className="input"
                  rows={2}
                  placeholder="Description de la source..."
                />
              </div>
            </div>
            
            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50">
              <button onClick={() => setShowSourceModal(false)} className="btn btn-secondary">Annuler</button>
              <button onClick={saveSource} className="btn btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Ajouter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// COMPOSANTS AUXILIAIRES
// ═══════════════════════════════════════════════════════════════════

function IndicatorCard({ icon: Icon, label, value, color }) {
  const colors = {
    green: 'bg-green-50 text-green-700 border-green-200',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
    gray: 'bg-gray-50 text-gray-500 border-gray-200'
  }
  
  return (
    <div className={`p-4 rounded-xl border-2 ${colors[color] || colors.blue}`}>
      <Icon className="w-5 h-5 mb-2 opacity-70" />
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs opacity-80">{label}</div>
    </div>
  )
}
