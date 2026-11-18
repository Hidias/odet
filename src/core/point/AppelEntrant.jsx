// Fenêtre « Appel entrant » (B110) : chercher la fiche, ou créer un prospect, puis créer l'action reliée.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Search, UserPlus } from 'lucide-react'
import { useAuthStore } from '../store'
import { Sheet } from '../../ui/Sheet'
import { Banner } from '../../ui/Banner'
import { StatusBadge } from '../../ui/StatusBadge'
import { chargerEquipe, nomProfil } from './actions'
import { iso } from './pointSemaine'
import { chercherFiches, creerFicheProspect, creerActionAppel, statutFiche, SUITES, LIMITE } from './appelEntrant'

export default function AppelEntrant({ onClose, peutCreerFiche = false }) {
  const moi = useAuthStore((s) => s.profile)
  const ctxSocietes = useAuthStore((s) => s.societes)
  const [texte, setTexte] = useState('')
  const [resultats, setResultats] = useState([])
  const [erreurLecture, setErreurLecture] = useState(false)
  // Texte dont les résultats sont affichés : tant qu'il diffère de la saisie, la recherche est en cours (rien ne dit
  // « nouveau prospect » avant la réponse, sinon un clic rapide crée un doublon)
  const [cherche, setCherche] = useState('')
  const [ficheCreee, setFicheCreee] = useState(false)
  const [fiche, setFiche] = useState(null)
  const [nouvelle, setNouvelle] = useState(null) // { nom, telephone, contact } quand aucune fiche ne convient
  const [form, setForm] = useState({ suite: 'rappeler', motif: '', contact: '', telephone: '', owner_id: '', due_on: iso(new Date()), urgent: false })
  const [equipe, setEquipe] = useState([])
  const [busy, setBusy] = useState(false)
  const demande = useRef(0)

  useEffect(() => { chargerEquipe().then(setEquipe) }, [])
  useEffect(() => { if (moi?.id) setForm((f) => (f.owner_id ? f : { ...f, owner_id: moi.id })) }, [moi?.id])

  // Recherche au fil de la frappe (la réponse d'une frappe ancienne ne remplace pas une plus récente)
  useEffect(() => {
    if (fiche || nouvelle) return undefined
    const n = ++demande.current
    const t = setTimeout(async () => {
      const r = await chercherFiches(texte)
      if (n !== demande.current) return
      setErreurLecture(r === null)
      setResultats(r || [])
      setCherche(texte)
    }, 250)
    return () => clearTimeout(t)
  }, [texte, fiche, nouvelle])

  const choisir = (c) => {
    setFiche(c)
    // Contact et numéro de la fiche choisie (jamais ceux d'une fiche choisie avant « Changer »)
    setForm((f) => ({ ...f, contact: c.contact_name || '', telephone: c.contact_phone || c.mobile || '' }))
  }
  const ouvrirCreation = () => {
    const chiffres = texte.replace(/\D/g, '')
    setNouvelle({ nom: chiffres.length >= 6 ? '' : texte.trim(), telephone: chiffres.length >= 6 ? texte.trim() : '', contact: '' })
  }
  const recommencer = () => { setFiche(null); setNouvelle(null); setFicheCreee(false); setCherche(''); setForm((f) => ({ ...f, contact: '', telephone: '' })) }

  const valider = async (e) => {
    e.preventDefault()
    setBusy(true)
    let f = fiche
    try {
      if (!f) {
        f = await creerFicheProspect(nouvelle)
        // Si l'action échoue ensuite, la fiche reste choisie : un nouvel essai ne recrée pas de doublon
        setFiche(f)
        setFicheCreee(true)
        setForm((x) => ({ ...x, contact: x.contact || nouvelle.contact, telephone: x.telephone || nouvelle.telephone }))
        setNouvelle(null)
      }
      await creerActionAppel({
        fiche: f, suite: form.suite, motif: form.motif,
        contact: form.contact || nouvelle?.contact, telephone: form.telephone || nouvelle?.telephone,
        owner_id: form.owner_id || null, due_on: form.due_on || null, urgent: form.urgent, ctxSocietes,
      })
      try { window.dispatchEvent(new Event('odet:actions-maj')) } catch { /* page Actions fermée : rien à rafraîchir */ }
      toast.success(fiche ? 'Action créée et reliée à la fiche' : 'Fiche prospect et action créées')
      onClose?.()
    } catch (err) {
      const msg = err?.code === '42501' ? 'Enregistrement refusé : vos accès ne le permettent pas.' : err?.message || 'Enregistrement impossible.'
      // La fiche a pu être créée avant le refus de l'action : le dire, pour ne pas laisser un prospect sans suite
      toast.error(ficheCreee || (!fiche && f) ? `${msg} La fiche prospect, elle, est créée.` : msg)
    } finally { setBusy(false) }
  }

  const aJour = cherche === texte
  const pret = (fiche || (nouvelle && nouvelle.nom.trim().length >= 2)) && !busy
  const footer = (fiche || nouvelle) ? (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
      <button type="submit" form="appel-entrant" className="btn btn-primary" disabled={!pret}>
        {fiche ? 'Créer l\'action' : 'Créer la fiche et l\'action'}
      </button>
    </>
  ) : null

  return (
    <Sheet title="Appel entrant" onClose={onClose} footer={footer}>
      {!fiche && !nouvelle && (
        <>
          <div>
            <label className="label" htmlFor="ae-recherche">Qui appelle ?</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
              <input id="ae-recherche" className="input pl-9" autoFocus value={texte} onChange={(e) => setTexte(e.target.value)}
                placeholder="Nom de l'entreprise, téléphone ou SIRET" autoComplete="off" />
            </div>
          </div>
          {erreurLecture && <Banner tone="warning">La recherche n'a pas abouti. Réessayez dans un instant.</Banner>}
          {texte.trim().length >= 2 && !erreurLecture && !aJour && (
            <p className="text-ui text-gray-600" role="status">Recherche en cours…</p>
          )}
          {texte.trim().length >= 2 && !erreurLecture && aJour && (
            <>
              <p className="sr-only" role="status">{resultats.length ? `${Math.min(resultats.length, LIMITE)} fiche(s) trouvée(s)` : 'Aucune fiche trouvée'}</p>
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
                {resultats.length === 0 && <li className="text-ui text-gray-600">Aucune fiche ne correspond : c'est un nouveau prospect.</li>}
              </ul>
              {resultats.length > LIMITE && (
                <Banner tone="info">Plus de {LIMITE} fiches correspondent : précisez le nom ou le numéro avant de créer une fiche.</Banner>
              )}
              {peutCreerFiche && resultats.length <= LIMITE && (
                <button type="button" className="btn btn-secondary justify-self-start" onClick={ouvrirCreation}>
                  <UserPlus className="w-4 h-4" />{resultats.length ? 'Aucune de ces fiches : nouveau prospect' : 'Créer la fiche du nouveau prospect'}
                </button>
              )}
              {!peutCreerFiche && resultats.length === 0 && (
                <Banner tone="info">La création de fiche ne fait pas partie de vos accès : demandez-la à un collègue.</Banner>
              )}
            </>
          )}
        </>
      )}

      {(fiche || nouvelle) && (
        <form id="appel-entrant" onSubmit={valider} className="grid gap-3">
          {fiche ? (
            <div className="flex items-center gap-2 rounded-ui-sm border border-gray-200 px-3 py-2">
              <span className="flex-1 min-w-0 font-medium text-gray-900 truncate">
                <Link to={`/clients/${fiche.id}`} onClick={onClose} className="hover:underline">{fiche.name}</Link>
              </span>
              <StatusBadge tone={fiche.type === 'client' ? 'success' : 'warning'}>{statutFiche(fiche)}</StatusBadge>
              <button type="button" className="btn btn-ghost btn-sm" onClick={recommencer}>Changer</button>
            </div>
          ) : (
            <fieldset className="grid gap-2 rounded-ui-sm border border-gray-200 p-3">
              <legend className="px-1 text-ui font-medium text-gray-900">Nouveau prospect</legend>
              <div>
                <label className="label" htmlFor="ae-nom">Entreprise ou personne</label>
                <input id="ae-nom" className="input" value={nouvelle.nom} maxLength={255} autoFocus
                  onChange={(e) => setNouvelle({ ...nouvelle, nom: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="ae-ncontact">Contact</label>
                  <input id="ae-ncontact" className="input" value={nouvelle.contact} maxLength={255}
                    onChange={(e) => setNouvelle({ ...nouvelle, contact: e.target.value })} />
                </div>
                <div>
                  <label className="label" htmlFor="ae-ntel">Téléphone</label>
                  <input id="ae-ntel" className="input" type="tel" value={nouvelle.telephone} maxLength={20}
                    onChange={(e) => setNouvelle({ ...nouvelle, telephone: e.target.value })} />
                </div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={recommencer}>Revenir à la recherche</button>
            </fieldset>
          )}

          <div role="radiogroup" aria-label="Suite à donner" className="flex flex-wrap gap-2">
            {Object.entries(SUITES).map(([k, libelle]) => (
              <button key={k} type="button" role="radio" aria-checked={form.suite === k} onClick={() => setForm({ ...form, suite: k })}
                className={`btn btn-sm ${form.suite === k ? 'bg-gray-900 text-white border-gray-900' : 'btn-secondary'}`}>{libelle}</button>
            ))}
          </div>
          <div>
            <label className="label" htmlFor="ae-motif">Motif de l'appel</label>
            <textarea id="ae-motif" className="input" rows={2} maxLength={1500} value={form.motif}
              placeholder="Ex. : demande de devis pour la vérification des extincteurs"
              onChange={(e) => setForm({ ...form, motif: e.target.value })} />
          </div>
          {fiche && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="ae-contact">Qui a appelé</label>
                <input id="ae-contact" className="input" value={form.contact} maxLength={255} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="ae-tel">Numéro à rappeler</label>
                <input id="ae-tel" className="input" type="tel" value={form.telephone} maxLength={20} onChange={(e) => setForm({ ...form, telephone: e.target.value })} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_160px_auto] gap-2 items-end">
            <div>
              <label className="label" htmlFor="ae-qui">Qui s'en occupe</label>
              <select id="ae-qui" className="select" value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })}>
                <option value="">Personne en particulier</option>
                {equipe.map((p) => <option key={p.id} value={p.id}>{nomProfil(p)}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="ae-date">Pour le</label>
              <input id="ae-date" type="date" className="input" value={form.due_on} onChange={(e) => setForm({ ...form, due_on: e.target.value })} />
            </div>
            <label className="inline-flex items-center gap-2 text-ui pb-2">
              <input type="checkbox" checked={form.urgent} onChange={(e) => setForm({ ...form, urgent: e.target.checked })} />Urgent
            </label>
          </div>
        </form>
      )}
    </Sheet>
  )
}
