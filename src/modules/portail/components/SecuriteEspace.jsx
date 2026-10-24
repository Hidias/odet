// Sécurité de l'espace client (0449) : compte personnel créé à la première connexion, changement du code d'accès ou
// du mot de passe, appareils qui ont ouvert l'espace (le client repère un appareil qu'il ne connaît pas).

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, KeyRound, UserPlus, Smartphone, ShieldCheck, Loader2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { motifCode, motifMotDePasse } from '../../../core/portail/appareil'

const quand = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

function Bloc({ icone: I, titre, children }) {
  return (
    <section className="space-y-2">
      <h3 className="font-semibold text-gray-900 flex items-center gap-2"><I className="w-4 h-4 text-gray-400" aria-hidden="true" />{titre}</h3>
      {children}
    </section>
  )
}

export function ListeAppareils({ appareils = [] }) {
  if (!appareils.length) return <p className="text-sm text-gray-500">Aucun appareil enregistré.</p>
  return (
    <ul className="divide-y divide-gray-100 text-sm">
      {appareils.map((a, i) => (
        <li key={i} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="font-medium">{a.libelle || 'Navigateur'}</span>
          {a.actuel && <span className="badge badge-success">cet appareil</span>}
          <span className="text-gray-500 w-full sm:w-auto sm:ml-auto">dernière ouverture le {quand(a.derniere)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * @param {object} p
 * @param {'lien'|'compte'} p.mode
 * @param {string} [p.token] @param {string} [p.code] lien et code (mode « lien »)
 * @param {object} [p.infos] { compte, email } de client_portal_acces_infos
 * @param {object[]} [p.appareils]
 * @param {(nouveau: string) => void} [p.onCode] nouveau code enregistré
 */
export default function SecuriteEspace({ mode, token, code, infos = null, appareils = [], onCode, onFermer }) {
  const navigate = useNavigate()
  const [nouveauCode, setNouveauCode] = useState('')
  const [compte, setCompte] = useState({ email: infos?.email || '', mdp: '', mdp2: '' })
  const [mdp, setMdp] = useState({ a: '', b: '' })
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null) // { ok, texte }

  const changerCode = async (e) => {
    e.preventDefault()
    const motif = motifCode(nouveauCode)
    if (motif) { setMsg({ ok: false, texte: motif }); return }
    setBusy('code'); setMsg(null)
    const { data, error } = await supabase.rpc('client_portal_changer_code', { p_token: token, p_code: code, p_nouveau: nouveauCode.replace(/\s/g, '') })
    setBusy(null)
    if (error || data?.error) { setMsg({ ok: false, texte: data?.error || 'Changement impossible pour le moment' }); return }
    onCode?.(nouveauCode.replace(/\s/g, ''))
    setNouveauCode('')
    setMsg({ ok: true, texte: 'Code changé. Utilisez désormais ce nouveau code, aussi pour vos collègues qui ouvrent l\'espace.' })
  }

  const creerCompte = async (e) => {
    e.preventDefault()
    const motif = motifMotDePasse(compte.mdp)
    if (motif) { setMsg({ ok: false, texte: `Mot de passe : ${motif}` }); return }
    if (compte.mdp !== compte.mdp2) { setMsg({ ok: false, texte: 'Les deux mots de passe ne sont pas identiques' }); return }
    setBusy('compte'); setMsg(null)
    try {
      const r = await fetch('/api/espace-entreprise', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'creer_compte', token, code, email: compte.email.trim(), password: compte.mdp }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Création impossible pour le moment')
      const { error } = await supabase.auth.signInWithPassword({ email: compte.email.trim(), password: compte.mdp })
      if (error) throw new Error('Compte créé : connectez-vous avec votre adresse et votre mot de passe')
      navigate('/mon-entreprise', { replace: true })
    } catch (err) {
      setMsg({ ok: false, texte: err.message })
    }
    setBusy(null)
  }

  const changerMdp = async (e) => {
    e.preventDefault()
    const motif = motifMotDePasse(mdp.a)
    if (motif) { setMsg({ ok: false, texte: `Mot de passe : ${motif}` }); return }
    if (mdp.a !== mdp.b) { setMsg({ ok: false, texte: 'Les deux mots de passe ne sont pas identiques' }); return }
    setBusy('mdp'); setMsg(null)
    const { error } = await supabase.auth.updateUser({ password: mdp.a })
    setBusy(null)
    if (error) { setMsg({ ok: false, texte: error.message }); return }
    setMdp({ a: '', b: '' })
    setMsg({ ok: true, texte: 'Mot de passe changé.' })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Sécurité de mon espace">
      <div className="bg-white w-full sm:max-w-lg rounded-t-ui-lg sm:rounded-ui-lg shadow-xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-gray-500" aria-hidden="true" />
          <h2 className="font-semibold flex-1">Sécurité de mon espace</h2>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Fermer" onClick={onFermer}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-6">
          {msg && <p role="status" className={`text-sm rounded-ui px-3 py-2 ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{msg.texte}</p>}

          {mode === 'lien' && !infos?.compte && (
            <Bloc icone={UserPlus} titre="Créer mon compte personnel">
              <p className="text-sm text-gray-600">Avec votre adresse e-mail et un mot de passe, vous retrouvez votre espace sans lien ni code, depuis la page de connexion de l'espace client.</p>
              <form className="grid gap-2" onSubmit={creerCompte}>
                <label className="block"><span className="label">Adresse e-mail</span><input className="input" type="email" autoComplete="email" required value={compte.email} onChange={(e) => setCompte({ ...compte, email: e.target.value })} /></label>
                <span className="text-xs text-gray-500">L'adresse connue de votre interlocuteur pour votre entreprise.</span>
                <label className="block"><span className="label">Mot de passe</span><input className="input" type="password" autoComplete="new-password" required value={compte.mdp} onChange={(e) => setCompte({ ...compte, mdp: e.target.value })} /></label>
                <label className="block"><span className="label">Mot de passe, encore une fois</span><input className="input" type="password" autoComplete="new-password" required value={compte.mdp2} onChange={(e) => setCompte({ ...compte, mdp2: e.target.value })} /></label>
                <span className="text-xs text-gray-500">10 caractères au moins, avec des lettres et des chiffres.</span>
                <button type="submit" className="btn btn-primary" disabled={busy === 'compte'}>{busy === 'compte' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}Créer mon compte</button>
              </form>
            </Bloc>
          )}

          {mode === 'lien' && (
            <Bloc icone={KeyRound} titre="Changer le code d'accès">
              <p className="text-sm text-gray-600">Le code est commun à votre entreprise : prévenez les collègues qui ouvrent l'espace avec le lien.</p>
              <form className="flex flex-wrap gap-2 items-end" onSubmit={changerCode}>
                <label className="block flex-1 min-w-[10rem]"><span className="label">Nouveau code (6 à 8 chiffres)</span><input className="input tracking-widest" inputMode="numeric" autoComplete="off" maxLength={8} value={nouveauCode} onChange={(e) => setNouveauCode(e.target.value.replace(/\D/g, ''))} /></label>
                <button type="submit" className="btn btn-secondary" disabled={busy === 'code' || nouveauCode.length < 6}>Changer</button>
              </form>
            </Bloc>
          )}

          {mode === 'compte' && (
            <Bloc icone={KeyRound} titre="Changer mon mot de passe">
              <form className="grid gap-2" onSubmit={changerMdp}>
                <label className="block"><span className="label">Nouveau mot de passe</span><input className="input" type="password" autoComplete="new-password" value={mdp.a} onChange={(e) => setMdp({ ...mdp, a: e.target.value })} /></label>
                <label className="block"><span className="label">Encore une fois</span><input className="input" type="password" autoComplete="new-password" value={mdp.b} onChange={(e) => setMdp({ ...mdp, b: e.target.value })} /></label>
                <button type="submit" className="btn btn-secondary" disabled={busy === 'mdp' || !mdp.a}>Changer</button>
              </form>
            </Bloc>
          )}

          <Bloc icone={Smartphone} titre="Appareils qui ont ouvert l'espace">
            <ListeAppareils appareils={appareils} />
            <p className="text-xs text-gray-500">Un appareil que vous ne connaissez pas ? {mode === 'lien' ? 'Changez le code ci-dessus' : 'Changez votre mot de passe'} et prévenez votre interlocuteur.</p>
          </Bloc>
        </div>
      </div>
    </div>
  )
}
