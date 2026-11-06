// Numéros de téléphone : affichage lisible et lien d'appel. Règle partagée, à réutiliser plutôt qu'à recopier.
// Un numéro français à 10 chiffres s'affiche par paires (06 12 34 56 78), un +33 suivi de 9 chiffres en
// +33 6 12 34 56 78. Tout autre format est rendu tel quel (sans espaces superflus) : on ne devine pas.
export function telephoneLisible(valeur) {
  if (valeur == null) return ''
  const brut = String(valeur).trim()
  const chiffres = brut.replace(/[\s.\-()]/g, '')
  if (/^0\d{9}$/.test(chiffres)) return chiffres.replace(/(\d{2})(?=\d)/g, '$1 ')
  if (/^\+33\d{9}$/.test(chiffres)) return '+33 ' + chiffres.slice(3, 4) + ' ' + chiffres.slice(4).replace(/(\d{2})(?=\d)/g, '$1 ')
  return brut.replace(/\s+/g, ' ')
}

// Lien d'appel : chiffres et « + » seulement
export function lienTelephone(valeur) {
  return 'tel:' + String(valeur ?? '').replace(/[^\d+]/g, '')
}
