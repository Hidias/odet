// Après une mise à jour, un onglet resté ouvert réclame des fichiers qui n'existent plus
// (page blanche). On recharge alors la page une fois, sans boucle (au plus une fois par minute).
// Code déplacé tel quel depuis src/main.jsx pour être partagé avec l'écran d'erreur (ErrorBoundary).
// Ajout (chantier B, 19/10) : page restée sur un ancien index juste après un déploiement, constatée en recette :
// module chargé vide (« reading 'default' » dans React.lazy) ou fichier servi en HTML (type MIME).
export const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Cannot read properties of undefined \(reading 'default'\)|not a valid JavaScript MIME type/i

// Renvoie vrai si la page se recharge, faux si un rechargement vient déjà d'avoir lieu (l'erreur persiste : elle doit
// alors s'afficher et remonter au suivi des erreurs, correctif du 19/10).
let rechargement = false
// Vrai quand la page est en train de se recharger : rien ne doit être journalisé pendant ce temps (audit du 19/10 au soir).
export function rechargementEnCours() { return rechargement }

export function reloadOnceAfterUpdate() {
  try {
    const last = Number(sessionStorage.getItem('odet_chunk_reload') || 0)
    if (Date.now() - last < 60000) return false
    sessionStorage.setItem('odet_chunk_reload', String(Date.now()))
  } catch { /* stockage indisponible : on recharge quand même */ }
  rechargement = true
  window.location.reload()
  return true
}

// Chargement différé sûr (cause racine de « reading 'default' », audit du 19/10 au soir) : un module vide ou introuvable
// après un déploiement provoque un seul rechargement de la page (la promesse reste alors en attente, aucun écran d'erreur
// ne clignote) ; si le rechargement vient déjà d'avoir lieu, une erreur claire portant le nom du module remonte.
export function importSur(charger) {
  return () => charger().then(
    (m) => {
      if (m && m.default) return m
      throw new Error("Module chargé vide après une mise à jour (reading 'default')")
    },
  ).catch((err) => {
    if (reloadOnceAfterUpdate()) return new Promise(() => {})
    throw err
  })
}
