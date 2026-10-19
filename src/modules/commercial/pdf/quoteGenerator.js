import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { format } from 'date-fns'
import { buildORG, prepareOrgForPDF } from '../../../core/org/orgUtils'
import { renderCommercialDoc, itemRow, fmtEuro, fmtRate, issuerLines, recipientLines, companyLegalLine, bankRows } from './commercialLayout'

// Devis et bon de commande partiel sur la mise en page commune des documents.
// Identité de l'organisme : uniquement depuis organization_settings (options.orgSettings).

function fmtDate(d) {
  if (!d) return ''
  return format(new Date(d), 'dd/MM/yyyy')
}

// Contact affiché sur le document : la personne connectée (options.contactPerson), sinon l'organisme
function contactFor(L, options) {
  const p = options && options.contactPerson
  if (p && p.name) return { name: p.name, phone: p.phone || L.phone, email: p.email || L.email }
  return { name: '', phone: L.phone, email: L.email }
}

async function orgFor(orgSettings) {
  const prepared = (await prepareOrgForPDF(orgSettings || {})) || orgSettings || {}
  return { ...prepared, ...buildORG(prepared) }
}

function totalsFor(quote, items) {
  const subtotalHt = items.reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price_ht) || 0), 0)
  const dp = parseFloat(quote.discount_percent) || 0
  const discountAmt = subtotalHt * dp / 100
  const totalHt = subtotalHt - discountAmt
  const rate = (quote.tva_rate === null || quote.tva_rate === undefined || quote.tva_rate === '') ? 20 : (parseFloat(quote.tva_rate) || 0)
  const tvaOn = quote.tva_applicable !== false
  const totalTva = tvaOn ? totalHt * rate / 100 : 0
  const rows = [{ label: 'Total HT', value: fmtEuro(subtotalHt) }]
  if (dp > 0) {
    rows.push({ label: (quote.discount_label || 'Remise') + ' (' + fmtRate(dp) + ')', value: '-' + fmtEuro(discountAmt), muted: true })
    rows.push({ label: 'Total net HT', value: fmtEuro(totalHt), bold: true })
  }
  rows.push(tvaOn ? { label: 'TVA ' + fmtRate(rate), value: fmtEuro(totalTva) } : { label: 'TVA', value: 'non applicable', muted: true })
  rows.push({ label: 'Total TTC', value: fmtEuro(totalHt + totalTva), grand: true })
  return rows
}

async function buildQuoteDoc(quote, items, client, contact, options, partial) {
  options = options || {}
  const L = await orgFor(options.orgSettings)
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const cb = contactFor(L, options)
  const tvaOn = quote.tva_applicable !== false

  const payment = [
    ['Validité', quote.validity_date ? "jusqu'au " + fmtDate(quote.validity_date) : null],
    ['Mode', quote.payment_method || 'virement bancaire'],
    ['Délai', quote.payment_terms || 'à 30 jours'],
    ['Échéance', quote.payment_deadline ? fmtDate(quote.payment_deadline) : null],
    ...bankRows(L),
  ].filter(r => r[1])

  // Mentions du devis : pénalités au taux BCE + 10 points (L441-10) et indemnité de 40 € seulement envers un
  // professionnel ; pas de mention d'exigibilité de la TVA sur un devis (elle dépend des lignes : biens ou services,
  // et de l'option sur les débits ; la facture la porte, calculée par la base) ; l'exonération de TVA de la formation
  // (261-4-4° du CGI) seulement pour un devis de formation
  const particulier = client && client.client_type === 'particulier'
  const formation = (items || []).some(it => !!it.course_id) || !!quote.session_id
  const legal = [
    particulier ? null : "En cas de retard de paiement, des pénalités sont exigibles au taux de la Banque centrale européenne majoré de 10 points, ainsi qu'une indemnité forfaitaire de 40 € pour frais de recouvrement (art. L441-10 du Code de commerce).",
    tvaOn ? null : (formation ? 'TVA non applicable, article 261-4-4° du CGI.' : 'TVA non applicable.'),
    companyLegalLine(L),
  ].filter(Boolean)

  renderCommercialDoc(doc, L, {
    formation,
    ref: partial ? quote.reference + '-P' : quote.reference,
    docLabel: partial ? 'Bon de commande' : 'Devis',
    code: partial ? 'BDC' : 'DEV',
    title: partial ? 'Bon de commande partiel' : 'Devis',
    subtitle: partial ? 'Lignes acceptées du devis ' + quote.reference + ' du ' + fmtDate(quote.quote_date) + ', montants recalculés sur ces seules lignes' : null,
    issuerLabel: 'Émetteur',
    issuerLines: issuerLines(L, cb),
    recipientLabel: 'Client',
    recipientLines: recipientLines(client, contact, true),
    meta: [
      ['N° de devis', quote.reference],
      ['Date', fmtDate(quote.quote_date)],
      ['Valable jusqu\'au', quote.validity_date ? fmtDate(quote.validity_date) : null],
      ['Réf. client', quote.client_reference || null],
    ],
    object: quote.object || null,
    rows: items.map(itemRow),
    totals: totalsFor(quote, items),
    notes: quote.notes || null,
    signature: {
      label: 'Bon pour accord du client',
      hint: 'Nom, fonction, date, signature, cachet et mention « Lu et approuvé, bon pour accord »',
      image: quote.signature_base64 || null,
    },
    payment,
    legal,
  })
  return doc
}

// ============================================================
// DEVIS
// ============================================================
export async function generateQuotePDF(quote, items, client, contact, options) {
  options = options || {}
  const doc = await buildQuoteDoc(quote, items || [], client, contact || null, options, false)
  if (!options.skipSave) doc.save(quote.reference + '.pdf')
  return doc
}

// ============================================================
// ACCEPTATION PARTIELLE - BON DE COMMANDE
// ============================================================
export async function generatePartialAcceptancePDF(quote, allItems, client, contact, options) {
  options = options || {}
  const acceptedItems = (allItems || []).filter(it => it.accepted === true)
  if (acceptedItems.length === 0) {
    throw new Error('Aucune ligne acceptée dans ce devis')
  }
  const doc = await buildQuoteDoc(quote, acceptedItems, client, contact || null, options, true)
  if (!options.skipSave) doc.save(quote.reference + '-PARTIEL.pdf')
  return doc
}
