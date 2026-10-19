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
