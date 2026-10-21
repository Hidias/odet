import { describe, it, expect } from 'vitest'
import { datesCreneau, libelleCreneau } from '../src/modules/formation/components/CreneauxRecurrents'

const du = new Date(2026, 9, 22)
describe('créneaux récurrents (0422)', () => {
  it('premier mardi du mois', () => {
    expect(datesCreneau({ frequence: 'mensuel', rang: 1, jour_semaine: 2, intervalle: 1, date_debut: '2026-10-01' }, du, 3))
      .toEqual(['2026-11-03', '2026-12-01', '2027-01-05'])
  })
  it('dernier vendredi, tous les 2 mois', () => {
    expect(datesCreneau({ frequence: 'mensuel', rang: -1, jour_semaine: 5, intervalle: 2, date_debut: '2026-10-01' }, du, 3))
      .toEqual(['2026-10-30', '2026-12-25', '2027-02-26'])
  })
  it('chaque lundi toutes les 2 semaines, jusqu\'à une date', () => {
    expect(datesCreneau({ frequence: 'hebdo', jour_semaine: 1, intervalle: 2, date_debut: '2026-10-26', date_fin: '2026-11-30' }, du, 10))
      .toEqual(['2026-10-26', '2026-11-09', '2026-11-23'])
  })
  it('libellé lisible', () => {
    expect(libelleCreneau({ frequence: 'mensuel', rang: 1, jour_semaine: 2, intervalle: 1 })).toBe('Le premier mardi du mois')
    expect(libelleCreneau({ frequence: 'hebdo', jour_semaine: 3, intervalle: 1 })).toBe('Chaque mercredi')
  })
})
