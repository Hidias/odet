import { FlaskConical } from 'lucide-react'
import { useMarquesDemo } from './marquesDemo'

const TITRE = 'Donnée de démonstration : elle n\'existe pas en vrai et sera supprimée à la purge des données de test.'

// Pastille « TEST » à côté d'un nom ou d'une référence. N'affiche rien pour une donnée réelle.
export function BadgeTest({ tbl, id, className = '' }) {
  const { estTest } = useMarquesDemo()
  if (!estTest(tbl, id)) return null
  return (
    <span className={`badge-test ${className}`} title={TITRE} aria-label="Donnée de test">
      <FlaskConical className="w-3 h-3" aria-hidden="true" />Test
    </span>
  )
}

const QUOI = { clients: 'Client', sessions: 'Session', quotes: 'Devis', invoices: 'Facture', trainees: 'Stagiaire', trainers: 'Formateur', prospect_rdv: 'Rendez-vous' }

// Bandeau en tête de fiche : rappelle que la fiche est fictive. N'affiche rien pour une donnée réelle.
export function BandeauTest({ tbl, id }) {
  const { estTest } = useMarquesDemo()
  if (!estTest(tbl, id)) return null
  return (
    <div role="note" className="bandeau-test mb-4">
      <FlaskConical className="w-4 h-4 flex-none" aria-hidden="true" />
      <span><strong>{QUOI[tbl] || 'Fiche'} de test.</strong> Donnée de démonstration : ne l'utilisez pas pour un vrai client. Elle sera supprimée à la purge des données de test.</span>
    </div>
  )
}

// Texte à ajouter dans une liste déroulante (<option>), où une pastille ne s'affiche pas
export function suffixeTest(estTest, tbl, id) {
  return estTest(tbl, id) ? ' (TEST)' : ''
}
