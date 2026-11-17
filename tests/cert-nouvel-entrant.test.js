import { describe, it, expect } from 'vitest'
import { indicateursNouvelEntrant } from '../src/modules/certification/lib/certData.js'

// Arrêté du 28 octobre 2026 (JO du 1er novembre 2026) : la liste vient du référentiel en base, jamais du texte de l'écran
describe('indicateurs où la formalisation suffit pour un nouvel entrant', () => {
  it('lit la liste dans les indicateurs, triée, avec « et » avant le dernier', () => {
    const ind = [26, 2, 3, 11, 13, 14, 19, 24, 25].map((number) => ({ number, new_entrant_light: true }))
      .concat([{ number: 22, new_entrant_light: false }, { number: 32, new_entrant_light: false }])
    expect(indicateursNouvelEntrant(ind)).toBe('2, 3, 11, 13, 14, 19, 24, 25 et 26')
  })
  it('rien sans indicateur', () => {
    expect(indicateursNouvelEntrant(null)).toBe('')
    expect(indicateursNouvelEntrant([{ number: 4, new_entrant_light: false }])).toBe('')
  })
  it("plus de liste recopiée dans l'écran du cycle", async () => {
    const fs = await import('node:fs')
    const page = fs.readFileSync(new URL('../src/modules/certification/pages/CertQualiopi.jsx', import.meta.url), 'utf8')
    expect(page).not.toMatch(/22, 24, 25, 26 et 32/)
  })
})

describe('indicateur 27 : procédure sous-traitance (P13) comptée', async () => {
  const { RULES } = await import('../src/modules/certification/lib/proofs.js')
  const base = { docs: {}, subcontracting: null }
  it('P13 enregistrée : ligne verte ; absente : ligne à compléter', () => {
    const avec = RULES[27]({ ...base, docs: { stProc: true } }).items.find((i) => /P13/.test(i.label))
    const sans = RULES[27]({ ...base, docs: { stProc: false } }).items.find((i) => /P13/.test(i.label))
    expect(avec?.ok).toBe(true)
    expect(sans?.ok).toBe(false)
  })
})
