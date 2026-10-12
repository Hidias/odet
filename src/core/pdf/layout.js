// Mise en page commune des documents PDF (jsPDF) : bandeau d'identité, en-tête de page
// suivante, pied de page, titre, cartes et tableaux clé / valeur.
// Tout vient de l'objet ORG construit par buildORG() (core/org/orgUtils.js) : aucune valeur
// d'organisme en dur ici. Les couleurs viennent de ORG.theme (marque de l'instance).

import { APP_VERSION } from '../version'

export const PAGE_MARGIN = 15

// Police du document : Helvetica par défaut ; un document peut en imposer une autre
// (doc.__odetFont, ex. Liberation Sans intégrée pour la facture PDF/A). Les polices
// intégrées n'ont pas d'italique : l'italique retombe sur le style droit.
export function fontOf(doc) { return (doc && doc.__odetFont) || 'helvetica' }
export function setF(doc, style = 'normal') {
  const font = fontOf(doc)
  let st = style
  if (font !== 'helvetica') st = style === 'bolditalic' ? 'bold' : (style === 'italic' ? 'normal' : style)
  doc.setFont(font, st)
}

// Dessine le logo dans une boîte en conservant ses proportions
export function drawLogoFitted(doc, logoBase64, x, y, maxW, maxH) {
  const fmt = logoBase64.includes('image/png') ? 'PNG' : 'JPEG'
  let w = maxW, h = maxH
  try {
    const p = doc.getImageProperties(logoBase64)
    if (p?.width && p?.height) {
      const r = p.width / p.height
      if (maxW / r <= maxH) { w = maxW; h = maxW / r } else { h = maxH; w = maxH * r }
    }
  } catch { /* proportions inconnues : boîte par défaut */ }
  doc.addImage(logoBase64, fmt, x, y + (maxH - h) / 2, w, h)
  return { w, h }
}

// Image insérée sans déformation, centrée dans une case. Retourne false si l'image est absente ou invalide.
export function drawImageFitted(doc, imageData, x, y, boxW, boxH, format = 'PNG') {
  if (!imageData || typeof imageData !== 'string' || !imageData.startsWith('data:image')) return false
  try {
    let ratio = 2.5
    try {
      const p = doc.getImageProperties(imageData)
      if (p?.width && p?.height) ratio = p.width / p.height
    } catch { /* proportions par défaut */ }
    let w = boxW
    let h = w / ratio
    if (h > boxH) { h = boxH; w = h * ratio }
    doc.addImage(imageData, format, x + (boxW - w) / 2, y + (boxH - h) / 2, w, h)
    return true
  } catch (e) {
    console.warn('Image non insérée dans le PDF :', e)
    return false
  }
}

/**
 * Bandeau de première page : logo à gauche, identité de l'organisme à droite, filet de couleur,
 * puis libellé du document (à gauche) et référence (à droite, en accent).
 * Retourne le y de reprise.
 */
export function drawHeaderBand(doc, ORG, { ref = null, docLabel = '' } = {}) {
  const pw = doc.internal.pageSize.getWidth()
  const M = PAGE_MARGIN
  const t = ORG.theme
  if (ORG.logo_base64) {
    try { drawLogoFitted(doc, ORG.logo_base64, M, 10, 42, 16) } catch { /* logo illisible : on continue sans */ }
  } else {
    setF(doc, 'bold'); doc.setFontSize(13); doc.setTextColor(...t.primary)
    doc.text(ORG.name || '', M, 20)
  }
  setF(doc, 'bold'); doc.setFontSize(8.5); doc.setTextColor(...t.primary)
  doc.text((ORG.nameFull || ORG.name || '').toUpperCase(), pw - M, 12, { align: 'right' })
  setF(doc, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...t.muted)
  doc.text(ORG.address || '', pw - M, 16.5, { align: 'right' })
  doc.text([ORG.phone, ORG.email].filter(Boolean).join('   '), pw - M, 20.5, { align: 'right' })
  doc.text([ORG.siret ? `SIRET ${ORG.siret}` : '', ORG.nda ? `NDA ${ORG.nda}` : ''].filter(Boolean).join('   '), pw - M, 24.5, { align: 'right' })
  doc.setDrawColor(...t.highlight); doc.setLineWidth(0.6)
  doc.line(M, 30, pw - M, 30)
  if (docLabel || ref) {
    setF(doc, 'normal'); doc.setFontSize(7); doc.setTextColor(...t.muted)
    if (docLabel) doc.text(docLabel.toUpperCase(), M, 34.5, { charSpace: 0.4 })
    if (ref) { setF(doc, 'bold'); doc.setTextColor(...t.accent); doc.text(ref, pw - M, 34.5, { align: 'right' }) }
  }
  doc.setTextColor(...t.text)
  return 42
}

// En-tête réduit des pages suivantes. Retourne le y de reprise.
export function drawRunningHeader(doc, ORG, { ref = null, docLabel = '' } = {}) {
  const pw = doc.internal.pageSize.getWidth()
  const M = PAGE_MARGIN
  const t = ORG.theme
  setF(doc, 'normal'); doc.setFontSize(7); doc.setTextColor(...t.muted)
  doc.text(`${ORG.name || ''}   ${docLabel}`.toUpperCase(), M, 12, { charSpace: 0.3 })
  if (ref) { setF(doc, 'bold'); doc.setTextColor(...t.accent); doc.text(ref, pw - M, 12, { align: 'right' }) }
  doc.setDrawColor(...t.line); doc.setLineWidth(0.3)
  doc.line(M, 15, pw - M, 15)
  doc.setTextColor(...t.text)
  return 24
}

/**
 * Pied de page : identité légale sur deux lignes, code documentaire et numéro de page.
 * pageNum / totalPages optionnels (voir numberPages pour une numérotation finale).
 */
export function drawFooter(doc, ORG, docCode, pageNum = null, totalPages = null) {
  const ph = doc.internal.pageSize.getHeight()
  const pw = doc.internal.pageSize.getWidth()
  const M = PAGE_MARGIN
  const t = ORG.theme
  doc.setDrawColor(...t.line); doc.setLineWidth(0.3)
  doc.line(M, ph - 16, pw - M, ph - 16)
  setF(doc, 'normal'); doc.setFontSize(6.5); doc.setTextColor(...t.muted)
  const l1 = [ORG.nameFull || ORG.name, ORG.addressFull].filter(Boolean).join('  ·  ')
  const l2 = [ORG.siret ? `SIRET ${ORG.siret}` : '', ORG.naf ? `NAF ${ORG.naf}` : '', ORG.tva ? `TVA ${ORG.tva}` : '', ORG.ndaFull ? `NDA ${ORG.ndaFull}` : ''].filter(Boolean).join('  ·  ')
  doc.text(l1, M, ph - 11.5)
  doc.text(l2, M, ph - 8)
  doc.text(`${ORG.doc_prefix ? ORG.doc_prefix + '-' : ''}${docCode}-${APP_VERSION}`, pw - M, ph - 8, { align: 'right' })
  if (pageNum) doc.text(totalPages ? `Page ${pageNum} / ${totalPages}` : `Page ${pageNum}`, pw - M, ph - 11.5, { align: 'right' })
  doc.setTextColor(...t.text)
}

// Numérotation « Page x / y » sur toutes les pages, à appeler une fois le document terminé.
export function numberPages(doc, ORG) {
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const total = doc.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    setF(doc, 'normal'); doc.setFontSize(6.5); doc.setTextColor(...ORG.theme.muted)
    doc.text(`Page ${p} / ${total}`, pw - PAGE_MARGIN, ph - 11.5, { align: 'right' })
  }
  doc.setTextColor(...ORG.theme.text)
}

// Titre de document : trait court en accent à gauche, titre en couleur principale, sous-titre discret.
export function drawDocTitle(doc, ORG, title, subtitle, y, { size = 17 } = {}) {
  const t = ORG.theme
  const M = PAGE_MARGIN
  doc.setFillColor(...t.accent)
  doc.rect(M, y - 6.5, 1.6, 9, 'F')
  setF(doc, 'bold'); doc.setFontSize(size); doc.setTextColor(...t.primary)
  doc.text(title, M + 5, y)
  if (subtitle) {
    setF(doc, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...t.muted)
    doc.text(subtitle, M + 5, y + 5.5)
    y += 5.5
  }
  doc.setTextColor(...t.text)
  return y + 10
}

// Titre de section : texte en couleur principale souligné d'un trait court en couleur de détail.
export function drawSectionTitle(doc, ORG, label, y) {
  const t = ORG.theme
  const M = PAGE_MARGIN
  setF(doc, 'bold'); doc.setFontSize(10); doc.setTextColor(...t.primary)
  doc.text(label, M, y)
  doc.setDrawColor(...t.highlight); doc.setLineWidth(0.5)
  doc.line(M, y + 2, M + 14, y + 2)
  doc.setTextColor(...t.text)
  return y + 8
}

/**
 * Carte « partie » (organisme, bénéficiaire, stagiaire) : étiquette en accent, première ligne en gras,
 * fond de surface et liseré accent à gauche. Retourne le y bas de la carte.
 */
export function drawPartyCard(doc, ORG, x, y, w, label, lines, footnote) {
  const t = ORG.theme
  const padX = 4, padTop = 5
  const lineH = 4.2
  const h = padTop + 4 + lines.length * lineH + (footnote ? 5 : 0) + 3
  doc.setFillColor(...t.surface)
  doc.rect(x, y, w, h, 'F')
  doc.setFillColor(...t.accent)
  doc.rect(x, y, 1.2, h, 'F')
  setF(doc, 'bold'); doc.setFontSize(7); doc.setTextColor(...t.accent)
  doc.text(label.toUpperCase(), x + padX, y + padTop, { charSpace: 0.4 })
  let yy = y + padTop + 5
  lines.forEach((ln, i) => {
    setF(doc, i === 0 ? 'bold' : 'normal'); doc.setFontSize(i === 0 ? 9.5 : 8.5); doc.setTextColor(...t.text)
    const parts = doc.splitTextToSize(String(ln || ''), w - padX * 2)
    doc.text(parts[0] || '', x + padX, yy)
    yy += lineH
  })
  if (footnote) {
    setF(doc, 'italic'); doc.setFontSize(7.5); doc.setTextColor(...t.muted)
    doc.text(footnote, x + padX, yy + 1)
  }
  doc.setTextColor(...t.text)
  return y + h
}

// Tableau clé / valeur : étiquette en capitales discrètes, valeur à droite, filet entre les lignes.
export function drawKeyValues(doc, ORG, x, y, w, rows, { labelW = 34, fontSize = 8.5 } = {}) {
  const t = ORG.theme
  rows.forEach(([k, v]) => {
    const lines = doc.splitTextToSize(String(v ?? ''), w - labelW)
    const h = Math.max(1, lines.length) * 4 + 2.6
    doc.setDrawColor(...t.line); doc.setLineWidth(0.25)
    doc.line(x, y + h, x + w, y + h)
    setF(doc, 'bold'); doc.setFontSize(fontSize - 1); doc.setTextColor(...t.muted)
    doc.text(String(k).toUpperCase(), x, y + 4.2, { charSpace: 0.2 })
    setF(doc, 'normal'); doc.setFontSize(fontSize); doc.setTextColor(...t.text)
    lines.forEach((l, i) => doc.text(l, x + labelW, y + 4.2 + i * 4))
    y += h
  })
  return y + 1
}

// Coche pleine (présence validée) dans une case carrée arrondie
export function drawCheckmark(doc, ORG, cx, cy, size, color) {
  const t = ORG.theme
  doc.setFillColor(...color); doc.roundedRect(cx, cy, size, size, 0.8, 0.8, 'F')
  doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.7)
  doc.line(cx + size * 0.25, cy + size * 0.58, cx + size * 0.45, cy + size * 0.78)
  doc.line(cx + size * 0.45, cy + size * 0.78, cx + size * 0.8, cy + size * 0.3)
  doc.setDrawColor(...t.line); doc.setLineWidth(0.25)
}

// Montant en euros, format français, sans espace insécable (non rendu par les polices standard de jsPDF)
export function formatMoney(n) {
  const s = Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ')
  return `${s} ${String.fromCharCode(8364)}`
}

// Heure « 09:00:00 » ou « 09:00 » affichée « 09h00 »
export function formatHour(t) {
  return (t || '').slice(0, 5).replace(':', 'h')
}

// ───────────────────────────────────────────────────────────────────────────────
// Composition des documents : un « flux » qui gère le saut de page (en-tête réduit + pied)
// et des blocs prêts à l'emploi. Tous les documents générés passent par ces blocs pour garder
// la même apparence que la convention, la convocation et l'attestation.
// ───────────────────────────────────────────────────────────────────────────────

/** Case à cocher carrée : vide (filet) ou cochée (pleine, couleur d'accent, coche blanche) */
export function drawCheckbox(doc, ORG, x, y, size = 3.4, checked = false, color = null) {
  const t = ORG.theme
  if (checked) {
    drawCheckmark(doc, ORG, x, y, size, color || t.accent)
  } else {
    doc.setDrawColor(...t.muted); doc.setLineWidth(0.3)
    doc.roundedRect(x, y, size, size, 0.6, 0.6, 'S')
  }
  doc.setDrawColor(...t.line)
}

/** Styles jspdf-autotable communs : en-tête couleur principale, lignes alternées, filets fins */
export function tableTheme(ORG, extraIn = {}) {
  const { font, ...extra } = extraIn
  const t = ORG.theme
  return {
    theme: 'grid',
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, top: 24, bottom: 22 },
    styles: { font: font || 'helvetica', fontSize: 8.5, textColor: t.text, lineColor: t.line, lineWidth: 0.2, cellPadding: 2.2, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: t.primary, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5, cellPadding: 2.4 },
    alternateRowStyles: { fillColor: t.surface },
    ...extra,
  }
}

/** Début de document : bandeau, titre, et flux prêt à écrire */
export function startDocument(doc, ORG, { ref = null, docLabel = '', code = 'DOC', title = '', subtitle = null, bottom } = {}) {
  let y = drawHeaderBand(doc, ORG, { ref, docLabel })
  if (title) y = drawDocTitle(doc, ORG, title, subtitle, y)
  return createFlow(doc, ORG, { ref, docLabel, code, startY: y, bottom })
}

/**
 * Flux de mise en page avec saut de page automatique.
 * f.y : position courante ; f.ensure(h) : saute de page si h ne tient pas.
 */
export function createFlow(doc, ORG, { ref = null, docLabel = '', code = 'DOC', startY = 42, bottom } = {}) {
  const t = ORG.theme
  const M = PAGE_MARGIN
  const W = doc.internal.pageSize.getWidth() - M * 2
  const BOTTOM = bottom || (doc.internal.pageSize.getHeight() - 19)
  const LINE = 4.1
  const f = { y: startY, M, W, LINE, t, doc, ORG, pages: 1 }
  f.body = (size = 9) => { setF(doc, 'normal'); doc.setFontSize(size); doc.setTextColor(...t.text) }
  f.newPage = () => {
    drawFooter(doc, ORG, code)
    doc.addPage()
    f.pages += 1
    f.y = drawRunningHeader(doc, ORG, { ref, docLabel })
  }
  f.ensure = (h) => { if (f.y + h > BOTTOM) f.newPage() }
  f.finish = () => { drawFooter(doc, ORG, code) }
  f.space = (h = 3) => { f.y += h }

  f.para = (text, { x = M, w = W, size = 9, after = 2.5, style = 'normal', color = null, align = 'left' } = {}) => {
    f.body(size)
    setF(doc, style)
    const lines = doc.splitTextToSize(String(text ?? ''), w)
    const lh = size * 0.455
    f.ensure(Math.min(lines.length, 3) * lh)
    lines.forEach(l => {
      f.ensure(lh)
      f.body(size); setF(doc, style); if (color) doc.setTextColor(...color)
      if (align === 'center') doc.text(l, x + w / 2, f.y, { align: 'center' })
      else doc.text(l, x, f.y)
      f.y += lh
    })
    f.y += after
    doc.setTextColor(...t.text)
  }
  f.note = (text, opts = {}) => f.para(text, { size: 7.5, color: t.muted, ...opts })

  f.bullets = (items, { x = M, w = W, size = 9 } = {}) => {
    items.filter(Boolean).forEach(it => {
      f.body(size)
      const lines = doc.splitTextToSize(String(it), w - 5)
      f.ensure(lines.length * LINE)
      f.body(size)
      doc.setFillColor(...t.highlight); doc.circle(x + 1.5, f.y - 1.1, 0.7, 'F')
      lines.forEach(l => { doc.text(l, x + 5, f.y); f.y += LINE })
    })
    f.y += 2
  }

  f.section = (label) => { f.ensure(11 + LINE * 3); f.y += 3; f.y = drawSectionTitle(doc, ORG, label, f.y) }

  // Petit intertitre en capitales discrètes (comme « OBJECTIFS » sur la convocation)
  f.label = (label) => {
    f.ensure(5 + LINE * 2)
    setF(doc, 'bold'); doc.setFontSize(7.5); doc.setTextColor(...t.muted)
    doc.text(String(label).toUpperCase(), M, f.y, { charSpace: 0.2 })
    doc.setTextColor(...t.text)
    f.y += 4.5
  }

  f.kv = (rows, { labelW = 34 } = {}) => {
    rows.filter(r => r && r[1] !== undefined && r[1] !== null).forEach(r => {
      const h = Math.max(1, doc.splitTextToSize(String(r[1] ?? ''), W - labelW).length) * 4 + 2.6
      f.ensure(h)
      f.y = drawKeyValues(doc, ORG, M, f.y, W, [r], { labelW }) - 1
    })
    f.y += 1
  }

  // Cartes côte à côte : [{ label, lines, footnote }]
  f.cards = (cards, { gap = 6 } = {}) => {
    const n = cards.length
    const colW = (W - gap * (n - 1)) / n
    const maxLines = Math.max(...cards.map(c => c.lines.length))
    cards.forEach(c => { while (c.lines.length < maxLines) c.lines.push('') })
    f.ensure(14 + maxLines * 4.2)
    let bottomY = f.y
    cards.forEach((c, i) => {
      bottomY = Math.max(bottomY, drawPartyCard(doc, ORG, M + i * (colW + gap), f.y, colW, c.label, c.lines, c.footnote))
    })
    f.y = bottomY + 6
  }

  // Encadré : fond de surface, liseré d'accent, étiquette et texte
  f.callout = (label, text, { tone = 'accent' } = {}) => {
    const color = tone === 'muted' ? t.muted : (tone === 'highlight' ? t.highlight : t.accent)
    setF(doc, 'normal'); doc.setFontSize(9)
    const lines = doc.splitTextToSize(String(text ?? ''), W - 10)
    const h = (label ? 10 : 5) + lines.length * 4.2 + 3
    f.ensure(h + 2)
    const by = f.y
    doc.setFillColor(...t.surface); doc.rect(M, by, W, h, 'F')
    doc.setFillColor(...color); doc.rect(M, by, 1.2, h, 'F')
    let yy = by + 5.5
    if (label) {
      setF(doc, 'bold'); doc.setFontSize(7); doc.setTextColor(...color)
      doc.text(String(label).toUpperCase(), M + 4, yy, { charSpace: 0.4 })
      yy += 5.5
    }
    setF(doc, 'normal'); doc.setFontSize(9); doc.setTextColor(...t.text)
    lines.forEach((l, i) => doc.text(l, M + 4, yy + i * 4.2))
    f.y = by + h + 5
  }

  // Champs à remplir (ou remplis) sur une ligne : [{ label, value, w }] ; w en fraction de la largeur
  f.fields = (fields, { gap = 6, height = 9 } = {}) => {
    f.ensure(height + 2)
    const total = fields.reduce((s, fl) => s + (fl.w || 1), 0)
    const usable = W - gap * (fields.length - 1)
    let x = M
    fields.forEach(fl => {
      const w = usable * (fl.w || 1) / total
      setF(doc, 'bold'); doc.setFontSize(6.8); doc.setTextColor(...t.muted)
      doc.text(String(fl.label || '').toUpperCase(), x, f.y, { charSpace: 0.2 })
      const ly = f.y + height - 3
      doc.setDrawColor(...t.line); doc.setLineWidth(0.3); doc.line(x, ly + 1.2, x + w, ly + 1.2)
      if (fl.value !== undefined && fl.value !== null && String(fl.value) !== '') {
        setF(doc, 'normal'); doc.setFontSize(9); doc.setTextColor(...t.text)
        doc.text(doc.splitTextToSize(String(fl.value), w)[0] || '', x, ly)
      }
      x += w + gap
    })
    doc.setTextColor(...t.text)
    f.y += height + 3
  }

  // Liste de cases : [{ label, checked, muted }] ; inline: true pour une seule ligne
  f.checks = (items, { inline = false, size = 9, colW = null, columns = 1 } = {}) => {
    const box = 3.4
    if (columns > 1) {
      const cw = W / columns
      for (let i = 0; i < items.length; i += columns) {
        f.ensure(6)
        items.slice(i, i + columns).forEach((it, j) => {
          const x = M + j * cw
          drawCheckbox(doc, ORG, x + 1, f.y - box + 0.6, box, !!it.checked, it.color || null)
          f.body(size); if (it.checked) setF(doc, 'bold')
          doc.text(doc.splitTextToSize(String(it.label), cw - box - 6)[0] || '', x + box + 4, f.y)
        })
        f.y += 5.6
      }
      f.y += 1
      return
    }
    if (inline) {
      f.ensure(6)
      let x = M
      items.forEach(it => {
        drawCheckbox(doc, ORG, x, f.y - box + 0.6, box, !!it.checked)
        f.body(size); if (it.muted && !it.checked) doc.setTextColor(...t.muted)
        if (it.checked) setF(doc, 'bold')
        doc.text(String(it.label), x + box + 2, f.y)
        x += colW || (doc.getTextWidth(String(it.label)) + box + 9)
      })
      doc.setTextColor(...t.text)
      f.y += 6.5
      return
    }
    items.forEach(it => {
      f.body(size)
      const lines = doc.splitTextToSize(String(it.label), W - 8)
      f.ensure(lines.length * LINE + 1.5)
      drawCheckbox(doc, ORG, M + 1, f.y - box + 0.6, box, !!it.checked, it.color || null)
      f.body(size); if (it.muted && !it.checked) doc.setTextColor(...t.muted)
      if (it.checked) setF(doc, 'bold')
      if (it.color) doc.setTextColor(...it.color)
      lines.forEach(l => { doc.text(l, M + box + 4, f.y); f.y += LINE })
      f.y += 1.5
      doc.setTextColor(...t.text)
    })
    f.y += 1
  }

  // Zone d'écriture encadrée, avec étiquette et texte éventuel (réponse saisie)
  f.box = (label, { height = 22, text = null, lined = false } = {}) => {
    setF(doc, 'normal'); doc.setFontSize(8.5)
    const lines = text ? doc.splitTextToSize(String(text), W - 6) : []
    const h = Math.max(height, lines.length * 4 + 6)
    f.ensure((label ? 5 : 0) + h + 3)
    if (label) {
      setF(doc, 'bold'); doc.setFontSize(7.5); doc.setTextColor(...t.muted)
      doc.text(String(label).toUpperCase(), M, f.y, { charSpace: 0.2 })
      f.y += 2.5
    }
    doc.setDrawColor(...t.line); doc.setLineWidth(0.3); doc.setFillColor(255, 255, 255)
    doc.roundedRect(M, f.y, W, h, 1, 1, 'S')
    if (lined && !lines.length) {
      for (let ly = f.y + 7; ly < f.y + h - 2; ly += 7) doc.line(M + 3, ly, M + W - 3, ly)
    }
    if (lines.length) {
      setF(doc, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...t.text)
      lines.forEach((l, i) => doc.text(l, M + 3, f.y + 5 + i * 4))
    }
    f.y += h + 5
    doc.setTextColor(...t.text)
  }

  /**
   * Grille de notation : sections [{ title, rows: [{ label, value }] }], échelle (ex. [1..5]),
   * colonne « N/C » facultative. value = note cochée (ou 'nc').
   */
  f.ratingGrid = (sections, { scale = [1, 2, 3, 4, 5], nc = true, colW = 10, rowH = 6.4, gap = 4 } = {}) => {
    const cols = [...scale.map(String), ...(nc ? ['N/C'] : [])]
    const gridW = cols.length * colW
    const labelW = W - gridW
    const headH = 6
    const drawHead = (title) => {
      doc.setFillColor(...t.primary); doc.rect(M, f.y, W, headH, 'F')
      setF(doc, 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255)
      doc.text(String(title).toUpperCase(), M + 3, f.y + 4.1, { charSpace: 0.3 })
      cols.forEach((c, i) => doc.text(c, M + labelW + i * colW + colW / 2, f.y + 4.1, { align: 'center' }))
      f.y += headH
    }
    sections.forEach(sec => {
      f.ensure(headH + rowH * Math.min(sec.rows.length, 3) + 2)
      drawHead(sec.title)
      sec.rows.forEach((r, ri) => {
        f.body(8)
        const lines = doc.splitTextToSize(String(r.label), labelW - 5)
        const h = Math.max(rowH, lines.length * 3.6 + 2.8)
        if (f.y + h > BOTTOM) { f.newPage(); drawHead(sec.title) }
        if (ri % 2 === 1) { doc.setFillColor(...t.surface); doc.rect(M, f.y, W, h, 'F') }
        doc.setDrawColor(...t.line); doc.setLineWidth(0.2); doc.line(M, f.y + h, M + W, f.y + h)
        f.body(8)
        lines.forEach((l, i) => doc.text(l, M + 3, f.y + h / 2 - (lines.length - 1) * 1.8 + 1.2 + i * 3.6))
        cols.forEach((c, i) => {
          const val = c === 'N/C' ? (r.value === 'nc' || r.value === 0) : Number(r.value) === Number(c)
          drawCheckbox(doc, ORG, M + labelW + i * colW + colW / 2 - 1.7, f.y + h / 2 - 1.7, 3.4, val)
        })
        f.y += h
      })
      f.y += gap
    })
  }

  // Question et cases sur une même ligne : « Recommanderiez-vous… ?  [ ] Oui  [ ] Non »
  f.choiceLine = (label, items, { size = 9, colW = 20 } = {}) => {
    f.ensure(7)
    f.body(size); setF(doc, 'bold')
    doc.text(String(label), M, f.y)
    let x = M + doc.getTextWidth(String(label)) + 6
    const box = 3.4
    items.forEach(it => {
      drawCheckbox(doc, ORG, x, f.y - box + 0.6, box, !!it.checked)
      f.body(size); if (it.checked) setF(doc, 'bold')
      doc.text(String(it.label), x + box + 2, f.y)
      x += colW
    })
    doc.setTextColor(...t.text)
    f.y += 7
  }

  // Cadres de signature côte à côte : [{ label, name, hint, image, stamp }]
  f.signatures = (blocks, { height = 32, gap = 6 } = {}) => {
    const n = blocks.length
    const colW = (W - gap * (n - 1)) / n
    f.ensure(height + 4)
    const by = f.y
    blocks.forEach((b, i) => {
      const x = M + i * (colW + gap)
      doc.setDrawColor(...t.line); doc.setLineWidth(0.3); doc.rect(x, by, colW, height)
      doc.setFillColor(...t.surface); doc.rect(x, by, colW, b.name ? 11 : 7, 'F')
      setF(doc, 'bold'); doc.setFontSize(7); doc.setTextColor(...t.accent)
      doc.text(String(b.label || '').toUpperCase(), x + 4, by + 4.5, { charSpace: 0.4 })
      if (b.name) {
        setF(doc, 'normal'); doc.setFontSize(8); doc.setTextColor(...t.text)
        doc.text(doc.splitTextToSize(String(b.name), colW - 8)[0] || '', x + 4, by + 8.8)
      }
      setF(doc, 'italic'); doc.setFontSize(7); doc.setTextColor(...t.muted)
      doc.text(b.hint || 'Signature', x + 4, by + height - 3)
      if (b.stamp) drawImageFitted(doc, b.stamp, x + 4, by + 13, Math.min(44, colW / 2), height - 18, 'JPEG')
      if (b.image) drawImageFitted(doc, b.image, x + colW / 2, by + 13, colW / 2 - 4, height - 18)
    })
    doc.setTextColor(...t.text)
    f.y = by + height + 5
  }

  // Tableau jspdf-autotable aux couleurs de l'instance ; continue le flux après le tableau
  f.table = (head, body, opts = {}) => {
    f.ensure(16)
    doc.autoTable({
      startY: f.y,
      head: head ? [head] : undefined,
      body,
      ...tableTheme(ORG, { font: fontOf(doc), ...opts }),
      didDrawPage: (data) => {
        if (data.pageNumber > 1) drawRunningHeader(doc, ORG, { ref, docLabel })
        if (opts.didDrawPage) opts.didDrawPage(data)
      },
    })
    const pagesNow = doc.getNumberOfPages()
    if (pagesNow > f.pages) {
      // Pied de page des pages créées par le tableau (la dernière reçoit le sien à la fin)
      for (let p = f.pages; p < pagesNow; p++) { doc.setPage(p); drawFooter(doc, ORG, code) }
      doc.setPage(pagesNow)
      f.pages = pagesNow
    }
    f.y = doc.lastAutoTable.finalY + 5
  }

  // Lieu, date et signataire (dirigeant) alignés à droite, comme la convocation
  f.signOff = ({ date = new Date(), place = null } = {}) => {
    f.ensure(14)
    f.body(9)
    const d = date instanceof Date ? date : new Date(date)
    const ds = isNaN(d) ? '' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
    doc.text(`Fait à ${place || ORG.lieu_signature || ORG.city || ''}, le ${ds}.`, M, f.y)
    const rx = M + W
    if (ORG.dirigeant_signature_base64) drawImageFitted(doc, ORG.dirigeant_signature_base64, rx - 75, f.y - 6, 28, 12)
    setF(doc, 'bold'); doc.text(ORG.dirigeant || '', rx, f.y, { align: 'right' })
    setF(doc, 'normal'); doc.setTextColor(...t.muted)
    doc.text([ORG.dirigeant_title, ORG.name].filter(Boolean).join(', '), rx, f.y + 4.5, { align: 'right' })
    doc.setTextColor(...t.text)
    f.y += 12
  }

  return f
}

// Texte libre des paramètres (règlement, livret) : paragraphes séparés par une ligne vide,
// lignes courtes sans ponctuation finale = intertitres, lignes « - » = puces.
export function writeRichText(f, text) {
  String(text || '').trim().split(/\n{2,}/).forEach((block) => {
    const b = block.trim()
    if (!b) return
    const isTitle = b.length < 90 && !b.includes('\n') && !/[.:;,!?]$/.test(b)
    if (isTitle) { f.section(b.replace(/^#+\s*/, '')); return }
    const lines = b.split('\n')
    if (lines.every(l => /^\s*[-•*]\s+/.test(l))) { f.bullets(lines.map(l => l.replace(/^\s*[-•*]\s+/, ''))); return }
    f.para(b.replace(/\n/g, ' '), { after: 3 })
  })
}
