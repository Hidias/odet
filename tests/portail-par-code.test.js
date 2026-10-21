import { describe, it, expect } from 'vitest'
import { couponsCodes } from '../src/modules/formation/components/CodesPortail'

describe('coupons des codes du portail (0423)', () => {
  it('un coupon par stagiaire, 10 par page', () => {
    const stagiaires = Array.from({ length: 12 }, (_, i) => ({ first_name: `P${i}`, last_name: 'Essai', code: String(100000 + i) }))
    const doc = couponsCodes({ titre: 'SST', dates: 'Le 01/11/2026', lien: 'https://exemple.test/#/portail/x', organisme: 'Organisme', stagiaires })
    expect(doc.getNumberOfPages()).toBe(2)
  })
})
