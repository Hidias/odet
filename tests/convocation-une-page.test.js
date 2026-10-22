// Convocation toujours sur une seule page (22/10, décision de H), même avec un contact, de longs objectifs et le QR code
import { it, expect, vi } from 'vitest'
globalThis.fetch = vi.fn(async () => { throw new Error('hors ligne') })
import { generatePDF, setOrganization } from '../src/modules/formation/pdf/pdfGenerator'
import { PDFDocument } from 'pdf-lib'

it('tient sur une page', async () => {
  setOrganization({ name: 'Organisme essai', address: '1 rue des Essais', postal_code: '29000', city: 'Quimper', phone: '02 00 00 00 00', email: 'contact@essai.invalid', dirigeant_name: 'Prénom NOM' })
  const objectifs = Array.from({ length: 9 }, (_, i) => `Objectif pédagogique numéro ${i + 1} formulé de façon assez longue pour occuper la ligne`).join('\n')
  const session = {
    reference: 'SES-ESSAI', start_date: '2026-11-25', end_date: '2026-11-26', start_time: '09:00:00', end_time: '17:00:00', attendance_token: 'jeton-essai',
    location_name: 'Salle de formation', location_address: '2 avenue des Essais', location_postal_code: '29000', location_city: 'Quimper',
    clients: { name: 'Entreprise essai' }, contact: { name: 'Contact ESSAI', role: 'Responsable RH', phone: '02 11 11 11 11', email: 'rh@essai.invalid' },
    courses: { title: 'Formation essai', duration_hours: 14, objectives: objectifs, material: 'Chaussures de sécurité.' },
  }
  const out = await generatePDF('convocation', session, { trainee: { first_name: 'Léa', last_name: 'Martin', gender: 'female', job_title: 'Cariste', access_code: '123456' }, trainer: { first_name: 'Prénom', last_name: 'FORMATEUR' } })
  const pdf = await PDFDocument.load(Buffer.from(out.base64, 'base64'))
  expect(pdf.getPageCount()).toBe(1)
}, 30000)
