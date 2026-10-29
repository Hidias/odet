import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/core/supabase', () => ({ supabase: {} }))
const { invoiceLinesForVisit, CODE_INVENTAIRE } = await import('../src/modules/interventions/lib/itvData.js')

describe('facture de la visite d\'inventaire (0463)', () => {
  it('une ligne au prix réglé, code reconnu par la déduction, pièces en plus', () => {
    const v = { kind: 'inventaire', reference: 'V9', started_at: '2026-10-29T08:00:00Z', sites: { name: 'Atelier' }, itv_contracts: null }
    const l = invoiceLinesForVisit(v, [{ part_id: 'p1', label: 'Joint', quantity: 1, unit_price_ht: 5 }], { tva_rate: 20, prix_inventaire: 90 }, 1, [], { p1: 'piece' })
    expect(l).toHaveLength(2)
    expect(l[0]).toMatchObject({ code: CODE_INVENTAIRE, unit_price_ht: 90, description_title: 'Inventaire initial du parc' })
    expect(CODE_INVENTAIRE).toBe('INVENTAIRE')
  })
  it('une visite ordinaire ne prend jamais la ligne d\'inventaire', () => {
    const l = invoiceLinesForVisit({ reference: 'V1', started_at: '2026-10-29T08:00:00Z', sites: { name: 'A' } }, [], { tva_rate: 20, visit_fee_ht: 70, prix_inventaire: 90 }, 1, [], {})
    expect(l[0].code).toBeUndefined()
    expect(l[0].unit_price_ht).toBe(70)
  })
})
