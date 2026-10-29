// Natures d'intervention (0463, 0465). Une vérification produit le rapport de vérification et pose les échéances des
// appareils ; les autres natures produisent un bon d'intervention et ne touchent pas aux échéances.

export const NATURES = {
  verification: { label: 'Vérification', bon: null, travaux: null },
  inventaire: { label: 'Inventaire', bon: 'Procès-verbal d\'inventaire', travaux: null },
  depannage: { label: 'Dépannage', bon: 'Bon d\'intervention', travaux: 'Panne constatée et travaux réalisés' },
  installation: { label: 'Installation', bon: 'Bon d\'intervention', travaux: 'Travaux réalisés' },
  livraison: { label: 'Livraison', bon: 'Bon de livraison', travaux: 'Matériel livré' },
  mise_en_service: { label: 'Mise en service', bon: 'Procès-verbal de mise en service', travaux: 'Essais et réglages réalisés' },
  exercice_evacuation: { label: 'Exercice d\'évacuation', bon: 'Compte rendu d\'exercice d\'évacuation', travaux: 'Déroulé, durée d\'évacuation et points à améliorer' },
}

// Ordre proposé à la création d'une intervention
export const NATURES_CREATION = ['depannage', 'installation', 'livraison', 'mise_en_service', 'exercice_evacuation', 'verification', 'inventaire']

export const natureDe = (visit) => NATURES[visit?.kind] || NATURES.verification
export const estVerification = (visit) => !visit?.kind || visit.kind === 'verification'
// Les appareils du site sont proposés d'office au contrôle pour une vérification et un inventaire seulement
export const controleTousAppareils = (visit) => estVerification(visit) || visit.kind === 'inventaire'

/** Délai promis d'un dépannage urgent : null, ou { avant, respecte (true/false/null si pas encore arrivé), retard } */
export function delaiUrgence(visit, maintenant = new Date()) {
  if (!visit?.urgent || !visit.deadline_at) return null
  const avant = new Date(visit.deadline_at)
  const arrivee = visit.started_at ? new Date(visit.started_at) : null
  if (arrivee) return { avant, respecte: arrivee <= avant, retard: arrivee > avant }
  return { avant, respecte: null, retard: maintenant > avant }
}
