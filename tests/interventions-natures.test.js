import { describe, it, expect } from 'vitest'
import { natureDe, estVerification, controleTousAppareils, delaiUrgence } from '../src/modules/interventions/lib/natures.js'

describe('natures d\'intervention (0465)', () => {
  it('vérification par défaut, bons distincts du rapport', () => {
    expect(estVerification({})).toBe(true)
    expect(natureDe({ kind: 'depannage' }).bon).toBe('Bon d\'intervention')
    expect(natureDe({ kind: 'inconnu' }).label).toBe('Vérification')
    expect(controleTousAppareils({ kind: 'inventaire' })).toBe(true)
    expect(controleTousAppareils({ kind: 'livraison' })).toBe(false)
  })
  it('délai promis : respecté, dépassé, en attente', () => {
    const base = { urgent: true, deadline_at: '2026-10-30T10:00:00Z' }
    expect(delaiUrgence({ ...base, started_at: '2026-10-30T09:00:00Z' })).toMatchObject({ respecte: true, retard: false })
    expect(delaiUrgence({ ...base, started_at: '2026-10-30T11:00:00Z' })).toMatchObject({ respecte: false, retard: true })
    expect(delaiUrgence(base, new Date('2026-10-30T12:00:00Z'))).toMatchObject({ respecte: null, retard: true })
    expect(delaiUrgence(base, new Date('2026-10-30T08:00:00Z')).retard).toBe(false)
    expect(delaiUrgence({ urgent: false, deadline_at: base.deadline_at })).toBe(null)
  })
})

import { vi } from 'vitest'
vi.mock('../src/core/supabase', () => ({ supabase: {} }))
describe('facture d\'une intervention hors vérification (0465)', async () => {
  const { invoiceLinesForVisit } = await import('../src/modules/interventions/lib/itvData.js')
  const v = (extra) => ({ reference: 'V2', started_at: '2026-10-29T08:00:00Z', sites: { name: 'A' }, ...extra })
  it('dépannage hors contrat : ligne à compléter, jamais le forfait de visite', () => {
    const l = invoiceLinesForVisit(v({ kind: 'depannage', urgent: true }), [], { tva_rate: 20, visit_fee_ht: 70 })
    expect(l[0]).toMatchObject({ description_title: 'Dépannage', unit_price_ht: 0 })
    expect(l[0].description_detail).toContain('prix à compléter')
    expect(l[0].description_detail).toContain('urgente')
  })
  it('dépannage compris au contrat', () => {
    const l = invoiceLinesForVisit(v({ kind: 'depannage', itv_contracts: { billing_period: 'mensuel', includes: { depannage: true } } }), [], { tva_rate: 20 })
    expect(l[0].description_detail).toContain('comprise au contrat')
  })
})
