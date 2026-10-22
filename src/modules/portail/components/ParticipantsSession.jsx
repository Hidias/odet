import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Users, UserPlus, Trash2, Loader2, X, Lock, CheckCircle2, Search, Clock, Ban } from 'lucide-react'
import { normaliserNir } from '../../passeport/lib/rules'

// Participants d'une session saisis par le client depuis son espace (0430, décisions de H du 21/10) : seulement une
// fois le devis signé et la session confirmée par l'organisme, jusqu'à la signature de la convention. Nom et prénom
// obligatoires ; le reste au mieux, sans bloquer : le stagiaire complète lui-même (0435). Retours du 22/10 (0437) :
// genre et nom de naissance toujours visibles, recherche parmi les salariés déjà connus, places en dépassement
// soumises à l'accord de l'organisme. Tout part dans la fiche du stagiaire.

export const GENRES = [
  { v: 'female', l: 'Femme' },
  { v: 'male', l: 'Homme' },
  { v: 'non_binary', l: 'Non genré' },
]

const ligneVide = () => ({ first_name: '', last_name: '', gender: '', nom_naissance: '', naissance_modifiee: false, email: '', ssn: '', birth_date: '', birth_place: '', job_title: '', ssn_present: false, statut: null })
const mailOk = (m) => !m || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.trim())
const lisible = (t) => /\p{L}/u.test(t || '')
const nirOk = (v) => !v.trim() || normaliserNir(v).ok
const normal = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
// Date de naissance saisie en JJ/MM/AAAA (22/10 : le champ date de Safari affichait la date du jour en gris, prise
// pour une valeur saisie) ; envoyée au format AAAA-MM-JJ
export const versIso = (d) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(d || '').trim())
  if (!m) return null
  const iso = `${m[3]}-${m[2]}-${m[1]}`
  const t = new Date(`${iso}T12:00:00`)
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : null
}
const depuisIso = (iso) => { const [y, m, j] = String(iso || '').slice(0, 10).split('-'); return y && m && j ? `${j}/${m}/${y}` : '' }
const masqueDate = (v) => {
  const c = String(v || '').replace(/\D/g, '').slice(0, 8)
  return [c.slice(0, 2), c.slice(2, 4), c.slice(4, 8)].filter(Boolean).join('/')
}
const dateOk = (d) => {
  if (!String(d || '').trim()) return true
  const iso = versIso(d)
  if (!iso) return false
  const t = new Date(`${iso}T12:00:00`)
  const max = new Date(); max.setFullYear(max.getFullYear() - 14)
  return t >= new Date('1930-01-01T00:00:00') && t <= max
}
const remplie = (l) => [l.first_name, l.last_name, l.email, l.ssn, l.birth_date, l.birth_place, l.job_title, l.gender].some((v) => String(v || '').trim())
export const erreursLigne = (l) => {
  const e = []
  if (!l.first_name.trim() || !l.last_name.trim()) e.push('nom et prénom requis')
  else if (!lisible(l.first_name) || !lisible(l.last_name)) e.push('nom ou prénom illisible')
  if (String(l.nom_naissance || '').trim() && !lisible(l.nom_naissance)) e.push('nom de naissance illisible')
  if (!mailOk(l.email)) e.push('e-mail invalide')
  if (!nirOk(l.ssn)) e.push(`n° de sécurité sociale : ${normaliserNir(l.ssn).error}`)
  if (!dateOk(l.birth_date)) e.push(versIso(l.birth_date) || !String(l.birth_date).trim() ? 'date de naissance invraisemblable' : 'date de naissance au format JJ/MM/AAAA')
  return e
}

/** Ligne de saisie à partir d'un participant ou d'un salarié connu */
export function ligneDepuis(p) {
  const usage = (p.last_name || '').toUpperCase()
  const naissance = (p.nom_naissance || '').toUpperCase()
  return {
    ...ligneVide(), first_name: p.first_name || '', last_name: p.last_name || '', gender: p.gender || '', email: p.email || '',
    nom_naissance: naissance || usage, naissance_modifiee: !!naissance && naissance !== usage,
    birth_date: depuisIso(p.birth_date), birth_place: p.birth_place || '', job_title: p.job_title || '', ssn_present: !!p.ssn_present,
    statut: p.statut && p.statut !== 'inscrit' ? p.statut : null,
  }
}

const STATUTS = {
  attente: { l: "en attente de l'accord de votre organisme", icone: Clock, c: 'text-accent-700 bg-accent-500/10 border-accent-500/30' },
  refuse: { l: 'refusé par votre organisme (places)', icone: Ban, c: 'text-[rgb(var(--c-danger))] bg-[rgb(var(--c-danger-bg))] border-[rgb(var(--c-danger)/0.3)]' },
}

/**
 * etat : { ouvert, raison, places, places_supplementaires, participants (statut inscrit, attente, refuse) }
 * chargerSalaries() → salariés déjà connus du client (recherche) ; onEnregistrer(liste)
 */
export default function ParticipantsSession({ etat, onEnregistrer, chargerSalaries = null }) {
  const [ouvert, setOuvert] = useState(false)
  if (!etat || !etat.devis) return null
  const liste = etat.participants || []
  const inscrits = liste.filter((p) => !p.statut || p.statut === 'inscrit')
  const enAttente = liste.filter((p) => p.statut === 'attente')
  return (
    <div className="mt-4 rounded-ui border border-gray-200 bg-gray-50/60 p-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Users className="w-5 h-5 text-primary-600 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-[12rem]">
          <p className="text-sm font-medium text-gray-900">Vos participants {etat.places ? <span className="text-gray-500 font-normal">({inscrits.length} sur {etat.places} places{etat.places_supplementaires ? `, ${etat.places_supplementaires} de plus sur accord` : ''})</span> : null}</p>
          {!etat.ouvert && etat.raison && <p className="text-xs text-gray-500 flex items-start gap-1 mt-0.5"><Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />{etat.raison}</p>}
          {etat.ouvert && liste.length === 0 && <p className="text-xs text-accent-700 mt-0.5">À saisir avant de signer la convention.</p>}
          {enAttente.length > 0 && <p className="text-xs text-accent-700 mt-0.5">{enAttente.length} participant{enAttente.length > 1 ? 's' : ''} en plus du maximum : en attente de l'accord de votre organisme.</p>}
        </div>
        {etat.ouvert && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setOuvert(true)}>
            <UserPlus className="w-4 h-4" aria-hidden="true" />{liste.length ? 'Modifier' : 'Saisir les participants'}
          </button>
        )}
      </div>
      {liste.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Participants saisis">
          {liste.map((p) => {
            const S = STATUTS[p.statut]
            return (
              <li key={p.trainee_id} className={`text-xs px-2 py-1 rounded-full border inline-flex items-center gap-1 ${S ? S.c : 'bg-white border-gray-200 text-gray-700'}`} title={S ? S.l : undefined}>
                {S && <S.icone className="w-3 h-3" aria-hidden="true" />}{(p.last_name || '').toUpperCase()} {p.first_name}{S ? <span className="sr-only"> ({S.l})</span> : null}
              </li>
            )
          })}
        </ul>
      )}
      {ouvert && <FenetreParticipants etat={etat} onEnregistrer={onEnregistrer} chargerSalaries={chargerSalaries} onFermer={() => setOuvert(false)} />}
    </div>
  )
}

function FenetreParticipants({ etat, onEnregistrer, chargerSalaries, onFermer }) {
  const places = etat.places || 10
  const plafond = places + (etat.places_supplementaires || 0)
  const [lignes, setLignes] = useState(() => {
    const l = (etat.participants || []).map(ligneDepuis)
    return l.length ? l : [ligneVide()]
  })
  const [salaries, setSalaries] = useState([])
  const [recherche, setRecherche] = useState('')
  const [recap, setRecap] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState('')
  const [fait, setFait] = useState(false)

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onFermer() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onFermer])

  useEffect(() => {
    if (!chargerSalaries) return
    chargerSalaries().then((d) => setSalaries(Array.isArray(d) ? d : [])).catch(() => setSalaries([]))
  }, [chargerSalaries])

  const maj = (i, champ, v) => setLignes((ls) => ls.map((l, k) => {
    if (k !== i) return l
    const n = { ...l, [champ]: v }
    // Le nom de naissance suit le nom d'usage tant qu'il n'a pas été changé à la main
    if (champ === 'last_name' && !l.naissance_modifiee) n.nom_naissance = String(v || '').toUpperCase()
    if (champ === 'nom_naissance') n.naissance_modifiee = normal(v) !== normal(l.last_name)
    return n
  }))
  const remplies = lignes.filter(remplie)
  const problemes = remplies.map((l, i) => ({ i, e: erreursLigne(l) })).filter((x) => x.e.length)

  // Salariés connus pas encore dans la liste, filtrés par la recherche (nom, prénom ou poste)
  const dejaLa = new Set(lignes.map((l) => `${normal(l.first_name)}|${normal(l.last_name)}`))
  const trouves = useMemo(() => {
    const q = normal(recherche)
    if (!q) return []
    return salaries.filter((s) => !dejaLa.has(`${normal(s.first_name)}|${normal(s.last_name)}`)
      && normal(`${s.first_name} ${s.last_name} ${s.last_name} ${s.first_name} ${s.job_title || ''}`).includes(q)).slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recherche, salaries, lignes])

  const ajouterSalarie = (s) => {
    setLignes((ls) => {
      const vide = ls.findIndex((l) => !remplie(l))
      if (vide >= 0) return ls.map((l, k) => (k === vide ? ligneDepuis(s) : l))
      return ls.length < plafond ? [...ls, ligneDepuis(s)] : ls
    })
    setRecherche('')
  }

  const enregistrer = async () => {
    setEnvoi(true); setErreur('')
    try {
      await onEnregistrer(remplies.map((l) => ({
        first_name: l.first_name.trim(), last_name: l.last_name.trim(),
        nom_naissance: (l.nom_naissance || '').trim() || l.last_name.trim(), gender: l.gender || null,
        email: l.email.trim() || null, ssn: l.ssn.trim() || null, birth_date: versIso(l.birth_date),
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
  const genreDe = (v) => GENRES.find((g) => g.v === v)?.l

  // Rendue au niveau de la page (22/10) : dans une carte animée, la fenêtre était coupée et ne défilait pas
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onFermer}>
      <div role="dialog" aria-modal="true" aria-labelledby="participants-titre" className="vitrine-monte w-full sm:max-w-2xl bg-white rounded-t-ui-lg sm:rounded-ui-lg max-h-[92vh] overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="participants-titre" className="font-display text-lg font-semibold text-gray-900">{recap ? 'Vérifiez avant d\'enregistrer' : 'Vos participants'}</h2>
            <p className="text-sm text-gray-500">
              {places} place{places > 1 ? 's' : ''}{plafond > places ? `, jusqu'à ${plafond} avec l'accord de votre organisme` : ' au plus'}. Seuls le nom et le prénom sont obligatoires.
            </p>
          </div>
          <button type="button" onClick={onFermer} aria-label="Fermer" className="p-1 text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        {!recap ? (
          <div className="px-5 py-4 space-y-4">
            <p className="text-sm text-gray-600 rounded-ui bg-gray-50 border border-gray-200 px-3 py-2">
              Indiquez tout ce que vous avez sous la main, sans vous bloquer : chaque participant pourra compléter lui-même les informations manquantes dans son espace stagiaire.
              Le n° de sécurité sociale sert à la déclaration au Passeport de prévention ; il est conservé chiffré et n'est plus affiché ensuite.
            </p>

            {salaries.length > 0 && lignes.length <= plafond && (
              <div className="relative">
                <label className="block text-sm font-medium text-gray-800" htmlFor="recherche-salarie">Retrouver un salarié déjà formé</label>
                <div className="relative mt-1">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                  <input id="recherche-salarie" className="input w-full pl-9" value={recherche} onChange={(e) => setRecherche(e.target.value)}
                    placeholder={`Nom, prénom ou poste (${salaries.length} salarié${salaries.length > 1 ? 's' : ''} connu${salaries.length > 1 ? 's' : ''})`} autoComplete="off" />
                </div>
                {recherche && (
                  <ul className="mt-1 rounded-ui border border-gray-200 bg-white divide-y divide-gray-100 shadow-sm" role="listbox" aria-label="Salariés trouvés">
                    {trouves.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">Aucun salarié trouvé : saisissez-le ci-dessous.</li>}
                    {trouves.map((s) => (
                      <li key={s.trainee_id}>
                        <button type="button" role="option" aria-selected="false" onClick={() => ajouterSalarie(s)} className="w-full text-left px-3 py-2 hover:bg-primary-50 flex items-center gap-2">
                          <UserPlus className="w-4 h-4 text-primary-600 shrink-0" aria-hidden="true" />
                          <span className="min-w-0"><span className="block text-sm text-gray-900">{(s.last_name || '').toUpperCase()} {s.first_name}</span>
                            <span className="block text-xs text-gray-500">{[s.job_title, s.derniere_formation ? `dernière formation le ${depuisIso(s.derniere_formation)}` : null].filter(Boolean).join(' · ') || 'Salarié connu'}</span></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {lignes.map((l, i) => {
              const e = remplie(l) ? erreursLigne(l) : []
              const S = STATUTS[l.statut]
              const auDela = remplie(l) && !l.statut && lignes.filter(remplie).indexOf(l) >= places
              return (
                <fieldset key={i} className="rounded-ui border border-gray-200 p-3 space-y-3">
                  <legend className="sr-only">Participant {i + 1}</legend>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-gray-800 flex items-center gap-2 flex-wrap" aria-hidden="true">Participant {i + 1}
                      {S && <span className={`text-xs px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${S.c}`}><S.icone className="w-3 h-3" />{S.l}</span>}
                      {auDela && <span className={`text-xs px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${STATUTS.attente.c}`}><Clock className="w-3 h-3" />au-delà de {places} : sur accord de votre organisme</span>}
                    </p>
                    <button type="button" onClick={() => setLignes((ls) => (ls.length > 1 ? ls.filter((_, k) => k !== i) : [ligneVide()]))} aria-label={`Retirer le participant ${i + 1}`} className="p-1.5 text-gray-400 hover:text-[rgb(var(--c-danger))]"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {champ(i, l, 'first_name', 'Prénom *', { autoCapitalize: 'words' })}
                    {champ(i, l, 'last_name', "Nom d'usage *", { autoCapitalize: 'characters' })}
                    {champ(i, l, 'nom_naissance', 'Nom de naissance', { autoCapitalize: 'characters', placeholder: 'Identique au nom d\'usage' })}
                    <div className="text-sm">
                      <span className="text-gray-600" id={`genre-${i}`}>Genre</span>
                      <div className="mt-1 grid grid-cols-3 gap-1" role="radiogroup" aria-labelledby={`genre-${i}`}>
                        {GENRES.map((g) => (
                          <button key={g.v} type="button" role="radio" aria-checked={l.gender === g.v} onClick={() => maj(i, 'gender', l.gender === g.v ? '' : g.v)}
                            className={`h-10 rounded-ui border text-sm ${l.gender === g.v ? 'border-primary-600 bg-primary-50 text-primary-800 font-medium' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}>
                            {g.l}
                          </button>
                        ))}
                      </div>
                    </div>
                    {champ(i, l, 'email', 'E-mail (pour recevoir sa convocation)', { type: 'email', inputMode: 'email' })}
                    {champ(i, l, 'job_title', 'Poste occupé')}
                    <label className="block text-sm"><span className="text-gray-600">Date de naissance</span>
                      <input className="input w-full mt-1" value={l.birth_date} onChange={(e) => maj(i, 'birth_date', masqueDate(e.target.value))} inputMode="numeric" placeholder="JJ/MM/AAAA" autoComplete="off" maxLength={10} /></label>
                    {champ(i, l, 'birth_place', 'Lieu de naissance')}
                  </div>
                  {champ(i, l, 'ssn', 'N° de sécurité sociale', { inputMode: 'numeric', placeholder: l.ssn_present ? 'Déjà renseigné : laissez vide pour le garder' : '13 ou 15 caractères' })}
                  {e.length > 0 && <p className="text-sm text-[rgb(var(--c-warning))]">{e.join(' ; ')}</p>}
                </fieldset>
              )
            })}
            {lignes.length < plafond && (
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
                const nn = (l.nom_naissance || '').trim()
                const infos = [
                  genreDe(l.gender) || null,
                  nn && normal(nn) !== normal(l.last_name) ? `nom de naissance ${nn.toUpperCase()}` : null,
                  l.birth_date ? `né(e) le ${l.birth_date}${l.birth_place.trim() ? ` à ${l.birth_place.trim()}` : ''}` : (l.birth_place.trim() ? `né(e) à ${l.birth_place.trim()}` : null),
                  l.job_title.trim() || null, l.email.trim() || null,
                  l.ssn.trim() ? 'n° de sécurité sociale indiqué' : (l.ssn_present ? 'n° de sécurité sociale déjà connu' : null),
                ].filter(Boolean)
                return (
                  <li key={i} className="px-3 py-2">
                    <p className="text-sm font-medium text-gray-900">{l.last_name.trim().toUpperCase()} {l.first_name.trim()}
                      {i >= places && !l.statut && <span className="ml-2 text-xs font-normal text-accent-700">sur accord de votre organisme</span>}</p>
                    <p className="text-xs text-gray-500">{infos.length ? infos.join(' · ') : 'Le participant complétera ses informations lui-même.'}</p>
                  </li>
                )
              })}
            </ul>
            {remplies.length > places && <p className="text-sm text-accent-700">Au-delà de {places} participants, votre organisme est prévenu et confirme les places en plus.</p>}
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
    </div>,
    document.body,
  )
}
