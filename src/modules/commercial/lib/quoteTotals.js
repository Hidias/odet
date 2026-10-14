// Totaux d'un devis.
// Code sorti tel quel de pages/Quotes.jsx pour pouvoir être testé (tests/totaux.test.js).

export function calcItemTotal(item) {
  return parseFloat(item.quantity || 0) * parseFloat(item.unit_price_ht || 0)
}

export function calcTotals(itemsList, discountPercent, tvaRate, tvaApplicable) {
  const subtotalHt = itemsList.reduce((sum, item) => sum + calcItemTotal(item), 0)
  const discountAmount = subtotalHt * (parseFloat(discountPercent || 0) / 100)
  const totalHt = subtotalHt - discountAmount
  const totalTva = tvaApplicable ? totalHt * (parseFloat(tvaRate || 20) / 100) : 0
  return { subtotalHt, discountAmount, totalHt, totalTva, totalTtc: totalHt + totalTva }
}
