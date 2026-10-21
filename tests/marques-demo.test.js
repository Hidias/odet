import { describe, it, expect } from 'vitest'
import { indexerMarques, estDemo } from '../src/core/demo/marquesDemo'
import { clientOptions } from '../src/ui/SearchSelect'

describe('marquage des données de test', () => {
  it('indexe les fiches de démonstration par table', () => {
    const m = indexerMarques([{ tbl: 'clients', id: 'a' }, { tbl: 'clients', id: 'b' }, { tbl: 'quotes', id: 'c' }, { tbl: null, id: 'x' }])
    expect(estDemo(m, 'clients', 'a')).toBe(true)
    expect(estDemo(m, 'quotes', 'c')).toBe(true)
    expect(estDemo(m, 'quotes', 'a')).toBe(false)
    expect(estDemo(m, 'clients', 'z')).toBe(false)
    expect(estDemo(m, 'clients', null)).toBe(false)
  })
  it('sans liste (avant la migration ou en erreur), rien n\'est marqué', () => {
    expect(estDemo(null, 'clients', 'a')).toBe(false)
    expect(estDemo(new Map(), 'clients', 'a')).toBe(false)
  })
  it('les options de client portent leur table pour la pastille', () => {
    expect(clientOptions([{ id: 'a', name: 'X' }])[0].testTbl).toBe('clients')
  })
})

import { buildORG, ribDemo } from '../src/core/org/orgUtils'
describe('RIB de démonstration jamais imprimé (0384)', () => {
  it('reconnaît le RIB de démonstration', () => {
    expect(ribDemo({ iban: 'FR76 3000 6000 0112 3456 7890 189', bic: 'AGRIFRPP' })).toBe(true)
    expect(ribDemo({ iban: 'FR7612345678901234567890104', bic: 'DEMOFRPP' })).toBe(true)
    expect(ribDemo({ iban: 'FR7612345678901234567890104', bic: 'AGRIFRPP' })).toBe(false)
  })
  it('les documents n\'ont pas de bloc bancaire avec le RIB de démonstration', () => {
    const o = buildORG({ name: 'Essai', iban: 'FR7630006000011234567890189', bic: 'DEMOFRPP', bank_name: 'Banque démo' })
    expect(o.iban).toBe('')
    expect(o.bic).toBe('')
    expect(o.bank_name).toBe('')
    expect(buildORG({ name: 'Essai', iban: 'FR7612345678901234567890104', bic: 'AGRIFRPP' }).iban).not.toBe('')
  })
})
