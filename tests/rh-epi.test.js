import { describe, it, expect } from 'vitest'
import { etatRemise, renouvellementPropose } from '../src/modules/rh/lib/rhEpi'

describe('EPI remis', () => {
  it('propose le renouvellement à la durée de l\'article, fin de mois comprise', () => {
    expect(renouvellementPropose('2026-10-21', 12)).toBe('2027-10-21')
    expect(renouvellementPropose('2026-01-31', 1)).toBe('2026-02-28')
    expect(renouvellementPropose('2026-10-21', null)).toBe('')
  })
  it('donne l\'état d\'une remise', () => {
    expect(etatRemise({ renew_on: '2026-10-01' }, '2026-10-21')).toBe('a_renouveler')
    expect(etatRemise({ renew_on: '2026-11-10' }, '2026-10-21')).toBe('bientot')
    expect(etatRemise({ renew_on: '2027-10-21' }, '2026-10-21')).toBe('en_cours')
    expect(etatRemise({ renew_on: null }, '2026-10-21')).toBe('en_cours')
    expect(etatRemise({ renew_on: '2026-10-01', returned_on: '2026-10-05' }, '2026-10-21')).toBe('rendu')
  })
})
