// Mise en page des documents commerciaux (facture, avoir, devis, bon de commande partiel)
// sur la mise en page commune (core/pdf/layout.js) : bandeau d'identité, cartes émetteur /
// destinataire, bandeau d'informations, tableau des lignes, totaux, règlement, mentions.
// Aucune valeur d'organisme en dur : tout vient de l'objet L (buildORG + logo préchargé).

import { startDocument, setF, numberPages, PAGE_MARGIN, drawImageFitted, drawKeyValues } from '../../../core/pdf/layout'
import { orgHorsFormation } from '../../../core/org/orgUtils'

export function fmtMoney(v) {
  var n = Math.abs(parseFloat(v) || 0).toFixed(2).split('.')
  n[0] = n[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return n.join(',')
}
export function fmtRate(r) {
  const n = parseFloat(r) || 0
  return (Number.isInteger(n) ? String(n) : fmtMoney(n).replace(/0$/, '')) + ' %'
}
function fmtQty(q) { return Number.isInteger(q) ? String(q) : fmtMoney(q) }
export function fmtEuro(v) { return (parseFloat(v) < 0 ? '-' : '') + fmtMoney(v) + ' €' }

// Coupe les lignes d'une carte à la largeur de la carte (taille 8,5)
function wrapCardLines(doc, lines, w) {
  const out = []
  lines.filter(l => l !== null && l !== undefined && l !== '').forEach((l, i) => {
    setF(doc, i === 0 ? 'bold' : 'normal'); doc.setFontSize(i === 0 ? 9.5 : 8.5)
    doc.splitTextToSize(String(l), w).forEach(p => out.push(p))
  })
  return out
}

// Ligne de tableau des prestations
export function itemRow(it) {
  var q = parseFloat(it.quantity) || 0
  var pu = parseFloat(it.unit_price_ht) || 0
  var tv = (it.tva_rate === null || it.tva_rate === undefined || it.tva_rate === '') ? 20 : (parseFloat(it.tva_rate) || 0)
  var lt = Math.round((q * pu + Number.EPSILON) * 100) / 100
  var desc = it.description_title || ''
  if (it.description_detail) desc += '\n' + it.description_detail
  return [it.code || '', desc, fmtQty(q), fmtMoney(pu) + '\n' + (it.unit || 'unité'), fmtRate(tv), fmtMoney(lt)]
}

/**
 * @param {jsPDF} doc document déjà créé (police éventuelle déclarée dans doc.__odetFont)
 * @param {object} L identité (buildORG + logo_base64 prêt)
 * @param {object} p voir les appelants (invoiceGenerator, quoteGenerator)
 */
export function renderCommercialDoc(doc, Lsource, p) {
  // Devis ou facture sans aucune formation (maintenance, matériel) : ni NDA ni mention Qualiopi
  const L = p.formation === false ? orgHorsFormation(Lsource) : Lsource
  const t = L.theme
  const M = PAGE_MARGIN
  const f = startDocument(doc, L, { ref: p.ref, docLabel: p.docLabel, code: p.code, title: p.title, subtitle: p.subtitle || null })
  const font = doc.__odetFont || 'helvetica'

  if (p.banner) f.callout(p.banner.label, p.banner.text, { tone: 'highlight' })

  // Cartes émetteur / destinataire
  const colW = (f.W - 6) / 2 - 8
  f.cards([
    { label: p.issuerLabel || 'Émetteur', lines: wrapCardLines(doc, p.issuerLines, colW) },
    { label: p.recipientLabel || 'Destinataire', lines: wrapCardLines(doc, p.recipientLines, colW) },
  ])
  if (p.forAccountOf && p.forAccountOf.length) {
    f.callout('Formation réalisée pour le compte de', p.forAccountOf.filter(Boolean).join(' · '), { tone: 'muted' })
  }

  // Bandeau d'informations (date, échéance, références)
  const meta = (p.meta || []).filter(m => m && m[1])
  if (meta.length) {
    f.ensure(16)
    doc.autoTable({
      startY: f.y,
      head: [meta.map(m => m[0])],
      body: [meta.map(m => m[1])],
      theme: 'plain',
      margin: { left: M, right: M },
      styles: { font, fontSize: 8.5, textColor: t.text, cellPadding: { top: 1.6, bottom: 1.6, left: 3, right: 3 } },
      headStyles: { font, fontStyle: 'bold', fontSize: 6.8, textColor: t.muted, fillColor: t.surface },
      bodyStyles: { fillColor: t.surface, fontStyle: 'bold' },
    })
    f.y = doc.lastAutoTable.finalY + 6
  }

  if (p.object) {
    f.ensure(10)
    f.para('Objet : ' + p.object, { size: 9.5, style: 'bold', after: 1.5 })
  }
  if (p.nature) f.note(p.nature, { after: 3 })

  // Lignes
  f.table(['Code', 'Désignation', 'Qté', 'PU HT', 'TVA', 'Total HT'], p.rows, {
    styles: { font, fontSize: 8.3, textColor: t.text, lineColor: t.line, lineWidth: 0.2, cellPadding: 2.4, overflow: 'linebreak', valign: 'top' },
    columnStyles: {
      0: { cellWidth: 20, fontSize: 7.5, textColor: t.muted },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 13, halign: 'center' },
      3: { cellWidth: 24, halign: 'right' },
      4: { cellWidth: 16, halign: 'right' },
      5: { cellWidth: 25, halign: 'right', fontStyle: 'bold' },
    },
  })

  // Bas de document sur deux colonnes : règlement (+ récapitulatif TVA) à gauche, totaux à droite
  const pw = doc.internal.pageSize.getWidth()
  const totW = 80
  const gap = 8
  const leftW = f.W - totW - gap
  const totRows = p.totals || []
  const recap = p.vatRecap || []
  const payment = (p.payment || []).filter(r => r && r[1])
  setF(doc, 'normal'); doc.setFontSize(8)
  const payH = payment.length ? 4 + payment.reduce((s, r) => s + Math.max(1, doc.splitTextToSize(String(r[1]), leftW - 30).length) * 4 + 2.6, 0) : 0
  const leftH = payH + (recap.length ? recap.length * 5.5 + 12 : 0)
  const rightH = totRows.length * 6.4 + 4
  f.ensure(Math.max(leftH, rightH) + 2)
  const y0 = f.y
  let yLeft = y0
  if (payment.length) {
    setF(doc, 'bold'); doc.setFontSize(7); doc.setTextColor(...t.accent)
    doc.text(String(p.paymentTitle || 'Règlement').toUpperCase(), M, y0 + 2.5, { charSpace: 0.4 })
    yLeft = drawKeyValues(doc, L, M, y0 + 3.5, leftW, payment, { labelW: 30, fontSize: 8 })
  }
  if (recap.length) {
    doc.autoTable({
      startY: yLeft + 3,
      margin: { left: M, right: pw - M - leftW },
      head: [['Taux TVA', 'Base HT', 'Montant TVA']],
      body: recap,
      theme: 'grid',
      styles: { font, fontSize: 7.5, textColor: t.text, lineColor: t.line, lineWidth: 0.2, cellPadding: 1.6 },
      headStyles: { font, fontStyle: 'bold', fontSize: 6.8, textColor: t.muted, fillColor: t.surface },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    })
    yLeft = doc.lastAutoTable.finalY
  }
  const grandIdx = totRows.findIndex(r => r.grand)
  doc.autoTable({
    startY: y0,
    margin: { left: pw - M - totW, right: M },
    body: totRows.map(r => [r.label, r.value]),
    theme: 'plain',
    styles: { font, fontSize: 8.8, textColor: t.text, cellPadding: { top: 1.4, bottom: 1.4, left: 3, right: 3 } },
    columnStyles: { 0: { halign: 'left' }, 1: { halign: 'right', cellWidth: 34 } },
    didParseCell: (data) => {
      const r = totRows[data.row.index]
      if (!r) return
      if (r.bold || r.grand) data.cell.styles.fontStyle = 'bold'
      if (r.grand) { data.cell.styles.fillColor = t.primary; data.cell.styles.textColor = [255, 255, 255]; data.cell.styles.fontSize = 10; data.cell.styles.cellPadding = { top: 2.4, bottom: 2.4, left: 3, right: 3 } }
      if (r.due) { data.cell.styles.fillColor = t.surface; data.cell.styles.textColor = t.primary; data.cell.styles.fontStyle = 'bold'; data.cell.styles.fontSize = 9.5 }
      if (r.muted) data.cell.styles.textColor = t.muted
    },
    didDrawCell: (data) => {
      const i = data.row.index
      if (data.section === 'body' && data.column.index === 0 && i > 0 && i !== grandIdx && !totRows[i].due && !totRows[i - 1].grand) {
        doc.setDrawColor(...t.line); doc.setLineWidth(0.2)
        doc.line(data.cell.x, data.cell.y, data.cell.x + totW, data.cell.y)
      }
    },
  })
  f.y = Math.max(yLeft, doc.lastAutoTable.finalY) + 6

  // Note (et, pour un devis, « bon pour accord » à droite)
  if (p.signature) {
    const sh = 28
    setF(doc, 'normal'); doc.setFontSize(8.5)
    const noteLines = p.notes ? doc.splitTextToSize(String(p.notes), leftW - 8) : []
    f.ensure(Math.max(sh + 10, noteLines.length * 4 + 12))
    const ys = f.y
    if (noteLines.length) {
      const nh = noteLines.length * 4 + 10
      doc.setFillColor(...t.surface); doc.rect(M, ys, leftW, nh, 'F')
      doc.setFillColor(...t.muted); doc.rect(M, ys, 1.2, nh, 'F')
      setF(doc, 'bold'); doc.setFontSize(7); doc.setTextColor(...t.muted)
      doc.text('NOTE', M + 4, ys + 5, { charSpace: 0.4 })
      setF(doc, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...t.text)
      noteLines.forEach((l, i) => doc.text(l, M + 4, ys + 10 + i * 4))
    }
    const sx = pw - M - totW
    setF(doc, 'bold'); doc.setFontSize(7); doc.setTextColor(...t.accent)
    doc.text(String(p.signature.label || 'Bon pour accord').toUpperCase(), sx, ys + 2.5, { charSpace: 0.4 })
    setF(doc, 'normal'); doc.setFontSize(6.8); doc.setTextColor(...t.muted)
    const hint = doc.splitTextToSize(p.signature.hint || '', totW)
    hint.forEach((l, i) => doc.text(l, sx, ys + 6 + i * 3))
    const by = ys + 6 + hint.length * 3
    doc.setDrawColor(...t.line); doc.setLineWidth(0.3)
    doc.rect(sx, by, totW, sh)
    if (p.signature.image) drawImageFitted(doc, p.signature.image, sx + 2, by + 1, totW - 4, sh - 2)
    doc.setTextColor(...t.text)
    f.y = Math.max(by + sh, ys + (noteLines.length ? noteLines.length * 4 + 10 : 0)) + 6
  } else if (p.notes) {
    f.callout('Note', p.notes, { tone: 'muted' })
  }

  // Mentions
  if (p.legal && p.legal.length) {
    f.space(1)
    p.legal.filter(Boolean).forEach(l => f.note(l, { after: 1.2 }))
  }

  f.finish()
  if (doc.getNumberOfPages() > 1) numberPages(doc, L)
  return doc
}

/** Lignes de la carte émetteur */
export function issuerLines(L, contact) {
  return [
    L.legal_name || L.name,
    L.street,
    [L.postal_code, L.city].filter(Boolean).join(' '),
    L.tva ? 'TVA intracommunautaire : ' + L.tva : null,
    contact && contact.name ? 'Contact : ' + contact.name : null,
    [contact && contact.phone, contact && contact.email].filter(Boolean).join(' · ') || null,
  ]
}

/** Lignes de la carte destinataire */
export function recipientLines(client, contact, withContact) {
  const lines = [client?.name || '']
  if (withContact && contact) {
    const cn = contact.name || ((contact.first_name || '') + ' ' + (contact.last_name || '')).trim()
    if (cn) lines.push("À l'attention de " + (contact.civilite ? contact.civilite + ' ' : '') + cn)
  }
  if (client?.address) lines.push(client.address)
  const cl = [client?.postal_code, (client?.city || '').toUpperCase()].filter(Boolean).join(' ')
  if (cl) lines.push(cl)
  if (client?.siret) lines.push('SIRET : ' + client.siret)
  else if (client?.siren) lines.push('SIREN : ' + client.siren)
  if (client?.tva) lines.push('TVA : ' + client.tva)
  return lines
}

/** Mentions légales de l'organisme (forme, capital, RCS) */
export function companyLegalLine(L) {
  const name = L.legal_name || L.name || ''
  const forme = L.forme_juridique && !name.toLowerCase().includes(L.forme_juridique.toLowerCase()) ? L.forme_juridique : ''
  if (!forme && !L.capital_social && !L.rcs) return null
  const first = [name, forme].filter(Boolean).join(', ') + (L.capital_social ? ' au capital de ' + L.capital_social + ' €' : '')
  return [first, L.rcs ? 'RCS ' + L.rcs : null].filter(Boolean).join(' · ')
}

/** Coordonnées bancaires (rien si pas d'IBAN dans les paramètres) */
export function bankRows(L) {
  if (!L.iban) return []
  return [['Banque', L.bank_name || ''], ['IBAN', L.iban], ['BIC', L.bic || '']]
}
