// Page de connexion dédiée à l'espace client (0449) : adresse e-mail et mot de passe du compte personnel, mot de passe
// oublié ; un compte de l'équipe qui arrive ici est renvoyé vers l'outil. Le lien et le code restent possibles.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, FileText, ShieldCheck, Clock, ArrowRight, Sparkles } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { useAuthStore } from '../../../core/store'
import { useBranding } from '../../../core/branding/BrandingProvider'
import { EcranVitrine } from '../components/Vitrine'

export default function EspaceClientConnexion() {
  const { branding } = useBranding()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [mdp, setMdp] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [oubli, setOubli] = useState(false)

  const connecter = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: mdp })
    if (error) { setBusy(false); setMsg({ ok: false, texte: 'Adresse ou mot de passe incorrect' }); return }
    const { data: prof } = await supabase.from('profiles').select('role').eq('id', data.user.id).maybeSingle()
    await useAuthStore.getState().initialize?.()
    setBusy(false)
    navigate(prof?.role === 'entreprise' ? '/mon-entreprise' : '/', { replace: true })
  }
  const envoyerOubli = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/?auth=reset` })
    setBusy(false)
    setMsg({ ok: true, texte: 'Si un compte existe pour cette adresse, un e-mail vous permet de choisir un nouveau mot de passe.' })
  }

  return (
    <EcranVitrine branding={branding} libelle="Espace client" pastille="Votre espace client" pastilleIcone={Sparkles}
      titre="Vos devis, formations, interventions et documents, au même endroit."
      accroche={`Tout ce que vous faites avec ${branding.org_name || 'votre prestataire'}, signé en ligne et disponible à tout moment.`}
      atouts={[
        { i: FileText, t: 'Devis et conventions à signer en ligne, rapports d\'intervention, factures, attestations et certificats' },
        { i: Clock, t: 'Disponible jour et nuit, sans demande à faire' },
        { i: ShieldCheck, t: 'Compte personnel, appareils inconnus signalés' },
      ]}
      pied={branding.org_name}>
      <h2 className="font-display text-xl font-semibold text-gray-900">{oubli ? 'Mot de passe oublié' : 'Connexion à mon espace'}</h2>
      {msg && <p role="status" className={`mt-3 text-sm rounded-ui px-3 py-2 ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{msg.texte}</p>}
      <form className="mt-4 space-y-3" onSubmit={oubli ? envoyerOubli : connecter}>
        <label className="block"><span className="label">Adresse e-mail</span><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {!oubli && <label className="block"><span className="label">Mot de passe</span><input className="input" type="password" autoComplete="current-password" required value={mdp} onChange={(e) => setMdp(e.target.value)} /></label>}
        <button type="submit" className="btn btn-primary w-full justify-center" disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="w-4 h-4" aria-hidden="true" />}{oubli ? 'Recevoir le lien' : 'Me connecter'}
        </button>
      </form>
      <button type="button" className="mt-3 text-sm text-primary-800 underline underline-offset-2" onClick={() => { setOubli(!oubli); setMsg(null) }}>{oubli ? 'Revenir à la connexion' : 'Mot de passe oublié ?'}</button>
      <p className="mt-6 text-sm text-gray-600">Pas encore de compte ? Ouvrez le lien de votre espace reçu par e-mail, saisissez le code reçu dans un e-mail séparé, puis « Sécurité et compte » pour créer le vôtre.</p>
    </EcranVitrine>
  )
}
