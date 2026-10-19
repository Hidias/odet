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
