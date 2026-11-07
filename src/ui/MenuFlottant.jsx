// Menu d'actions d'une ligne (bouton « ⋯ ») affiché par-dessus la page, jamais coupé par un tableau qui défile
// (07/11 : le menu de la liste des clients était coupé par le cadre du tableau). Aligné sur le bord droit du
// bouton, ouvert vers le haut quand la place manque en bas, fermé au défilement et avec Échap.
// ancre : rectangle du bouton (getBoundingClientRect) pris au clic ; menuRef : pour la fermeture au clic ailleurs.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export function positionMenu(ancre, hauteur, largeur, vw, vh) {
  const right = Math.max(8, vw - ancre.right)
  const left = Math.max(8, vw - right - largeur)
  const enBas = vh - ancre.bottom - 8
  const enHaut = ancre.top - 8
  const versLeHaut = hauteur > enBas && enHaut > enBas
  return versLeHaut ? { left, bottom: vh - ancre.top + 4 } : { left, top: ancre.bottom + 4 }
}

export default function MenuFlottant({ ancre, onFermer, menuRef, largeur = 180, label = 'Actions', children }) {
  const interne = useRef(null)
  const ref = menuRef || interne
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    if (!ancre) return
    const h = ref.current?.offsetHeight || 0
    setPos(positionMenu(ancre, h, largeur, window.innerWidth, window.innerHeight))
  }, [ancre, largeur, ref])

  useEffect(() => {
    if (!ancre) return
    const fermer = (e) => { if (!ref.current || !ref.current.contains(e.target)) onFermer() }
    const touche = (e) => { if (e.key === 'Escape') onFermer() }
    window.addEventListener('scroll', fermer, true)
    window.addEventListener('resize', onFermer)
    document.addEventListener('keydown', touche)
    return () => {
      window.removeEventListener('scroll', fermer, true)
      window.removeEventListener('resize', onFermer)
      document.removeEventListener('keydown', touche)
    }
  }, [ancre, onFermer, ref])

  if (!ancre) return null
  return createPortal(
    <div ref={ref} role="menu" aria-label={label}
      style={{ position: 'fixed', zIndex: 9999, width: largeur, visibility: pos ? 'visible' : 'hidden', ...(pos || { left: 0, top: 0 }) }}
      className="bg-white border border-gray-200 rounded-ui-sm shadow-md py-1">
      {children}
    </div>,
    document.body,
  )
}
