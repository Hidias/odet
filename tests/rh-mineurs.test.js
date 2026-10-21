import { describe, it, expect } from 'vitest'
import { estMineur } from '../src/modules/rh/pages/Personnel'

describe('jeune de moins de 18 ans', () => {
  it('mineur la veille de ses 18 ans, majeur le jour même', () => {
    expect(estMineur('2008-10-22', '2026-10-21')).toBe(true)
    expect(estMineur('2008-10-21', '2026-10-21')).toBe(false)
  })
  it('sans date de naissance : pas de signalement', () => {
    expect(estMineur('', '2026-10-21')).toBe(false)
    expect(estMineur(null)).toBe(false)
  })
})
