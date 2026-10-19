// Calcul unique des totaux des factures, avoirs et devis.
// Utilisé par l'écran, le PDF, le Factur-X (api/generate-facturx.js) et les factures préparées
// depuis une visite d'intervention : une seule règle, donc plus d'écart d'un centime.
//
// Règle (celle de la norme EN 16931, BR-CO-10 à BR-CO-16) :
// 1. total de chaque ligne = quantité × prix unitaire HT, arrondi au centime ;
// 2. lignes regroupées par taux de TVA ; remise globale appliquée à chaque groupe et arrondie ;
// 3. TVA de chaque groupe = base nette × taux, arrondie au centime ;
// 4. total TTC = total HT net + total TVA.
// Un taux de 0 % est un vrai taux : il n'est jamais remplacé par le taux par défaut.

export const DEFAULT_VAT_RATE = 20

export function round2(v) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100
}

function num(v) {
  if (typeof v === 'string') v = v.replace(',', '.')
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/** Taux de TVA d'une ligne : la valeur saisie (0 compris), sinon le taux par défaut. */
export function parseRate(v, fallback = DEFAULT_VAT_RATE) {
  if (v === null || v === undefined || String(v).trim() === '') return fallback
  const n = parseFloat(String(v).replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Total HT d'une ligne, arrondi au centime. */
export function lineTotal(item) {
  return round2(num(item?.quantity) * num(item?.unit_price_ht))
}

/**
 * Totaux d'un document.
 * @param {Array} items lignes { quantity, unit_price_ht, tva_rate }
 * @param {Object} opts { discountPercent, vatApplicable, defaultRate }
 * Catégorie de TVA (Factur-X) : S = taux positif, E = exonéré ou taux nul, ou TVA non applicable.
 */
export function computeDocumentTotals(items, opts = {}) {
  const dp = num(opts.discountPercent)
  const vatApplicable = opts.vatApplicable !== false
  const defaultRate = opts.defaultRate === undefined ? DEFAULT_VAT_RATE : opts.defaultRate
  const lines = (items || []).map((it) => {
    const rate = vatApplicable ? parseRate(it?.tva_rate, defaultRate) : 0
    return { it, q: num(it?.quantity), pu: num(it?.unit_price_ht), rate, cat: rate > 0 ? 'S' : 'E', net: lineTotal(it) }
  })
  const groups = new Map()
  for (const l of lines) {
    const key = `${l.cat}|${l.rate}`
    if (!groups.has(key)) groups.set(key, { cat: l.cat, rate: l.rate, lines: 0 })
    groups.get(key).lines = round2(groups.get(key).lines + l.net)
  }
  let allowanceTotal = 0
  let taxTotal = 0
  const breakdown = [...groups.values()].map((g) => {
    const allowance = dp > 0 ? round2(g.lines * dp / 100) : 0
    const base = round2(g.lines - allowance)
    const tax = g.cat === 'S' ? round2(base * g.rate / 100) : 0
    allowanceTotal = round2(allowanceTotal + allowance)
    taxTotal = round2(taxTotal + tax)
    return { ...g, allowance, base, tax }
  })
  const lineSum = round2(lines.reduce((s, l) => s + l.net, 0))
  const taxBasis = round2(lineSum - allowanceTotal)
  const grandTotal = round2(taxBasis + taxTotal)
  return { dp, vatApplicable, lines, breakdown, lineTotal: lineSum, allowanceTotal, taxBasis, taxTotal, grandTotal }
}
