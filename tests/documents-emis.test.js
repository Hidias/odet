import { describe, it, expect } from 'vitest'
import { contenuDocument, memeContenu } from '../src/modules/formation/lib/documentsEmis'
import { heuresDuDocument } from '../src/modules/formation/lib/presence'

const session = { start_date: '2026-10-20', end_date: '2026-10-20', start_time: '09:00', end_time: '17:00', courses: { duration_hours: 7, duration_days: 1 }, session_trainees: [{ trainee_id: 't1' }] }

describe('documents émis', () => {
  it('heures du document : suivies, sinon présence', () => {
    expect(heuresDuDocument(session, session.courses, {}, {})).toBe(7)
    expect(heuresDuDocument(session, session.courses, {}, { heures_realisees: 3.5 })).toBe(3.5)
  })
  it('contenu comparé : heures, résultat, absences', () => {
    const a = contenuDocument(session, 'certificat', { id: 't1', result: 'acquired' })
    expect(a).toEqual({ hours: 7, result: 'acquired', absences: [] })
    expect(memeContenu(a, { hours: '7', result: 'acquired', absences: [] })).toBe(true)
    expect(memeContenu(a, { hours: 3.5, result: 'acquired', absences: [] })).toBe(false)
    expect(memeContenu(contenuDocument(session, 'attestation', { id: 't1', result: 'acquired' }), { hours: 7, result: null, absences: [] })).toBe(true)
  })
})
