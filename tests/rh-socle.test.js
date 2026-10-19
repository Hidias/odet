import { describe, it, expect } from 'vitest'
import { statutContrat, plagesVersTexte, texteVersPlages, heuresSemaine, nomComplet } from '../src/modules/rh/lib/rhData'

describe('RH socle', () => {
  it('statut d\'un contrat (même règle que l\'annuaire en base)', () => {
    expect(statutContrat(null)).toBe('sans_contrat')
    expect(statutContrat({ start_on: '2026-11-01' }, '2026-10-19')).toBe('a_venir')
    expect(statutContrat({ start_on: '2026-01-01', end_on: '2026-10-18' }, '2026-10-19')).toBe('termine')
    expect(statutContrat({ start_on: '2026-01-01', end_on: '2026-10-19' }, '2026-10-19')).toBe('actif')
    expect(statutContrat({ start_on: '2026-01-01' }, '2026-10-19')).toBe('actif')
  })
  it('plages horaires : texte ↔ liste', () => {
    expect(plagesVersTexte([['08:30', '12:30'], ['13:30', '17:30']])).toBe('08:30-12:30, 13:30-17:30')
    expect(texteVersPlages('8h30-12h30 ; 13:30 - 17:30')).toEqual([['08:30', '12:30'], ['13:30', '17:30']])
    expect(texteVersPlages('')).toEqual([])
    expect(texteVersPlages('12:00-08:00')).toBeNull()
    expect(texteVersPlages('n\'importe quoi')).toBeNull()
  })
  it('heures par semaine de l\'horaire par défaut', () => {
    const j = [['08:30', '12:30'], ['13:30', '17:30']]
    expect(heuresSemaine({ lun: j, mar: j, mer: j, jeu: j, ven: j })).toBe(40)
  })
  it('nom affiché : nom d\'usage s\'il existe', () => {
    expect(nomComplet({ first_name: 'Marie', last_name: 'Le Gall', usage_name: 'Kerhervé' })).toBe('Marie Kerhervé')
  })
})

describe('RH absences', async () => {
  const { joursOuvres } = await import('../src/modules/rh/lib/rhData')
  it('jours ouvrés avec demi-journées (même calcul que la base)', () => {
    expect(joursOuvres('2026-11-02', false, '2026-11-06', false)).toBe(5)
    expect(joursOuvres('2026-11-02', true, '2026-11-06', true)).toBe(4)
    expect(joursOuvres('2026-11-06', false, '2026-11-09', false)).toBe(2)
    expect(joursOuvres('2026-11-07', false, '2026-11-08', false)).toBe(0)
    expect(joursOuvres('2026-11-04', true, '2026-11-04', false)).toBe(0.5)
    expect(joursOuvres('2026-11-06', false, '2026-11-02', false)).toBe(0)
  })
})

describe('RH heures', async () => {
  const { totauxSemaine, lundiDe, minutesLigne, heures } = await import('../src/modules/rh/lib/rhData')
  it('semaine : total, heures supplémentaires 25 % puis 50 %, dépassements signalés', () => {
    const l = [
      { work_date: '2026-11-02', start_time: '07:00:00', end_time: '19:00:00', break_minutes: 60 },
      { work_date: '2026-11-03', start_time: '08:00', end_time: '18:00', break_minutes: 60 },
      { work_date: '2026-11-04', start_time: '08:00', end_time: '18:00', break_minutes: 60 },
      { work_date: '2026-11-05', start_time: '08:00', end_time: '18:00', break_minutes: 60 },
      { work_date: '2026-11-06', start_time: '08:00', end_time: '18:00', break_minutes: 60 },
    ]
    const t = totauxSemaine(l, 35 * 60)
    expect(t.total).toBe(47 * 60)
    expect(t.sup).toBe(12 * 60)
    expect(t.sup25).toBe(8 * 60)
    expect(t.sup50).toBe(4 * 60)
    expect(t.joursLongs).toEqual(['2026-11-02'])
    expect(t.semaineLongue).toBe(false)
  })
  it('lundi de la semaine, durée d\'une ligne, affichage', () => {
    expect(lundiDe('2026-11-08')).toBe('2026-11-02')
    expect(lundiDe('2026-11-02')).toBe('2026-11-02')
    expect(minutesLigne('13:30', '17:30', 15)).toBe(225)
    expect(heures(225)).toBe('3 h45')
    expect(heures(480)).toBe('8 h')
  })
})

describe('RH : jours fériés dans le décompte (0311)', () => {
  it('le 14 juillet ne compte pas, sauf s\'il est travaillé', async () => {
    const { joursOuvres } = await import('../src/modules/rh/lib/rhData')
    expect(joursOuvres('2027-07-12', false, '2027-07-16', false, ['2027-07-14'])).toBe(4)
    expect(joursOuvres('2027-07-12', false, '2027-07-16', false, [])).toBe(5)
    expect(joursOuvres('2027-07-14', true, '2027-07-14', false, ['2027-07-14'])).toBe(0)
  })
})
