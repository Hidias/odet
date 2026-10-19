import { apiFetch } from '../../../core/api'
import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { format } from 'date-fns'
import { LiberationSans_Regular } from '../../../core/pdf/fonts/LiberationSans-Regular.js'
import { LiberationSans_Bold } from '../../../core/pdf/fonts/LiberationSans-Bold.js'
import { buildORG } from '../../../core/org/orgUtils'
import { computeDocumentTotals, round2 } from '../../../core/billing/totals'
import { renderCommercialDoc, itemRow, fmtMoney, fmtEuro, fmtRate, issuerLines, recipientLines, companyLegalLine, bankRows } from './commercialLayout'

// Facture et avoir sur la mise en page commune des documents.
// Polices Liberation Sans intégrées et logo aplati sur fond blanc : le PDF reste valide PDF/A-3b
// pour l'enveloppe Factur-X (/api/generate-facturx).
// Identité de l'organisme : uniquement depuis organization_settings (options.orgSettings).

function applyOrgSettings(orgSettings) {
  return buildORG(orgSettings || {})
}

// Contact affiché sur le document : la personne connectée (options.contactPerson), sinon l'organisme
function contactFor(L, options) {
  const p = options && options.contactPerson
  if (p && p.name) return { name: p.name, phone: p.phone || L.phone, email: p.email || L.email }
  return { name: '', phone: L.phone, email: L.email }
}

function fd(d) {
  if (!d) return ''
  return format(new Date(d), 'dd/MM/yyyy')
}

// ============================================================
// LOGO (aplati sur fond blanc : pas de canal alpha, exigence PDF/A)
// ============================================================
var logoCache = null
var logoCacheKey = null

async function loadLogo(L) {
  var src = L.logo_base64 || L.logo_url
  if (!src) return null
  if (logoCache && logoCacheKey === src) return logoCache
  try {
    var r = await fetch(src)
    var b = await r.blob()
    var dataUrl = await new Promise(function (res) {
      var rd = new FileReader()
      rd.onload = function () { res(rd.result) }
      rd.readAsDataURL(b)
    })
    var flat = await new Promise(function (res) {
      var img = new Image()
      img.onload = function () {
        var canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        var ctx = canvas.getContext('2d')
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0)
        res(canvas.toDataURL('image/png'))
      }
      img.onerror = function () { res(null) }
      img.src = dataUrl
    })
    if (flat) { logoCache = flat; logoCacheKey = src }
    return flat
  } catch (e) {
    return null
  }
}

// ============================================================
// CALCULS PARTAGES
// ============================================================
// Totaux : calcul unique de src/core/billing/totals.js (arrondi au centime par ligne puis par taux,
// taux de 0 % respecté), même résultat que le Factur-X.
export function calcInvoiceTotals(items, discountPercent, tvaApplicable) {
  var t = computeDocumentTotals(items || [], { discountPercent: discountPercent, vatApplicable: tvaApplicable !== false })
  var tvaByRate = {}
  t.breakdown.forEach(function (g) {
    var k = String(g.rate)
    if (!tvaByRate[k]) tvaByRate[k] = { base: 0, tva: 0 }
    tvaByRate[k].base = round2(tvaByRate[k].base + g.base)
    tvaByRate[k].tva = round2(tvaByRate[k].tva + g.tax)
  })
  return {
    subtotalHt: t.lineTotal,
    discountAmt: t.allowanceTotal,
    netHt: t.taxBasis,
    totalTva: t.taxTotal,
    totalTtc: t.grandTotal,
    tvaByRate: tvaByRate
  }
}

// ============================================================
// GENERATION PDF FACTURE / AVOIR
// ============================================================
// Document non émis : pas de date d'émission. Les documents d'avant la numérotation par la base (sans le champ) suivent
// leur statut.
export function isDraftDoc(invoice) {
  if (!invoice) return true
  if (Object.prototype.hasOwnProperty.call(invoice, 'issued_at')) return !invoice.issued_at
  return invoice.status === 'draft'
}

export async function generateInvoicePDF(invoice, items, client, contact, options) {
  options = options || {}
  contact = contact || null
  var L = applyOrgSettings(options.orgSettings)
  var isCredit = invoice.type === 'credit_note'
  var doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.addFileToVFS('LiberationSans-Regular.ttf', LiberationSans_Regular)
  doc.addFont('LiberationSans-Regular.ttf', 'LiberationSans', 'normal')
  doc.addFileToVFS('LiberationSans-Bold.ttf', LiberationSans_Bold)
  doc.addFont('LiberationSans-Bold.ttf', 'LiberationSans', 'bold')
  doc.__odetFont = 'LiberationSans'
  doc.setFont('LiberationSans', 'normal')

  var logo = options.logoOverride !== undefined ? options.logoOverride : await loadLogo(L)
  L = Object.assign({}, L, { logo_base64: logo || null })

  var cb = contactFor(L, options)
  var billingClient = options.billingClient || null
  var displayClient = billingClient || client

  var totals = calcInvoiceTotals(items, invoice.discount_percent, invoice.tva_applicable)
  var tvaOn = invoice.tva_applicable !== false
  var rates = Object.keys(totals.tvaByRate)

  var totalRows = []
  totalRows.push({ label: 'Total HT', value: fe(totals.subtotalHt) })
  if (totals.discountAmt > 0) {
    totalRows.push({ label: (invoice.discount_label || 'Remise') + ' (' + fmtRate(invoice.discount_percent) + ')', value: '-' + fe(totals.discountAmt), muted: true })
    totalRows.push({ label: 'Total net HT', value: fe(totals.netHt), bold: true })
  }
  if (tvaOn) rates.forEach(function (r) { totalRows.push({ label: 'TVA ' + fmtRate(r), value: fe(totals.tvaByRate[r].tva) }) })
  else totalRows.push({ label: 'TVA', value: 'non applicable', muted: true })
  totalRows.push({ label: isCredit ? "Montant de l'avoir TTC" : 'Total TTC', value: fe(totals.totalTtc), grand: true })
  if (!isCredit) {
    var paid = (parseFloat(invoice.amount_paid) || 0) + (parseFloat(invoice.amount_credited) || 0)
    if (paid > 0.004) totalRows.push({ label: 'Déjà réglé', value: '-' + fe(paid), muted: true })
    totalRows.push({ label: 'Reste à régler', value: fe(totals.totalTtc - paid), due: true })
  }

  var vatRecap = tvaOn && rates.length > 1 ? rates.map(function (r) {
    return [fmtRate(r), fe(totals.tvaByRate[r].base), fe(totals.tvaByRate[r].tva)]
  }) : []

  var payment = []
  var legal = []
  if (isCredit) {
    var refundDue = parseFloat(invoice.amount_due) || 0
    if (invoice.status !== 'draft' && refundDue > 0.01) {
      payment.push(['Montant', fe(refundDue)])
      payment.push(['Mode', invoice.payment_method || 'virement bancaire'])
    }
    legal.push('Avoir émis en régularisation de la facture ' + (invoice.parent_reference || '') + (invoice.parent_invoice_date ? ' du ' + fd(invoice.parent_invoice_date) : '') + '. Son montant vient en déduction des sommes dues au titre de cette facture.')
  } else {
    payment.push(['Mode', invoice.payment_method || 'virement bancaire'])
    payment.push(['Délai', invoice.payment_terms || 'à 30 jours'])
    if (invoice.due_date) payment.push(['Échéance', fd(invoice.due_date)])
    bankRows(L).forEach(function (r) { payment.push(r) })
    if (!Array.isArray(invoice.legal_mentions)) legal.push("En cas de retard de paiement, des pénalités sont exigibles au taux de la Banque centrale européenne majoré de 10 points, ainsi qu'une indemnité forfaitaire de 40 € pour frais de recouvrement (art. L441-10 du Code de commerce). Pas d'escompte pour paiement anticipé.")
  }
  // Mentions légales : celles figées à l'émission (ou calculées par la base pour l'aperçu d'un brouillon, 0363).
  // Documents d'avant 0363 sans mentions figées : texte d'origine, inchangé.
  if (Array.isArray(invoice.legal_mentions)) invoice.legal_mentions.forEach(function (m) { if (m) legal.push(String(m)) })
  else legal.push(tvaOn ? "TVA exigible d'après les encaissements (article 269, 2-c du CGI)." : "TVA non applicable, article 261-4-4° du CGI.")
  if (invoice.nature_operation) legal.push('Nature de l\'opération : ' + ({ services: 'prestations de services', biens: 'livraisons de biens', mixte: 'livraisons de biens et prestations de services' }[invoice.nature_operation] || invoice.nature_operation) + '.')
  legal.push(companyLegalLine(L))

  var subtitle = null
  if (invoice.parent_reference) subtitle = (isCredit ? 'Avoir sur la facture ' : 'Document parent : ') + invoice.parent_reference

  renderCommercialDoc(doc, L, {
    ref: isDraftDoc(invoice) ? 'Brouillon' : invoice.reference,
    docLabel: isCredit ? 'Avoir' : invoice.invoice_kind === 'acompte' ? "Facture d'acompte" : 'Facture',
    code: isCredit ? 'AVR' : 'FACT',
    title: isCredit ? 'Avoir' : invoice.invoice_kind === 'acompte' ? "Facture d'acompte" : invoice.invoice_kind === 'solde' ? 'Facture de solde' : 'Facture',
    subtitle: subtitle,
    issuerLabel: 'Émetteur',
    issuerLines: issuerLines(L, cb),
    recipientLabel: billingClient ? 'Facturé à (subrogation)' : (isCredit ? 'Destinataire' : 'Facturé à'),
    recipientLines: recipientLines(displayClient, contact, !billingClient),
    forAccountOf: billingClient && client ? [client.name, client.siret ? 'SIRET ' + client.siret : (client.siren ? 'SIREN ' + client.siren : null)] : null,
    meta: [
      ['N° ' + (isCredit ? "d'avoir" : 'de facture'), isDraftDoc(invoice) ? 'attribué à l\'émission' : invoice.reference],
      ['Date', fd(invoice.invoice_date)],
      [isCredit ? null : 'Échéance', isCredit ? null : fd(invoice.due_date)],
      ['Période de service', invoice.service_start_date ? fd(invoice.service_start_date) + (invoice.service_end_date && invoice.service_end_date !== invoice.service_start_date ? ' au ' + fd(invoice.service_end_date) : '') : null],
      [invoice.invoice_kind === 'acompte' && invoice.deposit_paid_on ? 'Date du versement' : null, invoice.invoice_kind === 'acompte' && invoice.deposit_paid_on ? fd(invoice.deposit_paid_on) : null],
      ['Réf. client', invoice.client_reference || null],
      ['Session', invoice.session_reference || null],
    ],
    object: invoice.object || null,
    // Nature de l'opération : déjà dans les mentions quand elle est connue (biens, services ou mixte) ; jamais figée
    nature: invoice.nature_operation ? null : "Nature de l'opération : prestation de services",
    // Identité de formation (NDA, Qualiopi) seulement pour une facture de formation professionnelle ; une facture de
    // maintenance ou de matériel (case décochée) ne les porte pas
    formation: invoice.is_formation_pro !== false,
    rows: items.map(itemRow),
    totals: totalRows,
    vatRecap: vatRecap,
    payment: payment,
    paymentTitle: isCredit ? 'Remboursement' : 'Règlement',
    legal: legal,
  })

  // Brouillon (pas encore émis par la base) : filigrane sur chaque page, aucun numéro (décision du 17/10)
  if (isDraftDoc(invoice)) {
    var nPages = doc.getNumberOfPages()
    for (var pg = 1; pg <= nPages; pg++) {
      doc.setPage(pg)
      doc.saveGraphicsState && doc.saveGraphicsState()
      if (doc.GState) doc.setGState(new doc.GState({ opacity: 0.18 }))
      doc.setFont(doc.__odetFont || 'helvetica', 'bold')
      doc.setFontSize(54)
      doc.setTextColor(150, 0, 0)
      doc.text('BROUILLON, sans valeur', 105, 160, { align: 'center', angle: 35 })
      doc.restoreGraphicsState && doc.restoreGraphicsState()
    }
    doc.setTextColor(0, 0, 0)
  }
  if (!options.skipSave) {
    doc.save((isDraftDoc(invoice) ? 'brouillon' : invoice.reference) + '.pdf')
  }

  return doc
}

function fe(v) { return fmtEuro(v) }

// ============================================================
// GENERATION FACTUR-X (PDF/A-3 + XML CII EN16931)
// Nécessite l'endpoint Vercel /api/generate-facturx
// ============================================================

/**
 * Génère et télécharge une facture au format Factur-X (PDF/A-3b).
 * Le PDF visuel est généré localement par jsPDF (inchangé),
 * puis envoyé à /api/generate-facturx qui y embarque le XML CII.
 *
 * @param {Object} invoice   - Objet facture complet (avec id)
 * @param {Array}  items     - Lignes de facture
 * @param {Object} client    - Client (name, address, siret…)
 * @param {Object} contact   - Contact (optionnel)
 * @param {Object} options   - Options passées à generateInvoicePDF
 * @param {Object} billingClient - Client OPCO si subrogation (optionnel)
 * @returns {Promise<void>}
 */
export async function generateFacturXPDF(invoice, items, client, contact, options, billingClient) {
  applyOrgSettings(options?.orgSettings)
  contact = contact || null
  options = options || {}

  // 1. Générer le PDF visuel jsPDF (skipSave = true pour avoir les bytes)
  var doc = await generateInvoicePDF(invoice, items, client, contact, {
    ...options,
    billingClient: billingClient || null,
    skipSave: true,
  })

  // 2. Extraire les bytes du PDF
  var pdfArrayBuffer = doc.output('arraybuffer')
  var pdfUint8 = new Uint8Array(pdfArrayBuffer)
  var binary = ''
  for (var i = 0; i < pdfUint8.length; i++) {
    binary += String.fromCharCode(pdfUint8[i])
  }
  var pdfBase64 = btoa(binary)

  // 3. Appeler l'endpoint Vercel pour embarquer le XML CII
  var response = await apiFetch('/api/generate-facturx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invoice_id: invoice.id,
      pdf_base64: pdfBase64,
    }),
  })

  if (!response.ok) {
    var errBody = null
    try { errBody = await response.json() } catch (_) {}
    throw new Error(
      'Erreur génération Factur-X : ' + (errBody?.error || response.statusText)
    )
  }

  // 4a. Mode retour base64 (pour envoi au comptable sans download)
  if (options.returnBase64) {
    var arrayBuffer = await response.arrayBuffer()
    var bytes = new Uint8Array(arrayBuffer)
    var b = ''
    for (var j = 0; j < bytes.length; j++) { b += String.fromCharCode(bytes[j]) }
    return btoa(b)
  }

  // 4b. Mode download (comportement par défaut - bouton Factur-X dans Invoices.jsx)
  var blob = await response.blob()
  var url = URL.createObjectURL(blob)
  var a = document.createElement('a')
  a.href = url
  a.download = invoice.reference + '_facturx.pdf'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
