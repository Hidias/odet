import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/core/supabase', () => ({ supabase: {} }))
const { donneesBilan } = await import('../src/modules/interventions/pdf/bilanPDF.js')

describe('bilan annuel (0472)', () => {
  const today = new Date('2026-10-29T12:00:00Z')
  const types = [{ id: 't1', name: 'Extincteur 6 L', lifespan_years: 20 }, { id: 't2', name: 'Bloc', lifespan_years: 10 }]
  const equipment = [
    { id: 'e1', type_id: 't1', manufactured_year: 2007, next_check_on: '2027-03-10', status: 'en_service' },
    { id: 'e2', type_id: 't1', manufactured_year: 2020, next_check_on: '2027-03-10', status: 'en_service' },
    { id: 'e3', type_id: 't2', manufactured_year: 2017, next_check_on: '2028-01-01', status: 'en_service' },
    { id: 'e5', type_id: 't2', manufactured_year: 2024, next_check_on: '2026-09-01', status: 'en_service' },
    { id: 'e4', type_id: 't2', manufactured_year: 2000, status: 'retire' },
  ]
  const visits = [{ status: 'terminee', started_at: '2026-03-10T08:00:00Z', sites: { name: 'Mairie' }, items: [{ result: 'conforme' }, { result: 'remplace' }] },
    { status: 'terminee', started_at: '2025-03-10T08:00:00Z', items: [{ result: 'conforme' }] }]
  const echeances = [{ due_on: '2027-01-01', amount_ht: 300, status: 'a_facturer' }, { due_on: '2028-01-01', amount_ht: 300, status: 'a_facturer' }]
  it('visites de l\'année, vérifications et fins de vie à venir, budget', () => {
    const d = donneesBilan({ equipment, visits, types, prixType: { t1: 55 }, echeances, today })
    expect(d.appareils).toBe(4)
    expect(d.enRetard).toBe(1)
    expect(d.visites).toHaveLength(1)
    expect(d.remplaces).toBe(1)
    expect(d.aVerifier).toEqual([{ mois: '2027-03', nb: 2 }])
    // 2007 + 20 = 2027 : en fin de vie l'an prochain ; 2017 + 10 = 2027 aussi, sans prix (sur devis)
    expect(d.finsDeVie).toEqual(expect.arrayContaining([{ type: 'Extincteur 6 L', nb: 1, prix: 55, total: 55 }, { type: 'Bloc', nb: 1, prix: null, total: null }]))
    expect(d.budget).toEqual({ contrat: 300, remplacement: 55, nonEstimes: 1 })
  })
})
