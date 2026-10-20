import { useEffect, useState, useRef } from 'react'
import { useDataStore } from '../../../core/store'
import { 
  FileText, Download, Trash2, Upload, Search, Filter, 
  X, FolderOpen, File, Image, FileSpreadsheet, Paperclip,
  Plus, Eye, ExternalLink, BookOpen, ClipboardList, Loader2, PenTool, Sparkles
} from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { downloadDocument, setOrganization } from '../pdf/pdfGenerator'
import CourierEditor from './CourierEditor'
import { useDroits } from '../../../core/rights/useDroit'
import SearchSelect, { courseOptions } from '../../../ui/SearchSelect'

import { confirmer } from '../../../ui/Confirm'
import { ouvrirFichier, readableUrl } from '../../../core/storageUtils'
const categories = [
  { id: 'all', name: 'Tous' },
  { id: 'programme', name: 'Programmes' },
  { id: 'support', name: 'Supports de formation' },
  { id: 'convocation', name: 'Convocations' },
  { id: 'attestation', name: 'Attestations' },
  { id: 'autre', name: 'Autres' },
]

const getFileIcon = (mimeType) => {
  if (!mimeType) return File
  if (mimeType.startsWith('image/')) return Image
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return FileSpreadsheet
  if (mimeType.includes('pdf')) return FileText
  return File
}

const formatFileSize = (bytes) => {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function Documents() {
  const d = useDroits({
    modifier: 'formation.documents.modifier',
    supprimer: 'formation.documents.supprimer',
  })
  const { 
    uploadedFiles, uploadedFilesLoading, fetchUploadedFiles, 
    uploadFile, deleteUploadedFile,
    sessions, fetchSessions,
    courses, fetchCourses,
    clients, fetchClients,
    organization, fetchOrganization,
    themes, fetchThemes, fetchThemeQuestions
  } = useDataStore()
  
  const [activeTab, setActiveTab] = useState('uploaded')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [showUpload, setShowUpload] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [loadingTheme, setLoadingTheme] = useState(null)
  const fileInputRef = useRef(null)
  
  const [uploadForm, setUploadForm] = useState({
    name: '',
    category: 'autre',
    session_id: '',
    course_id: '',
    client_id: '',
    notes: '',
  })
  const [selectedFile, setSelectedFile] = useState(null)
  
  useEffect(() => {
    fetchUploadedFiles()
    fetchSessions()
    fetchCourses()
    fetchClients()
    fetchOrganization()
    fetchThemes()
  }, [])
  
  useEffect(() => {
    if (organization) {
      setOrganization(organization)
    }
  }, [organization])
  
  const filteredFiles = uploadedFiles.filter(file => {
    const matchesSearch = 
      file.name?.toLowerCase().includes(search.toLowerCase()) ||
      file.filename?.toLowerCase().includes(search.toLowerCase())
    const matchesCategory = categoryFilter === 'all' || file.category === categoryFilter
    return matchesSearch && matchesCategory
  })
  
  // Helpers pour docs vierges
  const getThemeColor = (themeName) => {
    if (!themeName) return '#6b7280'
    const name = themeName.toLowerCase()
    if (name.includes('secourisme') || name.includes('sst') || name.includes('psc')) return '#22c55e'
    if (name.includes('incendie') || name.includes('epi') || name.includes('évacuation')) return '#ef4444'
    if (name.includes('électri') || name.includes('habilitation') || name.includes('hab')) return '#eab308'
    if (name.includes('r489') || name.includes('r485') || name.includes('conduite') || name.includes('chariot') || name.includes('nacelle')) return '#1f2937'
    if (name.includes('ergonomie') || name.includes('gestes') || name.includes('postures') || name.includes('prap')) return '#3b82f6'
    return '#6b7280'
  }
  
  const handleDownloadVierge = (docType) => {
    try {
      downloadDocument(docType, null, { isBlank: true })
      toast.success('Document téléchargé')
    } catch (error) {
      console.error(error)
      toast.error('Erreur lors du téléchargement')
    }
  }
  
  const handleDownloadThemeTest = async (theme) => {
    setLoadingTheme(theme.id)
    try {
      const { data: questions } = await fetchThemeQuestions(theme.id)
      if (!questions || questions.length === 0) {
        toast.error(`Aucune question pour le thème ${theme.name}`)
        setLoadingTheme(null)
        return
      }
      downloadDocument('positionnement', null, { isBlank: true, questions, themeName: theme.name })
      toast.success('Test téléchargé')
    } catch (error) {
      console.error(error)
      toast.error('Erreur lors du téléchargement')
    }
    setLoadingTheme(null)
  }
  
  const adminDocs = [
    { id: 'reglement', label: 'Règlement intérieur', qualiopi: '9' },
    { id: 'livret', label: 'Livret d\'accueil', qualiopi: '1' },
    { id: 'analyseBesoin', label: 'Analyse du besoin', qualiopi: '4' },
  ]
  
  const formationDocs = [
    { id: 'emargement', label: 'Feuille d\'émargement (10 lignes)', qualiopi: '11' },
    { id: 'ficheRenseignements', label: 'Fiche de renseignements stagiaire', qualiopi: '4' },
    { id: 'evaluation', label: 'Évaluation à chaud', qualiopi: '30' },
    { id: 'evaluationFroid', label: 'Évaluation à froid', qualiopi: '30' },
    { id: 'evaluationFormateur', label: 'Évaluation formateur', qualiopi: '17' },
  ]
  
  const handleDrag = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }
  
  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0])
    }
  }
  
  const handleFileSelect = (file) => {
    setSelectedFile(file)
    setUploadForm({ ...uploadForm, name: file.name })
    setShowUpload(true)
  }
  
  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0])
    }
  }
  
  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error('Sélectionnez un fichier')
      return
    }
    
    setUploading(true)
    
    const { data, error } = await uploadFile(selectedFile, {
      name: uploadForm.name || selectedFile.name,
      category: uploadForm.category,
      session_id: uploadForm.session_id || null,
      course_id: uploadForm.course_id || null,
      client_id: uploadForm.client_id || null,
      notes: uploadForm.notes,
    })
    
    setUploading(false)
    
    if (error) {
      console.error(error)
      toast.error('Erreur lors de l\'upload')
    } else {
      toast.success('Fichier uploadé avec succès')
      resetUploadForm()
    }
  }
  
  const resetUploadForm = () => {
    setSelectedFile(null)
    setUploadForm({
      name: '',
      category: 'autre',
      session_id: '',
      course_id: '',
      client_id: '',
      notes: '',
    })
    setShowUpload(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }
  
  const handleDelete = async (file) => {
    if (!await confirmer(`Supprimer le fichier "${file.name}" ?`)) return
    
    const { error } = await deleteUploadedFile(file.id, file.file_url)
    
    if (error) {
      toast.error('Erreur lors de la suppression')
    } else {
      toast.success('Fichier supprimé')
    }
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Documents</h1>
          <p className="text-gray-500 mt-1">Fichiers uploadés et documents vierges</p>
        </div>
        {activeTab === 'uploaded' && d.modifier && (
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="btn btn-primary flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            Téléverser un fichier
          </button>
        )}
        {activeTab === 'editeur' && (
          <div className="flex items-center gap-2 text-ui text-[rgb(var(--c-warning))] bg-[rgb(var(--c-warning-bg))] px-3 py-1.5 rounded-ui-sm">
            <Sparkles className="w-4 h-4" />
            Assistant IA intégré
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileInputChange}
          className="hidden"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif"
        />
      </div>
      
      {/* Onglets */}
      <div className="border-b border-gray-200">
        <nav className="flex overflow-x-auto whitespace-nowrap gap-4">
          <button
            onClick={() => setActiveTab('uploaded')}
            className={`pb-3 px-1 border-b-2 font-medium text-ui transition-colors ${
              activeTab === 'uploaded' 
                ? 'border-primary-500 text-primary-600' 
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4" />
              Fichiers uploadés
              <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-ui-sm">{uploadedFiles.length}</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('vierges')}
            className={`pb-3 px-1 border-b-2 font-medium text-ui transition-colors ${
              activeTab === 'vierges' 
                ? 'border-primary-500 text-primary-600' 
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Documents vierges
            </div>
          </button>
          <button
            onClick={() => setActiveTab('editeur')}
            className={`pb-3 px-1 border-b-2 font-medium text-ui transition-colors ${
              activeTab === 'editeur' 
                ? 'border-primary-500 text-primary-600' 
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <PenTool className="w-4 h-4" />
               Éditeur courrier
            </div>
          </button>
        </nav>
      </div>
      
      {/* Contenu onglet Fichiers uploadés */}
      {activeTab === 'uploaded' && (
        <>
          {/* Zone de drag & drop */}
          {d.modifier && (
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-ui p-8 text-center transition-colors ${
              dragActive 
                ? 'border-primary-500 bg-primary-50' 
                : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <FolderOpen className={`w-12 h-12 mx-auto mb-4 ${dragActive ? 'text-primary-500' : 'text-gray-400'}`} />
            <p className="text-gray-600 mb-2">
              Glissez-déposez vos fichiers ici
            </p>
            <p className="text-ui text-gray-400">
              ou cliquez sur le bouton "Téléverser"
            </p>
            <p className="text-ui-sm text-gray-400 mt-2">
              Formats acceptés : PDF, Word, Excel, PowerPoint, Images
            </p>
          </div>
          )}
      
          {/* Filtres */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher un fichier..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input pl-10"
              />
            </div>
            <nav className="flex gap-2 overflow-x-auto pb-2">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setCategoryFilter(cat.id)}
                  className={`px-3 py-1.5 rounded-ui-sm text-ui whitespace-nowrap shrink-0 transition-colors ${
                    categoryFilter === cat.id
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </nav>
          </div>
      
          {/* Liste des fichiers */}
          <div className="card p-0 overflow-hidden">
            {uploadedFilesLoading ? (
              <div className="p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
              </div>
            ) : filteredFiles.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                {search || categoryFilter !== 'all' 
                  ? 'Aucun fichier trouvé' 
                  : 'Aucun fichier téléversé. Commencez par glisser-déposer un fichier ci-dessus.'}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {filteredFiles.map((file) => {
                  const FileIcon = getFileIcon(file.mime_type)
                  return (
                    <div key={file.id} className="p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 bg-gray-100 rounded-ui-sm flex items-center justify-center flex-shrink-0">
                            <FileIcon className="w-5 h-5 text-gray-600" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 truncate">{file.name}</p>
                            <div className="flex items-center gap-2 text-ui text-gray-500">
                              <span className="capitalize">{file.category || 'Autre'}</span>
                              <span>•</span>
                              <span>{formatFileSize(file.file_size)}</span>
                              {file.sessions?.reference && (
                                <>
                                  <span>•</span>
                                  <span>{file.sessions.reference}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <span className="text-ui text-gray-400 hidden sm:block">
                            {file.created_at && format(new Date(file.created_at), 'd MMM yyyy', { locale: fr })}
                          </span>
                          <a
                            href={file.file_url} onClick={(e) => { e.preventDefault(); ouvrirFichier(file.file_url).catch((err) => toast.error(err.message)) }}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 hover:bg-gray-100 rounded-ui-sm"
                            title="Voir"
                          >
                            <Eye className="w-4 h-4 text-gray-400" />
                          </a>
                          <a
                            href={file.file_url} onClick={(e) => { e.preventDefault(); ouvrirFichier(file.file_url).catch((err) => toast.error(err.message)) }}
                        download={file.filename}
                        className="p-2 hover:bg-gray-100 rounded-ui-sm"
                        title="Télécharger"
                      >
                        <Download className="w-4 h-4 text-gray-400" />
                      </a>
                      {d.supprimer && (
                      <button
                        onClick={() => handleDelete(file)}
                        className="p-2 hover:bg-[rgb(var(--c-danger-bg))] rounded-ui-sm"
                        title="Supprimer"
                      >
                        <Trash2 className="w-4 h-4 text-[rgb(var(--c-danger))]" />
                      </button>
                      )}
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
      
      {/* Contenu onglet Documents vierges */}
      {activeTab === 'vierges' && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Documents administratifs */}
          <div className="card">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-ui-sm bg-[rgb(var(--c-info))]">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <h2 className="font-semibold">Documents administratifs</h2>
            </div>
            <div className="space-y-2">
              {adminDocs.map(doc => (
                <button
                  key={doc.id}
                  onClick={() => handleDownloadVierge(doc.id)}
                  className="w-full flex items-center justify-between p-3 rounded-ui-sm border hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-ui">{doc.label}</span>
                    <span className="text-ui-sm px-1.5 py-0.5 rounded bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]">Q{doc.qualiopi}</span>
                  </div>
                  <Download className="w-4 h-4 text-gray-400" />
                </button>
              ))}
            </div>
          </div>
          
          {/* Documents formation */}
          <div className="card">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-ui-sm bg-[rgb(var(--c-success))]">
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              <h2 className="font-semibold">Documents formation</h2>
            </div>
            <div className="space-y-2">
              {formationDocs.map(doc => (
                <button
                  key={doc.id}
                  onClick={() => handleDownloadVierge(doc.id)}
                  className="w-full flex items-center justify-between p-3 rounded-ui-sm border hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-ui">{doc.label}</span>
                    <span className="text-ui-sm px-1.5 py-0.5 rounded bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]">Q{doc.qualiopi}</span>
                  </div>
                  <Download className="w-4 h-4 text-gray-400" />
                </button>
              ))}
            </div>
          </div>
          
          {/* Tests de positionnement par thème */}
          <div className="card">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-ui-sm bg-gray-700">
                <ClipboardList className="w-5 h-5 text-white" />
              </div>
              <h2 className="font-semibold">Tests de positionnement</h2>
            </div>
            <p className="text-ui-sm text-gray-500 mb-3">
              Tests par thème de formation
            </p>
            <div className="space-y-2">
              {themes.length === 0 ? (
                <p className="text-ui text-gray-500 p-3">Chargement des thèmes...</p>
              ) : (
                themes.map(theme => (
                  <button
                    key={theme.id}
                    onClick={() => handleDownloadThemeTest(theme)}
                    disabled={loadingTheme === theme.id}
                    className="w-full flex items-center justify-between p-3 rounded-ui-sm border hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: getThemeColor(theme.name) }}
                      />
                      <span className="text-ui">Test {theme.name}</span>
                      <span className="text-ui-sm px-1.5 py-0.5 rounded bg-gray-100 text-gray-800">Q8</span>
                    </div>
                    {loadingTheme === theme.id ? (
                      <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Modal d'upload */}
      {showUpload && d.modifier && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={resetUploadForm} />
          <div className="relative min-h-full flex items-center justify-center p-4">
            <div className="relative bg-white rounded-ui shadow-md w-full max-w-md animate-fadeIn">
              <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold">Téléverser un fichier</h2>
                <button onClick={resetUploadForm} className="p-1 hover:bg-gray-100 rounded">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-4 space-y-4">
                {/* Fichier sélectionné */}
                {selectedFile && (
                  <div className="p-3 bg-gray-50 rounded-ui-sm flex items-center gap-3">
                    <Paperclip className="w-5 h-5 text-gray-400" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ui truncate">{selectedFile.name}</p>
                      <p className="text-ui-sm text-gray-500">{formatFileSize(selectedFile.size)}</p>
                    </div>
                    <button 
                      onClick={() => setSelectedFile(null)}
                      className="p-1 hover:bg-gray-200 rounded"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
                
                <div>
                  <label className="label">Nom du document</label>
                  <input
                    type="text"
                    value={uploadForm.name}
                    onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })}
                    className="input"
                    placeholder="Nom affiché"
                  />
                </div>
                
                <div>
                  <label className="label">Catégorie</label>
                  <select
                    value={uploadForm.category}
                    onChange={(e) => setUploadForm({ ...uploadForm, category: e.target.value })}
                    className="input"
                  >
                    <option value="programme">Programme</option>
                    <option value="support">Support de formation</option>
                    <option value="convocation">Convocation</option>
                    <option value="attestation">Attestation</option>
                    <option value="autre">Autre</option>
                  </select>
                </div>
                
                <div>
                  <label className="label">Lier à une session (optionnel)</label>
                  <SearchSelect
                    value={uploadForm.session_id}
                    onChange={(v) => setUploadForm({ ...uploadForm, session_id: v })}
                    options={sessions.map(s => ({ value: s.id, label: s.reference, hint: s.courses?.title || '' }))}
                    emptyLabel="-- Aucune --" searchPlaceholder="Référence ou formation..." aria-label="Session" />
                </div>
                
                <div>
                  <label className="label">Lier à une formation (optionnel)</label>
                  <SearchSelect
                    value={uploadForm.course_id}
                    onChange={(v) => setUploadForm({ ...uploadForm, course_id: v })}
                    options={courseOptions(courses)}
                    emptyLabel="-- Aucune --" searchPlaceholder="Rechercher une formation..." aria-label="Formation" />
                </div>
                
                <div>
                  <label className="label">Notes (optionnel)</label>
                  <textarea
                    value={uploadForm.notes}
                    onChange={(e) => setUploadForm({ ...uploadForm, notes: e.target.value })}
                    className="input"
                    rows={2}
                    placeholder="Informations complémentaires..."
                  />
                </div>
                
                <div className="flex justify-end gap-3 pt-4">
                  <button onClick={resetUploadForm} className="btn btn-secondary">
                    Annuler
                  </button>
                  <button 
                    onClick={handleUpload} 
                    className="btn btn-primary flex items-center gap-2"
                    disabled={uploading || !selectedFile}
                  >
                    {uploading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                        Upload...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        Téléverser
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contenu onglet Éditeur courrier */}
      {activeTab === 'editeur' && (
        <CourierEditor />
      )}
    </div>
  )
}
