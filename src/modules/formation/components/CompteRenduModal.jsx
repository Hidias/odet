import { apiFetch } from '../../../core/api'
import { useState, useEffect } from 'react'
import { supabase } from '../../../core/supabase'
import { X, FileText, Send, Loader, CheckCircle, AlertCircle, Upload, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { downloadNeedsAnalysisPDF, getNeedsAnalysisPDFBytes } from '../pdf/needsAnalysisPDF'


// Sanitise un nom de fichier pour en faire une clé Supabase Storage valide
// Supprime les accents, remplace espaces et caractères spéciaux par _
const sanitizeStorageKey = (name) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // supprime les diacritiques
    .replace(/[^a-zA-Z0-9._-]/g, '_') // remplace tout caractère non-ASCII par _
    .replace(/_+/g, '_')              // dédoublonne les underscores
    .replace(/^_|_$/g, '')            // trim underscores en début/fin

export default function CompteRenduModal({ rdv, client, analysisData: analysisDataProp, onClose }) {
  const [step, setStep] = useState('notes') // 'notes', 'generating', 'preview', 'sending', 'sent'
  const [notesCRM, setNotesCRM] = useState(rdv?.notes_crm || '')
  const [attachPDF, setAttachPDF] = useState(true)
  const [uploadedFiles, setUploadedFiles] = useState([]) // Fichiers uploadés par l'utilisateur
  const [analysisData, setAnalysisData] = useState(analysisDataProp)
  const [organization, setOrganization] = useState(null)
  
  const [generatedEmail, setGeneratedEmail] = useState(null)
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [toEmail, setToEmail] = useState(rdv?.contact_email || client?.email || '')
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Récupérer les infos utilisateur
  const [userEmail, setUserEmail] = useState(null)
  
  useEffect(() => {
    loadUserEmail()
    loadAnalysisAndOrg()
  }, [])

  const loadUserEmail = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    
    const { data } = await supabase
      .from('user_email_configs')
      .select('email')
      .eq('user_id', user.id)
      .single()
    
    if (data) setUserEmail(data.email)
  }

  const loadAnalysisAndOrg = async () => {
    // Charger organization settings
    const { data: orgData } = await supabase
      .from('organization_settings')
      .select('*')
      .single()
    if (orgData) setOrganization(orgData)

    // Charger analysisData si pas déjà passé via props
    if (!analysisData && rdv?.client_id) {
      const { data: analysis } = await supabase
        .from('prospect_needs_analysis')
        .select('*')
        .eq('client_id', rdv.client_id)
        .maybeSingle()
      if (analysis) setAnalysisData(analysis)
    }
  }

  // Fonction pour uploader des fichiers
  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files)
    
    files.forEach(file => {
      // Vérifier la taille (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} est trop volumineux (max 10MB)`)
        return
      }
      
      // Lire le fichier en base64
      const reader = new FileReader()
      reader.onload = (event) => {
        setUploadedFiles(prev => [...prev, {
          id: Date.now() + Math.random(),
          name: file.name,
          size: file.size,
          base64: event.target.result.split(',')[1] // Enlever le préfixe data:...
        }])
        toast.success(`${file.name} ajouté`)
      }
      reader.readAsDataURL(file)
    })
    
    // Reset input
    e.target.value = ''
  }

  // Fonction pour supprimer un fichier
  const handleRemoveFile = (fileId) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId))
    toast.success('Fichier supprimé')
  }

  const handleGenerate = async () => {
    if (!notesCRM.trim()) {
      toast.error('Veuillez saisir des notes de RDV')
      return
    }

    setLoading(true)
    setError(null)
    setStep('generating')

    try {
      // Construire le contexte
      const context = {
        client: client?.name,
        contact: rdv?.contact_name,
        date: rdv?.rdv_date ? new Date(rdv.rdv_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : null,
        notes: notesCRM,
        analysis: analysisData ? {
          context_stakes: analysisData.context_stakes,
          objectives_description: analysisData.objectives_description,
          participants_count: analysisData.participants_count
        } : null
      }

      // Appeler l'API backend (pas directement Claude)
      const response = await apiFetch('/api/generate-compte-rendu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context)
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Erreur API')
      }

      const data = await response.json()

      if (data.objets && data.mail) {
        setGeneratedEmail({ objets: data.objets, mail: data.mail })
        setEmailSubject(data.objets[0].replace(/^\d+\.\s*/, ''))
        setEmailBody(data.mail)
        setStep('preview')
      } else {
        throw new Error('Format de réponse inattendu')
      }

    } catch (err) {
      console.error('Erreur génération:', err)
      setError(err.message)
      toast.error('Erreur lors de la génération')
    } finally {
      setLoading(false)
    }
  }

  const handleSend = async () => {
    if (!toEmail || !emailSubject || !emailBody) {
      toast.error('Email, objet et corps obligatoires')
      return
    }

    if (!userEmail) {
      toast.error('Configurez votre email dans Paramètres')
      return
    }

    setLoading(true)
    setStep('sending')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      // Préparer les pièces jointes via Supabase Storage (évite la limite 4.5MB Vercel)
      const attachmentRefs = []
      const tempPaths = [] // Pour nettoyage après envoi
      
      // 1. PDF de l'analyse des besoins
      if (attachPDF && rdv?.client_id) {
        try {
          if (analysisData) {
            const pdfBytes = await getNeedsAnalysisPDFBytes(
              client || { name: rdv?.client_name || 'Client' },
              analysisData,
              false,
              organization
            )
            const filename = `Analyse_Besoin_${(client?.name || 'Client').replace(/\s/g, '_')}.pdf`
            const storagePath = `temp-email/${user.id}/${Date.now()}_${sanitizeStorageKey(filename)}`
            
            const { error: uploadError } = await supabase.storage
              .from('email-attachments')
              .upload(storagePath, new Blob([pdfBytes], { type: 'application/pdf' }))
            
            if (uploadError) throw new Error('Upload PDF analyse échoué: ' + uploadError.message)
            
            attachmentRefs.push({ filename, storagePath, size: pdfBytes.byteLength })
            tempPaths.push(storagePath)
            console.log('PDF analyse uploadé:', storagePath, pdfBytes.byteLength, 'bytes')
          } else {
            console.log('ℹ Pas d\'analyse de besoins trouvée pour ce client')
          }
        } catch (pdfError) {
          console.error('Erreur génération/upload PDF analyse:', pdfError)
          toast.error('Impossible de préparer le PDF d\'analyse')
        }
      }
      
      // 2. Fichiers uploadés par l'utilisateur
      for (const file of uploadedFiles) {
        try {
          const storagePath = `temp-email/${user.id}/${Date.now()}_${sanitizeStorageKey(file.name)}`
          // Reconvertir base64 en blob
          const byteChars = atob(file.base64)
          const byteArray = new Uint8Array(byteChars.length)
          for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i)
          
          const { error: uploadError } = await supabase.storage
            .from('email-attachments')
            .upload(storagePath, new Blob([byteArray]))
          
          if (uploadError) throw new Error('Upload échoué: ' + uploadError.message)
          
          attachmentRefs.push({ filename: file.name, storagePath, size: file.size })
          tempPaths.push(storagePath)
        } catch (fileError) {
          console.error('Erreur upload fichier:', fileError)
        }
      }

      // Envoyer via l'API (payload léger, sans base64)
      const response = await apiFetch('/api/send-email-rdv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          to: toEmail,
          subject: emailSubject,
          body: emailBody,
          attachmentRefs,
          rdvId: rdv.id
        })
      })

      const result = await response.json()

      if (!response.ok) throw new Error(result.error)

      setStep('sent')
      toast.success('Email envoyé avec succès !')

      setTimeout(() => {
        onClose()
      }, 2000)

    } catch (err) {
      console.error('Erreur envoi:', err)
      setError(err.message)
      toast.error('Erreur lors de l\'envoi')
      setStep('preview')
    } finally {
      setLoading(false)
    }
  }

  const generateAnalysisPDFBlob = async () => {
    // Utiliser la fonction existante pour générer le PDF
    // Cette fonction doit retourner un Blob
    // À adapter selon ton implémentation actuelle
    return new Blob(['PDF content'], { type: 'application/pdf' })
  }

  const blobToBase64 = (blob) => {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result)
      reader.readAsDataURL(blob)
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-ui-sm max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between bg-primary-600 text-white">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Compte-rendu de rendez-vous
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-primary-700 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {step === 'notes' && (
            <div className="space-y-4">
              <div>
                <label className="block text-ui font-medium text-gray-700 mb-2">
                   Notes de RDV (en vrac)
                </label>
                <textarea
                  value={notesCRM}
                  onChange={(e) => setNotesCRM(e.target.value)}
                  className="w-full h-64 px-3 py-2 border border-gray-300 rounded-ui-sm focus:ring-2 focus:ring-primary-500"
                  placeholder="Tape tes notes en vrac ici...
Exemple :
- Besoin formation nouveaux entrants
- Habilitation électrique B0H0V
- Chariot R489 catégorie 3
- Pas de VGP à date
- etc."
                />
              </div>

              <div>
                <label className="block text-ui font-medium text-gray-700 mb-2">
                   Documents à joindre
                </label>
                
                
                {/* Upload de fichiers */}
                <div className="border-2 border-dashed border-gray-300 rounded-ui-sm p-4 mb-3">
                  <label className="flex flex-col items-center cursor-pointer">
                    <Upload className="w-8 h-8 text-gray-400 mb-2" />
                    <span className="text-ui text-gray-600 text-center">
                      Ajouter des fichiers (analyse PDF, INRS, brochures, devis...)
                      <br />
                      <span className="text-ui-sm text-gray-500">Max 10MB par fichier • PDF, Word, Excel, Images</span>
                    </span>
                    <input
                      type="file"
                      multiple
                      onChange={handleFileUpload}
                      className="hidden"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif"
                    />
                  </label>
                </div>
                
                {/* Liste des fichiers uploadés */}
                {uploadedFiles.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-ui-sm font-medium text-gray-700">Fichiers ajoutés :</p>
                    {uploadedFiles.map(file => (
                      <div key={file.id} className="flex items-center justify-between bg-gray-50 p-2 rounded-ui-sm">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-gray-500" />
                          <span className="text-ui">{file.name}</span>
                          <span className="text-ui-sm text-gray-500">
                            ({(file.size / 1024).toFixed(0)} KB)
                          </span>
                        </div>
                        <button
                          onClick={() => handleRemoveFile(file.id)}
                          className="p-1 hover:bg-gray-200 rounded"
                          title="Supprimer"
                        >
                          <Trash2 className="w-4 h-4 text-[rgb(var(--c-danger))]" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={handleGenerate}
                disabled={loading || !notesCRM.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-ui-sm hover:bg-primary-700 disabled:opacity-50"
              >
                {loading ? <Loader className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
                Générer le compte-rendu
              </button>
            </div>
          )}

          {step === 'generating' && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader className="w-12 h-12 text-primary-600 animate-spin mb-4" />
              <p className="text-gray-600">Génération du compte-rendu en cours...</p>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <div>
                <label className="block text-ui font-medium text-gray-700 mb-1">Destinataire</label>
                <input
                  type="email"
                  value={toEmail}
                  onChange={(e) => setToEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm"
                />
              </div>

              <div>
                <label className="block text-ui font-medium text-gray-700 mb-1">Objet</label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-ui-sm"
                />
              </div>

              <div>
                <label className="block text-ui font-medium text-gray-700 mb-1">Corps du mail</label>
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  className="w-full h-96 px-3 py-2 border border-gray-300 rounded-ui-sm font-mono text-ui"
                />
              </div>

              {uploadedFiles.length > 0 && (
                <div className="bg-[rgb(var(--c-info-bg))] border border-[rgb(var(--c-info)/0.3)] rounded-ui-sm p-3">
                  <p className="text-ui font-medium text-[rgb(var(--c-info))] mb-2"> Pièces jointes ({uploadedFiles.length}) :</p>
                  <ul className="text-ui text-[rgb(var(--c-info))] space-y-1">
                    {uploadedFiles.map(file => (
                      <li key={file.id}>• {file.name}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('notes')}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-ui-sm hover:bg-gray-50"
                >
                  ← Retour
                </button>
                <button
                  onClick={handleSend}
                  disabled={loading}
                  className="flex-1 flex items-center justify-center gap-2 btn btn-secondary disabled:opacity-50"
                >
                  {loading ? <Loader className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  Envoyer
                </button>
              </div>
            </div>
          )}

          {step === 'sending' && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader className="w-12 h-12 text-[rgb(var(--c-success))] animate-spin mb-4" />
              <p className="text-gray-600">Envoi en cours...</p>
            </div>
          )}

          {step === 'sent' && (
            <div className="flex flex-col items-center justify-center py-12">
              <CheckCircle className="w-16 h-16 text-[rgb(var(--c-success))] mb-4" />
              <p className="text-xl font-semibold text-gray-900 mb-2">Email envoyé !</p>
              <p className="text-gray-600">L'email apparaîtra dans vos messages envoyés</p>
            </div>
          )}

          {error && (
            <div className="bg-[rgb(var(--c-danger-bg))] border border-[rgb(var(--c-danger)/0.3)] rounded-ui-sm p-4 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-[rgb(var(--c-danger))] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-ui font-medium text-[rgb(var(--c-danger))]">Erreur</p>
                <p className="text-ui text-[rgb(var(--c-danger))]">{error}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
