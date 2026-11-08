import { describe, it, expect } from 'vitest'
import { colonnesVisites, depotVisitePossible, choixVisite, RETOUR_A_PLANIFIER } from '../src/modules/interventions/lib/visitesKanban.js'

describe('Kanban des visites (choix prudent de H, 08/11)', () => {
  it('quatre colonnes, annulées hors tableau', () => {
    const cols = colonnesVisites([{ id: 1, status: 'a_planifier' }, { id: 2, status: 'annulee' }, { id: 3, status: 'terminee' }])
    expect(cols.map((c) => [c.code, c.label])).toEqual([['a_planifier', 'À planifier'], ['planifiee', 'Planifiée'], ['en_cours', 'En cours'], ['terminee', 'Terminée']])
    expect(cols.flatMap((c) => c.lignes).map((v) => v.id)).toEqual([1, 3])
  })
  it('un seul dépôt : planifiée vers à planifier, et seulement pour qui gère', () => {
    expect(depotVisitePossible({ status: 'planifiee' }, 'a_planifier')).toBe(true)
    expect(depotVisitePossible({ status: 'planifiee' }, 'a_planifier', false)).toBe(false)
    expect(depotVisitePossible({ status: 'en_cours' }, 'a_planifier')).toBe(false)
    expect(depotVisitePossible({ status: 'a_planifier' }, 'planifiee')).toBe(false)
    expect(depotVisitePossible({ status: 'planifiee' }, 'terminee')).toBe(false)
    expect(depotVisitePossible({ status: 'en_cours' }, 'terminee')).toBe(false)
    expect(RETOUR_A_PLANIFIER).toEqual({ status: 'a_planifier', planned_on: null, technician_id: null, route_order: 0 })
  })
  it('menu : ouvrir toujours, Planning pour planifier ou changer de jour, jamais terminer ni annuler', () => {
    const codes = (v, g = true) => choixVisite(v, g).map((c) => c.code)
    expect(codes({ id: 'a', status: 'a_planifier' })).toEqual(['ouvrir', 'planifier'])
    expect(codes({ id: 'a', status: 'planifiee', planned_on: '2026-12-07' })).toEqual(['ouvrir', 'jour', 'deplanifier'])
    expect(choixVisite({ id: 'a', status: 'planifiee', planned_on: '2026-12-07' }).find((c) => c.code === 'jour').lien).toBe('/interventions/planning?jour=2026-12-07')
    expect(codes({ id: 'a', status: 'en_cours' })).toEqual(['ouvrir'])
    expect(codes({ id: 'a', status: 'terminee' })).toEqual(['ouvrir'])
    expect(codes({ id: 'a', status: 'planifiee' }, false)).toEqual(['ouvrir'])
  })
})
