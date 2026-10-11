import { useEffect, useState } from 'react'
import { Lock, Eye, EyeOff, CheckCircle, Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '../supabase'
import { useBranding, brandLogo } from '../branding/BrandingProvider'

// Choix du mot de passe : après une invitation (mode 'welcome'), un lien de réinitialisation
// (mode 'reset') ou depuis le menu utilisateur (mode 'change', déjà connecté).
// Les liens d'invitation et de réinitialisation arrivent sur /?auth=welcome ou /?auth=reset
// avec le jeton dans le fragment : la bibliothèque Supabase ouvre la session automatiquement.

export function authModeFromUrl() {
  if (typeof window === 'undefined') return null
  const mode = new URLSearchParams(window.location.search).get('auth')
  return ['welcome', 'reset'].includes(mode) ? mode : null
}

function strength(pw) {
  let s = 0
  if (pw.length >= 10) s++
  if (pw.length >= 14) s++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
  if (/\d/.test(pw)) s++
  if (/[^A-Za-z0-9]/.test(pw)) s++
  return Math.min(s, 4)
}

export default function SetPassword({ mode = 'change', onDone }) {
  const { branding } = useBranding()
  const logo = brandLogo(branding, false)
  const [ready, setReady] = useState(mode === 'change')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      if (data.session) { setReady(true); setEmail(data.session.user.email || '') }
    }
    check()
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) { setReady(true); setEmail(session.user.email || '') }
    })
    // Lien expiré ou déjà utilisé : aucune session après quelques secondes
    const t = setTimeout(async () => {
      const { data } = await supabase.auth.getSession()
      if (!cancelled && !data.session && mode !== 'change') setError('Ce lien a expiré ou a déjà été utilisé. Demandez un nouveau lien à votre administrateur ou utilisez « Mot de passe oublié ».')
    }, 4000)
    return () => { cancelled = true; clearTimeout(t); sub.subscription.unsubscribe() }
  }, [mode])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (pw.length < 10) return setError('10 caractères minimum')
    if (pw !== pw2) return setError('Les deux mots de passe ne sont pas identiques')
    setBusy(true)
    const { error: err } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (err) return setError(err.message)
    setDone(true)
  }

  const finish = () => {
    if (onDone) return onDone()
    // On repart d'une adresse propre (sans ?auth=) vers l'application
    window.location.replace(`${window.location.origin}/#/`)
  }

  const titles = { welcome: 'Bienvenue', reset: 'Nouveau mot de passe', change: 'Changer mon mot de passe' }
  const intro = {
    welcome: `Choisissez le mot de passe de votre compte${branding.app_name ? ` ${branding.app_name}` : ''}.`,
    reset: 'Choisissez un nouveau mot de passe.',
    change: 'Le nouveau mot de passe remplace l\'actuel sur tous vos appareils.',
  }
  const level = strength(pw)

  const card = (
    <div className="w-full max-w-sm">
      {mode !== 'change' && (
        <div className="text-center mb-8">
          {logo && <img src={logo} alt={branding.org_name || ''} className="h-14 mx-auto mb-3 object-contain" />}
          <div className="font-display font-semibold text-xl text-gray-900">{branding.app_name || branding.org_name}</div>
        </div>
      )}
      {done ? (
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))] flex items-center justify-center mx-auto mb-4"><CheckCircle className="w-8 h-8" /></div>
          <h1 className="font-display font-semibold text-2xl text-gray-900">Mot de passe enregistré</h1>
          <p className="muted mt-1 mb-6">{email ? `Compte ${email}.` : ''}</p>
          <button type="button" className="btn btn-primary w-full" onClick={finish}>{mode === 'change' ? 'Fermer' : 'Ouvrir l\'application'}</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <h1 className="font-display font-semibold text-2xl text-gray-900">{titles[mode]}</h1>
            <p className="muted mt-1">{intro[mode]}{email ? ` Compte : ${email}` : ''}</p>
          </div>
          {!ready && !error && <div className="flex items-center gap-2 text-ui text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Vérification du lien</div>}
          {error && (
            <div className="p-3 rounded-ui-sm flex items-start gap-2 text-ui" style={{ background: 'rgb(var(--c-danger-bg))', color: 'rgb(var(--c-danger))' }}>
              <AlertCircle className="w-4 h-4 flex-none mt-0.5" /> {error}
            </div>
          )}
          <div>
            <label className="label" htmlFor="new-pw">Nouveau mot de passe</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input id="new-pw" type={show ? 'text' : 'password'} autoComplete="new-password" className="input pl-9 pr-10" value={pw} onChange={(e) => setPw(e.target.value)} disabled={!ready} />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 p-1" onClick={() => setShow((v) => !v)} aria-label="Afficher">{show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
            </div>
            <div className="flex gap-1 mt-2">
              {[0, 1, 2, 3].map((i) => <div key={i} className={`h-1 flex-1 rounded-full ${i < level ? (level >= 3 ? 'bg-[rgb(var(--c-success))]' : 'bg-[rgb(var(--c-warning))]') : 'bg-gray-200'}`} />)}
            </div>
            <p className="text-ui-sm text-gray-400 mt-1">10 caractères minimum. Une phrase de plusieurs mots est plus sûre qu'un mot compliqué.</p>
          </div>
          <div>
            <label className="label" htmlFor="new-pw2">Confirmation</label>
            <input id="new-pw2" type={show ? 'text' : 'password'} autoComplete="new-password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} disabled={!ready} />
          </div>
          <button type="submit" className="btn btn-primary w-full" disabled={!ready || busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Enregistrer le mot de passe</button>
        </form>
      )}
    </div>
  )

  if (mode === 'change') return <div className="card max-w-md">{card}</div>
  return <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'rgb(var(--ground))' }}>{card}</div>
}
