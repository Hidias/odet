// Totaux d'un devis : même calcul que les factures (src/core/billing/totals.js).
// Le devis porte un taux de TVA unique (quotes.tva_rate), appliqué à ses lignes au régime normal ; une ligne exonérée
// ou autoliquidée est à 0 % (régime de la ligne, 0363). 0 % est respecté.

import { computeDocumentTotals, lineTotal, parseRate } from '../../../core/billing/totals'

export function calcItemTotal(item) {
  return lineTotal(item)
}

export function calcTotals(itemsList, discountPercent, tvaRate, tvaApplicable) {
  const rate = parseRate(tvaRate)
  const t = computeDocumentTotals((itemsList || []).map((it) => ({ ...it, tva_rate: it.vat_regime && it.vat_regime !== 'normal' ? 0 : rate })), {
    discountPercent,
    vatApplicable: !!tvaApplicable,
  })
  return { subtotalHt: t.lineTotal, discountAmount: t.allowanceTotal, totalHt: t.taxBasis, totalTva: t.taxTotal, totalTtc: t.grandTotal }
}
