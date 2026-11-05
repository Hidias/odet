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

  it('échantillon : sessions terminées, convention en règle ou à reprendre (etatConvention)', () => {
    const r = sessionsEchantillon([
      { id: 's1', end_date: '2026-09-01', status: 'completed', convention_signed: true },
      { id: 's2', end_date: '2026-09-10', status: 'completed', convention_sent: true },
      { id: 's3', end_date: '2026-09-12', status: 'cancelled' },
      { id: 's4', end_date: '2026-12-01', status: 'planned' },
      { id: 's5', end_date: '2026-09-05', status: 'completed', session_type: 'subcontract' },
      { id: 's6', end_date: '2026-09-15', status: 'completed', session_type: 'inter' },
      { id: 's7', end_date: '2026-09-20', status: 'completed', session_type: 'inter' },
      { id: 's8', end_date: '2026-09-25', status: 'completed' },
    ], [
      { session_id: 's6', doc_status: 'signe' }, { session_id: 's6', doc_status: 'a_envoyer', status: 'cancelled' },
      { session_id: 's7', doc_status: 'signe' }, { session_id: 's7', doc_status: 'envoye' },
    ], '2025-10-19', '2026-10-19')
    expect(r.total).toBe(6)
    expect(r.completes.map((s) => s.id)).toEqual(['s1', 's5', 's6'])
    expect(r.aCompleter.map((s) => [s.id, s.motif])).toEqual([
      ['s8', 'Convention : non envoyée'],
      ['s2', 'Convention : envoyée, non signée'],
      ['s7', 'Convention : envoyée, non signée'],
    ])
  })

  it('date il y a n mois', () => {
    expect(ilYa(12, new Date('2026-10-19T12:00:00Z'))).toBe('2025-10-19')
  })
})
