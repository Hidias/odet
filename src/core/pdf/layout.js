// Mise en page commune des documents PDF (jsPDF) : bandeau d'identité, en-tête de page
// suivante, pied de page, titre, cartes et tableaux clé / valeur.
// Tout vient de l'objet ORG construit par buildORG() (core/org/orgUtils.js) : aucune valeur
// d'organisme en dur ici. Les couleurs viennent de ORG.theme (marque de l'instance).

import { APP_VERSION } from '../version'

export const PAGE_MARGIN = 15

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
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...t.primary)
    doc.text(ORG.name || '', M, 20)
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...t.primary)
  doc.text((ORG.nameFull || ORG.name || '').toUpperCase(), pw - M, 12, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...t.muted)
  doc.text(ORG.address || '', pw - M, 16.5, { align: 'right' })
  doc.text([ORG.phone, ORG.email].filter(Boolean).join('   '), pw - M, 20.5, { align: 'right' })
  doc.text([ORG.siret ? `SIRET ${ORG.siret}` : '', ORG.nda ? `NDA ${ORG.nda}` : ''].filter(Boolean).join('   '), pw - M, 24.5, { align: 'right' })
  doc.setDrawColor(...t.highlight); doc.setLineWidth(0.6)
  doc.line(M, 30, pw - M, 30)
  if (docLabel || ref) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...t.muted)
    if (docLabel) doc.text(docLabel.toUpperCase(), M, 34.5, { charSpace: 0.4 })
    if (ref) { doc.setFont('helvetica', 'bold'); doc.setTextColor(...t.accent); doc.text(ref, pw - M, 34.5, { align: 'right' }) }
  }
  doc.setTextColor(...t.text)
  return 42
}

// En-tête réduit des pages suivantes. Retourne le y de reprise.
export function drawRunningHeader(doc, ORG, { ref = null, docLabel = '' } = {}) {
  const pw = doc.internal.pageSize.getWidth()
  const M = PAGE_MARGIN
  const t = ORG.theme
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...t.muted)
  doc.text(`${ORG.name || ''}   ${docLabel}`.toUpperCase(), M, 12, { charSpace: 0.3 })
  if (ref) { doc.setFont('helvetica', 'bold'); doc.setTextColor(...t.accent); doc.text(ref, pw - M, 12, { align: 'right' }) }
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
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...t.muted)
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
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...ORG.theme.muted)
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
  doc.setFont('helvetica', 'bold'); doc.setFontSize(size); doc.setTextColor(...t.primary)
  doc.text(title, M + 5, y)
  if (subtitle) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...t.muted)
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
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...t.primary)
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
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...t.accent)
  doc.text(label.toUpperCase(), x + padX, y + padTop, { charSpace: 0.4 })
  let yy = y + padTop + 5
  lines.forEach((ln, i) => {
    doc.setFont('helvetica', i === 0 ? 'bold' : 'normal'); doc.setFontSize(i === 0 ? 9.5 : 8.5); doc.setTextColor(...t.text)
    const parts = doc.splitTextToSize(String(ln || ''), w - padX * 2)
    doc.text(parts[0] || '', x + padX, yy)
    yy += lineH
  })
  if (footnote) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(...t.muted)
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
    doc.setFont('helvetica', 'bold'); doc.setFontSize(fontSize - 1); doc.setTextColor(...t.muted)
    doc.text(String(k).toUpperCase(), x, y + 4.2, { charSpace: 0.2 })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(fontSize); doc.setTextColor(...t.text)
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
