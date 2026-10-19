// Après une mise à jour, un onglet resté ouvert réclame des fichiers qui n'existent plus
// (page blanche). On recharge alors la page une fois, sans boucle (au plus une fois par minute).
// Code déplacé tel quel depuis src/main.jsx pour être partagé avec l'écran d'erreur (ErrorBoundary).
// Ajout (chantier B, 19/10) : page restée sur un ancien index juste après un déploiement, constatée en recette :
// module chargé vide (« reading 'default' » dans React.lazy) ou fichier servi en HTML (type MIME).
export const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Cannot read properties of undefined \(reading 'default'\)|not a valid JavaScript MIME type/i

// Renvoie vrai si la page se recharge, faux si un rechargement vient déjà d'avoir lieu (l'erreur persiste : elle doit
// alors s'afficher et remonter au suivi des erreurs, correctif du 19/10).
export function reloadOnceAfterUpdate() {
  try {
    const last = Number(sessionStorage.getItem('odet_chunk_reload') || 0)
    if (Date.now() - last < 60000) return false
    sessionStorage.setItem('odet_chunk_reload', String(Date.now()))
  } catch { /* stockage indisponible : on recharge quand même */ }
  window.location.reload()
  return true
}
