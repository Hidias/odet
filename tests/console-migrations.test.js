import { describe, it, expect } from 'vitest'
import { classerMigrations } from '../src/core/console/migrations.js'

const emb = ['0001_a', '0002_b', '0003_c'].map((version) => ({ version, path: `${version}.sql` }))

describe('Console : migrations écartées', () => {
  it("une migration écartée n'est pas « à appliquer » et sort du total attendu", () => {
    const r = classerMigrations(emb, [{ version: '0001_a' }, { version: '0003_c' }], { '0002_b': 'raison' })
    expect(r.aAppliquer).toEqual([])
    expect(r.ecartees.map((m) => m.version)).toEqual(['0002_b'])
    expect(r.ecartees[0].raison).toBe('raison')
    expect(r.attendues).toBe(2)
  })
  it('une migration manquante non écartée reste à appliquer', () => {
    const r = classerMigrations(emb, [{ version: '0001_a' }], { '0002_b': 'raison' })
    expect(r.aAppliquer.map((m) => m.version)).toEqual(['0003_c'])
    expect(r.attendues).toBe(2)
  })
  it('une migration écartée mais appliquée quand même compte comme faite', () => {
    const r = classerMigrations(emb, emb, { '0002_b': 'raison' })
    expect(r.ecartees).toEqual([])
    expect(r.attendues).toBe(3)
  })
  it('sans liste fournie, 0110 est écartée', () => {
    const r = classerMigrations([{ version: '0110_finance_generique', path: 'x' }], [])
    expect(r.aAppliquer).toEqual([])
    expect(r.ecartees).toHaveLength(1)
  })
})
