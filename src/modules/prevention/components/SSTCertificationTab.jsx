import { useState, useEffect } from 'react'
import { CheckCircle, AlertCircle, Download, FileText, Award } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import SSTCertificationModal from './SSTCertificationModal'
import { generateSSTCertificationPDF } from '../pdf/generateSSTCertificationPDF'
import { archiveSstGrid, openArchive, archivePathOf } from '../../suivi/lib/archive'
import FormativeSummary, { useFormativeSummary } from '../../suivi/components/FormativeSummary'

export default function SSTCertificationTab({ session, sessionTrainees, trainer }) {
  const [certifications, setCertifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [selectedTrainee, setSelectedTrainee] = useState(null)
  const formativeSummary = useFormativeSummary(session?.id)

  useEffect(() => {
    if (session && sessionTrainees.length > 0) {
      loadCertifications()
    }
  }, [session, sessionTrainees])

  const loadCertifications = async () => {
    try {
      const { data, error } = await supabase
        .from('sst_certifications')
        .select('*')
        .eq('session_id', session.id)

      if (error) throw error

      setCertifications(data || [])
    } catch (error) {
      console.error('Erreur chargement certifications:', error)
      toast.error('Erreur lors du chargement des certifications')
    } finally {
      setLoading(false)
    }
  }

  const getCertification = (traineeId) => {
    return certifications.find(c => c.trainee_id === traineeId)
  }

  const handleOpenModal = (trainee) => {
    setSelectedTrainee(trainee)
    setShowModal(true)
  }

  const handleSaveCertification = async (data) => {
    await loadCertifications()
    toast.success('Certification enregistrée')
  }

  const handleGeneratePDF = async (trainee) => {
    const cert = getCertification(trainee.id)
    if (!cert) {
      toast.error('Aucune certification trouvée')
      return
    }

    try {
      const out = await generateSSTCertificationPDF(cert, trainee, session, trainer)
      toast.success('PDF généré avec succès')
      await archiveGrid(cert, out)
    } catch (error) {
      console.error('Erreur génération PDF:', error)
      toast.error('Erreur lors de la génération du PDF')
    }
  }

  // Archive la grille générée (bucket privé, conservation au moins 24 mois). Un échec n'empêche pas le téléchargement.
  const archiveGrid = async (cert, out, { quiet = false } = {}) => {
    if (!out?.bytes) return
    try {
      await archiveSstGrid(cert, out.bytes, out.fileName)
      if (!quiet) toast.success('Grille archivée')
      await loadCertifications()
    } catch (e) {
      console.warn('Archivage de la grille SST impossible :', e)
      toast.error('Grille téléchargée, mais pas archivée : ' + (e.message || 'erreur'))
    }
  }

  const handleOpenArchive = async (cert) => {
    try { await openArchive(cert.pdf_url) } catch (e) { toast.error(e.message || 'Ouverture impossible') }
  }

  const handleGenerateAllPDFs = async () => {
    const certifiedTrainees = sessionTrainees.filter(t => {
      const cert = getCertification(t.id)
      return cert && cert.candidat_certifie
    })

    if (certifiedTrainees.length === 0) {
      toast.error('Aucun stagiaire certifié')
      return
    }

    toast.info(`Génération de ${certifiedTrainees.length} certificat(s)...`)
    
    for (const trainee of certifiedTrainees) {
      const cert = getCertification(trainee.id)
      try {
        const out = await generateSSTCertificationPDF(cert, trainee, session, trainer)
        await archiveGrid(cert, out, { quiet: true })
      } catch (error) {
        console.error(`Erreur pour ${trainee.first_name} ${trainee.last_name}:`, error)
      }
    }
    
    toast.success(`${certifiedTrainees.length} PDF(s) générés`)
  }

  const stats = {
    total: sessionTrainees.length,
    certified: certifications.filter(c => c.candidat_certifie).length,
    notCertified: certifications.filter(c => !c.candidat_certifie).length,
    pending: sessionTrainees.length - certifications.length
  }

  if (loading) {
    return <div className="card">Chargement...</div>
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card bg-[rgb(var(--c-info-bg))] border-[rgb(var(--c-info)/0.3)]">
          <div className="text-center">
            <p className="text-3xl font-bold text-[rgb(var(--c-info))]">{stats.total}</p>
            <p className="text-ui text-[rgb(var(--c-info))]">Stagiaires</p>
          </div>
        </div>
        <div className="card bg-[rgb(var(--c-success-bg))] border-[rgb(var(--c-success)/0.3)]">
          <div className="text-center">
            <p className="text-3xl font-bold text-[rgb(var(--c-success))]">{stats.certified}</p>
            <p className="text-ui text-[rgb(var(--c-success))]">Certifiés</p>
          </div>
        </div>
        <div className="card bg-[rgb(var(--c-danger-bg))] border-[rgb(var(--c-danger)/0.3)]">
          <div className="text-center">
            <p className="text-3xl font-bold text-[rgb(var(--c-danger))]">{stats.notCertified}</p>
            <p className="text-ui text-[rgb(var(--c-danger))]">Non certifiés</p>
          </div>
        </div>
        <div className="card bg-gray-50 border-gray-200">
          <div className="text-center">
            <p className="text-3xl font-bold text-gray-600">{stats.pending}</p>
            <p className="text-ui text-gray-700">En attente</p>
          </div>
        </div>
      </div>

      {/* Actions globales */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">Actions</h3>
          <button
            onClick={handleGenerateAllPDFs}
            disabled={stats.certified === 0}
            className="btn btn-primary flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Générer tous les PDF ({stats.certified})
          </button>
        </div>
      </div>

      {/* Liste des stagiaires */}
      <div className="card">
        <h3 className="font-semibold text-lg mb-4">Grilles de certification</h3>
        <div className="space-y-3">
          {sessionTrainees.map(trainee => {
            const cert = getCertification(trainee.id)
            
            return (
              <div
                key={trainee.id}
                className={`p-4 rounded-ui-sm border-2 transition-all ${
                  cert
                    ? cert.candidat_certifie
                      ? 'bg-[rgb(var(--c-success-bg))] border-[rgb(var(--c-success)/0.3)]'
                      : 'bg-[rgb(var(--c-danger-bg))] border-[rgb(var(--c-danger)/0.3)]'
                    : 'bg-gray-50 border-gray-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Icône statut */}
                    <div>
                      {cert ? (
                        cert.candidat_certifie ? (
                          <CheckCircle className="w-8 h-8 text-[rgb(var(--c-success))]" />
                        ) : (
                          <AlertCircle className="w-8 h-8 text-[rgb(var(--c-danger))]" />
                        )
                      ) : (
                        <FileText className="w-8 h-8 text-gray-400" />
                      )}
                    </div>

                    {/* Infos stagiaire */}
                    <div>
                      <p className="font-medium text-gray-900">
                        {trainee.first_name} {trainee.last_name}
                      </p>
                      {cert && (
                        <p className="text-ui text-gray-600">
                          {cert.formation_type === 'FI' ? 'Formation Initiale' : 'MAC'} •{' '}
                          {Object.values({
                            c1: cert.c1_acquis,
                            c2: cert.c2_acquis,
                            c3: cert.c3_acquis,
                            c4: cert.c4_acquis,
                            c5: cert.c5_acquis,
                            c6: cert.c6_acquis,
                            c7: cert.c7_acquis,
                            c8: cert.c8_acquis
                          }).filter(v => v === true).length}/{cert.formation_type === 'FI' ? 8 : 7} compétences
                        </p>
                      )}
                      {!cert && (
                        <p className="text-ui text-gray-500">Non évalué</p>
                      )}
                      <FormativeSummary summary={formativeSummary} traineeId={trainee.id} className="mt-0.5" />
                    </div>

                    {/* Badge statut */}
                    {cert && (
                      <div>
                        {cert.candidat_certifie ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[rgb(var(--c-success))] text-white text-ui font-medium">
                            <Award className="w-4 h-4" />
                            Certifié
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[rgb(var(--c-danger))] text-white text-ui font-medium">
                            Non certifié
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleOpenModal(trainee)}
                      className="btn btn-secondary btn-sm"
                    >
                      {cert ? 'Modifier' : 'Évaluer'}
                    </button>
                    {cert && cert.candidat_certifie && (
                      <button
                        onClick={() => handleGeneratePDF(trainee)}
                        className="btn btn-primary btn-sm flex items-center gap-2"
                      >
                        <Download className="w-4 h-4" />
                        PDF
                      </button>
                    )}
                    {cert && archivePathOf(cert.pdf_url) && (
                      <button
                        onClick={() => handleOpenArchive(cert)}
                        className="btn btn-secondary btn-sm"
                        title="Grille archivée (conservée pour un contrôle)"
                      >
                        Archivée
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {sessionTrainees.length === 0 && (
            <p className="text-center text-gray-500 py-8">
              Aucun stagiaire dans cette session
            </p>
          )}
        </div>
      </div>

      {/* Modal */}
      {showModal && selectedTrainee && (
        <SSTCertificationModal
          show={showModal}
          onClose={() => {
            setShowModal(false)
            setSelectedTrainee(null)
          }}
          session={session}
          trainee={selectedTrainee}
          trainer={trainer}
          onSave={handleSaveCertification}
        />
      )}
    </div>
  )
}
