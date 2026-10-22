// Décharge « numéro de sécurité sociale non communiqué » (0436) : données pré-remplies et document signé sur une page
import { it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { donneesDecharge, nomFichierDecharge } from '../src/modules/prevention/lib/dechargeNir'
import { generatePasseportPreventionPDF } from '../src/modules/prevention/pdf/pdfPasseportPrevention'

const session = { start_date: '2026-11-25', end_date: '2026-11-26', clients: { name: 'Entreprise essai' }, courses: { title: 'SST' } }
const stagiaire = { first_name: 'Léa', last_name: 'Martin-Dupré', birth_date: '1985-05-02', job_title: 'Cariste' }

it('pré-remplit la décharge', () => {
  const d = donneesDecharge(session, stagiaire)
  expect(d).toMatchObject({ stagiaire: 'Léa MARTIN-DUPRÉ', naissance: '02/05/1985', entreprise: 'Entreprise essai', poste: 'Cariste', formation: 'SST', dates: 'du 25/11/2026 au 26/11/2026', signature: null })
  expect(nomFichierDecharge(stagiaire)).toBe('Decharge_NIR_Martin_Dupre_Lea.pdf')
})

it('décharge signée sur une page', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAAEUlEQVR4nGNgYGD4TwDTWgEACOwf4fAWWoUAAAAASUVORK5CYII='
  const doc = generatePasseportPreventionPDF('decharge', { name: 'Organisme essai', email: 'contact@essai.invalid' }, donneesDecharge(session, stagiaire, { signature_data: png, signed_at: '2026-11-20T08:00:00Z' }))
  const pdf = await PDFDocument.load(doc.output('arraybuffer'))
  expect(pdf.getPageCount()).toBe(1)
})
