// Après une mise à jour, un onglet resté ouvert réclame des fichiers qui n'existent plus
// (page blanche). On recharge alors la page, sans boucle (trois fois au plus en trois minutes).
// Code déplacé tel quel depuis src/main.jsx pour être partagé avec l'écran d'erreur (ErrorBoundary).
// Ajout (chantier B, 19/10) : page restée sur un ancien index juste après un déploiement, constatée en recette :
// module chargé vide (« reading 'default' » dans React.lazy) ou fichier servi en HTML (type MIME).
export const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Cannot read properties of undefined \(reading 'default'\)|not a valid JavaScript MIME type/i

// Renvoie vrai si la page se recharge, faux si un rechargement vient déjà d'avoir lieu (l'erreur persiste : elle doit
// alors s'afficher et remonter au suivi des erreurs, correctif du 19/10).
let rechargement = false
// Vrai quand la page est en train de se recharger : rien ne doit être journalisé pendant ce temps (audit du 19/10 au soir).
export function rechargementEnCours() { return rechargement }

// Plusieurs mises en ligne peuvent se suivre de près (21/10 : « Failed to fetch dynamically imported module » sur
// /stagiaires) : le premier rechargement retombait sur une version déjà remplacée et l'erreur s'affichait. Jusqu'à trois
// rechargements en trois minutes, espacés (immédiat, puis 3 s, puis 8 s), avant d'afficher l'erreur.
const FENETRE = 3 * 60000
const DELAIS = [0, 3000, 8000]
export function reloadOnceAfterUpdate() {
  // Un rechargement déjà lancé (plusieurs écouteurs voient la même erreur) : on n'en compte pas un autre
  if (rechargement) return true
  let essais = []
  try {
    essais = JSON.parse(sessionStorage.getItem('odet_chunk_reloads') || '[]').filter((t) => Date.now() - t < FENETRE)
    if (essais.length >= DELAIS.length) return false
    sessionStorage.setItem('odet_chunk_reloads', JSON.stringify([...essais, Date.now()]))
  } catch { /* stockage indisponible : on recharge quand même */ }
  rechargement = true
  const delai = DELAIS[essais.length] || 0
  if (delai) setTimeout(() => window.location.reload(), delai)
  else window.location.reload()
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

// Erreur attrapée par un écran (téléchargement d'un document, signature…) : si c'est un fichier de l'ancienne version
// après une mise à jour, la page se recharge au lieu d'afficher « document impossible » (constaté le 22/10 sur l'espace
// entreprise juste après une mise en ligne). Renvoie vrai si la page se recharge.
export function rechargerSiMiseAJour(err) {
  return CHUNK_ERROR.test(err?.message || String(err || '')) && reloadOnceAfterUpdate()
}
