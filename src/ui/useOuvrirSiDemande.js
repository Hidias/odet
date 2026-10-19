import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

// Ouvre le formulaire de création d'une page quand on y arrive par le bouton « + Nouveau » (état { openNew: true }).
// `pret` : attendre que la page ait chargé ce dont le formulaire a besoin. L'état est retiré aussitôt, pour qu'un
// retour arrière ou un rechargement ne rouvre pas le formulaire.
export function useOuvrirSiDemande(ouvrir, pret = true) {
  const location = useLocation()
  const navigate = useNavigate()
  const fait = useRef(false)
  const demande = !!location.state?.openNew
  useEffect(() => {
    if (!demande || !pret || fait.current) return
    fait.current = true
    navigate(location.pathname + location.search, { replace: true, state: {} })
    ouvrir()
  }, [demande, pret]) // eslint-disable-line react-hooks/exhaustive-deps
}
