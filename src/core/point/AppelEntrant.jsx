// Fenêtre « Appel entrant » (B110, simplifiée en un seul écran en B111) : « Qui appelle ? », motif, pour qui, Enregistrer.
// La fiche trouvée est reliée ; sinon la fiche prospect est créée à l'enregistrement (ou, sans ce droit, l'action seule).
// Le reste (suite, contact, numéro, date, urgent) est replié sous « Plus d'options ».
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Search } from 'lucide-react'
import { useAuthStore } from '../store'
import { Sheet } from '../../ui/Sheet'
import { Banner } from '../../ui/Banner'
import { StatusBadge } from '../../ui/StatusBadge'
import { chargerEquipe, nomProfil } from './actions'
import { iso } from './pointSemaine'
import {
  chercherFiches, creerFicheProspect, creerActionAppel, statutFiche, estTelephone, responsableParDefaut, etatEnregistrement,
  SUITES, LIMITE,
} from './appelEntrant'

const MESSAGES = {
  choisir: 'Choisissez la fiche qui appelle, ou indiquez que c\'est un nouveau prospect.',
  preciser: `Plus de ${LIMITE} fiches correspondent : précisez le nom ou le numéro.`,
  nommer: 'Indiquez le nom de l\'entreprise ou de la personne pour créer sa fiche.',
}

export default function AppelEntrant({ onClose, peutCreerFiche = false }) {
  const moi = useAuthStore((s) => s.profile)
  const ctxSocietes = useAuthStore((s) => s.societes)
  const [texte, setTexte] = useState('')
  const [resultats, setResultats] = useState([])
  const [erreurLecture, setErreurLecture] = useState(false)
  // Texte dont les résultats sont affichés : tant qu'il diffère de la saisie, la recherche est en cours (rien ne dit
  // « nouveau prospect » avant la réponse, sinon un clic rapide crée un doublon)
  const [cherche, setCherche] = useState('')
  const [fiche, setFiche] = useState(null)
  const [ficheCreee, setFicheCreee] = useState(false)
  const [nouveauConfirme, setNouveauConfirme] = useState(false)
  const [nom, setNom] = useState('') // nom du nouveau prospect quand on a tapé un numéro
  const [motif, setMotif] = useState('')
  const [ownerId, setOwnerId] = useState(null) // null : pas encore choisi, défaut appliqué
  const [plus, setPlus] = useState({ suite: 'rappeler', contact: '', telephone: '', due_on: iso(new Date()), urgent: false })
  const [equipe, setEquipe] = useState([])
  const [busy, setBusy] = useState(false)
  const demande = useRef(0)

  useEffect(() => { chargerEquipe().then(setEquipe) }, [])
  const owner = ownerId ?? responsableParDefaut(moi?.id, peutCreerFiche)

  // Recherche au fil de la frappe (la réponse d'une frappe ancienne ne remplace pas une plus récente)
  useEffect(() => {
    if (fiche) return undefined
    const n = ++demande.current
    const t = setTimeout(async () => {
      const r = await chercherFiches(texte)
      if (n !== demande.current) return
      setErreurLecture(r === null)
      setResultats(r || [])
      setCherche(texte)
    }, 250)
    return () => clearTimeout(t)
  }, [texte, fiche])

  const saisir = (v) => { setTexte(v); setNouveauConfirme(false) }
  const choisir = (c) => {
    setFiche(c)
    // Numéro tapé dans la recherche : c'est celui qui appelle ; sinon celui de la fiche
    setPlus((p) => ({ ...p, contact: c.contact_name || '', telephone: estTelephone(texte) ? texte.trim() : c.contact_phone || c.mobile || '' }))
  }
  const changer = () => { setFiche(null); setFicheCreee(false); setCherche(''); setPlus((p) => ({ ...p, contact: '', telephone: '' })) }

  const aJour = cherche === texte
  const etat = erreurLecture && !fiche ? 'attendre'
    : etatEnregistrement({ fiche, texte, nom, aJour, nbResultats: resultats.length, nouveauConfirme, peutCreerFiche })
  const pret = ['fiche', 'creer', 'sans_fiche'].includes(etat) && !busy

  const valider = async (e) => {
    e.preventDefault()
    if (!pret) return
    setBusy(true)
    let f = fiche
    const tel = plus.telephone.trim() || (estTelephone(texte) ? texte.trim() : '')
    const nomSaisi = estTelephone(texte) ? nom.trim() : texte.trim()
    try {
      if (etat === 'creer') {
        f = await creerFicheProspect({ nom: nomSaisi, telephone: tel, contact: plus.contact })
        // Si l'action échoue ensuite, la fiche reste choisie : un nouvel essai ne recrée pas de doublon
        setFiche(f)
        setFicheCreee(true)
      }
      await creerActionAppel({
        fiche: f, nomLibre: nomSaisi || tel, suite: plus.suite, motif, contact: plus.contact, telephone: tel,
        owner_id: owner || null, due_on: plus.due_on || null, urgent: plus.urgent, ctxSocietes,
      })
      try { window.dispatchEvent(new Event('odet:actions-maj')) } catch { /* page Actions fermée : rien à rafraîchir */ }
      toast.success(etat === 'creer' ? 'Fiche prospect et action créées' : etat === 'sans_fiche' ? 'Action créée' : 'Action créée et reliée à la fiche')
      onClose?.()
    } catch (err) {
      const msg = err?.code === '42501' ? 'Enregistrement refusé : vos accès ne le permettent pas.' : err?.message || 'Enregistrement impossible.'
      // La fiche a pu être créée avant le refus de l'action : le dire, pour ne pas laisser un prospect sans suite
      toast.error(ficheCreee || (etat === 'creer' && f) ? `${msg} La fiche prospect, elle, est créée.` : msg)
    } finally { setBusy(false) }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
      <button type="submit" form="appel-entrant" className="btn btn-primary" disabled={!pret}>Enregistrer</button>
    </>
  )

  return (
    <Sheet title="Appel entrant" onClose={onClose} footer={footer}>
      <form id="appel-entrant" onSubmit={valider} className="grid gap-3">
        <div>
          <label className="label" htmlFor="ae-recherche">Qui appelle ?</label>
          {fiche ? (
            <div className="flex items-center gap-2 rounded-ui-sm border border-gray-200 px-3 py-2">
              <span className="flex-1 min-w-0 font-medium text-gray-900 truncate">
                <Link to={`/clients/${fiche.id}`} onClick={onClose} className="hover:underline">{fiche.name}</Link>
              </span>
              <StatusBadge tone={fiche.type === 'client' ? 'success' : 'warning'}>{statutFiche(fiche)}</StatusBadge>
              <button type="button" className="btn btn-ghost btn-sm" onClick={changer}>Changer</button>
            </div>
          ) : (
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
              <input id="ae-recherche" className="input pl-9" autoFocus value={texte} onChange={(e) => saisir(e.target.value)}
                placeholder="Nom de l'entreprise, téléphone ou SIRET" autoComplete="off" />
            </div>
          )}
        </div>

        {!fiche && erreurLecture && <Banner tone="warning">La recherche n'a pas abouti. Réessayez dans un instant.</Banner>}
        {!fiche && texte.trim().length >= 2 && !erreurLecture && !aJour && (
          <p className="text-ui text-gray-600" role="status">Recherche en cours…</p>
        )}
        {!fiche && texte.trim().length >= 2 && !erreurLecture && aJour && (
          <>
            <p className="sr-only" role="status">{resultats.length ? `${Math.min(resultats.length, LIMITE)} fiche(s) trouvée(s)` : 'Aucune fiche trouvée'}</p>
            {resultats.length > 0 && !nouveauConfirme && (
              <ul className="grid gap-1" aria-label="Fiches trouvées">
                {resultats.slice(0, LIMITE).map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => choisir(c)}
                      className="w-full text-left rounded-ui-sm border border-gray-200 hover:bg-gray-50 px-3 py-2 flex items-center gap-2">
                      <span className="flex-1 min-w-0">
                        <span className="block font-medium text-gray-900 truncate">{c.name}</span>
                        <span className="block text-ui-sm text-gray-600 truncate">{[c.city, c.contact_name, c.contact_phone || c.mobile].filter(Boolean).join(' · ')}</span>
                      </span>
                      {['archive', 'inactif'].includes(c.status) && <StatusBadge tone="neutral">{c.status === 'archive' ? 'Archivée' : 'Inactive'}</StatusBadge>}
                      <StatusBadge tone={c.type === 'client' ? 'success' : 'warning'}>{statutFiche(c)}</StatusBadge>
                    </button>
                  </li>
                ))}
                {resultats.length <= LIMITE && (
                  <li>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNouveauConfirme(true)}>Aucune de ces fiches : nouveau prospect</button>
                  </li>
                )}
              </ul>
            )}
            {(resultats.length === 0 || nouveauConfirme) && (
              <p className="text-ui text-gray-600">
                {peutCreerFiche ? 'Nouveau prospect : sa fiche sera créée à l\'enregistrement.' : 'Aucune fiche : l\'action sera enregistrée avec le nom et le numéro, un collègue créera la fiche.'}
                {nouveauConfirme && <> <button type="button" className="underline" onClick={() => setNouveauConfirme(false)}>Revoir les fiches</button></>}
              </p>
            )}
            {(resultats.length === 0 || nouveauConfirme) && estTelephone(texte) && (
              <div>
                <label className="label" htmlFor="ae-nom">Entreprise ou personne</label>
                <input id="ae-nom" className="input" value={nom} maxLength={255} onChange={(e) => setNom(e.target.value)} />
              </div>
            )}
          </>
        )}

        <div>
          <label className="label" htmlFor="ae-motif">Motif de l'appel</label>
          <textarea id="ae-motif" className="input" rows={2} maxLength={1500} value={motif}
            placeholder="Ex. : demande de devis pour la vérification des extincteurs" onChange={(e) => setMotif(e.target.value)} />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-ui text-gray-700" htmlFor="ae-qui">Pour</label>
          <select id="ae-qui" className="select w-auto" value={owner} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">À attribuer</option>
            {equipe.map((p) => <option key={p.id} value={p.id}>{p.id === moi?.id ? `Moi (${nomProfil(p)})` : nomProfil(p)}</option>)}
          </select>
        </div>

        {MESSAGES[etat] && texte.trim().length >= 2 && <p className="text-ui-sm text-gray-600">{MESSAGES[etat]}</p>}

        <details className="rounded-ui-sm border border-gray-200 px-3 py-2">
          <summary className="cursor-pointer text-ui text-gray-700">Plus d'options</summary>
          <div className="grid gap-3 pt-3">
            <div role="radiogroup" aria-label="Suite à donner" className="flex flex-wrap gap-2">
              {Object.entries(SUITES).map(([k, libelle]) => (
                <button key={k} type="button" role="radio" aria-checked={plus.suite === k} onClick={() => setPlus({ ...plus, suite: k })}
                  className={`btn btn-sm ${plus.suite === k ? 'bg-gray-900 text-white border-gray-900' : 'btn-secondary'}`}>{libelle}</button>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="ae-contact">Qui a appelé</label>
                <input id="ae-contact" className="input" value={plus.contact} maxLength={255} onChange={(e) => setPlus({ ...plus, contact: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="ae-tel">Numéro à rappeler</label>
                <input id="ae-tel" className="input" type="tel" value={plus.telephone} maxLength={20}
                  placeholder={estTelephone(texte) ? texte.trim() : ''} onChange={(e) => setPlus({ ...plus, telephone: e.target.value })} />
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label" htmlFor="ae-date">Pour le</label>
                <input id="ae-date" type="date" className="input" value={plus.due_on} onChange={(e) => setPlus({ ...plus, due_on: e.target.value })} />
              </div>
              <label className="inline-flex items-center gap-2 text-ui pb-2">
                <input type="checkbox" checked={plus.urgent} onChange={(e) => setPlus({ ...plus, urgent: e.target.checked })} />Urgent
              </label>
            </div>
          </div>
        </details>
      </form>
    </Sheet>
  )
}
