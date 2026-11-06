import { describe, it, expect } from 'vitest'
import { telephoneLisible, lienTelephone } from '../src/core/telephone.js'

describe('telephoneLisible', () => {
  it('met un numéro français par paires', () => {
    expect(telephoneLisible('0612345678')).toBe('06 12 34 56 78')
    expect(telephoneLisible('06.12.34.56.78')).toBe('06 12 34 56 78')
    expect(telephoneLisible(' 02 98 00 00 00 ')).toBe('02 98 00 00 00')
  })
  it('met un +33 en forme internationale', () => {
    expect(telephoneLisible('+33612345678')).toBe('+33 6 12 34 56 78')
    expect(telephoneLisible('+33 6 12 34 56 78')).toBe('+33 6 12 34 56 78')
  })
  it('laisse tel quel un format inconnu, vide si rien', () => {
    expect(telephoneLisible('+44 20  7946 0958')).toBe('+44 20 7946 0958')
    expect(telephoneLisible('123')).toBe('123')
    expect(telephoneLisible(null)).toBe('')
    expect(telephoneLisible(undefined)).toBe('')
  })
})

describe('lienTelephone', () => {
  it('garde chiffres et plus', () => {
    expect(lienTelephone('06 12 34 56 78')).toBe('tel:0612345678')
    expect(lienTelephone('+33 6 12.34')).toBe('tel:+3361234')
    expect(lienTelephone(null)).toBe('tel:')
  })
  it('retire le 0 après +33 et coupe une extension', () => {
    expect(lienTelephone('+33 (0)6 12 34 56 78')).toBe('tel:+33612345678')
    expect(lienTelephone('+33 06 12 34 56 78')).toBe('tel:+33612345678')
    expect(lienTelephone('06 12 34 56 78 poste 12')).toBe('tel:0612345678')
    expect(telephoneLisible('   ')).toBe('')
  })
})
