import { describe, it, expect } from 'vitest'
import { contenuIcs, contenuIcsSessions } from '../src/core/fichiers/agenda'
import { sessionDuJour, noteAgenda } from '../src/modules/portail/pages/EspaceExterne'

describe('espace formateur (0453)', () => {
  it('émargement ouvert seulement les jours de la session', () => {
    const s = { start_date: '2026-11-02', end_date: '2026-11-03' }
    expect(sessionDuJour(s, '2026-11-01')).toBe(false)
    expect(sessionDuJour(s, '2026-11-02')).toBe(true)
    expect(sessionDuJour(s, '2026-11-03')).toBe(true)
    expect(sessionDuJour(s, '2026-11-04')).toBe(false)
    expect(sessionDuJour({ start_date: '2026-11-02' }, '2026-11-02')).toBe(true)
    expect(sessionDuJour({}, '2026-11-02')).toBe(false)
  })

  it('note d\'agenda sans prix', () => {
    const n = noteAgenda({ client: { name: 'Hôtel' }, session_trainees: [{}, {}], room: 'B', total_price: 1500 })
    expect(n).toBe('Client : Hôtel\n2 stagiaires\nSalle : B')
    expect(n).not.toContain('1500')
  })

  it('planning complet dans un seul fichier, un événement par jour', () => {
    const ics = contenuIcsSessions([
      { id: 'a', reference: 'SES-A', start_date: '2026-11-02', end_date: '2026-11-03', start_time: '08:30:00', end_time: '12:00:00', courses: { title: 'SST' } },
      { id: 'b', reference: 'SES-B', start_date: '2026-11-10', end_date: '2026-11-10', courses: { title: 'Incendie' } },
    ], { lieuDe: (s) => (s.id === 'a' ? 'Salle 1; Brest' : ''), prefixe: 'Intervention', noteDe: () => 'Client : X', maintenant: new Date('2026-10-24T10:00:00Z') })
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3)
    expect(ics).toContain('SUMMARY:Intervention : SST')
    expect(ics).toContain('DTSTART;TZID=Europe/Paris:20261102T083000')
    expect(ics).toContain('DTSTART;TZID=Europe/Paris:20261110T090000')
    expect(ics).toContain('LOCATION:Salle 1\\; Brest')
    expect(ics).toContain('Client : X')
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR')).toBe(true)
  })

  it('le fichier d\'une session reste le même pour le client et le stagiaire', () => {
    const ics = contenuIcs({ id: 's1', start_date: '2026-11-25', end_date: '2026-11-25', courses: { title: 'Initiation' } }, { maintenant: new Date('2026-10-24T10:00:00Z') })
    expect(ics).toContain('SUMMARY:Formation : Initiation')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1)
  })
})
