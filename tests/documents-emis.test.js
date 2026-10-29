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
    expect(a).toEqual({ hours: 7, result: 'acquired', absences: [], objectives: null })
    expect(memeContenu(a, { hours: '7', result: 'acquired', absences: [] })).toBe(true)
    expect(memeContenu(a, { hours: 3.5, result: 'acquired', absences: [] })).toBe(false)
    expect(memeContenu(contenuDocument(session, 'attestation', { id: 't1', result: 'acquired' }), { hours: 7, result: null, absences: [] })).toBe(true)
  })
})

import { appliquerEmis } from '../src/modules/formation/lib/documentsEmis'

describe('portails : version émise', () => {
  it('reprend la dernière version et la précédente', () => {
    const lignes = [
      { session_id: 's', trainee_id: 't1', kind: 'certificat', version: 2, issued_on: '2026-10-21', hours: '2', result: 'acquired', absences: [] },
      { session_id: 's', trainee_id: 't1', kind: 'certificat', version: 1, issued_on: '2026-08-24', hours: '4', result: 'acquired', absences: [] },
    ]
    const [t] = appliquerEmis(lignes, 's', 'certificat', [{ id: 't1', result: null }])
    expect(t.heures_realisees).toBe(2)
    expect(t.result).toBe('acquired')
    expect(t.document_emis).toEqual({ version: 2, issued_on: '2026-10-21', remplace: { version: 1, issued_on: '2026-08-24' } })
    expect(appliquerEmis(lignes, 's', 'attestation', [{ id: 't1' }])[0].document_emis).toBeUndefined()
  })
})
