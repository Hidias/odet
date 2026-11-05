import { describe, it, expect } from 'vitest'
import { formateursVoulus, autresFormateursIds, separerFormateurs } from '../src/core/session/formateursSession'

describe('formateurs d\'une session (C6)', () => {
  it('met le principal en premier, sans doublon ni vide', () => {
    expect(formateursVoulus('a', ['b', 'a', '', null, 'c', 'b'])).toEqual(['a', 'b', 'c'])
  })
  it('accepte une session sans principal', () => {
    expect(formateursVoulus('', ['b'])).toEqual(['b'])
    expect(formateursVoulus(null, [])).toEqual([])
  })
  it('retire le principal des autres formateurs', () => {
    expect(autresFormateursIds([{ trainer_id: 'a' }, { trainer_id: 'b' }, { trainer_id: 'b' }], 'a')).toEqual(['b'])
    expect(autresFormateursIds(null, 'a')).toEqual([])
  })
  it('sépare la liste d\'un formulaire', () => {
    expect(separerFormateurs(['a', 'b', 'c'])).toEqual({ principalId: 'a', autresIds: ['b', 'c'] })
    expect(separerFormateurs([])).toEqual({ principalId: null, autresIds: [] })
  })
})
