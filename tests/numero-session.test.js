// Numérotation des sessions : l'application n'impose plus de référence, la base la donne
// (generate_session_reference_v3 : préfixe de la société, code formation, date de début, compteur).
import { describe, it, expect, vi } from 'vitest'

const inserts = []
vi.mock('../src/core/supabase', () => ({
  supabase: {
    from: (table) => ({
      insert: (rows) => {
        inserts.push({ table, rows })
        return { select: () => ({ single: async () => ({ data: { id: 'session-essai', reference: 'GLD-SST-261210-001' }, error: null }) }) }
      },
    }),
  },
}))

const { useDataStore } = await import('../src/core/store.js')

describe('numéro de session', () => {
  it('createSession laisse la base numéroter (aucune référence envoyée)', async () => {
    useDataStore.setState({ fetchSessions: async () => ({}) })
    const { data, error } = await useDataStore.getState().createSession({
      course_id: 'c1', client_id: 'k1', start_date: '2026-12-10', end_date: '2026-12-10', trainer_ids: [], trainee_ids: [],
    })
    expect(error).toBeNull()
    expect(data.reference).toBe('GLD-SST-261210-001')
    const ligne = inserts.find((i) => i.table === 'sessions').rows[0]
    expect('reference' in ligne).toBe(false)
    expect(ligne.start_date).toBe('2026-12-10')
    expect(ligne.attendance_token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('la duplication par la base, qui envoyait des dates vides, n\'existe plus', () => {
    expect(useDataStore.getState().duplicateSession).toBeUndefined()
  })
})
