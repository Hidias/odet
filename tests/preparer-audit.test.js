import { describe, it, expect } from 'vitest'
import { sitesAMontrer, operationsEnRetard, sessionsEchantillon, ilYa } from '../src/modules/certification/lib/preparerAudit'

const visite = (id, jour, site = 's1', status = 'terminee') => ({ id, reference: `ITV-${id}`, status, finished_at: `${jour}T10:00:00Z`, site_id: site, client_id: 'c1', sites: { name: 'Site', city: 'Brest' }, clients: { name: 'Client' } })

describe('Préparer l\'audit', () => {
  it('sites à montrer : seulement les opérations périodiques faites, sur la période, visite terminée', () => {
    const r = sitesAMontrer([
      { result: 'conforme', operation: 'maa', itv_visits: visite('v1', '2026-05-02') },
      { result: 'conforme', operation: 'revision', itv_visits: visite('v1', '2026-05-02') },
      { result: 'remplace', operation: 'maa', itv_visits: visite('v2', '2026-06-01') },
      { result: 'conforme', operation: 'verification', itv_visits: visite('v3', '2026-06-01') },
      { result: 'conforme', operation: 'maa', itv_visits: visite('v4', '2024-01-01') },
      { result: 'conforme', operation: 'maa', itv_visits: visite('v5', '2026-07-01', 's1', 'en_cours') },
    ], '2025-10-19')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ total: 2, dernier: '2026-05-02', operations: { maa: 1, revision: 1 } })
    expect(r[0].visites).toEqual([{ id: 'v1', reference: 'ITV-v1' }])
  })

  it('opérations dues non faites, par client', () => {
    const type = { operations: [{ code: 'maa', label: 'MAA', years: [5] }, { code: 'revision', label: 'Révision', years: [10] }] }
    const r = operationsEnRetard([
      { id: 'e1', client_id: 'c1', manufactured_year: 2021, itv_equipment_types: type, clients: { name: 'A' } },
      { id: 'e2', client_id: 'c1', manufactured_year: 2016, itv_equipment_types: type, clients: { name: 'A' } },
      { id: 'e3', client_id: 'c2', manufactured_year: 2021, itv_equipment_types: type, clients: { name: 'B' } },
    ], { e3: [{ operation: 'maa', year: 2026 }] }, 2026)
    expect(r).toEqual([{ client_id: 'c1', client: 'A', dues: 2, retard: 0 }])
  })

  it('sessions terminées : complètes ou à compléter selon les alertes ouvertes', () => {
    const r = sessionsEchantillon([
      { id: 's1', end_date: '2026-09-01', status: 'completed' },
      { id: 's2', end_date: '2026-09-10', status: 'completed' },
      { id: 's3', end_date: '2026-09-12', status: 'cancelled' },
      { id: 's4', end_date: '2026-12-01', status: 'planned' },
    ], [{ entity_id: 's2', resolved_at: null }, { entity_id: 's2', resolved_at: null }, { entity_id: 's1', resolved_at: '2026-09-20' }], '2025-10-19', '2026-10-19')
    expect(r.total).toBe(2)
    expect(r.completes.map((s) => s.id)).toEqual(['s1'])
    expect(r.aCompleter).toEqual([{ id: 's2', end_date: '2026-09-10', status: 'completed', alertes: 2 }])
  })

  it('date il y a n mois', () => {
    expect(ilYa(12, new Date('2026-10-19T12:00:00Z'))).toBe('2025-10-19')
  })
})
