import { describe, expect, it, vi } from 'vitest'
vi.mock('../src/core/supabase', () => ({ supabase: {} }))
const { peutDesactiverEmplacement } = await import('../src/modules/stock/lib/stockData.js')

describe('désactiver un emplacement de stock', () => {
  it('refuse tant qu\'il reste un article', () => {
    expect(peutDesactiverEmplacement({ kind: 'depot' }, [0, 2]).ok).toBe(false)
    expect(peutDesactiverEmplacement({ kind: 'depot' }, [0, 0.0001]).ok).toBe(true)
  })
  it('stock d\'un technicien : seulement quand son compte est désactivé', () => {
    const l = { kind: 'technicien', profile_id: 'p1' }
    expect(peutDesactiverEmplacement(l, [], true).ok).toBe(false)
    expect(peutDesactiverEmplacement(l, [], undefined).ok).toBe(false)
    expect(peutDesactiverEmplacement(l, [], false).ok).toBe(true)
  })
})
