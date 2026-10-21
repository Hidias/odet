import { describe, it, expect } from 'vitest'
import { listeDemiJournees, controleEmargement, heuresRealisees } from '../src/modules/formation/lib/presence'

const session = { start_date: '2026-10-20', end_date: '2026-10-21', start_time: '09:00', end_time: '17:00' }
const course = { duration_hours: 14, duration_days: 2 }
const sig = (date, m, a, trainee = 't1') => ({ trainee_id: trainee, date, morning: m, afternoon: a, signature_morning: m ? 'x' : null, signature_afternoon: a ? 'x' : null })

describe('heures réellement suivies', () => {
  it('liste les demi-journées attendues', () => {
    expect(listeDemiJournees(session, course).length).toBe(4)
    expect(listeDemiJournees({ ...session, end_date: '2026-10-20', day_type: 'half', start_time: '13:30' }, { duration_hours: 3.5 }))
      .toEqual([{ date: '2026-10-20', period: 'afternoon' }])
  })
  it('session sur papier : pas de contrôle', () => {
    expect(controleEmargement({ session, course, traineeId: 't1', halfdays: [] }).controle).toBe(false)
  })
  it('signale une demi-journée sans signature, puis applique la décision la plus récente', () => {
    const halfdays = [sig('2026-10-20', true, true), sig('2026-10-21', true, false)]
    let c = controleEmargement({ session, course, traineeId: 't1', halfdays })
    expect(c.aRegulariser).toHaveLength(1)
    expect(heuresRealisees({ session, course, controle: c }).hours).toBe(14)
    const regularisations = [
      { trainee_id: 't1', date: '2026-10-21', period: 'afternoon', decision: 'present_oubli', decided_at: '2026-10-21T18:00:00Z' },
      { trainee_id: 't1', date: '2026-10-21', period: 'afternoon', decision: 'absent', decided_at: '2026-10-22T08:00:00Z' },
    ]
    c = controleEmargement({ session, course, traineeId: 't1', halfdays, regularisations })
    expect(c.aRegulariser).toHaveLength(0)
    expect(c.absents).toHaveLength(1)
    expect(heuresRealisees({ session, course, controle: c }).hours).toBe(10.5)
  })
  it('signature par procuration comptée, départ anticipé pas retiré deux fois', () => {
    const halfdays = [sig('2026-10-20', true, true)]
    const proxies = [{ trainee_id: 't1', date: '2026-10-21', period: 'morning' }]
    const regularisations = [{ trainee_id: 't1', date: '2026-10-21', period: 'afternoon', decision: 'absent', decided_at: '2026-10-21T18:00:00Z' }]
    const c = controleEmargement({ session, course, traineeId: 't1', halfdays, proxies, regularisations })
    expect(c.absents).toHaveLength(1)
    const st = { early_departure: true, departure_date: '2026-10-21', departure_time: '12:00', presence_hours: 10.5 }
    expect(heuresRealisees({ session, course, st, controle: c }).hours).toBe(10.5)
  })
})
