// Statut unique : une seule table pour toute l'application, pour qu'une session ou une facture
// ait la même apparence sur chaque écran. Forme : un point de couleur et un texte.
// Tons : success, warning, danger, info, neutral, brand.

export const STATUS = {
  session: {
    draft: ['neutral', 'Brouillon'],
    planned: ['info', 'Planifiée'],
    confirmed: ['brand', 'Confirmée'],
    in_progress: ['warning', 'En cours'],
    completed: ['success', 'Terminée'],
    cancelled: ['danger', 'Annulée'],
  },
  invoice: {
    draft: ['neutral', 'Brouillon'],
    due: ['warning', 'À régler'],
    overdue: ['danger', 'En retard'],
    partial: ['warning', 'Partiel'],
    paid: ['success', 'Payée'],
    cancelled: ['neutral', 'Annulée'],
    credited: ['neutral', 'Annulée par avoir'],
  },
  quote: {
    draft: ['neutral', 'Brouillon'],
    sent: ['info', 'Envoyé'],
    accepted: ['success', 'Accepté'],
    refused: ['danger', 'Refusé'],
    expired: ['neutral', 'Expiré'],
  },
  visit: {
    a_planifier: ['neutral', 'À planifier'],
    planifiee: ['info', 'Planifiée'],
    en_cours: ['warning', 'En cours'],
    terminee: ['success', 'Terminée'],
    annulee: ['neutral', 'Annulée'],
  },
}

const TONES = ['success', 'warning', 'danger', 'info', 'neutral', 'brand']

/**
 * <StatusBadge kind="session" status="confirmed" />  : libellé et ton tirés de la table commune
 * <StatusBadge tone="warning">Convocations à envoyer</StatusBadge> : statut libre
 */
export function StatusBadge({ kind = null, status = null, tone = null, children = null, className = '' }) {
  const entry = kind && status ? STATUS[kind]?.[status] : null
  const t = TONES.includes(tone) ? tone : entry?.[0] || 'neutral'
  const label = children ?? entry?.[1] ?? status ?? ''
  return <span className={`status status-${t} ${className}`}>{label}</span>
}

export function statusLabel(kind, status) {
  return STATUS[kind]?.[status]?.[1] || status || ''
}

export default StatusBadge
