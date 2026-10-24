import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { devisDeFormation } from '../src/modules/commercial/lib/metierDevis'

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
  it('l’envoi ne joint les CGV de formation que pour un devis de formation', () => {
    const src = readFileSync('src/modules/commercial/pages/Quotes.jsx', 'utf8')
    expect(src).toMatch(/devisDeFormation\(quote, loadedItems\) \? await publishedDocPDF\('cgv'\) : null/)
    expect(src.match(/publishedDocPDF\('cgv'\)/g)).toHaveLength(1)
  })
})
