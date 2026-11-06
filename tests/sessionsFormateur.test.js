import { describe, it, expect } from 'vitest'
import { filtreFormateur, sessionsCoFormateur } from '../api/_lib/sessionsFormateur.js'

const A = '11111111-1111-4111-8111-111111111111'
const S1 = '22222222-2222-4222-8222-222222222222'
const S2 = '33333333-3333-4333-8333-333333333333'

describe('sessions d\'un formateur pour les agendas (C6)', () => {
  it('principal seul sans autre session', () => {
    expect(filtreFormateur(A, [])).toBe(`trainer_id.eq.${A}`)
  })
  it('principal ou autre formateur', () => {
    expect(filtreFormateur(A, [S1, S2])).toBe(`trainer_id.eq.${A},id.in.(${S1},${S2})`)
  })
  it('écarte un identifiant qui n\'est pas un uuid', () => {
    expect(filtreFormateur(A, [S1, 'x),trainer_id.neq.(y'])).toBe(`trainer_id.eq.${A},id.in.(${S1})`)
    expect(() => filtreFormateur('all', [])).toThrow()
  })
  it('lecture de session_trainers : liste sans doublon, erreur levée si la lecture échoue', async () => {
    const client = (res) => ({ from: () => ({ select: () => ({ eq: async () => res }) }) })
    await expect(sessionsCoFormateur(client({ data: [{ session_id: S1 }, { session_id: S1 }, { session_id: S2 }], error: null }), A)).resolves.toEqual([S1, S2])
    await expect(sessionsCoFormateur(client({ data: null, error: { message: 'refus' } }), A)).rejects.toThrow('session_trainers')
  })
})
