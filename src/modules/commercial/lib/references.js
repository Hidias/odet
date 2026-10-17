// Numérotation des factures, avoirs et devis.
// Partie calcul sortie telle quelle de pages/Invoices.jsx et pages/Quotes.jsx pour pouvoir être testée
// (tests/references.test.js). La lecture de la dernière référence en base reste dans les pages.
import { format } from 'date-fns'

// Factures et avoirs : FACT-AAAAMMJJ-NNNNN / AVR-AAAAMMJJ-NNNNN.
// Le numéro suit la dernière référence du même type, tous jours confondus.
export const invoicePrefix = (type = 'invoice') => (type === 'credit_note' ? 'AVR' : 'FACT')

export function nextInvoiceReference(lastReference, type = 'invoice', date = new Date()) {
  const pfx = invoicePrefix(type), ds = format(date, 'yyyyMMdd')
  let seq = 1
  if (lastReference) { const m = lastReference.match(/-(\d+)$/); if (m) seq = parseInt(m[1]) + 1 }
  return pfx + '-' + ds + '-' + String(seq).padStart(5, '0')
}

// Devis : DEV-AAAAMMJJ-NNNNN, numéro remis à 1 chaque jour.
export const quoteDay = (date = new Date()) => format(date, 'yyyyMMdd')

export function nextQuoteReference(lastReference, date = new Date()) {
  const today = quoteDay(date)
  let nextNum = 1
  if (lastReference) {
    const parts = lastReference.split('-')
    nextNum = parseInt(parts[2] || '0') + 1
  }
  return `DEV-${today}-${String(nextNum).padStart(5, '0')}`
}
