// Appareils de l'espace client (0449) : chaque navigateur tire une fois un identifiant au hasard, gardé sur l'appareil ;
// seule son empreinte (SHA-256) part au serveur. Aucun pistage : rien n'est tiré du matériel ni du navigateur.

const CLE = 'odet.appareil.v1'

function aleatoire() {
  const a = new Uint8Array(32)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Identifiant de cet appareil (localStorage ; à défaut, le temps de l'onglet) */
export function identifiantAppareil() {
  for (const stock of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      const s = stock()
      let v = s.getItem(CLE)
      if (!v) { v = aleatoire(); s.setItem(CLE, v) }
      return v
    } catch { /* stockage indisponible : suivant */ }
  }
  return aleatoire()
}

export async function empreinteAppareil() {
  const data = new TextEncoder().encode(`odet-appareil:${identifiantAppareil()}`)
  const h = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Code choisi par le client : même règle que la base (app.code_acces_valable) ; null si valable, sinon le motif */
export function motifCode(code) {
  const c = String(code || '').replace(/\s/g, '')
  if (!/^[0-9]{6,8}$/.test(c)) return 'Le code compte 6 à 8 chiffres'
  if (/^(.)\1+$/.test(c)) return 'Un code fait d\'un seul chiffre répété est trop facile à deviner'
  let monte = true
  let descend = true
  for (let i = 1; i < c.length; i++) {
    const d = Number(c[i]) - Number(c[i - 1])
    if ((d + 10) % 10 !== 1) monte = false
    if ((-d + 10) % 10 !== 1) descend = false
  }
  if (monte || descend) return 'Une suite de chiffres (123456…) est trop facile à deviner'
  return null
}

/** Mot de passe du compte : 10 caractères au moins, lettres et chiffres (même règle que le serveur) */
export function motifMotDePasse(mdp) {
  const m = String(mdp || '')
  if (m.length < 10) return '10 caractères au moins'
  if (!/[A-Za-z]/.test(m) || !/[0-9]/.test(m)) return 'Des lettres et des chiffres'
  return null
}
