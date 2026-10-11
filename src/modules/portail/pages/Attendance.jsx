import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../../core/supabase'
import SignatureCanvas from 'react-signature-canvas'
import { 
  Calendar, MapPin, CheckCircle, AlertCircle, Clock, Trash2, Send, Users, RefreshCw
} from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import toast from 'react-hot-toast'

export default function PublicAttendance() {
  const { token } = useParams()
  const [session, setSession] = useState(null)
  const [trainees, setTrainees] = useState([])
  const [attendances, setAttendances] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedTrainee, setSelectedTrainee] = useState(null)
  const [selectedPeriod, setSelectedPeriod] = useState('full')
  const [signing, setSigning] = useState(false)
  const [currentDate, setCurrentDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const sigCanvas = useRef(null)
  
  useEffect(() => {
    loadSession()
  }, [token])
  
  const loadSession = async () => {
    try {
      setLoading(true)
      setError(null)
      
      // Charger la session par token
      const { data: sessionData, error: sessionError } = await supabase
        .from('sessions')
        .select(`
          *,
          courses(title, duration_hours),
          clients(name),
          session_trainees(trainee_id, status, trainees(id, first_name, last_name, email))
        `)
        .eq('attendance_token', token)
        .single()
      
      if (sessionError) {
        console.error('Session error:', sessionError)
        throw new Error('Session non trouvée')
      }
      
      if (!sessionData) {
        throw new Error('Session non trouvée ou lien invalide')
      }
      
      setSession(sessionData)
      
      // Pour les sessions demi-journée, forcer la période à 'am'
      if (sessionData.day_type === 'half') {
        setSelectedPeriod('am')
      }
      
      // Extraire les stagiaires
      const traineesList = sessionData.session_trainees?.map(st => st.trainees).filter(Boolean) || []
      setTrainees(traineesList)
      
      // Charger les émargements existants pour aujourd'hui
      await loadAttendances(sessionData.id)
      
    } catch (err) {
      console.error('Load error:', err)
      setError(err.message || 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }
  
  const loadAttendances = async (sessionId) => {
    const { data, error } = await supabase
      .from('attendances')
      .select('*')
      .eq('session_id', sessionId)
      .eq('date', currentDate)
    
    if (!error) {
      setAttendances(data || [])
    }
  }
  
  const hasSignedToday = (traineeId, period = null) => {
    if (period) {
      return attendances.some(a => 
        a.trainee_id === traineeId && 
        (a.period === period || a.period === 'full')
      )
    }
    return attendances.some(a => a.trainee_id === traineeId)
  }
  
  const getSignatureStatus = (traineeId) => {
    const traineeAttendances = attendances.filter(a => a.trainee_id === traineeId)
    if (traineeAttendances.length === 0) return 'none'
    
    const hasFull = traineeAttendances.some(a => a.period === 'full')
    const hasAM = traineeAttendances.some(a => a.period === 'am')
    const hasPM = traineeAttendances.some(a => a.period === 'pm')
    
    if (hasFull || (hasAM && hasPM)) return 'complete'
    if (hasAM) return 'am'
    if (hasPM) return 'pm'
    return 'none'
  }
  
  const clearSignature = () => {
    sigCanvas.current?.clear()
  }
  
  const submitSignature = async () => {
    if (!selectedTrainee) {
      toast.error('Veuillez sélectionner votre nom')
      return
    }
    
    if (sigCanvas.current?.isEmpty()) {
      toast.error('Veuillez signer dans le cadre')
      return
    }
    
    // Vérifier si déjà signé pour cette période
    if (hasSignedToday(selectedTrainee, selectedPeriod)) {
      toast.error('Vous avez déjà émargé pour cette période')
      return
    }
    
    setSigning(true)
    
    try {
      const signatureData = sigCanvas.current.toDataURL('image/png')
      
      // Créer un hash simple pour la preuve
      const timestamp = new Date().toISOString()
      const proofString = `${session.id}-${selectedTrainee}-${currentDate}-${selectedPeriod}-${timestamp}`
      const signatureHash = btoa(proofString).substring(0, 64)
      
      const attendanceData = {
        session_id: session.id,
        trainee_id: selectedTrainee,
        date: currentDate,
        period: selectedPeriod,
        present: true,
        signature: signatureData,
        signature_hash: signatureHash,
        signed_at: timestamp,
      }
      
      const { data, error } = await supabase
        .from('attendances')
        .insert([attendanceData])
        .select()
        .single()
      
      if (error) {
        console.error('Insert error:', error)
        if (error.code === '23505') {
          throw new Error('Vous avez déjà émargé pour cette période')
        }
        throw error
      }
      
      toast.success('Émargement enregistré avec succès !')
      
      // Mettre à jour la liste des émargements
      setAttendances([...attendances, data])
      
      // Réinitialiser le formulaire
      setSelectedTrainee(null)
      clearSignature()
      
    } catch (err) {
      console.error('Submit error:', err)
      toast.error(err.message || 'Erreur lors de l\'enregistrement')
    } finally {
      setSigning(false)
    }
  }
  
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <RefreshCw className="w-8 h-8 text-primary-600 animate-spin mb-4" />
        <p className="text-gray-500">Chargement de la session...</p>
      </div>
    )
  }
  
  if (error) {
    return (
      <div className="card text-center py-12">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Erreur</h2>
        <p className="text-gray-500 mb-4">{error}</p>
        <button onClick={loadSession} className="btn btn-primary">
          Réessayer
        </button>
      </div>
    )
  }
  
  if (!session) {
    return (
      <div className="card text-center py-12">
        <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Session non trouvée</h2>
        <p className="text-gray-500">Le lien d'émargement est invalide ou a expiré.</p>
      </div>
    )
  }
  
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Info session */}
      <div className="card">
        <h1 className="text-xl font-bold text-gray-900 mb-2">
          {session.courses?.title || 'Formation'}
        </h1>
        <p className="text-gray-600 mb-4">{session.clients?.name}</p>
        
        <div className="flex flex-wrap gap-4 text-sm text-gray-500">
          <span className="flex items-center gap-1">
            <Calendar className="w-4 h-4" />
            {format(new Date(session.start_date), 'd MMMM yyyy', { locale: fr })}
          </span>
          {session.location && (
            <span className="flex items-center gap-1">
              <MapPin className="w-4 h-4" />
              {session.location}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="w-4 h-4" />
            {session.courses?.duration_hours}h
          </span>
          <span className="flex items-center gap-1">
            <Users className="w-4 h-4" />
            {trainees.length} stagiaire(s)
          </span>
        </div>
      </div>
      
      {/* Date du jour */}
      <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 text-center">
        <p className="text-primary-700 font-medium">
          📅 Émargement du {format(new Date(currentDate), 'EEEE d MMMM yyyy', { locale: fr })}
        </p>
      </div>
      
      {/* Liste des stagiaires */}
      <div className="card">
        <h2 className="font-semibold text-gray-900 mb-4">
          Cliquez sur votre nom pour émarger
        </h2>
        
        {trainees.length === 0 ? (
          <p className="text-gray-500 text-center py-4">Aucun stagiaire inscrit</p>
        ) : (
          <div className="space-y-3">
            {trainees.map(trainee => {
              const status = getSignatureStatus(trainee.id)
              const isComplete = status === 'complete'
              const isSelected = selectedTrainee === trainee.id
              
              return (
                <div 
                  key={trainee.id}
                  onClick={() => !isComplete && setSelectedTrainee(isSelected ? null : trainee.id)}
                  className={`p-4 rounded-lg border-2 transition-all cursor-pointer ${
                    isSelected
                      ? 'border-primary-500 bg-primary-50 shadow-md'
                      : isComplete
                      ? 'border-green-300 bg-green-50 cursor-default'
                      : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">
                        {trainee.first_name} {trainee.last_name}
                      </p>
                      {trainee.email && (
                        <p className="text-sm text-gray-500">{trainee.email}</p>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {status === 'complete' && (
                        <span className="badge badge-green flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          Complet
                        </span>
                      )}
                      {status === 'am' && (
                        <span className="badge badge-blue">Matin ✓</span>
                      )}
                      {status === 'pm' && (
                        <span className="badge badge-blue">Après-midi ✓</span>
                      )}
                      {status === 'none' && (
                        <span className="badge badge-gray">À signer</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      
      {/* Zone de signature */}
      {selectedTrainee && (
        <div className="card animate-fadeIn border-2 border-primary-200">
          <h2 className="font-semibold text-gray-900 mb-4">
            ✍️ Signature de {trainees.find(t => t.id === selectedTrainee)?.first_name}
          </h2>
          
          {/* Choix de la période */}
          <div className="mb-4">
            <label className="label">Période d'émargement</label>
            {session.day_type === 'half' ? (
              // Session demi-journée : une seule option (pas de choix)
              <div className="py-3 px-4 rounded-lg border-2 border-primary-500 bg-primary-50 text-primary-700 text-sm font-medium text-center">
                📆 Demi-journée
                {hasSignedToday(selectedTrainee, 'am') && ' ✓'}
              </div>
            ) : (
              // Session journée complète : choix matin / après-midi / journée
              <div className="grid grid-cols-3 gap-3">
                {[
                  { id: 'am', label: '🌅 Matin', disabled: hasSignedToday(selectedTrainee, 'am') },
                  { id: 'pm', label: '🌆 Après-midi', disabled: hasSignedToday(selectedTrainee, 'pm') },
                  { id: 'full', label: '📆 Journée', disabled: hasSignedToday(selectedTrainee, 'full') || (hasSignedToday(selectedTrainee, 'am') && hasSignedToday(selectedTrainee, 'pm')) },
                ].map(period => (
                  <button
                    key={period.id}
                    onClick={() => !period.disabled && setSelectedPeriod(period.id)}
                    disabled={period.disabled}
                    className={`py-3 px-4 rounded-lg border-2 text-sm font-medium transition-all ${
                      selectedPeriod === period.id
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : period.disabled
                        ? 'border-green-200 bg-green-50 text-green-600 cursor-not-allowed'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {period.label}
                    {period.disabled && ' ✓'}
                  </button>
                ))}
              </div>
            )}
          </div>
          
          {/* Canvas signature */}
          <div className="mb-4">
            <label className="label">Signez dans le cadre ci-dessous</label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg bg-white">
              <SignatureCanvas
                ref={sigCanvas}
                penColor="black"
                canvasProps={{
                  className: 'w-full h-48 rounded-lg',
                  style: { touchAction: 'none' }
                }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Utilisez votre doigt ou votre souris pour signer
            </p>
          </div>
          
          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={clearSignature}
              className="btn btn-secondary flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Effacer
            </button>
            <button
              onClick={() => setSelectedTrainee(null)}
              className="btn btn-secondary"
            >
              Annuler
            </button>
            <button
              onClick={submitSignature}
              disabled={signing}
              className="btn btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {signing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Envoi en cours...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Valider mon émargement
                </>
              )}
            </button>
          </div>
        </div>
      )}
      
      {/* Instructions */}
      {!selectedTrainee && trainees.length > 0 && (
        <div className="text-center py-4">
          <p className="text-gray-500">
            👆 Cliquez sur votre nom ci-dessus pour signer
          </p>
        </div>
      )}
      
      {/* Footer légal */}
      <div className="text-center text-xs text-gray-400 py-4">
        <p>
          Conformément aux articles L6353-1 à L6353-9 du Code du travail,
          cette feuille d'émargement constitue une preuve de présence.
        </p>
        <p className="mt-1">
          Votre signature électronique a valeur de preuve.
        </p>
      </div>
    </div>
  )
}
