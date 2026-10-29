import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/core/supabase', () => ({ supabase: {} }))
const { invoiceLinesForVisit } = await import('../src/modules/interventions/lib/itvData.js')

const visite = (contrat) => ({ reference: 'V1', started_at: '2026-10-20T08:00:00Z', sites: { name: 'Mairie' }, itv_contracts: contrat })
const pieces = [{ part_id: 'p1', label: 'Joint de tête', quantity: 2, unit_price_ht: 6 }, { part_id: 'd1', label: 'Déplacement', quantity: 1, unit_price_ht: 40 }]
const cats = { p1: 'piece', d1: 'deplacement' }

describe('facture de visite et échéancier (0461)', () => {
  it('contrat à échéancier : forfait à 0 €, pièces facturées si non comprises', () => {
    const l = invoiceLinesForVisit(visite({ label: 'Contrat', annual_price_ht: 1200, billing_period: 'trimestriel', includes: {} }), pieces, { tva_rate: 20 }, 2, [], cats)
    expect(l[0].unit_price_ht).toBe(0)
    expect(l[1].unit_price_ht).toBe(6)
    expect(l[2].unit_price_ht).toBe(40)
    expect(l[2].nature).toBe('service')
  })
  it('ce que le contrat comprend passe à 0 € avec la mention', () => {
    const l = invoiceLinesForVisit(visite({ label: 'Contrat', annual_price_ht: 1200, billing_period: 'mensuel', includes: { pieces: true, deplacement: true } }), pieces, { tva_rate: 20 }, 2, [], cats)
    expect(l.slice(1).every((x) => x.unit_price_ht === 0 && x.description_detail === 'Compris au contrat')).toBe(true)
  })
  it('contrat « à la visite » : part du forfait annuel, comme avant', () => {
    const l = invoiceLinesForVisit(visite({ label: 'Contrat', annual_price_ht: 1200, billing_period: 'visite', includes: {} }), [], { tva_rate: 20 }, 2, [], cats)
    expect(l[0].unit_price_ht).toBe(600)
  })
})
