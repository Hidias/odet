import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Mail, Lock, AlertCircle, Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store'
import { supabase } from '../supabase'
import { useBranding, brandLogo } from '../branding/BrandingProvider'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const { user, login, error } = useAuthStore()
  const { branding } = useBranding()
  const location = useLocation()

  // Page demandée avant la connexion (par exemple la signature sur le téléphone du formateur)
  const from = typeof location.state?.from === 'string' ? location.state.from : '/'

  if (user) {
    return <Navigate to={from} replace />
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    const result = await login(email.trim(), password)
    if (result.error) {
      toast.error(result.error)
      setIsLoading(false)
    }
    // Connexion réussie : la redirection est faite par <Navigate> ci-dessus dès que l'utilisateur est en mémoire
  }

  const forgot = async () => {
    if (!email.trim()) return toast.error('Saisissez votre adresse email, puis cliquez à nouveau')
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/?auth=reset` })
    if (err) toast.error(err.message)
    else toast.success('Si ce compte existe, un lien de réinitialisation vient de vous être envoyé')
  }

  const logo = brandLogo(branding, false)
  const title = branding.app_name || branding.org_name || ''

  return (
    <div className="min-h-screen flex" style={{ background: 'rgb(var(--ground))' }}>
      {/* Panneau de marque (bureau) */}
      <div className="hidden lg:flex lg:w-[46%] bg-nav text-nav-fg flex-col justify-between p-12">
        <div className="flex items-center gap-4">
          {logo && (
            <div className="bg-white rounded-ui p-2 inline-flex">
              <img src={logo} alt={branding.org_name || ''} className="h-12 w-auto max-w-[180px] object-contain" />
            </div>
          )}
        </div>
        <div>
          <div className="font-display font-semibold text-4xl leading-tight">{title}</div>
          {branding.org_name && branding.org_name !== title && (
            <div className="text-nav-fg/70 mt-2 text-lg">{branding.org_name}</div>
          )}
          <p className="text-nav-fg/60 mt-6 max-w-md">
            Sessions, stagiaires, documents, qualité et facturation au même endroit.
          </p>
        </div>
        <div className="text-nav-fg/40 text-ui-sm">
          {branding.qualiopi_certified ? 'Organisme certifié Qualiopi' : ''}
        </div>
      </div>

      {/* Formulaire */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden text-center mb-8">
            {logo && <img src={logo} alt={branding.org_name || ''} className="h-14 mx-auto mb-3 object-contain" />}
            <div className="font-display font-semibold text-2xl">{title}</div>
          </div>

          <h2 className="font-display font-semibold text-2xl text-gray-900">Connexion</h2>
          <p className="text-gray-500 mt-1 mb-6">Accédez à votre espace de gestion.</p>

          {error && (
            <div className="mb-4 p-3 rounded-ui-sm flex items-center gap-2 text-ui" style={{ background: 'rgb(var(--c-danger-bg))', color: 'rgb(var(--c-danger))' }}>
              <AlertCircle className="w-4 h-4 flex-none" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="label">Adresse email</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
                  className="input pl-9" placeholder="vous@exemple.fr" />
              </div>
            </div>
            <div>
              <label htmlFor="password" className="label">Mot de passe</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password}
                  onChange={(e) => setPassword(e.target.value)} className="input pl-9 pr-10" placeholder="Votre mot de passe" />
                <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={isLoading} className="btn btn-primary w-full" style={{ height: 44 }}>
              {isLoading ? 'Connexion en cours' : 'Se connecter'}
            </button>
          </form>
          <button type="button" onClick={forgot} className="mt-4 text-ui-sm text-gray-500 hover:text-gray-800 underline">Mot de passe oublié</button>

          <p className="text-ui-sm text-gray-400 mt-8 text-center">
            Accès réservé aux utilisateurs autorisés par {branding.org_name || 'votre organisme'}.
          </p>
        </div>
      </div>
    </div>
  )
}
