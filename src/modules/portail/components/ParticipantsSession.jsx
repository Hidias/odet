import { useEffect, useState } from 'react'
import { Users, UserPlus, Trash2, Loader2, X, Lock, CheckCircle2 } from 'lucide-react'
import { normaliserNir } from '../../passeport/lib/rules'

// Participants d'une session saisis par le client depuis son espace (0430, décisions de H du 21/10) : seulement une
// fois le devis signé et la session confirmée par l'organisme, dans la limite des places, jusqu'à la signature de la
// convention. Nom et prénom obligatoires ; le reste (nom de naissance, e-mail, n° de sécurité sociale, date et lieu de
// naissance, poste) au mieux, sans bloquer : le stagiaire complète lui-même (0435, décision de H du 22/10). Mêmes
// données que la session : l'organisme les voit tout de suite et peut aussi les saisir.

const ligneVide = () => ({ first_name: '', last_name: '', naissance_identique: true, nom_naissance: '', email: '', ssn: '', birth_date: '', birth_place: '', job_title: '', ssn_present: false })
const mailOk = (m) => !m || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.trim())
const lisible = (t) => /\p{L}/u.test(t || '')
const nirOk = (v) => !v.trim() || normaliserNir(v).ok
const dateOk = (d) => {
  if (!d) return true
  const t = new Date(`${d}T12:00:00`)
  const max = new Date(); max.setFullYear(max.getFullYear() - 14)
  return !Number.isNaN(t.getTime()) && t >= new Date('1930-01-01T00:00:00') && t <= max
}
const remplie = (l) => [l.first_name, l.last_name, l.email, l.ssn, l.birth_date, l.birth_place, l.job_title, l.naissance_identique ? '' : l.nom_naissance].some((v) => String(v || '').trim())
export const erreursLigne = (l) => {
  const e = []
  if (!l.first_name.trim() || !l.last_name.trim()) e.push('nom et prénom requis')
  else if (!lisible(l.first_name) || !lisible(l.last_name)) e.push('nom ou prénom illisible')
  if (!l.naissance_identique && !lisible(l.nom_naissance)) e.push('nom de naissance à indiquer')
  if (!mailOk(l.email)) e.push('e-mail invalide')
  if (!nirOk(l.ssn)) e.push(`n° de sécurité sociale : ${normaliserNir(l.ssn).error}`)
  if (!dateOk(l.birth_date)) e.push('date de naissance invraisemblable')
  return e
}

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
    const l = (etat.participants || []).map((p) => {
      const usage = (p.last_name || '').toUpperCase()
      const naissance = (p.nom_naissance || '').toUpperCase()
      return {
        ...ligneVide(), first_name: p.first_name || '', last_name: p.last_name || '', email: p.email || '',
        naissance_identique: !naissance || naissance === usage, nom_naissance: naissance && naissance !== usage ? p.nom_naissance : '',
        birth_date: p.birth_date || '', birth_place: p.birth_place || '', job_title: p.job_title || '', ssn_present: !!p.ssn_present,
      }
    })
    return l.length ? l : [ligneVide()]
  })
  const [recap, setRecap] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')
  const [fait, setFait] = useState(false)

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onFermer() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onFermer])

  const maj = (i, champ, v) => setLignes((ls) => ls.map((l, k) => (k === i ? { ...l, [champ]: v } : l)))
  const remplies = lignes.filter(remplie)
  const problemes = remplies.map((l, i) => ({ i, e: erreursLigne(l) })).filter((x) => x.e.length)

  const enregistrer = async () => {
    setEnvoi(true); setErreur('')
    try {
      await onEnregistrer(remplies.map((l) => ({
        first_name: l.first_name.trim(), last_name: l.last_name.trim(),
        nom_naissance: l.naissance_identique ? null : l.nom_naissance.trim(),
        email: l.email.trim() || null, ssn: l.ssn.trim() || null, birth_date: l.birth_date || null,
        birth_place: l.birth_place.trim() || null, job_title: l.job_title.trim() || null,
      })))
      setFait(true)
      setTimeout(onFermer, 900)
    } catch (e) {
      setErreur(e.message || 'Enregistrement impossible, réessayez.')
      setRecap(false)
    } finally { setEnvoi(false) }
  }

  const champ = (i, l, nom, libelle, props = {}) => (
    <label className="block text-sm"><span className="text-gray-600">{libelle}</span>
      <input className="input w-full mt-1" value={l[nom]} onChange={(e) => maj(i, nom, e.target.value)} autoComplete="off" {...props} /></label>
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onFermer}>
      <div role="dialog" aria-modal="true" aria-labelledby="participants-titre" className="vitrine-monte w-full sm:max-w-2xl bg-white rounded-t-ui-lg sm:rounded-ui-lg max-h-[92vh] overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="participants-titre" className="font-display text-lg font-semibold text-gray-900">{recap ? 'Vérifiez avant d\'enregistrer' : 'Vos participants'}</h2>
            <p className="text-sm text-gray-500">{places} place{places > 1 ? 's' : ''} au plus. Seuls le nom et le prénom sont obligatoires.</p>
          </div>
          <button type="button" onClick={onFermer} aria-label="Fermer" className="p-1 text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        {!recap ? (
          <div className="px-5 py-4 space-y-4">
            <p className="text-sm text-gray-600 rounded-ui bg-gray-50 border border-gray-200 px-3 py-2">
              Indiquez tout ce que vous avez sous la main, sans vous bloquer : chaque participant pourra compléter lui-même les informations manquantes dans son espace stagiaire.
              Le n° de sécurité sociale sert à la déclaration au Passeport de prévention ; il est conservé chiffré et n'est plus affiché ensuite.
            </p>
            {lignes.map((l, i) => {
              const e = remplie(l) ? erreursLigne(l) : []
              return (
                <fieldset key={i} className="rounded-ui border border-gray-200 p-3 space-y-3">
                  <legend className="sr-only">Participant {i + 1}</legend>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-gray-800" aria-hidden="true">Participant {i + 1}</p>
                    <button type="button" onClick={() => setLignes((ls) => (ls.length > 1 ? ls.filter((_, k) => k !== i) : [ligneVide()]))} aria-label={`Retirer le participant ${i + 1}`} className="p-1.5 text-gray-400 hover:text-[rgb(var(--c-danger))]"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {champ(i, l, 'first_name', 'Prénom *', { autoCapitalize: 'words' })}
                    {champ(i, l, 'last_name', "Nom d'usage *", { autoCapitalize: 'characters' })}
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" className="rounded" checked={l.naissance_identique} onChange={(ev) => maj(i, 'naissance_identique', ev.target.checked)} />
                      Nom de naissance identique au nom d'usage
                    </label>
                    {!l.naissance_identique && champ(i, l, 'nom_naissance', 'Nom de naissance', { autoCapitalize: 'characters' })}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {champ(i, l, 'email', 'E-mail (pour recevoir sa convocation)', { type: 'email', inputMode: 'email' })}
                    {champ(i, l, 'job_title', 'Poste occupé')}
                    {champ(i, l, 'birth_date', 'Date de naissance', { type: 'date' })}
                    {champ(i, l, 'birth_place', 'Lieu de naissance')}
                  </div>
                  {champ(i, l, 'ssn', 'N° de sécurité sociale', { inputMode: 'numeric', placeholder: l.ssn_present ? 'Déjà renseigné : laissez vide pour le garder' : '13 ou 15 caractères' })}
                  {e.length > 0 && <p className="text-sm text-[rgb(var(--c-warning))]">{e.join(' ; ')}</p>}
                </fieldset>
              )
            })}
            {lignes.length < places && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLignes((ls) => [...ls, ligneVide()])}><UserPlus className="w-4 h-4" aria-hidden="true" />Ajouter un participant</button>
            )}
            {erreur && <p role="alert" className="text-sm text-[rgb(var(--c-danger))]">{erreur}</p>}
            <p className="text-xs text-gray-500">Vous pouvez modifier cette liste jusqu'à la signature de la convention. Ensuite, un changement passe par votre organisme.</p>
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn btn-secondary" onClick={onFermer}>Annuler</button>
              <button type="button" className="btn btn-primary" onClick={() => setRecap(true)} disabled={problemes.length > 0}>
                Vérifier {remplies.length} participant{remplies.length > 1 ? 's' : ''}
              </button>
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-3">
            {remplies.length === 0 && <p className="text-sm text-gray-600">Aucun participant : la liste sera vidée.</p>}
            <ul className="divide-y divide-gray-100 rounded-ui border border-gray-200">
              {remplies.map((l, i) => {
                const infos = [
                  !l.naissance_identique && l.nom_naissance.trim() ? `nom de naissance ${l.nom_naissance.trim().toUpperCase()}` : null,
                  l.birth_date ? `né(e) le ${new Date(`${l.birth_date}T12:00:00`).toLocaleDateString('fr-FR')}${l.birth_place.trim() ? ` à ${l.birth_place.trim()}` : ''}` : (l.birth_place.trim() ? `né(e) à ${l.birth_place.trim()}` : null),
                  l.job_title.trim() || null, l.email.trim() || null,
                  l.ssn.trim() ? 'n° de sécurité sociale indiqué' : (l.ssn_present ? 'n° de sécurité sociale déjà connu' : null),
                ].filter(Boolean)
                return (
                  <li key={i} className="px-3 py-2">
                    <p className="text-sm font-medium text-gray-900">{l.last_name.trim().toUpperCase()} {l.first_name.trim()}</p>
                    <p className="text-xs text-gray-500">{infos.length ? infos.join(' · ') : 'Le participant complétera ses informations lui-même.'}</p>
                  </li>
                )
              })}
            </ul>
            {erreur && <p role="alert" className="text-sm text-[rgb(var(--c-danger))]">{erreur}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn btn-secondary" onClick={() => setRecap(false)} disabled={envoi}>Corriger</button>
              <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={envoi || fait}>
                {envoi ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : fait ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : null}
                {fait ? 'Enregistré' : 'Confirmer et enregistrer'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
