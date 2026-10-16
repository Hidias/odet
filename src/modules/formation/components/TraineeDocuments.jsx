import { appName } from '../../../core/org/currentOrg'
import { useState, useEffect } from 'react'
import { supabase } from '../../../core/supabase'
import { FileText, Download, CheckCircle, AlertCircle, ArrowLeft } from 'lucide-react'
import toast from 'react-hot-toast'

/**
 * Composant Documents pour le Portail Stagiaire
 * Affiche les documents accessibles via QR code
 */

export default function TraineeDocuments({ session, traineeId, onBack }) {
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState({})

  useEffect(() => {
    const courseId = session?.course_id || session?.courses?.id
    if (session?.id && courseId) {
      loadDocuments(courseId)
    }
  }, [session])

  const loadDocuments = async (courseId) => {
    try {
      // Charger les documents stagiaires pour cette formation
      const { data: docData, error: docError } = await supabase
        .from('course_documents')
        .select('*')
        .eq('course_id', courseId)
        .eq('type', 'document_stagiaire')

      if (docError) throw docError

      if (docData && docData.length > 0) {
        // Vérifier quels documents sont activés pour cette session
        const docIds = docData.map(d => d.id)
        const { data: accessData, error: accessError } = await supabase
          .from('session_document_access')
          .select('document_id')
          .eq('session_id', session.id)
          .eq('is_active', true)
          .in('document_id', docIds)

        if (accessError) throw accessError

        if (accessData && accessData.length > 0) {
          // Ne garder que les documents activés
          const activeDocIds = new Set(accessData.map(a => a.document_id))
          setDocuments(docData.filter(d => activeDocIds.has(d.id)))
        } else {
          setDocuments([])
        }
      } else {
        setDocuments([])
      }
    } catch (error) {
      console.error('Erreur chargement documents:', error)
    } finally {
      setLoading(false)
    }
  }

  const downloadDocument = async (doc) => {
    setDownloading(prev => ({ ...prev, [doc.id]: true }))
    
    try {
      // Enregistrer le téléchargement pour traçabilité (Qualiopi)
      await supabase
        .from('course_document_downloads')
        .insert([{
          document_id: doc.id,
          session_id: session.id,
          trainee_id: traineeId || null
        }])

      // Ouvrir le PDF dans un nouvel onglet
      window.open(doc.file_url, '_blank')
      toast.success('Document ouvert dans un nouvel onglet')
    } catch (error) {
      console.error('Erreur téléchargement:', error)
      toast.error('Erreur lors du téléchargement')
    } finally {
      setDownloading(prev => ({ ...prev, [doc.id]: false }))
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[rgb(var(--c-info)/0.3)] mx-auto mb-4" />
          <p className="text-gray-600">Chargement des documents...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Bouton retour */}
        {onBack && (
          <button
            onClick={onBack}
            className="mb-6 flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="font-medium">Retour</span>
          </button>
        )}

        {/* Header */}
        <div className="bg-white rounded-ui-sm shadow-md p-6 mb-6">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-[rgb(var(--c-info-bg))] rounded-full mb-4">
              <FileText className="w-8 h-8 text-[rgb(var(--c-info))]" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
               Documents de formation
            </h1>
            <h2 className="text-lg text-gray-700 mb-1">
              {session.courses?.title}
            </h2>
            <p className="text-ui text-gray-500">
              Session du {new Date(session.start_date).toLocaleDateString('fr-FR')}
              {session.end_date && ` au ${new Date(session.end_date).toLocaleDateString('fr-FR')}`}
            </p>
          </div>
        </div>

        {/* Liste des documents */}
        {documents.length === 0 ? (
          <div className="bg-white rounded-ui-sm shadow-md p-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
              <FileText className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Aucun document disponible
            </h3>
            <p className="text-gray-600 mb-6">
              Les documents seront mis à disposition par votre formateur pendant la formation.
            </p>
            {onBack && (
              <button
                onClick={onBack}
                className="px-6 py-2 bg-[rgb(var(--c-info))] text-white rounded-ui-sm hover:bg-[rgb(var(--c-info))] transition-colors"
              >
                Retour à l'accueil
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {documents.map(doc => {
              const isDownloading = downloading[doc.id]
              
              return (
                <div key={doc.id} className="bg-white rounded-ui-sm shadow-md p-6 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      <div className="w-16 h-16 bg-[rgb(var(--c-danger-bg))] rounded-ui-sm flex items-center justify-center">
                        <FileText className="w-8 h-8 text-[rgb(var(--c-danger))]" />
                      </div>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 mb-1">
                        Livret de formation
                      </h3>
                      <p className="text-ui text-gray-600 mb-1">
                        {doc.file_name}
                      </p>
                      <div className="flex items-center gap-3 text-ui-sm text-gray-500">
                        <span> PDF</span>
                        <span>•</span>
                        <span>{(doc.file_size / 1024 / 1024).toFixed(1)} MB</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <button
                      onClick={() => downloadDocument(doc)}
                      disabled={isDownloading}
                      className="w-full px-4 py-3 bg-[rgb(var(--c-info))] text-white rounded-ui-sm hover:bg-[rgb(var(--c-info))] transition-colors flex items-center justify-center gap-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isDownloading ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                          <span>Ouverture...</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-5 h-5" />
                          <span>Télécharger le document</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Note informative */}
        <div className="mt-6 bg-[rgb(var(--c-info-bg))] border border-[rgb(var(--c-info)/0.3)] rounded-ui-sm p-4">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-[rgb(var(--c-info))] flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-ui text-[rgb(var(--c-info))] font-medium mb-1">
                 À propos de ce document
              </p>
              <p className="text-ui text-[rgb(var(--c-info))]">
                Ce livret contient les supports pédagogiques de votre formation. 
                Vous pouvez le télécharger et le consulter à tout moment.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-ui text-gray-500">
          <p>{appName()}, session {session.reference}</p>
        </div>
      </div>
    </div>
  )
}
