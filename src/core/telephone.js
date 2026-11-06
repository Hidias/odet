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

// Lien d'appel : chiffres et « + » de tête seulement. Une extension (« poste 12 ») est coupée ; le « (0) » ou le 0
// placé après +33 est retiré (+33 (0)6... appelle +336...).
export function lienTelephone(valeur) {
  const debut = String(valeur ?? '').trim().match(/^\+?[\d\s.\-()]*/)[0]
  let n = debut.replace(/\(0\)/g, '').replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '')
  if (n.startsWith('+330')) n = '+33' + n.slice(4)
  return 'tel:' + n
}
