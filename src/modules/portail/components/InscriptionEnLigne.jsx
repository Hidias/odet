import { useState } from 'react'
import { X, Loader2, Plus, Trash2, CheckCircle } from 'lucide-react'
import { supabase } from '../../../core/supabase'

// Inscription directe en ligne à une session inter (0420), depuis le calendrier public : un particulier pour
// lui-même, ou une entreprise pour plusieurs salariés. La demande reste en attente jusqu'à la confirmation par
// l'organisme ; aucun paiement en ligne.

const vide = { first_name: '', last_name: '', email: '', job_title: '' }

export default function InscriptionEnLigne({ session, mention, onFermer }) {
  const [kind, setKind] = useState('entreprise')
  const [c, setC] = useState({ contact_first_name: '', contact_last_name: '', contact_email: '', contact_phone: '', contact_function: '', company_name: '', siret: '', address: '', postal_code: '', city: '', message: '' })
  const [participants, setParticipants] = useState([{ ...vide }])
  const [consent, setConsent] = useState(false)
  const [piege, setPiege] = useState('')
  const [busy, setBusy] = useState(false)
  const [erreur, setErreur] = useState('')
  const [fait, setFait] = useState(false)
  const [enAttente, setEnAttente] = useState(false)
  const max = session.places != null ? Math.max(1, Math.min(20, session.places)) : 20

  const champ = (k, label, props = {}) => (
    <div>
      <label className="block text-sm text-gray-700 mb-0.5" htmlFor={`ins-${k}`}>{label}</label>
      <input id={`ins-${k}`} className="input" value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} {...props} />
    </div>
  )

  const envoyer = async (e) => {
    e.preventDefault()
    setErreur('')
    if (piege) { setFait(true); return } // robot : rien n'est envoyé
    const parts = kind === 'particulier'
      ? [{ first_name: c.contact_first_name, last_name: c.contact_last_name, email: c.contact_email }]
      : participants.filter((p) => p.first_name.trim() || p.last_name.trim())
    if (kind === 'entreprise' && parts.length === 0) return setErreur('Indiquez au moins un participant')
    if (!consent) return setErreur('Merci de cocher l\'accord sur l\'usage de vos données')
    setBusy(true)
    const { data: rep, error } = await supabase.rpc('public_inscrire', {
      p_session: session.id,
      p_inscription: { ...c, kind, consent, participants: parts, siret: c.siret.replace(/\s/g, '') },
    })
    setBusy(false)
    if (error) return setErreur(error.message || 'Inscription impossible pour le moment')
    setEnAttente(!!rep?.liste_attente)
    setFait(true)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Inscription en ligne">
      <div className="bg-white w-full sm:max-w-lg rounded-t-ui-lg sm:rounded-ui-lg max-h-[92vh] overflow-y-auto p-4 space-y-3">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <h2 className="font-display font-semibold text-gray-900">Inscription</h2>
            <p className="text-sm text-gray-500">{session.title}</p>
          </div>
          <button type="button" onClick={onFermer} className="p-1 text-gray-400 hover:text-gray-600" aria-label="Fermer"><X className="w-5 h-5" /></button>
        </div>
        {fait ? (
          <div className="text-center py-6 space-y-2">
            <CheckCircle className="w-12 h-12 mx-auto text-[rgb(var(--c-success))]" aria-hidden="true" />
            <p className="font-medium text-gray-900">{enAttente ? 'Vous êtes sur la liste d\'attente' : 'Demande d\'inscription enregistrée'}</p>
            {enAttente && <p className="text-sm text-gray-600">La session est complète : dès qu'une place se libère, elle vous est proposée et l'organisme vous recontacte.</p>}
            <p className="text-sm text-gray-600">L'organisme vous recontacte pour confirmer l'inscription et vous transmettre {kind === 'particulier' ? 'le contrat de formation' : 'la convention'} à signer en ligne. Aucun paiement n'est demandé à ce stade.</p>
            <button type="button" className="btn btn-primary" onClick={onFermer}>Fermer</button>
          </div>
        ) : (
          <form onSubmit={envoyer} className="space-y-3">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Type d'inscription">
              {[['entreprise', 'Pour mon entreprise'], ['particulier', 'Pour moi (particulier)']].map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                  className={`rounded-ui border px-3 py-2 text-sm font-medium ${kind === k ? 'bg-accent-500 text-accent-fg border-accent-500' : 'bg-white text-gray-700 border-gray-200'}`}>{l}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {champ('contact_first_name', 'Prénom *', { required: true, autoComplete: 'given-name' })}
              {champ('contact_last_name', 'Nom *', { required: true, autoComplete: 'family-name' })}
              {champ('contact_email', 'Email *', { required: true, type: 'email', autoComplete: 'email' })}
              {champ('contact_phone', 'Téléphone', { type: 'tel', autoComplete: 'tel' })}
            </div>
            {kind === 'entreprise' && (
              <>
                {champ('contact_function', 'Votre fonction')}
                <div className="grid grid-cols-2 gap-2">
                  {champ('company_name', 'Entreprise *', { required: true, autoComplete: 'organization' })}
                  {champ('siret', 'SIRET', { inputMode: 'numeric', placeholder: '14 chiffres' })}
                </div>
              </>
            )}
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-3">{champ('address', 'Adresse', { autoComplete: 'street-address' })}</div>
              {champ('postal_code', 'Code postal', { autoComplete: 'postal-code', inputMode: 'numeric' })}
              <div className="col-span-2">{champ('city', 'Ville', { autoComplete: 'address-level2' })}</div>
            </div>
            {kind === 'entreprise' && (
              <div className="space-y-2">
                <div className="text-sm font-medium text-gray-800">Participants ({participants.length} / {max})</div>
                {participants.map((p, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                    <div><label className="block text-xs text-gray-600" htmlFor={`p-${i}-fn`}>Prénom</label><input id={`p-${i}-fn`} className="input" value={p.first_name} onChange={(e) => setParticipants(participants.map((x, j) => (j === i ? { ...x, first_name: e.target.value } : x)))} /></div>
                    <div><label className="block text-xs text-gray-600" htmlFor={`p-${i}-ln`}>Nom</label><input id={`p-${i}-ln`} className="input" value={p.last_name} onChange={(e) => setParticipants(participants.map((x, j) => (j === i ? { ...x, last_name: e.target.value } : x)))} /></div>
                    <button type="button" className="p-2 text-gray-400 hover:text-[rgb(var(--c-danger))] disabled:opacity-30" disabled={participants.length === 1} aria-label={`Retirer le participant ${i + 1}`} onClick={() => setParticipants(participants.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
                {participants.length < max && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParticipants([...participants, { ...vide }])}><Plus className="w-4 h-4" />Ajouter un participant</button>}
              </div>
            )}
            <div>
              <label className="block text-sm text-gray-700 mb-0.5" htmlFor="ins-message">Message (facultatif)</label>
              <textarea id="ins-message" className="input" rows={2} maxLength={2000} value={c.message} onChange={(e) => setC({ ...c, message: e.target.value })} placeholder="Besoin d'adaptation, financement, question…" />
            </div>
            {/* Champ piège invisible : rempli seulement par les robots */}
            <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={piege} onChange={(e) => setPiege(e.target.value)} name="site_web" />
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>J'accepte que ces informations servent à traiter mon inscription et à organiser la formation. Elles ne sont pas transmises à des tiers.</span>
            </label>
            {mention && <p className="text-xs text-gray-500">{mention}</p>}
            {erreur && <p className="text-sm text-[rgb(var(--c-danger))]" role="alert">{erreur}</p>}
            <button type="submit" className="btn btn-primary w-full" disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Envoyer ma demande d'inscription</button>
          </form>
        )}
      </div>
    </div>
  )
}
