import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { devisDeFormation, documentsAJoindre } from '../src/modules/commercial/lib/metierDevis'

describe('CGV de formation seulement avec un devis de formation', () => {
  it('devis de BAES ou d’extincteurs : pas de formation', () => {
    expect(devisDeFormation({}, [{ code: 'BAES', nature: 'bien' }, { description_title: 'Extincteur 6 L' }])).toBe(false)
    expect(devisDeFormation({}, [])).toBe(false)
    expect(devisDeFormation(null, null)).toBe(false)
  })
  it('ligne de formation du catalogue ou devis rattaché à une session : formation', () => {
    expect(devisDeFormation({}, [{ code: 'BAES' }, { course_id: 'c1' }])).toBe(true)
    expect(devisDeFormation({ session_id: 's1' }, [])).toBe(true)
  })
  it('l’envoi joint les conditions du métier, jamais celles de la formation pour un devis de matériel', () => {
    const src = readFileSync('src/modules/commercial/pages/Quotes.jsx', 'utf8')
    expect(src).toMatch(/for \(const d of documentsAJoindre\(quote, loadedItems\)\)/)
    expect(src).not.toMatch(/publishedDocPDF\('cgv'\)/)
    expect(documentsAJoindre({}, [{ code: 'BAES', nature: 'bien' }]).map((d) => d.doc)).not.toContain('cgv')
  })
})
