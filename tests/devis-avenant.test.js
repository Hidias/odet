import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('../src/core/supabase', () => ({ supabase: {} }))
const { mentionsDevis } = await import('../src/modules/commercial/lib/mentionsDevis')
const { documentsAJoindre, piecesEntrepriseAJoindre } = await import('../src/modules/commercial/lib/metierDevis')
const { libelleDevisPublie } = await import('../src/modules/commercial/lib/conditionsDevis')

const T = { cgv: 'CGV.', avenant: 'Avenant au {devis} du {signe_le} : {montant_devis} + {avenants} + {ecart} = {nouveau_total}.' }
const espaces = (s) => s.replace(/\s/g, ' ')

describe('Avenant au devis signé (0446)', () => {
  const av = { amendment_of: 'q1', amendment_number: 2 }
  it('ne joint pas de nouvelles conditions : celles du devis s’appliquent', () => {
    expect(documentsAJoindre(av, [{ nature: 'bien', description_title: 'BAES' }])).toEqual([])
    expect(piecesEntrepriseAJoindre({ ...av, metier: 'installation' }, [])).toEqual([])
    const m = mentionsDevis({ quote: av, items: [{ nature: 'bien', description_title: 'BAES' }], client: {}, textes: T,
      avenant: { reference: 'DEV-1', signe_le: '2026-10-20T10:00:00Z', montant_devis: 1000, avenants: 200, ecart: -50 } })
    expect(m.signature).toEqual([])
    expect(espaces(m.legal[0])).toBe('Avenant au DEV-1 du 20/10/2026 : 1 000,00 € + 200,00 € + -50,00 € = 1 150,00 €.')
  })
  it('remis dans l’espace client sous le nom « Avenant »', () => {
    expect(libelleDevisPublie({ reference: 'DEV-1-AV1', amendment_of: 'q1' }, [])).toBe('Avenant DEV-1-AV1')
  })
  it('un devis signé propose l’avenant avant la nouvelle version', () => {
    const src = readFileSync('src/modules/commercial/pages/Quotes.jsx', 'utf8')
    expect(src.indexOf("confirmLabel: 'Faire un avenant'")).toBeGreaterThan(0)
    expect(src.indexOf("confirmLabel: 'Faire un avenant'")).toBeLessThan(src.indexOf("confirmLabel: 'Créer la nouvelle version'"))
    expect(src).toMatch(/supabase\.rpc\('devis_avenant'/)
  })
})
