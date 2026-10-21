import { describe, it, expect } from 'vitest'
import { parJour } from '../src/modules/formation/components/RessentiSession'

describe('ressenti au fil de la formation (0414)', () => {
  it('regroupe par jour, le plus récent d’abord, avec difficultés et remarques', () => {
    const r = [
      { id: 1, trainee_id: 'a', jour: '2026-10-20', note: 5, commentaire: null },
      { id: 2, trainee_id: 'b', jour: '2026-10-20', note: 2, commentaire: '' },
      { id: 3, trainee_id: 'a', jour: '2026-10-21', note: 4, commentaire: 'Une question sur le DAE' },
    ]
    const j = parJour(r, { a: 'Paul MARTIN', b: 'Claire DURAND' })
    expect(j.map((x) => x.jour)).toEqual(['2026-10-21', '2026-10-20'])
    expect(j[1].moyenne).toBe(3.5)
    expect(j[1].difficultes).toBe(1)
    expect(j[1].remarques).toEqual([{ id: 2, nom: 'Claire DURAND', note: 2, commentaire: '' }])
    expect(j[0].remarques[0].commentaire).toBe('Une question sur le DAE')
  })
})
