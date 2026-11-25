// B126 : une seule règle « session réalisée » pour tout l'outil (résultats, indicateurs, froid, facturation).
// Aujourd'hui une session réalisée est une session « Terminée » (status = 'completed') : comportement inchangé.
// Quand les étapes « À clôturer » et « À facturer » arriveront, on les ajoute ici seulement
// (et dans app.session_realisee, migration 0527), sans toucher aux écrans qui lisent cette règle.
// Les affichages et filtres de libellé (« Terminée », « Annulée ») ne passent pas par ici : ils montrent le statut tel quel.

export const STATUTS_REALISEE = Object.freeze(['completed'])

// Accepte une session ({ status }) ou directement un statut.
export function estRealisee(sessionOuStatut) {
  const statut = typeof sessionOuStatut === 'string' ? sessionOuStatut : sessionOuStatut?.status
  return STATUTS_REALISEE.includes(statut)
}
