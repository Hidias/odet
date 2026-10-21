// Quiz flash (0425) : éléments communs à l'écran projeté et au téléphone du stagiaire. Chaque réponse a une forme ET
// une couleur (lisible par les daltoniens), toujours dans le même ordre.

export const COULEURS = ['#2F6FDF', '#E8891A', '#139A8B', '#B83280']
export const NOMS_FORMES = ['triangle', 'rond', 'carré', 'losange']

export function Forme({ i, taille = 24 }) {
  const p = { width: taille, height: taille, viewBox: '0 0 24 24', 'aria-hidden': 'true', className: 'shrink-0' }
  if (i === 0) return <svg {...p}><path d="M12 3 22 21H2Z" fill="#fff" /></svg>
  if (i === 1) return <svg {...p}><circle cx="12" cy="12" r="10" fill="#fff" /></svg>
  if (i === 2) return <svg {...p}><rect x="3" y="3" width="18" height="18" fill="#fff" /></svg>
  return <svg {...p}><path d="M12 2 22 12 12 22 2 12Z" fill="#fff" /></svg>
}

// Secondes restantes d'une question, horloge du serveur (décalage mesuré à chaque lecture)
export function resteSecondes(etat, decalage) {
  if (!etat?.q_debut) return etat?.duree || 20
  const ecoule = (Date.now() + decalage - Date.parse(etat.q_debut)) / 1000
  return Math.max(0, Math.ceil((etat.duree || 20) - ecoule))
}

export function decalageServeur(etat) {
  return etat?.maintenant ? Date.parse(etat.maintenant) - Date.now() : 0
}

// Petits sons (après une action de la personne seulement), toujours doublés d'un signal visuel
let ctx = null
export function bip(freqs, actif) {
  if (!actif) return
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)()
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.frequency.value = f; o.type = 'triangle'; g.gain.value = 0.08
      o.connect(g); g.connect(ctx.destination)
      const t0 = ctx.currentTime + i * 0.12
      o.start(t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25); o.stop(t0 + 0.26)
    })
  } catch { /* son indisponible */ }
}

export function lireAVoixHaute(texte, actif) {
  if (!actif || !texte) return
  try { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(texte); u.lang = 'fr-FR'; window.speechSynthesis.speak(u) } catch { /* indisponible */ }
}

export const mouvementReduit = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Confettis légers (canvas plein écran, retiré à la fin)
export function confettis(n = 80) {
  if (typeof document === 'undefined' || mouvementReduit()) return
  const cv = document.createElement('canvas')
  cv.setAttribute('aria-hidden', 'true')
  Object.assign(cv.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '80' })
  document.body.appendChild(cv)
  cv.width = window.innerWidth; cv.height = window.innerHeight
  const c = cv.getContext('2d')
  const cols = ['#D6213A', '#C9993A', '#2F6FDF', '#139A8B', '#E8891A', '#ffffff']
  let parts = Array.from({ length: n }, (_, k) => ({ x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.3, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4, r: Math.random() * 3, s: 5 + Math.random() * 6, col: cols[k % cols.length] }))
  const boucle = () => {
    c.clearRect(0, 0, cv.width, cv.height)
    parts.forEach((p) => { p.x += p.vx; p.y += p.vy; p.r += 0.1; c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.fillStyle = p.col; c.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); c.restore() })
    parts = parts.filter((p) => p.y < cv.height + 20)
    if (parts.length) requestAnimationFrame(boucle); else cv.remove()
  }
  requestAnimationFrame(boucle)
}

// Réglages d'accessibilité du joueur (sur son téléphone)
const CLE = 'odet_quiz_flash_reglages'
export function lireReglages() {
  try { return { sansChrono: false, voix: false, sons: false, grand: false, ...JSON.parse(localStorage.getItem(CLE) || '{}') } } catch { return { sansChrono: false, voix: false, sons: false, grand: false } }
}
export function garderReglages(r) {
  try { localStorage.setItem(CLE, JSON.stringify(r)) } catch { /* stockage indisponible */ }
}
