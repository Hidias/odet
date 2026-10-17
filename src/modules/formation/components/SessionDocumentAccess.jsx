import { useState, useEffect } from 'react'
import { supabase } from '../../../core/supabase'
import { FileText, CheckCircle, XCircle, Eye, Download, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'

/**
 * Composant pour activer/désactiver l'accès au document stagiaire
 * À intégrer dans SessionDetail.jsx
 */

export default function SessionDocumentAccess({ sessionId, courseId }) {
  const [document, setDocument] = useState(null)
  const [access, setAccess] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [stats, setStats] = useState({ total: 0, downloaded: 0 })

  useEffect(() => {
    if (courseId && sessionId) {
      loadData()
      loadStats()
    }
  }, [courseId, sessionId])

  const loadData = async () => {
    try {
      // Charger le document stagiaire de la formation
      const { data: docData, error: docError } = await supabase
        .from('course_documents')
        .select('*')
        .eq('course_id', courseId)
        .eq('type', 'document_stagiaire')
        .maybeSingle()

      if (docError) throw docError
      setDocument(docData)

      if (docData) {
        // Charger l'état d'activation pour cette session
        const { data: accessData, error: accessError } = await supabase
          .from('session_document_access')
          .select('*')
          .eq('session_id', sessionId)
          .eq('document_id', docData.id)
          .maybeSingle()

        if (accessError && accessError.code !== 'PGRST116') throw accessError
        setAccess(accessData)
      }
    } catch (error) {
      console.error('Erreur chargement document:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadStats = async () => {
    try {
      // Nombre total de stagiaires dans la session
      const { count: totalCount } = await supabase
        .from('session_trainees')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', sessionId)

      // Nombre de téléchargements uniques
      const { data: downloads } = await supabase
        .from('course_document_downloads')
        .select('trainee_id')
        .eq('session_id', sessionId)

      const uniqueTrainees = new Set(downloads?.map(d => d.trainee_id).filter(Boolean))

      setStats({
        total: totalCount || 0,
        downloaded: uniqueTrainees.size
      })
    } catch (error) {
      console.error('Erreur chargement stats:', error)
    }
  }

  const toggleAccess = async () => {
    if (!document) return

    setUpdating(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const isActive = !access?.is_active

      if (access) {
        // Update existing
        const { error } = await supabase
          .from('session_document_access')
          .update({
            is_active: isActive,
            activated_at: isActive ? new Date().toISOString() : null,
            activated_by: isActive ? userData?.user?.id : null
          })
          .eq('id', access.id)

        if (error) throw error
      } else {
        // Create new
        const { error } = await supabase
          .from('session_document_access')
          .insert([{
            session_id: sessionId,
            document_id: document.id,
            is_active: isActive,
            activated_at: isActive ? new Date().toISOString() : null,
            activated_by: isActive ? userData?.user?.id : null
          }])

        if (error) throw error
      }

      toast.success(
        isActive 
          ? ' Document accessible aux stagiaires via QR code' 
          : ' Document désactivé'
      )

      loadData()
    } catch (error) {
      console.error('Erreur mise à jour:', error)
      toast.error('Erreur lors de la mise à jour')
    } finally {
      setUpdating(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-ui-sm shadow p-4">
        <p className="text-ui text-gray-500">Chargement...</p>
      </div>
    )
  }

  if (!document) {
    return (
      <div className="bg-[rgb(var(--c-warning-bg))] border border-[rgb(var(--c-warning)/0.3)] rounded-ui-sm p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-[rgb(var(--c-warning))] flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-ui font-medium text-[rgb(var(--c-warning))] mb-1">
              Document stagiaire non disponible
            </p>
            <p className="text-ui-sm text-[rgb(var(--c-warning))]">
              Ajoutez un document dans l'onglet "Documents de formations" pour le rendre accessible aux stagiaires
            </p>
          </div>
        </div>
      </div>
    )
  }

  const isActive = access?.is_active || false

  return (
    <div className="bg-white rounded-ui-sm shadow p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3 flex-1">
          <div className="bg-[rgb(var(--c-danger-bg))] rounded-ui-sm p-2">
            <FileText className="w-6 h-6 text-[rgb(var(--c-danger))]" />
          </div>
          <div>
            <h4 className="font-medium text-gray-900">Document stagiaire</h4>
            <p className="text-ui text-gray-600">{document.file_name}</p>
            <p className="text-ui-sm text-gray-500">
              {(document.file_size / 1024 / 1024).toFixed(1)} MB
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => window.open(document.file_url, '_blank')}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
            title="Prévisualiser"
          >
            <Eye className="w-5 h-5" />
          </button>
          <button
            onClick={() => window.open(document.file_url, '_blank')}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
            title="Télécharger"
          >
            <Download className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Toggle accès */}
      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-ui-sm">
        <div className="flex items-center gap-3">
          {isActive ? (
            <>
              <CheckCircle className="w-5 h-5 text-[rgb(var(--c-success))]" />
              <div>
                <span className="text-ui font-medium text-[rgb(var(--c-success))] block">
                  Accessible aux stagiaires
                </span>
                <span className="text-ui-sm text-[rgb(var(--c-success))]">
                  Via QR code • Section "Documents"
                </span>
              </div>
            </>
          ) : (
            <>
              <XCircle className="w-5 h-5 text-gray-400" />
              <div>
                <span className="text-ui font-medium text-gray-600 block">
                  Non accessible
                </span>
                <span className="text-ui-sm text-gray-500">
                  Activez pour rendre disponible
                </span>
              </div>
            </>
          )}
        </div>

        <button
          onClick={toggleAccess}
          disabled={updating}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[rgb(var(--c-info)/0.3)] focus:ring-offset-2 ${
            isActive ? 'bg-[rgb(var(--c-success))]' : 'bg-gray-300'
          } ${updating ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              isActive ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Statistiques (si activé) */}
      {isActive && (
        <div className="pt-4 border-t border-gray-200 space-y-3">
          <div className="flex items-center justify-between text-ui">
            <span className="text-gray-600 font-medium">Téléchargements :</span>
            <span className="text-gray-900 font-semibold">
              {stats.downloaded} / {stats.total} stagiaires
              {stats.total > 0 && (
                <span className="ml-2 text-ui-sm text-gray-500">
                  ({Math.round((stats.downloaded / stats.total) * 100)}%)
                </span>
              )}
            </span>
          </div>
          
          {/* Barre de progression */}
          <div className="relative">
            <div className="overflow-hidden h-2 text-ui-sm flex rounded-full bg-gray-200">
              <div
                style={{ width: `${stats.total > 0 ? (stats.downloaded / stats.total) * 100 : 0}%` }}
                className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-[rgb(var(--c-success))] transition-all duration-300"
              />
            </div>
          </div>

          {/* Détails */}
          {stats.total > 0 && stats.downloaded === stats.total && (
            <div className="flex items-center gap-2 text-ui-sm text-[rgb(var(--c-success))] bg-[rgb(var(--c-success-bg))] p-2 rounded">
              <CheckCircle className="w-4 h-4" />
              <span className="font-medium">Tous les stagiaires ont téléchargé le document ! </span>
            </div>
          )}
        </div>
      )}

      {/* Note d'aide */}
      <div className="text-ui-sm text-gray-500 bg-[rgb(var(--c-info-bg))] p-3 rounded border border-[rgb(var(--c-info)/0.3)]">
        <div className="flex items-start gap-2">
          <span className="text-[rgb(var(--c-info))]"></span>
          <div>
            <p className="font-medium text-[rgb(var(--c-info))] mb-1">Comment les stagiaires accèdent au document ?</p>
            <ol className="list-decimal list-inside space-y-0.5 text-[rgb(var(--c-info))]">
              <li>Ils scannent le QR code de la session</li>
              <li>Ils cliquent sur " Documents"</li>
              <li>Ils téléchargent le livret de formation</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
