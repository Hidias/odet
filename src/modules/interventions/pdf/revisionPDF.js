// Courrier de révision annuelle du prix d'un contrat de maintenance (0462) : indice, valeurs, calcul, nouveau prix.
import { jsPDF } from 'jspdf'
import 'jspdf-autotable'
import { startDocument, numberPages } from '../../../core/pdf/layout'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { orgHorsFormation } from '../../../core/org/orgUtils'
import { dateFr } from '../lib/contrat'

const euros = (n) => `${Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € HT`
const nombre = (n) => Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 4 })
const mois = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : '')

export async function buildRevisionPDF({ contract, client, revision, org = null }) {
  const ORG = orgHorsFormation(org || await loadPdfOrg())
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, { ref: contract.reference || null, docLabel: 'Révision du prix', code: 'REV', title: 'Révision annuelle du prix', subtitle: contract.label || 'Contrat de maintenance' })
  f.cards([{ label: 'Client', lines: [client?.name || '', client?.address || '', [client?.postal_code, client?.city].filter(Boolean).join(' ')].filter(Boolean) }])
  f.para(`Conformément à la clause de révision de votre contrat, le prix annuel est révisé à la date anniversaire du ${dateFr(revision.anniversary)}, selon la formule P = P0 × I / I0.`, { after: 3 })
  f.kv([
    ['Indice', [contract.index_label, contract.index_series ? `série ${contract.index_series}` : null].filter(Boolean).join(', ') || 'Indice du contrat'],
    ['Valeur de référence (I0)', `${nombre(contract.index_base_value)}${contract.index_base_month ? `, ${mois(contract.index_base_month)}` : ''}`],
    ['Nouvelle valeur (I)', `${nombre(revision.new_value)}${revision.new_value_month ? `, ${mois(revision.new_value_month)}` : ''}`],
    ['Prix de référence (P0)', euros(contract.base_price_ht)],
    ['Prix annuel révisé (P)', euros(revision.price_after)],
  ], { labelW: 50 })
  f.para(`Le nouveau prix s'applique aux échéances à compter du ${dateFr(revision.anniversary)}. Nous restons à votre disposition pour toute question.`, { after: 6 })
  f.signOff()
  numberPages(doc, ORG)
  return { base64: doc.output('datauristring').split(',')[1], filename: `Revision_prix_${(client?.name || 'client').replace(/[^A-Za-z0-9]+/g, '_')}_${String(revision.anniversary).slice(0, 4)}.pdf` }
}
