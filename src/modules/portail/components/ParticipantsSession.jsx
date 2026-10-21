import { useEffect, useState } from 'react'
import { Users, UserPlus, Trash2, Loader2, X, Lock, CheckCircle2 } from 'lucide-react'

// Participants d'une session saisis par le client depuis son espace (0430, décisions de H du 21/10) : seulement une
// fois le devis signé et la session confirmée par l'organisme, dans la limite des places, jusqu'à la signature de la
// convention. Nom, prénom, e-mail facultatif (pour que le stagiaire reçoive sa convocation). Mêmes données que la
// session : l'organisme les voit tout de suite et peut aussi les saisir.

const ligneVide = () => ({ first_name: '', last_name: '', email: '' })
const mailOk = (m) => !m || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.trim())

/** etat : { ouvert, raison, places, participants, devis_signe, validation_requise } (client_portal_participants / ent_participants) */
export default function ParticipantsSession({ etat, onEnregistrer }) {
  const [ouvert, setOuvert] = useState(false)
  if (!etat || !etat.devis) return null
  const liste = etat.participants || []
  return (
    <div className="mt-4 rounded-ui border border-gray-200 bg-gray-50/60 p-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Users className="w-5 h-5 text-primary-600 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-[12rem]">
          <p className="text-sm font-medium text-gray-900">Vos participants {etat.places ? <span className="text-gray-500 font-normal">({liste.length} sur {etat.places} places)</span> : null}</p>
          {!etat.ouvert && etat.raison && <p className="text-xs text-gray-500 flex items-start gap-1 mt-0.5"><Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />{etat.raison}</p>}
          {etat.ouvert && liste.length === 0 && <p className="text-xs text-accent-700 mt-0.5">À saisir avant de signer la convention.</p>}
        </div>
        {etat.ouvert && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setOuvert(true)}>
            <UserPlus className="w-4 h-4" aria-hidden="true" />{liste.length ? 'Modifier' : 'Saisir les participants'}
          </button>
        )}
      </div>
      {liste.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Participants saisis">
          {liste.map((p) => <li key={p.trainee_id} className="text-xs px-2 py-1 rounded-full bg-white border border-gray-200 text-gray-700">{(p.last_name || '').toUpperCase()} {p.first_name}</li>)}
        </ul>
      )}
      {ouvert && <FenetreParticipants etat={etat} onEnregistrer={onEnregistrer} onFermer={() => setOuvert(false)} />}
    </div>
  )
}

function FenetreParticipants({ etat, onEnregistrer, onFermer }) {
  const places = etat.places || 10
  const [lignes, setLignes] = useState(() => {
    const l = (etat.participants || []).map((p) => ({ first_name: p.first_name || '', last_name: p.last_name || '', email: p.email || '' }))
    return l.length ? l : [ligneVide()]
  })
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')
  const [fait, setFait] = useState(false)

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onFermer() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onFermer])

  const maj = (i, champ, v) => setLignes((ls) => ls.map((l, k) => (k === i ? { ...l, [champ]: v } : l)))
  const remplies = lignes.filter((l) => l.first_name.trim() || l.last_name.trim() || l.email.trim())
  const incompletes = remplies.some((l) => !l.first_name.trim() || !l.last_name.trim())
  const mailsFaux = remplies.some((l) => !mailOk(l.email))

  const enregistrer = async () => {
    setEnvoi(true); setErreur('')
    try {
      await onEnregistrer(remplies.map((l) => ({ first_name: l.first_name.trim(), last_name: l.last_name.trim(), email: l.email.trim() || null })))
      setFait(true)
      setTimeout(onFermer, 900)
    } catch (e) {
      setErreur(e.message || 'Enregistrement impossible, réessayez.')
    } finally { setEnvoi(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onFermer}>
      <div role="dialog" aria-modal="true" aria-labelledby="participants-titre" className="vitrine-monte w-full sm:max-w-2xl bg-white rounded-t-ui-lg sm:rounded-ui-lg max-h-[92vh] overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="participants-titre" className="font-display text-lg font-semibold text-gray-900">Vos participants</h2>
            <p className="text-sm text-gray-500">{places} place{places > 1 ? 's' : ''} au plus. L'e-mail permet d'envoyer sa convocation au participant.</p>
          </div>
          <button type="button" onClick={onFermer} aria-label="Fermer" className="p-1 text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {lignes.map((l, i) => (
            <fieldset key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1.3fr_auto] gap-2 items-end border-b border-gray-100 pb-3 sm:border-0 sm:pb-0">
              <legend className="sr-only">Participant {i + 1}</legend>
              <label className="block text-sm"><span className="text-gray-600 sm:sr-only">Prénom</span>
                <input className="input w-full mt-1 sm:mt-0" placeholder="Prénom" value={l.first_name} onChange={(e) => maj(i, 'first_name', e.target.value)} autoComplete="off" /></label>
              <label className="block text-sm"><span className="text-gray-600 sm:sr-only">Nom</span>
                <input className="input w-full mt-1 sm:mt-0" placeholder="Nom" value={l.last_name} onChange={(e) => maj(i, 'last_name', e.target.value)} autoComplete="off" /></label>
              <label className="block text-sm"><span className="text-gray-600 sm:sr-only">E-mail (facultatif)</span>
                <input type="email" inputMode="email" className={`input w-full mt-1 sm:mt-0 ${!mailOk(l.email) ? 'border-[rgb(var(--c-danger))]' : ''}`} placeholder="E-mail (facultatif)" value={l.email} onChange={(e) => maj(i, 'email', e.target.value)} autoComplete="off" /></label>
              <button type="button" onClick={() => setLignes((ls) => (ls.length > 1 ? ls.filter((_, k) => k !== i) : [ligneVide()]))} aria-label={`Retirer le participant ${i + 1}`} className="p-2 text-gray-400 hover:text-[rgb(var(--c-danger))] justify-self-end"><Trash2 className="w-4 h-4" /></button>
            </fieldset>
          ))}
          {lignes.length < places && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLignes((ls) => [...ls, ligneVide()])}><UserPlus className="w-4 h-4" aria-hidden="true" />Ajouter un participant</button>
          )}
          {incompletes && <p className="text-sm text-[rgb(var(--c-warning))]">Indiquez le nom et le prénom de chaque participant.</p>}
          {mailsFaux && <p className="text-sm text-[rgb(var(--c-warning))]">Une adresse e-mail n'est pas valide.</p>}
          {erreur && <p role="alert" className="text-sm text-[rgb(var(--c-danger))]">{erreur}</p>}
          <p className="text-xs text-gray-500">Vous pouvez modifier cette liste jusqu'à la signature de la convention. Ensuite, un changement passe par votre organisme.</p>
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-secondary" onClick={onFermer}>Annuler</button>
            <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={envoi || fait || incompletes || mailsFaux}>
              {envoi ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : fait ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : null}
              {fait ? 'Enregistré' : `Enregistrer ${remplies.length} participant${remplies.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
