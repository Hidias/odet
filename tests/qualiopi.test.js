// Résultats publiés (indicateur 2 Qualiopi) et heures de présence.
import { describe, it, expect } from 'vitest'
import { plannedHalfDays, sessionsInPeriod, computeResults } from '../src/modules/certification/lib/results.js'
import { computePresenceHours, sessionDayList, formatHours } from '../src/modules/formation/lib/presence.js'

describe('Demi-journées prévues', () => {
  it('1 jour de 7 h : matin et après-midi', () => {
    expect(plannedHalfDays({ start_date: '2026-03-02', end_date: '2026-03-02' }, 7)).toEqual([
      { date: '2026-03-02', period: 'morning' }, { date: '2026-03-02', period: 'afternoon' },
    ])
  })
  it('2 jours de 14 h : 4 demi-journées', () => expect(plannedHalfDays({ start_date: '2026-03-02', end_date: '2026-03-03' }, 14)).toHaveLength(4))
  it('10,5 h sur 2 jours : 3 demi-journées', () => expect(plannedHalfDays({ start_date: '2026-03-02', end_date: '2026-03-03' }, 10.5)).toHaveLength(3))
  it('session à la demi-journée l\'après-midi', () => {
    expect(plannedHalfDays({ start_date: '2026-03-02', day_type: 'half', start_time: '13:30' }, 3.5)).toEqual([{ date: '2026-03-02', period: 'afternoon' }])
  })
  it('passage à l\'heure d\'été sans jour perdu', () => expect(plannedHalfDays({ start_date: '2026-03-28', end_date: '2026-03-30' }, 21)).toHaveLength(6))
  it('durée absente : 7 h par défaut', () => expect(plannedHalfDays({ start_date: '2026-03-02' }, null)).toHaveLength(2))
  it('dates incohérentes : rien', () => expect(plannedHalfDays({ start_date: '2026-03-05', end_date: '2026-03-02' }, 7)).toEqual([]))
})

describe('Sessions retenues', () => {
  const sessions = [
    { id: 'a', status: 'completed', end_date: '2026-01-31' },
    { id: 'b', status: 'completed', end_date: '2026-02-15' },
    { id: 'c', status: 'planned', end_date: '2026-02-10' },
  ]
  it('seulement les sessions terminées dans la période, bornes incluses', () => {
    expect(sessionsInPeriod(sessions, { from: '2026-02-01', to: '2026-02-15' }).map((s) => s.id)).toEqual(['b'])
    expect(sessionsInPeriod(sessions, { from: '2026-01-31' }).map((s) => s.id)).toEqual(['a', 'b'])
  })
})

describe('Résultats publiés', () => {
  const sessions = [{ id: 's1', status: 'completed', start_date: '2026-03-02', end_date: '2026-03-03', course_id: 'c1' }]
  const enrollments = [
    { session_id: 's1', trainee_id: 't1', result: 'acquired' },
    { session_id: 's1', trainee_id: 't2', result: 'Acquis' },
    { session_id: 's1', trainee_id: 't3', result: 'not_acquired' },
    { session_id: 's1', trainee_id: 't4', result: null },
  ]
  const attendance = [
    { session_id: 's1', trainee_id: 't1', date: '2026-03-02', morning: true, afternoon: true },
    { session_id: 's1', trainee_id: 't1', date: '2026-03-03', morning: true, afternoon: true },
    { session_id: 's1', trainee_id: 't2', date: '2026-03-02', morning: true, afternoon: false },
    { session_id: 'autre', trainee_id: 't3', date: '2026-03-02', morning: true, afternoon: true },
  ]
  const evaluations = [
    { session_id: 's1', would_recommend: true, q_org_accueil: 5, q_global_competences: 4 },
    { session_id: 's1', would_recommend: false, q_org_accueil: 3 },
    { session_id: 's1', would_recommend: null },
  ]
  const r = computeResults({ sessions, courseHours: { c1: 14 }, enrollments, attendance, evaluations })

  it('assiduité : demi-journées signées / prévues, tous inscrits', () => {
    // 4 inscrits x 4 demi-journées = 16 prévues ; t1 : 4 signées, t2 : 1 ; la session « autre » ne compte pas
    expect(r.attendance).toEqual({ value: 31.3, num: 5, den: 16 })
  })
  it('atteinte des objectifs : acquis / résultats saisis', () => expect(r.objectives).toEqual({ value: 66.7, num: 2, den: 3 }))
  it('satisfaction : moyenne des notes données', () => expect(r.satisfaction.value).toBe(4))
  it('recommandation : oui / réponses données', () => expect(r.recommendation).toEqual({ value: 50, num: 1, den: 2 }))
  it('effectifs', () => { expect(r.sessions).toBe(1); expect(r.trainees).toBe(4) })
  it('aucune donnée : valeurs vides, pas de division par zéro', () => {
    const v = computeResults({})
    expect(v.attendance.value).toBeNull()
    expect(v.satisfaction.value).toBeNull()
  })
})

describe('Heures de présence (attestation)', () => {
  const session = { start_date: '2026-03-02', end_date: '2026-03-03', start_time: '09:00', end_time: '17:00' }
  const course = { duration_hours: 14, duration_days: 2 }
  it('par défaut : durée complète', () => expect(computePresenceHours(session, course)).toEqual({ hours: 14, partial: false, breakLabel: '' }))
  it('arrivée à 10 h le premier jour : 1 h de moins', () => {
    const r = computePresenceHours(session, course, { arrival_date: '2026-03-02', arrival_time: '10:00' })
    expect(r.hours).toBe(13)
    expect(r.partial).toBe(true)
  })
  it('départ anticipé à 12 h le premier jour : 3 h, jour suivant non compté', () => {
    expect(computePresenceHours(session, course, { early_departure: true, departure_date: '2026-03-02', departure_time: '12:00' }).hours).toBe(3)
  })
  it('départ sans heure : la journée ne compte pas', () => {
    expect(computePresenceHours(session, course, { early_departure: true, departure_date: '2026-03-03' }).hours).toBe(7)
  })
  it('jours de session au changement d\'heure', () => expect(sessionDayList({ start_date: '2026-10-24', end_date: '2026-10-26' })).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']))
  it('libellé', () => { expect(formatHours(1)).toBe('1 heure'); expect(formatHours(5.5)).toBe('5,5 heures') })
})
