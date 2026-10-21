// Déconnexion automatique après une heure sans activité (A1, 21/10) : l'heure de la dernière activité est partagée
// entre les onglets de l'appareil ; avertissement à 55 minutes, déconnexion à 60.

export const AVERTISSEMENT_MS = 55 * 60 * 1000
export const DECONNEXION_MS = 60 * 60 * 1000
const CLE = 'odet_derniere_activite'

export function noterActivite(t = Date.now()) {
  try { localStorage.setItem(CLE, String(t)) } catch { /* stockage indisponible : l'onglet garde sa propre heure */ }
  return t
}

export function derniereActivite(repli) {
  try {
    const v = Number(localStorage.getItem(CLE))
    return Number.isFinite(v) && v > 0 ? Math.max(v, repli || 0) : repli
  } catch { return repli }
}

// Essai à l'écran (vérification avant annonce) : sur un appareil où la clé locale odet_inactivite_essai vaut 1,
// avertissement à 1 minute et déconnexion à 2 ; sans effet ailleurs
function durees() {
  try { if (localStorage.getItem('odet_inactivite_essai') === '1') return [60 * 1000, 120 * 1000] } catch { /* normal */ }
  return [AVERTISSEMENT_MS, DECONNEXION_MS]
}

// État pour une durée d'inactivité : actif, avertissement (secondes restantes), deconnexion
export function etatInactivite(inactifMs, [avert, deco] = durees()) {
  if (inactifMs >= deco) return { etat: 'deconnexion', reste: 0 }
  if (inactifMs >= avert) return { etat: 'avertissement', reste: Math.ceil((deco - inactifMs) / 1000) }
  return { etat: 'actif', reste: null }
}
