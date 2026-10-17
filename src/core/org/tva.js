// Numéro de TVA intracommunautaire français calculé depuis le SIREN.
// Clé = (12 + 3 × (SIREN mod 97)) mod 97, sur 2 chiffres, puis « FR » + clé + SIREN.
// Le répertoire officiel des entreprises ne renvoie pas ce numéro : il est toujours calculé.

export function sirenFrom(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length >= 9 ? digits.slice(0, 9) : null
}

export function tvaFromSiren(value) {
  const siren = sirenFrom(value)
  if (!siren) return ''
  const key = (12 + 3 * (Number(siren) % 97)) % 97
  return 'FR' + String(key).padStart(2, '0') + siren
}

export function pappersUrl(value) {
  const siren = sirenFrom(value)
  return siren ? 'https://www.pappers.fr/entreprise/' + siren : null
}
