import { useState, useEffect } from 'react'
import { X, CheckCircle, AlertCircle, Save } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { 
  getCompetencesConfig, 
  getAllIndicatorIds,
  isCompetenceAcquise,
  isCandidatCertifie 
} from '../lib/sstCompetencesConfig'

export default function SSTCertificationModal({ 
  show, 
  onClose, 
  session, 
  trainee, 
  trainer,
  onSave 
}) {
  const [formationType, setFormationType] = useState('FI')
  const [indicateurs, setIndicateurs] = useState({})
  const [loading, setLoading] = useState(false)
  const [existingCertification, setExistingCertification] = useState(null)

  useEffect(() => {
    if (show && session && trainee) {
      detectFormationType()
      loadExistingCertification()
    }
  }, [show, session, trainee])

  // Détecter automatiquement le type de formation
  const detectFormationType = () => {
    const courseTitle = session?.courses?.title?.toLowerCase() || ''
    if (courseTitle.includes('mac') || courseTitle.includes('recyclage') || courseTitle.includes('maintien')) {
      setFormationType('MAC')
    } else {
      setFormationType('FI')
    }
  }

  // Charger une certification existante
  const loadExistingCertification = async () => {
    try {
      const { data, error } = await supabase
        .from('sst_certifications')
        .select('*')
        .eq('session_id', session.id)
        .eq('trainee_id', trainee.id)
        .maybeSingle()

      if (error) throw error

      if (data) {
        setExistingCertification(data)
        setFormationType(data.formation_type)
        
        // Charger tous les indicateurs depuis la BDD
        const indicateurIds = getAllIndicatorIds(data.formation_type)
        const loadedIndicateurs = {}
        
        indicateurIds.forEach(id => {
          loadedIndicateurs[id] = data[id]
        })
        
        setIndicateurs(loadedIndicateurs)
      }
    } catch (error) {
      console.error('Erreur chargement certification:', error)
    }
  }

  // Toggle un indicateur : null → true → false → null
  const toggleIndicateur = (id) => {
    setIndicateurs(prev => ({
      ...prev,
      [id]: prev[id] === true ? false : prev[id] === false ? null : true
    }))
  }

  // Calculer l'état de chaque compétence
  const getCompetenceStatus = (competenceCode) => {
    return isCompetenceAcquise(competenceCode, indicateurs, formationType)
  }

  // Calculer si certifié
  const certifie = isCandidatCertifie(indicateurs, formationType)

  const handleSave = async () => {
    if (!trainer) {
      toast.error('Aucun formateur assigné à cette session')
      return
    }

    setLoading(true)
    try {
      // Préparer les données avec tous les indicateurs
      const certificationData = {
        session_id: session.id,
        trainee_id: trainee.id,
        formation_type: formationType,
        date_certification: session.end_date,
        formateur_id: trainer.id,
        formateur_nom: trainer.last_name,
        formateur_prenom: trainer.first_name,
        formateur_signature_url: trainer.signature_url || null,
      }

      // Ajouter tous les indicateurs
      const indicateurIds = getAllIndicatorIds(formationType)
      indicateurIds.forEach(id => {
        certificationData[id] = indicateurs[id] === undefined ? null : indicateurs[id]
      })

      // Calculer automatiquement les compétences acquises
      const config = getCompetencesConfig(formationType)
      Object.keys(config).forEach(code => {
        const key = `${code.toLowerCase()}_acquis`
        certificationData[key] = getCompetenceStatus(code)
      })

      const { data, error } = await supabase
        .from('sst_certifications')
        .upsert(certificationData, { 
          onConflict: 'session_id,trainee_id',
          returning: true 
        })
        .select()
        .single()

      if (error) throw error

      toast.success(`Certification ${data.candidat_certifie ? '✓ VALIDÉE' : '✗ NON VALIDÉE'}`)
      
      if (onSave) onSave(data)
      onClose()
    } catch (error) {
      console.error('Erreur sauvegarde certification:', error)
      toast.error('Erreur lors de la sauvegarde')
    } finally {
      setLoading(false)
    }
  }

  const competencesConfig = getCompetencesConfig(formationType)
  const competencesList = Object.values(competencesConfig)

  // Calculer les stats
  const nbCompetencesAcquises = Object.keys(competencesConfig).filter(code => 
    getCompetenceStatus(code)
  ).length
  const nbCompetencesRequises = Object.keys(competencesConfig).length

  if (!show) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              Grille de certification SST - {formationType === 'FI' ? 'Formation Initiale' : 'MAC'}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {trainee.first_name} {trainee.last_name} • Session du {format(new Date(session.start_date), 'dd/MM/yyyy', { locale: fr })} au {format(new Date(session.end_date), 'dd/MM/yyyy', { locale: fr })}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Type de formation */}
        <div className="px-6 py-4 bg-gray-50 border-b">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Type de formation
          </label>
          <div className="flex gap-4">
            <button
              onClick={() => setFormationType('FI')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                formationType === 'FI'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              Formation Initiale (8 compétences)
            </button>
            <button
              onClick={() => setFormationType('MAC')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                formationType === 'MAC'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              MAC (7 compétences)
            </button>
          </div>
        </div>

        {/* Grille des compétences avec indicateurs détaillés */}
        <div className="px-6 py-4">
          <div className="space-y-6">
            {competencesList.map((comp) => {
              const isAcquise = getCompetenceStatus(comp.code)
              
              return (
                <div 
                  key={comp.code} 
                  className={`border-2 rounded-xl p-5 transition-all ${
                    isAcquise 
                      ? 'border-green-300 bg-green-50' 
                      : 'border-gray-300 bg-white'
                  }`}
                >
                  {/* En-tête de la compétence */}
                  <div className="flex items-start gap-4 mb-4 pb-4 border-b">
                    <div className="flex-shrink-0">
                      <span className={`inline-flex items-center justify-center w-12 h-12 rounded-full font-bold text-lg ${
                        isAcquise 
                          ? 'bg-green-600 text-white' 
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {comp.code}
                      </span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900 mb-1">{comp.titre}</h4>
                      <p className="text-xs text-gray-500">
                        Épreuve {comp.epreuve} • {comp.indicateurs.length} indicateur{comp.indicateurs.length > 1 ? 's' : ''}
                      </p>
                    </div>
                    {isAcquise && (
                      <div className="flex-shrink-0">
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-green-600 text-white text-sm font-medium">
                          <CheckCircle className="w-4 h-4" />
                          Acquise
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Liste des indicateurs */}
                  <div className="space-y-3">
                    {comp.indicateurs.map((ind, idx) => {
                      const value = indicateurs[ind.id]
                      
                      return (
                        <div 
                          key={ind.id}
                          className="flex items-start gap-3 p-3 rounded-lg bg-white border border-gray-200 hover:border-gray-300 transition-colors"
                        >
                          <div className="flex-1">
                            <p className="text-sm text-gray-800">
                              {ind.incontournable && (
                                <span className="inline-block px-2 py-0.5 mr-2 text-xs font-medium bg-yellow-100 text-yellow-800 rounded">
                                  Incontournable
                                </span>
                              )}
                              {ind.texte}
                            </p>
                          </div>
                          <div className="flex-shrink-0">
                            <button
                              onClick={() => toggleIndicateur(ind.id)}
                              className={`px-4 py-2 rounded-lg font-medium text-sm transition-all min-w-[130px] ${
                                value === true
                                  ? 'bg-green-600 text-white hover:bg-green-700'
                                  : value === false
                                  ? 'bg-red-600 text-white hover:bg-red-700'
                                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                              }`}
                            >
                              {value === true ? '✓ Acquis' : value === false ? '✗ Non acquis' : 'Non évalué'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Résultat */}
        <div className="px-6 py-4 border-t bg-gray-50">
          <div className={`p-4 rounded-lg ${certifie ? 'bg-green-100 border-2 border-green-600' : 'bg-red-100 border-2 border-red-600'}`}>
            <div className="flex items-center gap-3">
              {certifie ? (
                <CheckCircle className="w-8 h-8 text-green-600" />
              ) : (
                <AlertCircle className="w-8 h-8 text-red-600" />
              )}
              <div>
                <p className="font-bold text-lg">
                  {certifie ? '✓ CANDIDAT CERTIFIÉ' : '✗ CANDIDAT NON CERTIFIÉ'}
                </p>
                <p className="text-sm">
                  {nbCompetencesAcquises}/{nbCompetencesRequises} compétences acquises
                  {certifie ? ' (validation automatique)' : ` (minimum ${nbCompetencesRequises} requis)`}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t flex items-center justify-between bg-white">
          <button
            onClick={onClose}
            className="btn btn-secondary"
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="btn btn-primary flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            {loading ? 'Enregistrement...' : 'Enregistrer la certification'}
          </button>
        </div>
      </div>
    </div>
  )
}
