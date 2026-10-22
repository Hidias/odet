// Vérification du n° de sécurité sociale (NIR), une seule règle pour toute l'application (22/10, décision de H) :
// espace entreprise, portail stagiaire, fiche stagiaire et Passeport de prévention. Refait par la base à
// l'enregistrement (app.nir_complet).
//  - 15 caractères obligatoires : 13 + clé de 2 chiffres (espaces, points et tirets ignorés) ;
//  - clé = 97 − (13 premiers chiffres modulo 97), Corse : 2A compte 19, 2B compte 18 ;
//  - numéro provisoire (1er chiffre 7 ou 8) accepté avec une alerte ;
//  - cohérence avec le genre et la date de naissance de la fiche : alerte sans blocage (la fiche peut être fausse).
// On vérifie que le numéro est valide et cohérent, pas qu'il appartient à la personne : aucun service ne le permet.

const FORMAT = /^[1278]\d{4}(\d{2}|2A|2B)\d{6}\d{2}$/

export const nettoyerNir = (v) => String(v || '').toUpperCase().replace(/[\s.\-_]/g, '')

/** Affichage par groupes : 1 85 05 78 006 084 36 */
export function formaterNir(v) {
  const c = nettoyerNir(v).slice(0, 15)
  const tailles = [1, 2, 2, 2, 3, 3, 2]
  const out = []
  let i = 0
  for (const t of tailles) { if (i >= c.length) break; out.push(c.slice(i, i + t)); i += t }
  return out.join(' ')
}

export function cleNir(nir13) {
  return 97 - Number(BigInt(String(nir13).replace('2A', '19').replace('2B', '18')) % 97n)
}

const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/**
 * ctx : { gender ('male' | 'female' | 'non_binary'), birth_date ('AAAA-MM-JJ') }
 * Renvoie { vide, ok, nir15, nir13, erreurs: [], alertes: [], provisoire }
 */
export function verifierNir(entree, ctx = {}) {
  const c = nettoyerNir(entree)
  const r = { vide: !c, ok: false, nir15: null, nir13: null, erreurs: [], alertes: [], provisoire: false }
  if (!c) return r
  if (c.length !== 15) {
    r.erreurs.push(c.length === 13
      ? 'Il manque la clé : ajoutez les 2 derniers chiffres (15 caractères en tout, comme sur la carte Vitale)'
      : `15 caractères attendus (13 + clé de 2 chiffres) : vous en avez ${c.length}`)
    return r
  }
  if (!FORMAT.test(c)) {
    r.erreurs.push('Format invalide : le numéro commence par 1 ou 2 et ne contient que des chiffres (2A ou 2B pour une naissance en Corse)')
    return r
  }
  const n13 = c.slice(0, 13)
  if (Number(c.slice(13)) !== cleNir(n13)) {
    r.erreurs.push('La clé (2 derniers chiffres) ne correspond pas au numéro : vérifiez chaque chiffre')
    return r
  }
  r.ok = true; r.nir15 = c; r.nir13 = n13
  const sexe = c[0]
  r.provisoire = sexe === '7' || sexe === '8'
  if (r.provisoire) r.alertes.push('Numéro provisoire (commence par 7 ou 8) : à remplacer par le numéro définitif dès qu\'il est connu')
  const homme = sexe === '1' || sexe === '7'
  if (ctx.gender === 'male' && !homme) r.alertes.push('Le numéro est celui d\'une femme, la fiche indique un homme')
  if (ctx.gender === 'female' && homme) r.alertes.push('Le numéro est celui d\'un homme, la fiche indique une femme')
  const naissance = /^(\d{4})-(\d{2})/.exec(String(ctx.birth_date || ''))
  if (naissance) {
    if (c.slice(1, 3) !== naissance[1].slice(2)) r.alertes.push(`Le numéro indique une naissance en ${c.slice(1, 3)}, la fiche en ${naissance[1]}`)
    const m = Number(c.slice(3, 5))
    if (m >= 1 && m <= 12 && m !== Number(naissance[2])) r.alertes.push(`Le numéro indique une naissance en ${mois[m - 1]}, la fiche en ${mois[Number(naissance[2]) - 1]}`)
  }
  return r
}
