import { orgEmail } from '../../../core/org/currentOrg'
import { useState } from 'react'
import { useBranding } from '../../../core/branding/BrandingProvider'
import { supabase } from '../../../core/supabase'
import { AlertCircle, Send, CheckCircle, Search, Building2, Calendar, GraduationCap } from 'lucide-react'

export default function Reclamation() {
  const { branding } = useBranding()
  const [sessionRef, setSessionRef] = useState('')
  const [sessionInfo, setSessionInfo] = useState(null)
  const [sessionError, setSessionError] = useState('')
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    company: '',
    message: '',
    honeypot: '' // Anti-bot
  })
  
  // Vérifier la session
  const handleVerifySession = async () => {
    if (!sessionRef.trim()) {
      setSessionError('Veuillez saisir un numéro de session')
      return
    }
    
    const fullRef = sessionRef.startsWith('SES-') ? sessionRef : `SES-${sessionRef}`
    
    setVerifying(true)
    setSessionError('')
    setSessionInfo(null)
    
    try {
      // Vérification par fonction publique : le portail ne lit aucune table directement
      const { data, error } = await supabase.rpc('public_reclamation_session', { p_reference: fullRef })

      if (error) {
        console.error('Supabase error:', error)
        setSessionError('Erreur lors de la vérification')
        return
      }

      if (!data) {
        setSessionError('Session non trouvée. Vérifiez le numéro.')
        return
      }

      const courseTitle = data.title || 'Formation'

      setSessionInfo({
        id: data.id,
        reference: data.reference,
        title: courseTitle,
        startDate: data.start_date,
        endDate: data.end_date
      })
    } catch (err) {
      console.error('Erreur:', err)
      setSessionError('Erreur lors de la vérification')
    } finally {
      setVerifying(false)
    }
  }
  
  // Soumettre la réclamation
  const handleSubmit = async (e) => {
    e.preventDefault()
    
    // Anti-bot
    if (form.honeypot) {
      setSubmitted(true)
      return
    }
    
    if (!form.fullName || !form.email || !form.message) {
      setError('Veuillez remplir tous les champs obligatoires')
      return
    }
    
    if (!sessionInfo) {
      setError('Veuillez vérifier le numéro de session')
      return
    }
    
    setLoading(true)
    setError('')
    
    try {
      // Enregistrement et notification par fonction publique
      const { error: reclError } = await supabase.rpc('public_reclamation_submit', {
        p_session_id: sessionInfo.id,
        p_full_name: form.fullName,
        p_email: form.email,
        p_phone: form.phone || null,
        p_company: form.company || null,
        p_message: form.message,
      })

      if (reclError) throw reclError
      
      // La notification est créée par la fonction
      setSubmitted(true)
    } catch (err) {
      console.error('Erreur soumission:', err)
      setError('Une erreur est survenue. Veuillez réessayer ou nous contacter' + (orgEmail() ? ` à ${orgEmail()}` : ''))
    } finally {
      setLoading(false)
    }
  }
  
  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return ''
    return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  }
  
  // Page de confirmation
  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Réclamation enregistrée</h1>
          <p className="text-gray-600 mb-6">
            Votre demande a bien été prise en compte. Un premier retour vous sera transmis sous 48 heures ouvrées.
          </p>
          <p className="text-sm text-gray-500">
            Pour toute question urgente : <a href={`mailto:${orgEmail()}`} className="text-primary-600 hover:underline">{orgEmail()}</a>
          </p>
        </div>
      </div>
    )
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-500 to-primary-700 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          {(branding.logo_url || branding.logo_base64) && <img src={branding.logo_url || branding.logo_base64} alt={branding.org_name || ''} className="h-16 mx-auto mb-4 bg-white rounded-ui p-2 object-contain" />}
          <h1 className="text-3xl font-bold text-white">Formulaire de réclamation</h1>
          <p className="text-white/80 mt-2">{branding.org_name} - Suivi qualité</p>
        </div>
        
        {/* Formulaire */}
        <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Numéro de session */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Numéro de session *
              </label>
              <div className="flex gap-2">
                <div className="flex-1 flex">
                  <span className="inline-flex items-center px-3 bg-gray-100 border border-r-0 border-gray-300 rounded-l-lg text-gray-500 text-sm">
                    SES-
                  </span>
                  <input
                    type="text"
                    value={sessionRef.replace('SES-', '')}
                    onChange={(e) => {
                      setSessionRef(e.target.value.toUpperCase())
                      setSessionInfo(null)
                      setSessionError('')
                    }}
                    placeholder="XXXXXXXX"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-r-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 uppercase"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleVerifySession}
                  disabled={verifying}
                  className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 flex items-center gap-2"
                >
                  <Search className="w-4 h-4" />
                  {verifying ? 'Vérification...' : 'Vérifier'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Le numéro de session figure sur vos documents de formation (convocation, feuille d'émargement)
              </p>
              
              {sessionError && (
                <p className="text-red-600 text-sm mt-2 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  {sessionError}
                </p>
              )}
              
              {sessionInfo && (
                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-green-700 font-medium flex items-center gap-2 mb-2">
                    <CheckCircle className="w-4 h-4" />
                    Session trouvée
                  </p>
                  <div className="text-sm text-green-800 space-y-1">
                    <p className="flex items-center gap-2">
                      <GraduationCap className="w-4 h-4" />
                      {sessionInfo.title}
                    </p>
                    <p className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      {formatDate(sessionInfo.startDate)}
                      {sessionInfo.endDate !== sessionInfo.startDate && ` - ${formatDate(sessionInfo.endDate)}`}
                    </p>
                  </div>
                </div>
              )}
            </div>
            
            {/* Nom */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nom et prénom *
              </label>
              <input
                type="text"
                value={form.fullName}
                onChange={(e) => setForm({...form, fullName: e.target.value})}
                placeholder="Jean Dupont"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                required
              />
            </div>
            
            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Adresse email *
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({...form, email: e.target.value})}
                placeholder="jean.dupont@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                required
              />
            </div>
            
            {/* Téléphone et Entreprise */}
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Téléphone
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({...form, phone: e.target.value})}
                  placeholder="06 XX XX XX XX"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Entreprise
                </label>
                <input
                  type="text"
                  value={form.company}
                  onChange={(e) => setForm({...form, company: e.target.value})}
                  placeholder="Nom de votre entreprise"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>
            
            {/* Message */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Votre réclamation *
              </label>
              <textarea
                value={form.message}
                onChange={(e) => setForm({...form, message: e.target.value})}
                rows={5}
                placeholder="Décrivez votre réclamation de manière détaillée..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                required
              />
            </div>
            
            {/* Honeypot - caché */}
            <input
              type="text"
              name="website"
              value={form.honeypot}
              onChange={(e) => setForm({...form, honeypot: e.target.value})}
              style={{ display: 'none' }}
              tabIndex={-1}
              autoComplete="off"
            />
            
            {/* Erreur */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}
            
            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !sessionInfo}
              className="w-full py-3 px-4 bg-primary-500 text-white font-medium rounded-lg hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
            >
              <Send className="w-5 h-5" />
              {loading ? 'Envoi en cours...' : 'Envoyer ma réclamation'}
            </button>
            
            <p className="text-xs text-gray-500 text-center">
              Un premier retour vous sera transmis sous 48 heures ouvrées.
              <br />
              Vous pouvez également nous contacter à{' '}
              <a href={`mailto:${orgEmail()}`} className="text-primary-600 hover:underline">
                {orgEmail()}
              </a>
            </p>
          </form>
        </div>
        
        {/* Footer */}
        <p className="text-center text-white/60 text-sm mt-6">
          © {new Date().getFullYear()} {branding.legal_name || branding.org_name} - Organisme de formation
        </p>
      </div>
    </div>
  )
}
