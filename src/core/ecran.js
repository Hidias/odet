import { useEffect, useState } from 'react'

// Largeur d'écran suivie en direct (téléphone qui pivote, fenêtre redimensionnée) : un seul rendu à la fois quand une
// liste a deux présentations (cartes au téléphone, tableau sur grand écran), pour ne jamais avoir deux champs de
// saisie du même enregistrement (A11 du 07/11, bilan des attentes). md de Tailwind = 768 px.
export function useEcranLarge(minPx = 768) {
  const requete = `(min-width: ${minPx}px)`
  const lire = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(requete).matches : true)
  const [large, setLarge] = useState(lire)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia(requete)
    const suivre = () => setLarge(mq.matches)
    suivre()
    mq.addEventListener?.('change', suivre)
    return () => mq.removeEventListener?.('change', suivre)
  }, [requete])
  return large
}
