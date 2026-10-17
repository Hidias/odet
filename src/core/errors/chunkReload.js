// Après une mise à jour, un onglet resté ouvert réclame des fichiers qui n'existent plus
// (page blanche). On recharge alors la page une fois, sans boucle (au plus une fois par minute).
// Code déplacé tel quel depuis src/main.jsx pour être partagé avec l'écran d'erreur (ErrorBoundary).
export const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i

export function reloadOnceAfterUpdate() {
  try {
    const last = Number(sessionStorage.getItem('odet_chunk_reload') || 0)
    if (Date.now() - last < 60000) return
    sessionStorage.setItem('odet_chunk_reload', String(Date.now()))
  } catch { /* stockage indisponible : on recharge quand même */ }
  window.location.reload()
}
