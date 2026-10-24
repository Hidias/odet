import { describe, it, expect } from 'vitest'
import { contenuIcs, contenuIcsSessions } from '../src/core/fichiers/agenda'
import { sessionDuJour, noteAgenda } from '../src/modules/portail/pages/EspaceExterne'
import { motifFrais, montant, totauxFrais, euros } from '../src/modules/formation/lib/fraisFormateur'

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

describe('notes de frais (0454)', () => {
  const ok = { spent_on: '2026-10-20', category: 'repas', amount: '18,50', file: { size: 1000, name: 't.jpg' } }
  it('montant lu à la française', () => {
    expect(montant('18,50')).toBe(18.5)
    expect(montant('1 200.4')).toBe(1200.4)
    expect(montant('12,345')).toBeNull()
    expect(montant('abc')).toBeNull()
  })
  it('contrôles avant envoi', () => {
    const j = '2026-10-24'
    expect(motifFrais(ok, j)).toBeNull()
    expect(motifFrais({ ...ok, file: null }, j)).toMatch(/ticket/)
    expect(motifFrais({ ...ok, spent_on: '2026-10-25' }, j)).toMatch(/futur/)
    expect(motifFrais({ ...ok, spent_on: '2025-10-01' }, j)).toMatch(/plus d'un an/)
    expect(motifFrais({ ...ok, amount: '0' }, j)).toMatch(/Montant/)
    expect(motifFrais({ ...ok, category: 'kilometres', file: null, km: '' }, j)).toMatch(/kilomètres/)
    expect(motifFrais({ ...ok, category: 'kilometres', file: null, km: '120' }, j)).toBeNull()
    expect(motifFrais({ ...ok, category: 'autre', description: '' }, j)).toMatch(/Précisez/)
    expect(motifFrais({ ...ok, file: { size: 9 * 1024 * 1024 } }, j)).toMatch(/lourd/)
  })
  it('totaux par état', () => {
    const t = totauxFrais([{ status: 'soumise', amount_ttc: 10 }, { status: 'validee', amount_ttc: '5.5' }, { status: 'remboursee', amount_ttc: 2 }, { status: 'refusee', amount_ttc: 100 }])
    expect(t).toEqual({ aValider: 10, aRembourser: 5.5, rembourse: 2 })
    expect(euros(5.5).replace(/\s/g, ' ')).toBe('5,50 €')
  })
})
