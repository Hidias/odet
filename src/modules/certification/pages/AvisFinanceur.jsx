// Avis d'un financeur (0517, Qualiopi indicateur 30) : page publique ouverte par le lien reçu, sans compte.
// Une seule réponse ; note globale obligatoire, le reste facultatif. Aucune donnée de stagiaire n'est montrée.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle, Loader2, Lock } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import PublicLayout from '../../../app/PublicLayout'
import { Notes } from '../../portail/components/AvisEntreprise'
import { QUESTIONS_FINANCEUR } from '../lib/financeurs'

const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '')

// Hors du composant : défini dedans, il serait recréé à chaque frappe et le champ perdrait le curseur
const Cadre = ({ children }) => <PublicLayout title="Votre avis de financeur"><div className="max-w-xl mx-auto py-8 space-y-4">{children}</div></PublicLayout>

export default function AvisFinanceur() {
  const { token } = useParams()
  const [d, setD] = useState(null)
  const [erreur, setErreur] = useState('')
  const [rep, setRep] = useState({ note_globale: null, commentaire: '' })
  const [busy, setBusy] = useState(false)
  const [fini, setFini] = useState(false)
  const [refus, setRefus] = useState('')

  useEffect(() => {
    supabase.rpc('financeur_avis_ouvrir', { p_token: token }).then(({ data, error }) => {
      if (error) setErreur('Ouverture impossible pour le moment. Réessayez plus tard.')
      else if (data?.error) setErreur(data.error)
      else setD(data)
    })
  }, [token])

  const envoyer = async (e) => {
    e.preventDefault()
    if (!rep.note_globale) { setRefus('Choisissez une note globale de 1 à 5'); return }
    setBusy(true); setRefus('')
    const { data, error } = await supabase.rpc('financeur_avis_repondre', { p_token: token, p_reponses: { ...rep, commentaire: rep.commentaire.trim() } })
    setBusy(false)
    if (error) { setRefus('Envoi impossible pour le moment. Réessayez dans un instant.'); return }
    if (data?.error) { setRefus(data.error); return }
    setFini(true)
  }

  if (erreur) {
    return <Cadre><div className="text-center space-y-3"><div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto"><Lock className="w-6 h-6 text-gray-500" aria-hidden="true" /></div><p className="text-ui text-gray-700" role="alert">{erreur}</p></div></Cadre>
  }
  if (!d) return <Cadre><div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-gray-400" aria-label="Chargement" /></div></Cadre>
  if (fini || d.repondu) {
    return <Cadre><div className="text-center space-y-3"><CheckCircle className="w-10 h-10 mx-auto text-[rgb(var(--c-success))]" aria-hidden="true" /><p className="text-ui text-gray-800">{fini ? 'Merci, votre avis a bien été transmis.' : 'Votre avis a déjà été enregistré. Merci.'}</p><p className="text-ui-sm text-gray-600">{d.organisme} en tiendra compte dans sa démarche d'amélioration.</p></div></Cadre>
  }
  if (d.expire) {
    return <Cadre><p className="text-ui text-gray-700 text-center" role="alert">Ce lien a expiré. Vous pouvez répondre directement à l'e-mail reçu de {d.organisme}.</p></Cadre>
  }

  return (
    <Cadre>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-gray-900">{d.organisme}</h2>
        <p className="text-ui text-gray-700">
          Bonjour, merci de prendre deux minutes pour nous dire ce que vous pensez de notre travail, en tant que financeur ({d.financeur}), pour {d.sessions.length > 1 ? `les ${d.sessions.length} formations` : 'la formation'} de {d.annee}.
        </p>
      </div>
      {d.sessions.length > 0 && (
        <ul className="text-ui-sm text-gray-600 list-disc pl-5">
          {d.sessions.map((s, i) => <li key={i}>{s.titre || 'Formation'}{s.debut ? `, ${s.fin && s.fin !== s.debut ? `du ${fr(s.debut)} au ${fr(s.fin)}` : `le ${fr(s.debut)}`}` : ''}</li>)}
        </ul>
      )}
      <form onSubmit={envoyer} className="space-y-4">
        <div className="space-y-1.5">
          <span className="label">Note globale (obligatoire)</span>
          <Notes label="Note globale de 1 à 5" valeur={rep.note_globale} onChange={(v) => setRep({ ...rep, note_globale: v })} />
        </div>
        {QUESTIONS_FINANCEUR.map(([k, l]) => (
          <div key={k} className="space-y-1.5">
            <span className="label">{l}</span>
            <Notes label={`${l}, de 1 à 5`} valeur={rep[k] ?? null} onChange={(v) => setRep({ ...rep, [k]: v })} />
          </div>
        ))}
        <label className="block"><span className="label">Vos observations (facultatif)</span>
          <textarea className="input min-h-[110px]" maxLength={2000} value={rep.commentaire} onChange={(e) => setRep({ ...rep, commentaire: e.target.value })} />
        </label>
        <p className="text-ui-sm text-gray-500">1 : pas du tout satisfait, 5 : très satisfait. Votre réponse est envoyée une seule fois ; ce lien reste valable jusqu'au {fr(d.valable_jusqu_au)}.</p>
        {refus && <p className="text-ui-sm text-[rgb(var(--c-danger))]" role="alert">{refus}</p>}
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Envoyer mon avis</button>
      </form>
    </Cadre>
  )
}
