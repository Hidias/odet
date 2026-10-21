import { describe, it, expect } from 'vitest'
import { joursAvant, messageMaintien } from '../src/modules/formation/components/SeuilMaintien'

describe('seuil de maintien (0421)', () => {
  it('compte les jours avant le début', () => {
    expect(joursAvant('2026-10-31', new Date(2026, 9, 21, 15))).toBe(10)
    expect(joursAvant('2026-10-21', new Date(2026, 9, 21, 8))).toBe(0)
    expect(joursAvant('2026-10-20', new Date(2026, 9, 21))).toBe(-1)
  })
  it('propose les prochaines dates en cas de report', () => {
    const m = messageMaintien({ decision: 'reportee', titre: 'SST', debut: '2026-10-31', prochaines: [{ start_date: '2026-11-20', location_city: 'Quimper' }] })
    expect(m).toContain('est reportée')
    expect(m).toContain('à Quimper')
    expect(m).toContain('Prochaines dates')
  })
  it('sans prochaine date, annonce un retour', () => {
    const m = messageMaintien({ decision: 'annulee', titre: 'SST', debut: '2026-10-31' })
    expect(m).toContain('est annulée')
    expect(m).toContain('dès qu\'une nouvelle date')
  })
  it('maintien : confirmation simple', () => {
    expect(messageMaintien({ decision: 'maintenue', titre: 'SST', debut: '2026-10-31' })).toContain('confirmons le maintien')
  })
})
