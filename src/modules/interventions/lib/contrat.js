// Conditions d'un contrat de maintenance (0460, lot 1 des contrats, décisions de H du 27/10/2026).
// Une seule règle pour le devis (bloc « Contrat »), son PDF, la fiche du contrat et le contrat PDF.
// Les mêmes calculs sont faits en base (échéance, date limite de refus) : garder les deux identiques.

export const DUREES = [1, 3, 5]
export const PERIODICITES = [
  ['mensuel', 'Mensuelle'], ['trimestriel', 'Trimestrielle'], ['annuel', 'Annuelle'], ['visite', 'À chaque visite'],
]
export const CODE_FRAIS_CONTRAT = 'FRAIS-CONTRAT'

const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const lire = (s) => { const [y, m, j] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, j, 12) }
export const dateFr = (s) => (s ? lire(s).toLocaleDateString('fr-FR') : '')

/** Conditions complètes d'un devis, avec les valeurs par défaut de l'entreprise (préavis, reconduction) */
export function conditionsDevis(contrat = {}, reglages = {}, client = null) {
  const c = contrat || {}
  return {
    duree_ans: DUREES.includes(Number(c.duree_ans)) ? Number(c.duree_ans) : 1,
    reconduction: c.reconduction !== false,
    reconduction_ans: Number(c.reconduction_ans) || Number(reglages?.contrat_reconduction_ans) || 1,
    preavis_mois: Number.isFinite(Number(c.preavis_mois)) && c.preavis_mois !== '' && c.preavis_mois !== null
      ? Number(c.preavis_mois) : (Number.isFinite(Number(reglages?.contrat_preavis_mois)) ? Number(reglages.contrat_preavis_mois) : 3),
    // Client public : trimestriel proposé par défaut (décision 4.2)
    periodicite: c.periodicite || (client?.client_type === 'public' ? 'trimestriel' : 'annuel'),
    mois_visite: Array.isArray(c.mois_visite) ? c.mois_visite.map(Number).filter((m) => m >= 1 && m <= 12) : [],
  }
}

export const libellePeriodicite = (p) => (PERIODICITES.find(([k]) => k === p) || [null, ''])[1]
const ans = (n) => `${n} an${n > 1 ? 's' : ''}`

/** Phrase des conditions, reprise sur le devis et le contrat */
export function phraseConditions(c) {
  if (!c) return ''
  const k = conditionsDevis(c)
  const reconduction = k.reconduction
    ? `reconduit tacitement par périodes de ${ans(k.reconduction_ans)}, sauf refus notifié au moins ${k.preavis_mois} mois avant l'échéance`
    : `non reconduit à son terme`
  return `Contrat de maintenance d'une durée de ${ans(k.duree_ans)}, ${reconduction}. Facturation ${libellePeriodicite(k.periodicite).toLowerCase()}.`
}

/** Montant des frais d'établissement réglé pour une durée ; null si aucun montant saisi */
export function fraisEtablissement(reglages, duree) {
  const v = reglages?.contrat_frais_etablissement?.[String(duree)]
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

/**
 * Lignes du devis avec la ligne de frais d'établissement à jour : ajoutée si un montant est réglé pour la durée,
 * prix mis à jour quand la durée change, retirée si aucun montant. Une ligne supprimée à la main n'est pas remise
 * (retiree = true).
 */
export function lignesAvecFrais(items, reglages, duree, { retiree = false, base = {} } = {}) {
  const montant = fraisEtablissement(reglages, duree)
  const i = (items || []).findIndex((it) => it.code === CODE_FRAIS_CONTRAT)
  if (montant === null || retiree) return i >= 0 && montant === null ? items.filter((_, j) => j !== i) : items
  const ligne = {
    ...base, ...(i >= 0 ? items[i] : {}), code: CODE_FRAIS_CONTRAT,
    description_title: `Frais d'établissement du contrat (${ans(duree)})`, quantity: 1, unit: 'forfait',
    unit_price_ht: montant, nature: 'service', metier: 'maintenance',
  }
  if (i >= 0) return items.map((it, j) => (j === i ? ligne : it))
  return [...(items || []), { ...ligne, position: (items || []).length }]
}

/** Échéance de la première période : veille de la date anniversaire */
export function echeanceInitiale(debut, duree) {
  const d = lire(debut)
  // 29 février : PostgreSQL donne le 28 février de l'année d'arrivée
  const jour = d.getDate()
  d.setDate(1)
  d.setFullYear(d.getFullYear() + (Number(duree) || 1))
  d.setDate(Math.min(jour, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  d.setDate(d.getDate() - 1)
  return iso(d)
}

/** Dernier jour pour refuser la reconduction : lendemain de l'échéance moins le préavis, moins un jour */
export function limiteRefus(echeance, preavisMois) {
  if (!echeance) return null
  const d = lire(echeance)
  d.setDate(d.getDate() + 1)
  // Comme PostgreSQL : le 31 mai moins 3 mois donne le 28 (ou 29) février, pas le 3 mars
  const jour = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() - (Number(preavisMois) || 0))
  const dernier = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(jour, dernier))
  d.setDate(d.getDate() - 1)
  return iso(d)
}

export const STATUTS_CONTRAT = { a_valider: ['badge-warning', 'À valider'], actif: ['badge-success', 'Actif'], suspendu: ['badge-neutral', 'Suspendu'], termine: ['badge-neutral', 'Terminé'] }

/** Le devis propose-t-il un contrat de maintenance ? Métier « maintenance » ou une ligne de maintenance */
export function devisAvecContrat(quote, items, metierDevis, metiersDesLignes) {
  return metierDevis(quote, items) === 'maintenance' || metiersDesLignes(items, quote).includes('maintenance')
}
