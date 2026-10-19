import { useState } from 'react'
import { UserPlus, Loader2, CheckCircle2, Eye, EyeOff } from 'lucide-react'

// Création du compte stagiaire depuis le portail (lot 2, 0047) : le stagiaire a ouvert son espace avec le code de sa
// convocation (ticket du portail) ; il choisit son adresse et son mot de passe, le serveur vérifie le ticket et relie
// le compte à sa fiche. Il retrouve ensuite ses formations, attestations et certificats en se connectant.

export default function CompteStagiairePortail({ token, trainee, ticket, emailConnu }) {
  const [ouvert, setOuvert] = useState(false)
  const [email, setEmail] = useState(emailConnu || '')
  const [password, setPassword] = useState('')
  const [voir, setVoir] = useState(false)
  const [busy, setBusy] = useState(false)
  const [erreur, setErreur] = useState('')
  const [fait, setFait] = useState(false)

  if (!trainee || !ticket) return null

  const creer = async (e) => {
    e.preventDefault()
    setErreur('')
    if (password.length < 10) { setErreur('Mot de passe de 10 caractères au moins'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/comptes-externes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'creer_stagiaire', token, trainee_id: trainee.id, ticket, email, password }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErreur(j.error || 'Création impossible pour le moment'); return }
      setFait(true)
    } catch {
      setErreur('Création impossible pour le moment')
    } finally { setBusy(false) }
  }

  if (fait) {
    return (
      <div className="bg-white rounded-ui-lg border border-gray-200 p-4 text-ui text-gray-700 flex items-start gap-2">
        <CheckCircle2 className="w-5 h-5 text-[rgb(var(--c-success))] shrink-0" />
        <span>Compte créé. Connectez-vous avec <strong>{email}</strong> sur <a href="/#/login" className="text-primary-700 underline">la page de connexion</a> pour retrouver vos formations et vos documents.</span>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-ui-lg border border-gray-200 p-4 space-y-3">
      <button type="button" onClick={() => setOuvert(!ouvert)} className="w-full flex items-center gap-3 text-left">
        <span className="w-10 h-10 rounded-full bg-primary-50 text-primary-700 flex items-center justify-center shrink-0"><UserPlus className="w-5 h-5" /></span>
        <span className="min-w-0">
          <span className="block font-semibold text-gray-900">Créer mon compte</span>
          <span className="block text-ui-sm text-gray-500">Pour retrouver mes formations, attestations et certificats</span>
        </span>
      </button>
      {ouvert && (
        <form onSubmit={creer} className="space-y-2">
          <input type="email" required className="input w-full" placeholder="Mon adresse email" value={email} onChange={(e) => setEmail(e.target.value.trim())} aria-label="Adresse email" autoComplete="email" />
          <div className="relative">
            <input type={voir ? 'text' : 'password'} required minLength={10} className="input w-full pr-10" placeholder="Mot de passe (10 caractères au moins)"
              value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Mot de passe" autoComplete="new-password" />
            <button type="button" onClick={() => setVoir(!voir)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400" aria-label={voir ? 'Masquer' : 'Afficher'}>
              {voir ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {erreur && <p className="text-ui-sm text-[rgb(var(--c-danger))]">{erreur}</p>}
          <button type="submit" className="btn btn-primary w-full justify-center" disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Créer mon compte</button>
        </form>
      )}
    </div>
  )
}
