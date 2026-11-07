// A11 lot 6 (07/11) : émargement en bouton principal les jours de formation seulement.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { jourDeFormation } from '../src/modules/formation/lib/presence'

describe('jour de formation', () => {
  const s = { start_date: '2026-12-07', end_date: '2026-12-08' }
  it('vrai du premier au dernier jour, faux avant et après', () => {
    expect(jourDeFormation(s, new Date(2026, 11, 6, 23, 59))).toBe(false)
    expect(jourDeFormation(s, new Date(2026, 11, 7, 0, 1))).toBe(true)
    expect(jourDeFormation(s, new Date(2026, 11, 8, 18))).toBe(true)
    expect(jourDeFormation(s, new Date(2026, 11, 9, 8))).toBe(false)
  })
  it('sans date de fin : le seul jour ; sans session : faux', () => {
    expect(jourDeFormation({ start_date: '2026-12-07' }, new Date(2026, 11, 7, 9))).toBe(true)
    expect(jourDeFormation(null)).toBe(false)
    expect(jourDeFormation({ start_date: '2026-12-07', status: 'cancelled' }, new Date(2026, 11, 7, 9))).toBe(false)
  })
  it('la fiche session choisit le style du bouton par cette règle', () => {
    const f = readFileSync('src/modules/formation/pages/SessionDetail.jsx', 'utf8')
    expect(f).toContain("className={`btn ${jourDeFormation(session) ? 'btn-primary' : 'btn-secondary'}`}")
  })
})
