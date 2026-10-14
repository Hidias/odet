// Calcul des dates d'échéance de facture.
// Code sorti tel quel de pages/Invoices.jsx pour pouvoir être testé (tests/echeances.test.js).
// Le comportement est inchangé : seul l'emplacement a changé.
import { format, addDays } from 'date-fns'

// Échéance à partir d'aujourd'hui (création de facture depuis une session, un devis, un client).
// « fin de mois » : date + délai, puis dernier jour de ce mois-là.
export const calcDueDate = (terms) => {
  const daysMap = { 'À réception de facture': 0, 'à 30 jours': 30, 'à 30 jours fin de mois': 30, 'à 45 jours': 45, 'à 45 jours fin de mois': 45, 'à 60 jours': 60, 'à 60 jours fin de mois': 60 }
  const days = daysMap[terms] ?? 30
  let d = addDays(new Date(), days)
  if (terms?.includes('fin de mois')) { d = new Date(d.getFullYear(), d.getMonth() + 1, 0) }
  return format(d, 'yyyy-MM-dd')
}

// Échéance recalculée quand on change le délai de règlement dans le formulaire de facture,
// à partir de la date de la facture.
export const dueDateFromInvoiceDate = (t, invoiceDate) => {
  let d = 30
  if (t.includes('réception')) d = 0; else if (t.includes('45')) d = 45; else if (t.includes('60')) d = 60
  let dueD = addDays(new Date(invoiceDate || new Date()), d)
  if (t.includes('fin de mois')) { dueD = new Date(dueD.getFullYear(), dueD.getMonth() + 1, 0) }
  return format(dueD, 'yyyy-MM-dd')
}
