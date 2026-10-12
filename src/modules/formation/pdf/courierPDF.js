// Courriers, attestations libres et notes internes : même en-tête, même pied de page
// que les documents de session (core/pdf/layout.js). Identité lue dans ORG (buildORG).

import jsPDF from 'jspdf'
import { startDocument, drawImageFitted, PAGE_MARGIN } from '../../../core/pdf/layout'

const LABELS = { courrier: 'Courrier', attestation: 'Attestation', note_interne: 'Note interne' }
const CODES = { courrier: 'COUR', attestation: 'ATTL', note_interne: 'NOTE' }

/**
 * @param {object} ORG objet de buildORG(organization_settings)
 * @param {object} p { docType, destinataire, objet, lieu, docDate, body, signataire }
 */
export function buildCourierPDF(ORG, { docType = 'courrier', destinataire = '', objet = '', lieu = '', docDate = '', body = '', signataire = '' } = {}) {
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true })
  const docLabel = LABELS[docType] || 'Courrier'
  const isAttestation = docType === 'attestation'
  const isNote = docType === 'note_interne'
  const f = startDocument(doc, ORG, {
    docLabel,
    code: CODES[docType] || 'COUR',
    title: isAttestation ? 'Attestation' : (isNote ? 'Note interne' : ''),
    subtitle: isNote && objet ? objet : null,
  })
  const t = ORG.theme
  const M = PAGE_MARGIN
  const W = f.W

  // Destinataire : bloc à droite (fenêtre d'enveloppe)
  if (isNote) {
    f.kv([['Destinataires', String(destinataire || '').split('\n').filter(Boolean).join(', ') || null], ['Rédigée par', String(signataire || '').split('\n')[0] || null]])
    f.y += 3
  } else if (destinataire && !isAttestation) {
    const lines = String(destinataire).split('\n').map(s => s.trim()).filter(Boolean)
    const x = M + W * 0.55
    f.y = Math.max(f.y, 50)
    lines.forEach((l, i) => {
      doc.setFont('helvetica', i === 0 ? 'bold' : 'normal'); doc.setFontSize(10); doc.setTextColor(...t.text)
      doc.text(doc.splitTextToSize(l, W * 0.45)[0] || '', x, f.y)
      f.y += 4.8
    })
    f.y += 6
  } else if (destinataire && isAttestation) {
    f.para(`Destinataire : ${String(destinataire).split('\n').filter(Boolean).join(', ')}`, { color: t.muted, after: 3 })
  }

  // Lieu et date à droite
  const d = docDate ? new Date(docDate + 'T12:00:00') : null
  const dateTxt = d && !isNaN(d) ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
  if (lieu || dateTxt) {
    f.ensure(8)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...t.muted)
    doc.text(`${lieu ? lieu + ', le ' : 'Le '}${dateTxt}`, M + W, f.y, { align: 'right' })
    doc.setTextColor(...t.text)
    f.y += 9
  }

  // Objet
  if (objet && !isNote) {
    f.ensure(10)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...t.primary)
    const lines = doc.splitTextToSize(`Objet : ${objet}`, W)
    lines.forEach(l => { doc.text(l, M, f.y); f.y += 4.8 })
    doc.setDrawColor(...t.highlight); doc.setLineWidth(0.5); doc.line(M, f.y - 2, M + 14, f.y - 2)
    doc.setTextColor(...t.text)
    f.y += 5
  }

  // Corps : une ligne vide = nouveau paragraphe
  String(body || '').split('\n').forEach(p => {
    if (!p.trim()) { f.y += 2.5; return }
    f.para(p, { size: 10, after: 1.5 })
  })

  // Signataire à droite, tampon et signature au-dessus
  if (signataire && !isNote) {
    const sigLines = String(signataire).split('\n').filter(Boolean)
    const hasImages = ORG.stamp_base64 || ORG.dirigeant_signature_base64
    f.ensure(12 + (hasImages ? 24 : 0) + sigLines.length * 5)
    f.y += 8
    const x = M + W * 0.55
    if (hasImages) {
      if (ORG.stamp_base64) drawImageFitted(doc, ORG.stamp_base64, x, f.y, 40, 20, 'JPEG')
      if (ORG.dirigeant_signature_base64) drawImageFitted(doc, ORG.dirigeant_signature_base64, x + 42, f.y, 34, 20)
      f.y += 24
    }
    sigLines.forEach((l, i) => {
      doc.setFont('helvetica', i === 0 ? 'bold' : 'normal'); doc.setFontSize(9.5)
      doc.setTextColor(...(i === 0 ? t.text : t.muted))
      doc.text(l, x, f.y)
      f.y += 4.8
    })
    doc.setTextColor(...t.text)
  }

  f.finish()
  // Numérotation si plusieurs pages
  const total = doc.getNumberOfPages()
  if (total > 1) {
    const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight()
    for (let i = 1; i <= total; i++) {
      doc.setPage(i)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...t.muted)
      doc.text(`Page ${i} / ${total}`, pw - M, ph - 11.5, { align: 'right' })
    }
  }
  return doc
}
