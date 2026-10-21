// Règle de la subrogation OPCO (fin au 1er octobre 2026, décision de H du 21/10 : appliquer les nouvelles règles).
// Les OPCO deviennent assujettis à la TVA : l'organisme facture l'entreprise TTC, l'OPCO la rembourse HT. Restent en
// subrogation : l'apprentissage, et le plan de développement des compétences des entreprises de moins de 50 salariés
// (hors cofinancement), sur demande de l'entreprise. C'est la date de l'accord de prise en charge qui compte.
// La date propre à un OPCO (fiche client « fin de la subrogation ») passe avant la date générale.

export const FIN_SUBROGATION = '2026-10-01'

/** Effectif d'un client : { min, max } ou null (code de tranche INSEE, ou texte « 20-49 », « 50 à 99 salariés ») */
export function trancheEffectif(client) {
  const code = String(client?.taille_entreprise || '').trim()
  const parCode = { '00': [0, 0], '01': [1, 2], '02': [3, 5], '03': [6, 9], '11': [10, 19], '12': [20, 49], '21': [50, 99], '22': [100, 199], '31': [200, 249], '32': [250, 499], '41': [500, 999], '42': [1000, 1999], '51': [2000, 4999], '52': [5000, 9999], '53': [10000, Infinity] }
  if (parCode[code]) return { min: parCode[code][0], max: parCode[code][1] }
  const t = String(client?.effectif || '')
  const n = (t.match(/\d[\d\s]*/g) || []).map((x) => Number(x.replace(/\s/g, ''))).filter((x) => Number.isFinite(x))
  if (!n.length) return null
  if (/plus de|\+|et plus/i.test(t) && n.length === 1) return { min: n[0], max: Infinity }
  return { min: n[0], max: n.length > 1 ? n[1] : n[0] }
}

/**
 * Subrogation possible pour un accord donné ?
 * @returns {{ etat: 'possible'|'sur_demande'|'impossible'|'a_verifier', message: string }}
 */
export function subrogationPossible({ client, dateAccord, finOpco = null, apprentissage = false, cofinancement = false }) {
  if (apprentissage) return { etat: 'possible', message: 'Apprentissage : l\'OPCO paie l\'organisme directement.' }
  const fin = finOpco || FIN_SUBROGATION
  if (dateAccord && dateAccord < fin) {
    return { etat: 'possible', message: `Accord daté d'avant le ${frDate(fin)} : ancien circuit, la subrogation reste possible si l'accord la prévoit.` }
  }
  const tranche = trancheEffectif(client)
  const tvaAvance = 'L\'organisme facture l\'entreprise TTC ; l\'entreprise paie et l\'OPCO la rembourse HT.'
  if (cofinancement) return { etat: 'impossible', message: `Formation cofinancée : plus de subrogation pour les accords depuis le ${frDate(fin)}. ${tvaAvance}` }
  if (!tranche) return { etat: 'a_verifier', message: `Effectif inconnu : la subrogation n'est possible que pour une entreprise de moins de 50 salariés (plan de développement des compétences), sur sa demande. Sinon : ${tvaAvance}` }
  if (tranche.max < 50) return { etat: 'sur_demande', message: 'Moins de 50 salariés : subrogation possible sur le plan de développement des compétences, si l\'entreprise la demande à son OPCO.' }
  if (tranche.min >= 50) return { etat: 'impossible', message: `50 salariés ou plus : plus de subrogation pour les accords depuis le ${frDate(fin)}. ${tvaAvance}` }
  return { etat: 'a_verifier', message: `Effectif à préciser (autour de 50 salariés). ${tvaAvance}` }
}

function frDate(iso) {
  const [a, m, j] = String(iso).slice(0, 10).split('-')
  return `${j}/${m}/${a}`
}
