// Planche d'étiquettes QR (A4, 3 colonnes x 8 rangées, étiquettes 70 x 37 mm, format courant du commerce).
// Le QR code ouvre la fiche de l'appareil dans l'application (connexion requise).

import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { setF } from '../../../core/pdf/layout'

export const LABEL = { w: 70, h: 37, cols: 3, rows: 8, top: 0.5, left: 0 }

/** Adresse ouverte par le QR code d'un appareil */
export function equipmentUrl(code, base = null) {
  const origin = base || (typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '')
  return `${origin.replace(/\/$/, '')}/#/interventions/appareil/${encodeURIComponent(code)}`
}

export async function buildEtiquettesPDF(equipment, { client = null, org = null, base = null, startAt = 0 } = {}) {
  const ORG = org || await loadPdfOrg()
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const t = ORG.theme
  const perPage = LABEL.cols * LABEL.rows
  let slot = startAt
  for (const e of equipment) {
    if (slot > 0 && slot % perPage === 0) doc.addPage()
    const k = slot % perPage
    const col = k % LABEL.cols, row = Math.floor(k / LABEL.cols)
    const x = LABEL.left + col * LABEL.w, y = LABEL.top + row * LABEL.h
    const qr = await QRCode.toDataURL(equipmentUrl(e.label_code, base), { margin: 0, errorCorrectionLevel: 'M', width: 300 })
    const q = 27
    doc.addImage(qr, 'PNG', x + 4, y + (LABEL.h - q) / 2, q, q)
    const tx = x + 4 + q + 3, tw = LABEL.w - (q + 11)
    setF(doc, 'bold'); doc.setFontSize(6.2); doc.setTextColor(...t.muted)
    doc.text(doc.splitTextToSize(String(ORG.name || '').toUpperCase(), tw)[0] || '', tx, y + 8, { charSpace: 0.15 })
    setF(doc, 'bold'); doc.setFontSize(12); doc.setTextColor(...t.text)
    doc.text(e.label_code, tx, y + 14)
    setF(doc, 'normal'); doc.setFontSize(7.4)
    const typeLines = doc.splitTextToSize(String(e.itv_equipment_types?.name || ''), tw).slice(0, 2)
    doc.text(typeLines, tx, y + 19)
    doc.setFontSize(6.4); doc.setTextColor(...t.muted)
    const where = [client?.name || e.clients?.name, e.location].filter(Boolean).join(', ')
    if (where) doc.text(doc.splitTextToSize(where, tw)[0], tx, y + 19 + typeLines.length * 3.2 + 1)
    doc.text('Scanner pour l\'historique', tx, y + LABEL.h - 5)
    if (ORG.phone) doc.text(String(ORG.phone), tx, y + LABEL.h - 2.4)
    slot += 1
  }
  const name = String(client?.name || 'parc').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40)
  return { doc, filename: `Etiquettes_${name}.pdf` }
}
