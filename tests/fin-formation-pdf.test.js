// Attestation de fin de formation (0476) : une page, objectifs et résultat de chacun, aucune référence légale
import { it, expect, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
globalThis.fetch = vi.fn(async () => { throw new Error('hors ligne') })
import { generatePDF, setOrganization } from '../src/modules/formation/pdf/pdfGenerator'
import { PDFDocument } from 'pdf-lib'

it('tient sur une page avec dix objectifs', async () => {
  setOrganization({ name: 'Organisme essai', address: '1 rue des Essais', postal_code: '29000', city: 'Quimper', phone: '02 00 00 00 00', email: 'contact@essai.invalid', dirigeant_name: 'Prénom NOM' })
  const objectifs = Array.from({ length: 10 }, (_, i) => ({ texte: `Objectif pédagogique numéro ${i + 1} formulé de façon assez longue pour occuper la ligne`, acquis: i === 3 ? false : i === 7 ? null : true }))
  const session = {
    reference: 'SES-ESSAI', start_date: '2026-11-25', end_date: '2026-11-26', start_time: '09:00:00', end_time: '17:00:00',
    location_name: 'Salle de formation', location_address: '2 avenue des Essais', location_postal_code: '29000', location_city: 'Quimper',
    clients: { name: 'Entreprise essai' }, courses: { title: 'Formation essai', duration_hours: 14, duration_days: 2 },
  }
  const out = await generatePDF('fin_formation', session, {
    trainee: { first_name: 'Léa', last_name: 'Martin', gender: 'female', result: 'not_acquired', heures_realisees: 12.5, objectifs_resultats: objectifs, document_emis: { version: 2, issued_on: '2026-11-30', remplace: { version: 1, issued_on: '2026-11-26' } } },
    trainer: { first_name: 'Prénom', last_name: 'FORMATEUR' },
  })
  if (process.env.APERCU_PDF) writeFileSync(process.env.APERCU_PDF, Buffer.from(out.base64, 'base64'))
  const pdf = await PDFDocument.load(Buffer.from(out.base64, 'base64'))
  expect(pdf.getPageCount()).toBe(1)
  expect(out.filename).toMatch(/^Attestation_fin_SES-ESSAI_Martin\.pdf$/)
}, 30000)
