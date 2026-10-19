import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Banner } from '../../ui/Banner'
import { useNotices, cleBandeau, bandeauFermeAujourdhui, fermerBandeau, ouvrirPostIt, PHRASE_DEMO } from './notices'

// Bandeau d'information en haut de l'application (comptes internes connectés).
// Texte et activation réglés dans la Console ; fermable pour la journée ; réapparaît quand le texte change.
// Deuxième phrase tant que des données de démonstration existent (calculé par la base).
export default function BandeauInfo({ nouveautes = true, retours = true }) {
  const banner = useNotices((s) => s.banner)
  const [fermeCle, setFermeCle] = useState(null)
  const cle = cleBandeau(banner)
  if (!banner || fermeCle === cle || bandeauFermeAujourdhui(banner)) return null

  const fermer = () => { fermerBandeau(banner); setFermeCle(cle) }

  return (
    <Banner tone="info" className="mb-4 print:hidden" onClose={fermer}>
      <span className="text-gray-700">{banner.body}</span>
      {banner.demo && <span className="text-gray-700"> {PHRASE_DEMO}</span>}
      {(nouveautes || retours) && (
        <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {nouveautes && <Link to="/nouveautes" className="font-semibold text-accent-700 hover:underline">Voir les nouveautés</Link>}
          {retours && (
            <button type="button" onClick={() => ouvrirPostIt()} className="font-semibold text-accent-700 hover:underline">
              Signaler un problème ou une idée
            </button>
          )}
        </span>
      )}
    </Banner>
  )
}
