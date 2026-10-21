import { describe, it, expect } from 'vitest'
import { champsManquants } from '../src/modules/formation/components/CompletudeFiche'

describe('fiche formation complète', () => {
  it('champs vides repérés (base ou formulaire)', () => {
    const base = { objectives: 'x', program: 'y', duration_hours: 2, target_audience: 'Tout public', prerequisites: 'Aucun', methods: 'z', evaluation_methods: 'e' }
    expect(champsManquants(base)).toEqual(['trainer_equipment', 'material'])
    expect(champsManquants({ ...base, trainer_equipment: 'a', material: 'b' })).toEqual([])
    expect(champsManquants({ content: '', duration: '' })).toContain('content')
  })
})
