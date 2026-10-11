import { useState } from 'react'
import { useNavigate, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store'
import { Mail, Lock, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { user, login, error } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()

  // Page demandée avant la connexion (ex : QR code signature sur le téléphone)
  const from = typeof location.state?.from === 'string' ? location.state.from : '/'

  // Si déjà connecté, rediriger
  if (user) {
    return <Navigate to={from} replace />
  }
  
  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    
    const result = await login(email, password)
    
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('🎓 Bienvenue sur Campus !')
      navigate(from, { replace: true })
    }
    
    setIsLoading(false)
  }
  
  return (
    <div className="min-h-screen bg-primary-500 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <img src="/assets/logo-campus.png" alt="Access Campus" className="h-24 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-accent-500">Access Campus</h1>
          <p className="text-white/70 mt-1">Votre plateforme de gestion des formations</p>
        </div>
        
        {/* Card de connexion */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Connexion</h2>
          <p className="text-sm text-gray-500 mb-6">Campus vous souhaite la bienvenue</p>
          
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input pl-10"
                  placeholder="votre@email.com"
                  required
                />
              </div>
            </div>
            
            <div>
              <label className="label">Mot de passe</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input pl-10"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>
            
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 bg-accent-500 hover:bg-accent-600 text-primary-900 font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-primary-900/30 border-t-primary-900 rounded-full animate-spin" />
                  Connexion...
                </>
              ) : (
                'Se connecter'
              )}
            </button>
          </form>
          
          {/* Note sur les accès */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-xs text-gray-500 text-center">
              Accès réservé aux utilisateurs autorisés.
              <br />
              Contactez l'administrateur si besoin.
            </p>
          </div>
        </div>
        
        <p className="text-center text-white/40 text-xs mt-6">Access Campus V2.7.0</p>
      </div>
    </div>
  )
}
