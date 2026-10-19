import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import EmptyState from '../../ui/EmptyState'

// Page affichée quand le compte n'a pas le droit d'ouvrir l'adresse demandée (garde des pages, ecrans/gardes).
// Pas de redirection automatique : la personne comprend pourquoi la page ne s'ouvre pas.
export default function PageRefusee({ accueil = true }) {
  return (
    <EmptyState
      icon={Lock}
      title="Cette page ne fait pas partie de vos accès"
      action={accueil ? <Link to="/" className="btn btn-secondary">Revenir à l'accueil</Link> : null}
    >
      Si vous en avez besoin, demandez à la personne qui gère les accès de votre organisme.
    </EmptyState>
  )
}
