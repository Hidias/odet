// Certificat de réalisation : rubriques du modèle du ministère (heures réalisées), résultat en plus (décision de H du
// 29/10), aucune référence légale périmée
import { it, expect, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
globalThis.fetch = vi.fn(async () => { throw new Error('hors ligne') })
import { generatePDF, setOrganization } from '../src/modules/formation/pdf/pdfGenerator'

it('heures réalisées, résultat, sans article périmé', async () => {
  setOrganization({ name: 'Organisme essai', address: '1 rue des Essais', postal_code: '29000', city: 'Quimper', phone: '02 00 00 00 00', email: 'contact@essai.invalid', dirigeant_name: 'Prénom NOM' })
  const session = { reference: 'SES-ESSAI', start_date: '2026-11-25', end_date: '2026-11-26', start_time: '09:00:00', end_time: '17:00:00',
    clients: { name: 'Entreprise essai' }, courses: { title: 'Formation essai', duration_hours: 14, duration_days: 2 }, session_trainees: [] }
  const out = await generatePDF('certificat', session, { trainee: { id: 't', first_name: 'Léa', last_name: 'Martin', gender: 'female', result: 'acquired', heures_realisees: 12.5 } })
  const fichier = `${process.env.TMPDIR || '/tmp'}/certificat-essai-${process.pid}.pdf`
  writeFileSync(fichier, Buffer.from(out.base64, 'base64'))
  if (process.env.APERCU_PDF) writeFileSync(process.env.APERCU_PDF, Buffer.from(out.base64, 'base64'))
  let texte = ''
  try { texte = execFileSync('pdftotext', [fichier, '-'], { encoding: 'utf8' }) } catch { return } // outil absent : rendu seul
  expect(texte).toMatch(/12,5 heures réalisées/)
  expect(texte).toMatch(/Mme Léa MARTIN/)
  expect(texte).not.toMatch(/6353/)
}, 30000)
