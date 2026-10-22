// Signature en ligne reportée dans le cadre « Bon pour accord » du document (retour de H du 22/10)
import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import jsPDF from 'jspdf'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { marquerZoneSignature, lireZoneSignature, reporterSignature } from '../src/core/signature/zone'

// Trait de signature : PNG 8 × 4 généré à la main (pixels noirs)
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAAEUlEQVR4nGNgYGD4TwDTWgEACOwf4fAWWoUAAAAASUVORK5CYII='

function documentAvecCadre({ marquer = true, page = 1 } = {}) {
  const doc = new jsPDF({ compress: true })
  for (let i = 1; i < page; i++) doc.addPage()
  doc.text('Devis', 20, 20)
  doc.rect(120, 200, 70, 28)
  if (marquer) marquerZoneSignature(doc, { x: 120, y: 200, w: 70, h: 28 })
  return doc.output('arraybuffer')
}

describe('zone de signature', () => {
  it('se note dans le PDF et se relit', async () => {
    const pdf = await PDFDocument.load(documentAvecCadre({ page: 2 }), { updateMetadata: false })
    const z = lireZoneSignature(pdf.getKeywords())
    expect(z.page).toBe(1)
    expect(z.x).toBeCloseTo(120 / 210, 3)
    expect(z.y).toBeCloseTo(200 / 297, 3)
    expect(z.w).toBeCloseTo(70 / 210, 3)
  })

  it('refuse une marque absente ou faussée', () => {
    expect(lireZoneSignature('')).toBeNull()
    expect(lireZoneSignature('odet-zone-signature 0 0.1 0.1 0.1 0.1')).toBeNull()
    expect(lireZoneSignature('odet-zone-signature 1 0.1 0.1 2 0.1')).toBeNull()
  })

  it('reporte la signature dans le cadre noté', async () => {
    const pdf = await PDFDocument.load(documentAvecCadre(), { updateMetadata: false })
    const ok = await reporterSignature(pdf, { signature_data: PNG, signer_name: 'Ségolène Vimeux', signed_at: '2026-10-22T08:07:26Z' }, { StandardFonts, rgb })
    expect(ok).toBe(true)
    const octets = await pdf.save()
    if (process.env.SORTIE_REPORT) writeFileSync(process.env.SORTIE_REPORT, octets)
    expect(octets.length).toBeGreaterThan(1000)
  })

  it('ne fait rien sans cadre noté (anciens documents) ni sans tracé', async () => {
    const sans = await PDFDocument.load(documentAvecCadre({ marquer: false }), { updateMetadata: false })
    expect(await reporterSignature(sans, { signature_data: PNG }, { StandardFonts, rgb })).toBe(false)
    const avec = await PDFDocument.load(documentAvecCadre(), { updateMetadata: false })
    expect(await reporterSignature(avec, { signature_data: null }, { StandardFonts, rgb })).toBe(false)
  })

  it('garde la légende lisible avec des caractères hors police standard', async () => {
    const pdf = await PDFDocument.load(documentAvecCadre(), { updateMetadata: false })
    const ok = await reporterSignature(pdf, { signature_data: PNG, signer_name: 'Ayşe Öztürk 李', signed_at: '2026-10-22T08:07:26Z' }, { StandardFonts, rgb })
    expect(ok).toBe(true)
  })
})
