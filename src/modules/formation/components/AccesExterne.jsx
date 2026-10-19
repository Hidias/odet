import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Copy, KeyRound, Loader2, UserPlus } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { callApi } from '../../../core/api'

// Compte personnel d'un formateur externe ou d'un stagiaire (lot 2, 0047), sur sa fiche.
// L'application n'envoie aucun email : le lien pour choisir un mot de passe s'affiche, à transmettre par la personne.
// Un stagiaire peut aussi créer son compte lui-même depuis son espace (code de la convocation).

const fr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const LIBELLES = {
  formateur: { titre: 'Espace formateur', texte: 'Ses sessions, programmes et listes de stagiaires, ses justificatifs. Jamais de prix ni de factures.' },
  stagiaire: { titre: 'Compte stagiaire', texte: 'Ses formations, attestations et certificats. Le stagiaire peut aussi créer son compte depuis son espace, avec le code de sa convocation.' },
}

export default function AccesExterne({ kind, id, email: emailFiche, peutGerer }) {
  const [etat, setEtat] = useState(undefined)
  const [email, setEmail] = useState(emailFiche || '')
  const [ouvert, setOuvert] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lien, setLien] = useState(null)

  const load = async () => {
    const { data, error } = await supabase.rpc('acces_externe_etat', { p_kind: kind, p_id: id })
    setEtat(error ? 'indispo' : data || null)
  }
  useEffect(() => { if (id) load() }, [id, kind])

  if (etat === undefined || etat === 'indispo') return null
  const L = LIBELLES[kind]

  const appeler = async (action) => {
    setBusy(true)
    try {
      const r = await callApi('/api/comptes-externes', { action, kind, id, email })
      setLien(r.link || null)
      setOuvert(false)
      if (action === 'inviter') toast.success('Compte créé : transmettez le lien')
      load()
    } catch (e) {
      toast.error(e.message)
    } finally { setBusy(false) }
  }

  const copier = async () => {
    try { await navigator.clipboard.writeText(lien); toast.success('Lien copié') } catch { toast.error('Copie impossible') }
  }

  return (
    <div className="border border-gray-200 rounded-ui-sm p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-gray-900 text-ui">{L.titre}</div>
        {etat && <span className={`text-ui-sm px-2 py-0.5 rounded-full ${etat.is_active === false ? 'bg-gray-100 text-gray-500' : 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]'}`}>{etat.is_active === false ? 'Désactivé' : 'Actif'}</span>}
      </div>
      {etat ? (
        <>
          <div className="text-ui-sm text-gray-600">{etat.email} · {etat.last_seen_at ? `vu le ${fr(etat.last_seen_at)}` : 'pas encore connecté'}</div>
          {peutGerer && etat.is_active !== false && (
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => appeler('lien')} disabled={busy}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />} Lien pour choisir un mot de passe
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-ui-sm text-gray-500">{L.texte}</p>
          {peutGerer && !ouvert && <button type="button" className="btn btn-sm btn-secondary" onClick={() => setOuvert(true)}><UserPlus className="w-3.5 h-3.5" /> Créer son accès</button>}
          {peutGerer && ouvert && (
            <div className="flex flex-wrap gap-2">
              <input type="email" className="input flex-1 min-w-[200px]" value={email} onChange={(e) => setEmail(e.target.value.trim())} placeholder="Adresse email de connexion" aria-label="Adresse email de connexion" />
              <button type="button" className="btn btn-primary" onClick={() => appeler('inviter')} disabled={busy || !email}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Créer</button>
              <button type="button" className="btn btn-ghost" onClick={() => setOuvert(false)}>Annuler</button>
            </div>
          )}
        </>
      )}
      {lien && (
        <div className="space-y-1">
          <p className="text-ui-sm text-gray-600">À transmettre depuis votre messagerie (le lien ne sert qu'une fois) :</p>
          <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-ui-sm">
            <span className="text-ui-sm text-gray-700 truncate flex-1">{lien}</span>
            <button type="button" onClick={copier} className="p-1.5 text-gray-400 hover:text-primary-600 rounded hover:bg-white" title="Copier le lien"><Copy className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}
    </div>
  )
}
