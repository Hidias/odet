import { describe, it, expect } from 'vitest'
import { preuvesDuReferentiel } from '../src/modules/certification/lib/certData'
import { familleConcernee, etatQualifies } from '../src/modules/certification/lib/preparerAudit'

const refs = [
  { code: 'rnq-2026', kind: 'qualiopi' }, { code: 'rnq-2019', kind: 'qualiopi' },
  { code: 'apsad-i4nf285', kind: 'apsad' }, { code: 'apsad-i4nf285-cdbbe1f6', kind: 'apsad' },
]

describe('preuves rattachées à leur référentiel (0391)', () => {
  const preuves = [
    { id: 1, indicator_number: 3, referential_code: 'rnq-2026' },
    { id: 2, indicator_number: 3, referential_code: 'rnq-2019' },
    { id: 3, indicator_number: 3, referential_code: 'apsad-i4nf285-cdbbe1f6' },
    { id: 4, indicator_number: 3, referential_code: null },
  ]
  it('Qualiopi voit ses preuves des deux éditions et les anciennes sans référentiel, jamais celles de l\'APSAD', () => {
    expect(preuvesDuReferentiel(preuves, 'rnq-2026', refs).map((p) => p.id)).toEqual([1, 2, 4])
  })
  it('une exigence APSAD ne voit que ses preuves', () => {
    expect(preuvesDuReferentiel(preuves, 'apsad-i4nf285-cdbbe1f6', refs).map((p) => p.id)).toEqual([3])
  })
})

describe('famille de matériel d\'un référentiel', () => {
  it('compare sans casse ni accents', () => {
    expect(familleConcernee('Extincteurs', ['Extincteurs'])).toBe(true)
    expect(familleConcernee('Désenfumage', ['desenfumage'])).toBe(true)
    expect(familleConcernee('RIA', ['RIA', 'PIA'])).toBe(true)
  })
  it('écarte les autres familles', () => {
    expect(familleConcernee('Éclairage de sécurité', ['Extincteurs'])).toBe(false)
    expect(familleConcernee('Alarme', ['RIA', 'PIA'])).toBe(false)
  })
  it('sans familles, tout le matériel compte', () => {
    expect(familleConcernee('Alarme', null)).toBe(true)
  })
})

describe('personnes qualifiées', () => {
  it('signale le départ, l\'expiration et la suspension', () => {
    const l = etatQualifies([
      { id: 'a', label: 'APSAD I4', expires_on: '2030-01-01', hr_people: { first_name: 'Ana', last_name: 'B' } },
      { id: 'b', label: 'APSAD I4', expires_on: '2020-01-01', hr_people: { first_name: 'Bob', last_name: 'C' } },
      { id: 'c', label: 'APSAD I4', suspended_at: '2026-10-01', hr_people: { first_name: 'Cid', last_name: 'D' } },
      { id: 'd', label: 'APSAD I4', hr_people: { first_name: 'Dan', last_name: 'E', archived_at: '2026-09-30T10:00:00Z' } },
      { id: 'e', label: 'ancien', archived_at: '2026-01-01', hr_people: { first_name: 'Eve', last_name: 'F' } },
    ], '2026-10-21')
    expect(l.map((q) => [q.nom, q.etat])).toEqual([['Ana B', 'valide'], ['Bob C', 'expiree'], ['Cid D', 'suspendue'], ['Dan E', 'partie']])
    expect(l[3].partieLe).toBe('2026-09-30')
  })
})
