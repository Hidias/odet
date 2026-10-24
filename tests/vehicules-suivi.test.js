import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/core/supabase', () => ({ supabase: {} }))
const { moisEntre, coutTotal, echeanceAmende } = await import('../src/modules/vehicules/lib/suiviVehicule')

describe('Suivi des véhicules', () => {
  it('mois entiers écoulés', () => {
    expect(moisEntre('2026-01-15', '2026-10-24')).toBe(9)
    expect(moisEntre('2026-01-15', '2026-10-14')).toBe(8)
    expect(moisEntre('2026-10-24', '2026-01-01')).toBe(0)
    expect(moisEntre(null, '2026-01-01')).toBe(0)
  })
  it('coût total : loyers, assurance, carburant, entretien, sinistre net, amendes payées', () => {
    const c = coutTotal({
      vehicule: { acquisition: 'lld', acquired_on: '2026-01-24', monthly_cost_ttc: 400, insurance_annual_ttc: 1200 },
      pleins: [{ amount_ttc: 80 }, { amount_ttc: 70.5 }],
      evenements: [{ kind: 'entretien', cost_ttc: 250 }, { kind: 'sinistre', cost_ttc: null, deductible: 300, indemnity: null }, { kind: 'sinistre', cost_ttc: 1000, indemnity: 800 }],
      amendes: [{ amount: 135, paid_by_company: true }, { amount: 90, paid_by_company: false }],
      jusqua: '2026-10-24',
    })
    expect(c.mois).toBe(9)
    expect(c.parts).toEqual({ achat: 0, loyers: 3600, assurance: 900, carburant: 150.5, entretien: 250, sinistres: 500, amendes: 135 })
    expect(c.total).toBe(5535.5)
    expect(c.parMois).toBe(615.06)
  })
  it('coût total : achat comptant compté une fois, crédit par ses mensualités, loyers arrêtés à la fin du contrat', () => {
    expect(coutTotal({ vehicule: { acquisition: 'achat', purchase_price_ttc: 20000 } }).total).toBe(20000)
    expect(coutTotal({ vehicule: { acquisition: 'credit', purchase_price_ttc: 20000, monthly_cost_ttc: 300, acquired_on: '2026-01-01' }, jusqua: '2026-07-01' }).total).toBe(1800)
    expect(coutTotal({ vehicule: { acquisition: 'lld', monthly_cost_ttc: 100, acquired_on: '2025-01-01', contract_end_on: '2025-07-01' }, jusqua: '2026-10-24' }).parts.loyers).toBe(600)
  })
  it('désignation du conducteur : à faire, en retard, faite', () => {
    const f = { status: 'a_designer', deadline_on: '2026-11-29' }
    expect(echeanceAmende(f, '2026-10-24')).toMatchObject({ etat: 'afaire' })
    expect(echeanceAmende(f, '2026-12-01').etat).toBe('retard')
    expect(echeanceAmende({ status: 'designe', designated_on: '2026-10-30' }).etat).toBe('fait')
  })
})
