import { useEffect, useRef, useState } from 'react'
import { Search, Loader2, ExternalLink } from 'lucide-react'
import { chercherEntreprises, photographie, pappers, libelleEtat } from '../lib/registry'

// Nouveau client : un seul champ « Nom, SIREN ou SIRET » (lot 2). Résultats du répertoire avec leur état (actif,
// cessé, déjà client) ; un clic préremplit la fiche (TVA calculée, adresse du siège). La saisie manuelle reste
// possible : rien n'est obligatoire ici.

export default function RechercheRepertoire({ clientsExistants = [], onChoisir }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState([])
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState(null)
  const dernier = useRef(0)

  useEffect(() => {
    const texte = q.trim()
    if (texte.length < 3) { setRes([]); setErreur(null); return undefined }
    const n = ++dernier.current
    const t = setTimeout(async () => {
      setEnCours(true)
      try {
        const r = await chercherEntreprises(texte)
        if (n === dernier.current) { setRes(r); setErreur(null) }
      } catch (e) {
        if (n === dernier.current) { setRes([]); setErreur(e.message) }
      } finally {
        if (n === dernier.current) setEnCours(false)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [q])

  const sirensClients = new Map(clientsExistants.filter((c) => c.siren || c.siret)
    .map((c) => [String(c.siren || c.siret).replace(/\s/g, '').slice(0, 9), c]))

  const choisir = (e) => {
    onChoisir?.({
      name: e.nom || '',
      legal_name: e.raison_sociale || null,
      siret: e.siege?.siret || '',
      siren: e.siren,
      address: e.siege?.adresse || '',
      postal_code: e.siege?.code_postal || '',
      city: (e.siege?.ville || '').toUpperCase(),
      tva: e.tva || '',
      forme_juridique: e.forme_juridique || null,
      naf_code: e.naf || null,
      naf: e.naf || null,
      naf_label: e.naf_libelle || null,
      effectif: e.effectif || null,
      dirigeant_nom: e.dirigeant_nom || null,
      dirigeant_qualite: e.dirigeant_qualite || null,
      date_creation: e.date_creation || null,
      etat_administratif: e.etat,
      registry_snapshot: photographie(e),
      registry_synced_at: new Date().toISOString(),
    })
    setQ('')
    setRes([])
  }

  return (
    <div className="rounded-ui border border-gray-200 p-3 space-y-2 bg-gray-50/60">
      <label className="label" htmlFor="recherche-repertoire">Rechercher au répertoire des entreprises</label>
      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
        <input id="recherche-repertoire" className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, SIREN ou SIRET" autoComplete="off" />
        {enCours && <Loader2 className="w-4 h-4 text-gray-400 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />}
      </div>
      {erreur && <p className="text-ui-sm text-[rgb(var(--c-warning))]">{erreur} : saisie manuelle possible ci-dessous.</p>}
      {res.length > 0 && (
        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-ui-sm bg-white max-h-72 overflow-y-auto">
          {res.map((e) => {
            const deja = sirensClients.get(e.siren)
            return (
              <li key={e.siren} className="flex items-start gap-2 p-2">
                <button type="button" onClick={() => choisir(e)} className="flex-1 min-w-0 text-left hover:bg-gray-50 rounded-ui-sm p-1 -m-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-ui font-medium text-gray-900">{e.nom}</span>
                    <span className={`badge ${e.etat === 'C' ? 'badge-danger' : 'badge-success'}`} style={{ height: 18, fontSize: 10.5 }}>{e.etat === 'C' ? 'Cessée' : libelleEtat(e.etat)}</span>
                    {deja && <span className="badge badge-warning" style={{ height: 18, fontSize: 10.5 }}>déjà client</span>}
                  </div>
                  <div className="text-ui-sm text-gray-500">
                    SIREN {e.siren}{e.siege?.ville ? ` · ${e.siege.code_postal || ''} ${e.siege.ville}` : ''}{e.naf ? ` · ${e.naf}` : ''}
                  </div>
                  {deja && <div className="text-ui-sm text-[rgb(var(--c-warning))]">Fiche existante : {deja.name}</div>}
                </button>
                <a href={pappers(e.siren)} target="_blank" rel="noreferrer" className="text-ui-sm text-accent-700 hover:underline inline-flex items-center gap-1 flex-none mt-1">Pappers <ExternalLink className="w-3 h-3" /></a>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
