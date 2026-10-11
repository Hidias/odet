import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { format } from 'date-fns'
import { buildORG } from '../../../core/org/orgUtils'

// ============================================================
// IDENTITÉ DE L'ORGANISME : uniquement depuis organization_settings (options.orgSettings)
// ============================================================
function emptyOrg() {
  return { name: '', legal: '', forme: '', address_line1: '', address_line2: '', country: 'France', phone: '', email: '', siret: '', naf: '',
    tva: '', tva_applicable: true, rcs: '', nda: '', ndaFull: '', capital: '', bank_name: '', bic: '', iban: '', logo_base64: null, logo_url: null, theme: null }
}
let ORG = emptyOrg()

function applyOrgSettings(orgSettings) {
  const base = buildORG(orgSettings || {})
  ORG = {
    name: base.legal_name || base.name,
    legal: base.legal_name,
    forme: base.forme_juridique,
    address_line1: base.street,
    address_line2: [base.postal_code, base.city].filter(Boolean).join(' '),
    country: 'France',
    phone: base.phone,
    email: base.email,
    siret: base.siret,
    naf: base.naf,
    tva: base.tva,
    tva_applicable: base.tva_applicable,
    rcs: base.rcs,
    nda: base.nda,
    ndaFull: base.ndaFull,
    capital: base.capital_social,
    bank_name: base.bank_name,
    bic: base.bic,
    iban: base.iban,
    logo_base64: base.logo_base64,
    logo_url: base.logo_url,
    theme: base.theme,
  }
}

// Contact affiché sur le document : la personne connectée (options.contactPerson), sinon l'organisme
function contactFor(options) {
  const p = options && options.contactPerson
  if (p && p.name) return { name: p.name, phone: p.phone || ORG.phone, email: p.email || ORG.email }
  return { name: ORG.name, phone: ORG.phone, email: ORG.email }
}

// ============================================================
// LAYOUT
// ============================================================
var ML = 18
var MR = 192
var FOOTER_SEP_Y = 271
// Bottom block (conditions+bank+legal) = ~38mm
// Anchored above footer: 271 - 4 - 38 = 229
var BOTTOM_BLOCK_Y = 229

// ============================================================
// FORMAT HELPERS
// ============================================================
function fmtDate(d) {
  if (!d) return ''
  return format(new Date(d), 'dd/MM/yyyy')
}

function fmtMoney(val) {
  var num = Math.abs(parseFloat(val) || 0)
  var fixed = num.toFixed(2)
  var parts = fixed.split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return parts.join(',')
}

function fmtEuro(val) {
  var prefix = parseFloat(val) < 0 ? '-' : ''
  return prefix + fmtMoney(val) + ' EUR'
}

// ============================================================
// LOAD LOGO
// ============================================================
var logoCache = null
var logoCacheKey = null

async function loadLogo() {
  var src = ORG.logo_base64 || ORG.logo_url
  if (!src) return null
  if (logoCache && logoCacheKey === src) return logoCache
  logoCacheKey = src
  try {
    var resp = await fetch(src)
    var blob = await resp.blob()
    return new Promise(function (resolve) {
      var reader = new FileReader()
      reader.onload = function () { logoCache = reader.result; resolve(logoCache) }
      reader.readAsDataURL(blob)
    })
  } catch (e) {
    console.warn('Logo load failed:', e)
    return null
  }
}

// ============================================================
// FOOTER
// ============================================================
function addFooter(doc, font, pageNum, totalPages) {
  var cx = 105
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.3)
  doc.line(ML, FOOTER_SEP_Y, MR, FOOTER_SEP_Y)
  doc.setFont(font, 'normal')
  doc.setFontSize(7)
  doc.setTextColor(120, 120, 120)
  doc.text(`${ORG.name} - ${ORG.address_line1} - ${ORG.address_line2} - ${ORG.country}`, cx, 275, { align: 'center' })
  if (ORG.ndaFull) doc.text(`Declaration d'activite enregistree sous le numero ${ORG.ndaFull}`, cx, 279, { align: 'center' })
  doc.text([ORG.forme ? `${ORG.forme}${ORG.capital ? ' au capital de ' + ORG.capital + ' EUR' : ''}` : '', ORG.siret ? `Siret : ${ORG.siret}` : '', ORG.naf ? `Naf : ${ORG.naf}` : '', ORG.tva ? `TVA : ${ORG.tva}` : '', ORG.rcs ? `RCS ${ORG.rcs}` : ''].filter(Boolean).join(' - '), cx, 283, { align: 'center' })
  doc.text(`Tel : ${ORG.phone} - Email : ${ORG.email}`, cx, 287, { align: 'center' })
  // Page number bottom right
  doc.setFont(font, 'bold')
  doc.setFontSize(7)
  doc.setTextColor(100, 100, 100)
  doc.text('Page ' + pageNum + ' / ' + totalPages, MR, 291, { align: 'right' })
  doc.setTextColor(0, 0, 0)
}

// ============================================================
// BOTTOM BLOCK (conditions + banque + mentions legales)
// Drawn at fixed Y position above footer
// ============================================================
function drawBottomBlock(doc, font, quote) {
  var y = BOTTOM_BLOCK_Y

  // Separator
  doc.setDrawColor(210, 210, 210)
  doc.setLineWidth(0.2)
  doc.line(ML, y - 2, MR, y - 2)

  // Conditions
  doc.setFontSize(7)
  doc.setTextColor(60, 60, 60)
  doc.setFont(font, 'normal')

  var conds = [
    ['Date de validite :', fmtDate(quote.validity_date)],
    ['Moyen de reglement :', quote.payment_method || 'virement bancaire'],
    ['Delai de reglement :', quote.payment_terms || 'a 30 jours'],
    ['Date limite de reglement :', fmtDate(quote.payment_deadline)],
  ]
  for (var i = 0; i < conds.length; i++) {
    doc.text(conds[i][0], ML, y)
    doc.text(conds[i][1], ML + 40, y)
    y += 3.5
  }

  // Bank
  y += 0.5
  doc.text('Banque :', ML, y)
  doc.text(ORG.bank_name, ML + 40, y)
  y += 3.5
  doc.text('BIC : ' + ORG.bic, ML + 40, y)
  y += 3
  doc.text('IBAN : ' + ORG.iban, ML + 40, y)
  y += 5

  // Legal
  doc.setFontSize(6)
  doc.setTextColor(100, 100, 100)
  doc.text(
    "En cas de retard de paiement, des penalites seront exigibles au taux legal majore de 10 points, ainsi qu'une indemnite forfaitaire de 40 EUR",
    ML, y
  )
  y += 2.5
  doc.text("pour frais de recouvrement (art. L441-10 du Code de commerce).", ML, y)
  y += 3.5
  if (quote.tva_applicable !== false) {
    doc.text("TVA exigible d'apres les encaissements (article 269, 2-c du CGI).", ML, y)
  } else {
    doc.setFont(font, 'bold')
    doc.text("TVA non applicable conformement a l'article 261 du CGI.", ML, y)
  }
}

// ============================================================
// MAIN
// ============================================================
export async function generateQuotePDF(quote, items, client, contact, options) {
  applyOrgSettings(options?.orgSettings)
  contact = contact || null
  options = options || {}
  var doc = new jsPDF()
  var FONT = 'helvetica'
  var createdBy = contactFor(options)
  var logo = await loadLogo()
  var y = 12

  // ─── LOGO ───
  if (logo) {
    try { doc.addImage(logo, 'PNG', ML, y, 52, 13) } catch (e) {
      doc.setFontSize(14); doc.setFont(FONT, 'bold'); doc.setTextColor(233, 180, 76)
      doc.text((ORG.name || '').toUpperCase(), ML, y + 14); doc.setTextColor(0, 0, 0)
    }
  }

  // ─── REFERENCE ───
  doc.setTextColor(0, 0, 0)
  doc.setFontSize(11); doc.setFont(FONT, 'bold')
  doc.text('Devis ' + quote.reference, MR, y + 5, { align: 'right' })
  doc.setFont(FONT, 'normal'); doc.setFontSize(9)
  doc.text('En date du : ' + fmtDate(quote.quote_date), MR, y + 11, { align: 'right' })
  if (quote.client_reference) {
    doc.text('Ref. client : ' + quote.client_reference, MR, y + 17, { align: 'right' })
  }

  y = 40

  // ─── EMETTEUR ───
  doc.setFontSize(9); doc.setFont(FONT, 'normal'); doc.setTextColor(80, 80, 80)
  doc.text(ORG.address_line1, ML, y)
  doc.text(ORG.address_line2, ML, y + 5)
  doc.text(ORG.country, ML, y + 10)
  doc.setTextColor(0, 0, 0); doc.setFont(FONT, 'bold')
  doc.text('Votre contact : ' + createdBy.name, ML, y + 18)
  doc.setFont(FONT, 'normal'); doc.setTextColor(80, 80, 80)
  doc.text('Tel : ' + createdBy.phone, ML, y + 23)
  if (createdBy.email) doc.text('Email : ' + createdBy.email, ML, y + 28)

  // ─── CLIENT ───
  var cX = 118; var cy = y
  doc.setFontSize(10); doc.setFont(FONT, 'bold'); doc.setTextColor(0, 0, 0)
  doc.text(client?.name || '', cX, cy); cy += 6
  doc.setFont(FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(60, 60, 60)
  if (contact) {
    var civ = contact.civilite || ''
    var cName = contact.name || ((contact.first_name || '') + ' ' + (contact.last_name || '')).trim()
    if (cName) { doc.text("A l'attention de " + (civ ? civ + ' ' : '') + cName, cX, cy); cy += 5 }
  }
  if (client?.address) { var addrLines = doc.splitTextToSize(client.address, MR - cX - 2); doc.text(addrLines, cX, cy); cy += addrLines.length * 5 }
  var cityLine = [client?.postal_code, (client?.city || '').toUpperCase()].filter(Boolean).join(' ')
  if (cityLine) { doc.text(cityLine, cX, cy); cy += 5 }
  doc.text('France', cX, cy)

  y = 82

  // ─── OBJET ───
  if (quote.object) {
    doc.setFontSize(9); doc.setFont(FONT, 'normal'); doc.setTextColor(0, 0, 0)
    doc.text('Objet : ' + quote.object, ML, y); y += 8
  }

  // ─── TABLE ───
  var tableBody = items.map(function (item) {
    var qty = parseFloat(item.quantity) || 0
    var pu = parseFloat(item.unit_price_ht) || 0
    var tva = parseFloat(item.tva_rate) || 20
    var lineTotal = qty * pu
    var tvaAmt = lineTotal * tva / 100
    var desc = item.description_title || ''
    if (item.description_detail) desc += ' :\n' + item.description_detail
    return [
      item.code || '', desc, fmtMoney(qty),
      fmtMoney(pu) + '\n' + (item.unit || 'unite'),
      fmtMoney(tva) + ' %\n(' + fmtMoney(tvaAmt) + ')',
      fmtMoney(lineTotal)
    ]
  })

  var tableConfig = {
    margin: { left: ML, right: 18 },
    head: [['Nom / Code', 'Description', 'Qte', 'PU HT', 'TVA', 'Total HT']],
    theme: 'grid',
    headStyles: {
      fillColor: [240, 240, 240], textColor: [50, 50, 50],
      fontStyle: 'bold', fontSize: 8, font: FONT,
      lineWidth: 0.3, lineColor: [180, 180, 180], cellPadding: 3,
    },
    bodyStyles: {
      fontSize: 8, font: FONT, cellPadding: 3,
      lineWidth: 0.2, lineColor: [200, 200, 200],
      textColor: [40, 40, 40], valign: 'top',
    },
    columnStyles: {
      0: { cellWidth: 22 }, 1: { cellWidth: 'auto' },
      2: { cellWidth: 16, halign: 'center' },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 22, halign: 'right', fontSize: 7 },
      5: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
    },
  }

  // ─── MESURE : Est-ce que tout tient sur une page ? ───
  // Hauteur post-tableau nécessaire : totaux(~28) + notes(~8) + signature(~30) = ~66mm
  // Le bottom block doit commencer à BOTTOM_BLOCK_Y (229) au plus tard
  var POST_TABLE_HEIGHT = 66
  var MAX_TABLE_END_Y = BOTTOM_BLOCK_Y - POST_TABLE_HEIGHT  // ~163

  // Mesurer le tableau complet avec un doc temporaire
  var measureDoc = new jsPDF()
  measureDoc.autoTable(Object.assign({}, tableConfig, { startY: y, body: tableBody }))
  var measuredEndY = measureDoc.lastAutoTable.finalY
  var measuredPages = measureDoc.internal.getNumberOfPages()

  // Faut-il scinder ? Oui si le tableau dépasse le seuil ET qu'on a plus d'une ligne
  var needsSplit = measuredPages === 1 && measuredEndY > MAX_TABLE_END_Y && tableBody.length > 1

  if (needsSplit) {
    // ─── MODE SCINDÉ : dernière(s) ligne(s) sur page 2 ───
    var mainBody = tableBody.slice(0, -1)
    var lastRow = tableBody.slice(-1)

    // Page 1 : tableau sans la dernière ligne
    doc.autoTable(Object.assign({}, tableConfig, { startY: y, body: mainBody }))

    // Page 2
    doc.addPage()
    y = 20

    // Dernière ligne en continuation (avec header répété)
    doc.autoTable(Object.assign({}, tableConfig, { startY: y, body: lastRow }))
    y = doc.lastAutoTable.finalY + 4
  } else {
    // ─── MODE NORMAL : tout sur la même page (ou autoTable gère le saut lui-même) ───
    doc.autoTable(Object.assign({}, tableConfig, { startY: y, body: tableBody }))
    y = doc.lastAutoTable.finalY + 4
  }

  // ─── TOTAUX (compact) ───
  var hasDiscount = parseFloat(quote.discount_percent) > 0
  var subtotalHt = items.reduce(function (s, it) {
    return s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price_ht) || 0)
  }, 0)
  var discountAmt = subtotalHt * (parseFloat(quote.discount_percent) || 0) / 100
  var totalHt = subtotalHt - discountAmt
  var totalTva = quote.tva_applicable !== false ? totalHt * (parseFloat(quote.tva_rate) || 20) / 100 : 0
  var totalTtc = totalHt + totalTva

  var totRows = []
  if (hasDiscount) {
    totRows.push(['Montant total HT', fmtEuro(subtotalHt)])
    totRows.push(['Reduction HT (' + fmtMoney(quote.discount_percent) + '%)', '-' + fmtEuro(discountAmt)])
  }
  totRows.push([
    { content: 'Total net HT', styles: { fontStyle: 'bold' } },
    { content: fmtEuro(totalHt), styles: { fontStyle: 'bold' } }
  ])
  if (quote.tva_applicable !== false) {
    totRows.push(['TVA ' + fmtMoney(quote.tva_rate || 20) + '%', fmtEuro(totalTva)])
  }
  totRows.push([
    { content: 'Montant total TTC', styles: { fontStyle: 'bold', fontSize: 10 } },
    { content: fmtEuro(totalTtc), styles: { fontStyle: 'bold', fontSize: 10 } }
  ])

  doc.autoTable({
    startY: y,
    margin: { left: 118, right: 18 },
    body: totRows,
    theme: 'plain',
    styles: { fontSize: 9, font: FONT, cellPadding: 1.5, textColor: [30, 30, 30] },
    columnStyles: {
      0: { halign: 'right' },
      1: { halign: 'right', cellWidth: 34 },
    },
  })

  y = doc.lastAutoTable.finalY + 5

  // ─── NOTES ───
  if (quote.notes) {
    doc.setFontSize(8); doc.setFont(FONT, 'italic'); doc.setTextColor(80, 80, 80)
    var noteMaxWidth = MR - ML  // largeur utile entre marges
    var noteLines = doc.splitTextToSize('Note : ' + quote.notes, noteMaxWidth)
    doc.text(noteLines, ML, y)
    doc.setTextColor(0, 0, 0); y += noteLines.length * 3.5 + 2
  }

  // ─── SIGNATURE ───
  var sigX = 118
  var sigW = MR - sigX  // 74mm

  doc.setFontSize(7.5); doc.setFont(FONT, 'bold'); doc.setTextColor(0, 80, 130)
  doc.text("Signature du client precedee de la mention", sigX + sigW / 2, y, { align: 'center' })
  doc.text("'Lu et approuve, bon pour accord' :", sigX + sigW / 2, y + 4, { align: 'center' })
  doc.setTextColor(0, 0, 0)

  var sigBoxY = y + 6
  doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.3)
  doc.rect(sigX, sigBoxY, sigW, 18)

  if (quote.signature_base64) {
    try { doc.addImage(quote.signature_base64, 'PNG', sigX + 2, sigBoxY + 1, sigW - 4, 16) } catch (e) { /* */ }
  }

  var afterSignatureY = sigBoxY + 18 + 3

  // ─── BOTTOM BLOCK PLACEMENT ───
  if (afterSignatureY > BOTTOM_BLOCK_Y - 2) {
    doc.addPage()
  }

  var finalPage = doc.internal.getNumberOfPages()
  doc.setPage(finalPage)
  drawBottomBlock(doc, FONT, quote)

  // ─── FOOTER on ALL pages ───
  var totalPages = doc.internal.getNumberOfPages()
  for (var p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    addFooter(doc, FONT, p, totalPages)
  }

  if (!options.skipSave) {
    doc.save(quote.reference + '.pdf')
  }
  return doc
}

// ============================================================
// ACCEPTATION PARTIELLE — BON DE COMMANDE
// ============================================================
export async function generatePartialAcceptancePDF(quote, allItems, client, contact, options) {
  applyOrgSettings(options?.orgSettings)
  contact = contact || null
  options = options || {}

  // Filtrer les lignes acceptées uniquement
  var acceptedItems = allItems.filter(function (it) { return it.accepted === true })
  if (acceptedItems.length === 0) {
    throw new Error('Aucune ligne acceptée dans ce devis')
  }

  var doc = new jsPDF()
  var FONT = 'helvetica'
  var createdBy = contactFor(options)
  var logo = await loadLogo()
  var y = 12

  // ─── LOGO ───
  if (logo) {
    try { doc.addImage(logo, 'PNG', ML, y, 52, 13) } catch (e) {
      doc.setFontSize(14); doc.setFont(FONT, 'bold'); doc.setTextColor(233, 180, 76)
      doc.text((ORG.name || '').toUpperCase(), ML, y + 14); doc.setTextColor(0, 0, 0)
    }
  }

  // ─── BANDEAU AMBRE (haut à droite) ───
  var bannerX = 116
  var bannerW = MR - bannerX // ~76mm
  var bannerH = 27
  doc.setFillColor(254, 243, 199) // amber-100
  doc.rect(bannerX, y - 2, bannerW, bannerH, 'F')
  doc.setDrawColor(217, 119, 6) // amber-600
  doc.setLineWidth(0.6)
  doc.rect(bannerX, y - 2, bannerW, bannerH, 'D')
  doc.setFont(FONT, 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(120, 53, 15) // amber-900
  doc.text('BON DE COMMANDE PARTIEL', bannerX + bannerW / 2, y + 5, { align: 'center' })
  doc.setFont(FONT, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(146, 64, 14) // amber-800
  doc.text('Suite au devis ' + quote.reference, bannerX + bannerW / 2, y + 11, { align: 'center' })
  doc.text('du ' + fmtDate(quote.quote_date), bannerX + bannerW / 2, y + 17, { align: 'center' })
  doc.setTextColor(0, 0, 0)

  y = 40

  // ─── EMETTEUR ───
  doc.setFontSize(9); doc.setFont(FONT, 'normal'); doc.setTextColor(80, 80, 80)
  doc.text(ORG.address_line1, ML, y)
  doc.text(ORG.address_line2, ML, y + 5)
  doc.text(ORG.country, ML, y + 10)
  doc.setTextColor(0, 0, 0); doc.setFont(FONT, 'bold')
  doc.text('Votre contact : ' + createdBy.name, ML, y + 18)
  doc.setFont(FONT, 'normal'); doc.setTextColor(80, 80, 80)
  doc.text('Tel : ' + createdBy.phone, ML, y + 23)
  if (createdBy.email) doc.text('Email : ' + createdBy.email, ML, y + 28)

  // ─── CLIENT ───
  var cX = 118; var cy = y
  doc.setFontSize(10); doc.setFont(FONT, 'bold'); doc.setTextColor(0, 0, 0)
  doc.text(client?.name || '', cX, cy); cy += 6
  doc.setFont(FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(60, 60, 60)
  if (contact) {
    var civ = contact.civilite || ''
    var cName = contact.name || ((contact.first_name || '') + ' ' + (contact.last_name || '')).trim()
    if (cName) { doc.text("A l'attention de " + (civ ? civ + ' ' : '') + cName, cX, cy); cy += 5 }
  }
  if (client?.address) { var addrLines = doc.splitTextToSize(client.address, MR - cX - 2); doc.text(addrLines, cX, cy); cy += addrLines.length * 5 }
  var cityLine = [client?.postal_code, (client?.city || '').toUpperCase()].filter(Boolean).join(' ')
  if (cityLine) { doc.text(cityLine, cX, cy); cy += 5 }
  doc.text('France', cX, cy)

  y = 82

  // ─── OBJET ───
  if (quote.object) {
    doc.setFontSize(9); doc.setFont(FONT, 'normal'); doc.setTextColor(0, 0, 0)
    doc.text('Objet : ' + quote.object, ML, y); y += 6
  }

  // ─── NOTE PARTIELLE (italique ambre) ───
  doc.setFontSize(8); doc.setFont(FONT, 'italic'); doc.setTextColor(146, 64, 14) // amber-800
  var partialNote = 'Ce document recapitule les lignes acceptees du devis ' + quote.reference + ' du ' + fmtDate(quote.quote_date)
  var noteLines = doc.splitTextToSize(partialNote, MR - ML - 4)
  doc.text(noteLines, ML, y); y += noteLines.length * 3.5 + 4
  doc.setTextColor(0, 0, 0)

  // ─── TABLE (lignes acceptées uniquement) ───
  var tableBody = acceptedItems.map(function (item) {
    var qty = parseFloat(item.quantity) || 0
    var pu = parseFloat(item.unit_price_ht) || 0
    var tva = parseFloat(item.tva_rate) || 20
    var lineTotal = qty * pu
    var tvaAmt = lineTotal * tva / 100
    var desc = item.description_title || ''
    if (item.description_detail) desc += ' :\n' + item.description_detail
    return [
      item.code || '', desc, fmtMoney(qty),
      fmtMoney(pu) + '\n' + (item.unit || 'unite'),
      fmtMoney(tva) + ' %\n(' + fmtMoney(tvaAmt) + ')',
      fmtMoney(lineTotal)
    ]
  })

  var tableConfig = {
    margin: { left: ML, right: 18 },
    head: [['Nom / Code', 'Description', 'Qte', 'PU HT', 'TVA', 'Total HT']],
    theme: 'grid',
    headStyles: {
      fillColor: [254, 243, 199], textColor: [120, 53, 15], // amber-100 / amber-900
      fontStyle: 'bold', fontSize: 8, font: FONT,
      lineWidth: 0.3, lineColor: [217, 119, 6], cellPadding: 3,
    },
    bodyStyles: {
      fontSize: 8, font: FONT, cellPadding: 3,
      lineWidth: 0.2, lineColor: [253, 230, 138], // amber-200
      textColor: [40, 40, 40], valign: 'top',
    },
    columnStyles: {
      0: { cellWidth: 22 }, 1: { cellWidth: 'auto' },
      2: { cellWidth: 16, halign: 'center' },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 22, halign: 'right', fontSize: 7 },
      5: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
    },
  }

  var POST_TABLE_HEIGHT = 66
  var MAX_TABLE_END_Y = BOTTOM_BLOCK_Y - POST_TABLE_HEIGHT

  var measureDoc = new jsPDF()
  measureDoc.autoTable(Object.assign({}, tableConfig, { startY: y, body: tableBody }))
  var measuredEndY = measureDoc.lastAutoTable.finalY
  var measuredPages = measureDoc.internal.getNumberOfPages()

  var needsSplit = measuredPages === 1 && measuredEndY > MAX_TABLE_END_Y && tableBody.length > 1

  if (needsSplit) {
    var mainBody = tableBody.slice(0, -1)
    var lastRow = tableBody.slice(-1)
    doc.autoTable(Object.assign({}, tableConfig, { startY: y, body: mainBody }))
    doc.addPage()
    y = 20
    doc.autoTable(Object.assign({}, tableConfig, { startY: y, body: lastRow }))
    y = doc.lastAutoTable.finalY + 4
  } else {
    doc.autoTable(Object.assign({}, tableConfig, { startY: y, body: tableBody }))
    y = doc.lastAutoTable.finalY + 4
  }

  // ─── TOTAUX (recalculés sur lignes acceptées) ───
  var hasDiscount = parseFloat(quote.discount_percent) > 0
  var subtotalHt = acceptedItems.reduce(function (s, it) {
    return s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price_ht) || 0)
  }, 0)
  var discountAmt = subtotalHt * (parseFloat(quote.discount_percent) || 0) / 100
  var totalHt = subtotalHt - discountAmt
  var totalTva = quote.tva_applicable !== false ? totalHt * (parseFloat(quote.tva_rate) || 20) / 100 : 0
  var totalTtc = totalHt + totalTva

  var totRows = []
  if (hasDiscount) {
    totRows.push(['Montant total HT', fmtEuro(subtotalHt)])
    totRows.push(['Reduction HT (' + fmtMoney(quote.discount_percent) + '%)', '-' + fmtEuro(discountAmt)])
  }
  totRows.push([
    { content: 'Total net HT', styles: { fontStyle: 'bold' } },
    { content: fmtEuro(totalHt), styles: { fontStyle: 'bold' } }
  ])
  if (quote.tva_applicable !== false) {
    totRows.push(['TVA ' + fmtMoney(quote.tva_rate || 20) + '%', fmtEuro(totalTva)])
  }
  totRows.push([
    { content: 'Montant total TTC', styles: { fontStyle: 'bold', fontSize: 10 } },
    { content: fmtEuro(totalTtc), styles: { fontStyle: 'bold', fontSize: 10 } }
  ])

  doc.autoTable({
    startY: y,
    margin: { left: 118, right: 18 },
    body: totRows,
    theme: 'plain',
    styles: { fontSize: 9, font: FONT, cellPadding: 1.5, textColor: [30, 30, 30] },
    columnStyles: {
      0: { halign: 'right' },
      1: { halign: 'right', cellWidth: 34 },
    },
  })

  y = doc.lastAutoTable.finalY + 5

  // ─── NOTES ───
  if (quote.notes) {
    doc.setFontSize(8); doc.setFont(FONT, 'italic'); doc.setTextColor(80, 80, 80)
    var qNoteLines = doc.splitTextToSize('Note : ' + quote.notes, MR - ML)
    doc.text(qNoteLines, ML, y)
    doc.setTextColor(0, 0, 0); y += qNoteLines.length * 3.5 + 2
  }

  // ─── SIGNATURE (cadre amber-600) ───
  var sigX = 118
  var sigW = MR - sigX

  doc.setFontSize(7.5); doc.setFont(FONT, 'bold'); doc.setTextColor(146, 64, 14) // amber-800
  doc.text("Signature du client precedee de la mention", sigX + sigW / 2, y, { align: 'center' })
  doc.text("'Lu et approuve, bon pour accord' :", sigX + sigW / 2, y + 4, { align: 'center' })
  doc.setTextColor(0, 0, 0)

  var sigBoxY = y + 6
  doc.setDrawColor(217, 119, 6) // amber-600
  doc.setLineWidth(0.5)
  doc.rect(sigX, sigBoxY, sigW, 18)

  if (quote.signature_base64) {
    try { doc.addImage(quote.signature_base64, 'PNG', sigX + 2, sigBoxY + 1, sigW - 4, 16) } catch (e) { /* */ }
  }

  var afterSignatureY = sigBoxY + 18 + 3

  // ─── BOTTOM BLOCK ───
  if (afterSignatureY > BOTTOM_BLOCK_Y - 2) {
    doc.addPage()
  }

  var finalPage = doc.internal.getNumberOfPages()
  doc.setPage(finalPage)
  drawBottomBlock(doc, FONT, quote)

  // ─── FOOTER on ALL pages ───
  var totalPages = doc.internal.getNumberOfPages()
  for (var p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    addFooter(doc, FONT, p, totalPages)
  }

  if (!options.skipSave) {
    doc.save(quote.reference + '-PARTIEL.pdf')
  }
  return doc
}
