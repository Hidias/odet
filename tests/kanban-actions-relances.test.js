import { describe, it, expect } from 'vitest'
import { colonnesActions, changementColonne, choixAction, finDeSemaine, lundiProchain } from '../src/core/point/actions.js'
import { colonnesRelances, passagesRelance, depotRelancePossible } from '../src/modules/commercial/lib/relances.js'

const auj = '2026-11-11' // mercredi

describe('Kanban des actions (échéances)', () => {
  const actions = [
    { id: 1, status: 'a_faire', due_on: '2026-11-09' },
    { id: 2, status: 'a_faire', due_on: '2026-11-13' },
    { id: 3, status: 'a_faire', due_on: '2026-11-20' },
    { id: 4, status: 'a_faire', due_on: null },
    { id: 5, status: 'fait', due_on: '2026-11-10' },
  ]
  it('semaine du lundi au dimanche', () => {
    expect(finDeSemaine(auj)).toBe('2026-11-15')
    expect(lundiProchain(auj)).toBe('2026-11-16')
    expect(lundiProchain('2026-11-16')).toBe('2026-11-23')
  })
  it('colonnes : En retard seulement si elle a des cartes, Terminées seulement sur demande', () => {
    expect(colonnesActions(actions, { auj }).map((c) => c.code)).toEqual(['retard', 'semaine', 'plus_tard', 'sans'])
    expect(colonnesActions(actions.slice(1), { auj }).map((c) => c.code)).toEqual(['semaine', 'plus_tard', 'sans'])
    const avec = colonnesActions(actions, { auj, avecTerminees: true })
    expect(avec.map((c) => c.code)).toEqual(['retard', 'semaine', 'plus_tard', 'sans', 'terminees'])
    expect(avec.find((c) => c.code === 'terminees').lignes.map((a) => a.id)).toEqual([5])
  })
  it('déposer change la date, jamais vers « En retard », rien si la colonne est la même', () => {
    expect(changementColonne(actions[0], 'semaine', auj)).toEqual({ due_on: auj })
    expect(changementColonne(actions[0], 'plus_tard', auj)).toEqual({ due_on: '2026-11-16' })
    expect(changementColonne(actions[1], 'sans', auj)).toEqual({ due_on: null })
    expect(changementColonne(actions[1], 'terminees', auj)).toEqual({ status: 'fait' })
    expect(changementColonne(actions[3], 'retard', auj)).toBeNull()
    expect(changementColonne(actions[1], 'semaine', auj)).toBeNull()
    expect(changementColonne(actions[4], 'semaine', auj)).toEqual({ status: 'a_faire', due_on: auj })
    expect(changementColonne(actions[4], 'terminees', auj)).toBeNull()
  })
  it('menu : choix sans effet retirés ; action terminée : remettre à faire', () => {
    const codes = (a) => choixAction(a, auj).map((c) => c.code)
    expect(codes({ status: 'a_faire', due_on: auj })).toEqual(['lundi', 'report', 'sans', 'fait', 'abandonne'])
    expect(codes({ status: 'a_faire', due_on: null })).toEqual(['aujourdhui', 'lundi', 'report', 'fait', 'abandonne'])
    expect(codes({ status: 'abandonne', due_on: null })).toEqual(['rouvrir'])
  })
})

describe('Kanban des relances à valider', () => {
  it('quatre colonnes par état, les relances en erreur restent hors colonnes comme dans la liste', () => {
    const cols = colonnesRelances([{ id: 1, status: 'a_valider' }, { id: 2, status: 'valide' }, { id: 3, status: 'erreur' }])
    expect(cols.map((c) => c.code)).toEqual(['a_valider', 'valide', 'envoye', 'ignore'])
    expect(cols.flatMap((c) => c.lignes).map((x) => x.id)).toEqual([1, 2])
  })
  it('passages : valider sauf relance bloquée, ignorer avec confirmation, envoyée jamais par glisser', () => {
    expect(passagesRelance({ status: 'a_valider' }).map((p) => p.status)).toEqual(['valide', 'ignore'])
    expect(passagesRelance({ status: 'a_valider', blocked_reason: 'pas de formateur' }).map((p) => p.status)).toEqual(['ignore'])
    expect(passagesRelance({ status: 'a_valider' }).find((p) => p.status === 'ignore').confirmer).toBeTruthy()
    expect(passagesRelance({ status: 'valide' }).map((p) => p.status)).toEqual(['a_valider', 'envoye'])
    expect(passagesRelance({ status: 'envoye' })).toEqual([])
    expect(passagesRelance({ status: 'ignore' })).toEqual([])
    expect(depotRelancePossible({ status: 'valide' }, 'envoye')).toBe(false)
    expect(depotRelancePossible({ status: 'valide' }, 'a_valider')).toBe(true)
    expect(depotRelancePossible({ status: 'a_valider' }, 'valide')).toBe(true)
    expect(depotRelancePossible({ status: 'a_valider', blocked_reason: 'x' }, 'valide')).toBe(false)
    expect(depotRelancePossible({ status: 'envoye' }, 'a_valider')).toBe(false)
  })
})
