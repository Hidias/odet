// Demande du n° de sécurité sociale à l'entreprise (0440, décision de H du 22/10)
import { describe, it, expect } from 'vitest'
import { texteDemande, pdfValide } from '../api/nir-demande.js'
import { generatePasseportPreventionPDF } from '../src/modules/prevention/pdf/pdfPasseportPrevention'
import { donneesDecharge, nomFichierAutorisation } from '../src/modules/prevention/lib/dechargeNir'

const d = { first_name: 'Marc', last_name: 'Essai', course: 'Sauveteur secouriste du travail', start_date: '2026-11-25', end_date: '2026-11-26', contact_name: 'Sophie' }
const ID = '11111111-2222-3333-4444-555555555555'

describe("e-mail à l'entreprise", () => {
  it('nomme le salarié, renvoie vers l\'espace client et ne demande jamais le numéro par e-mail', () => {
    const t = texteDemande(d, 'Organisme essai')
    expect(t.sujet).toBe('N° de sécurité sociale de Marc ESSAI : formation « Sauveteur secouriste du travail » du 25 novembre 2026 au 26 novembre 2026')
    expect(t.corps).toMatch(/^Bonjour Sophie,/)
    expect(t.corps).toMatch(/autorisation signée est jointe/)
    expect(t.corps).toMatch(/« Numéros demandés »/)
    expect(t.corps).toMatch(/ne pas nous l'envoyer par e-mail/)
    expect(t.fichier).toBe('Autorisation_NIR_Essai_Marc.pdf')
  })
})

describe('autorisation signée', () => {
  const session = { start_date: '2026-11-25', end_date: '2026-11-25', clients: { name: 'Entreprise essai' }, courses: { title: 'SST' } }
  const t = { first_name: 'Marc', last_name: 'Essai', birth_date: '1985-05-02' }
  it("porte l'identifiant de la signature, contrôlé avant l'envoi", () => {
    const b64 = generatePasseportPreventionPDF('autorisation', { name: 'Organisme essai' }, donneesDecharge(session, t, { id: ID, signed_at: '2026-10-22T10:00:00Z' }))
      .output('datauristring').split(',')[1]
    expect(pdfValide(b64, ID)).not.toBeNull()
    expect(pdfValide(b64, '99999999-2222-3333-4444-555555555555')).toBeNull()
    expect(pdfValide(Buffer.from('pas un pdf'.repeat(80)).toString('base64'), ID)).toBeNull()
  })
  it('nom de fichier', () => expect(nomFichierAutorisation(t)).toBe('Autorisation_NIR_Essai_Marc.pdf'))
})
