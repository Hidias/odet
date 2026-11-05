// C6 : plusieurs formateurs sur une session, enregistrés dans session_trainers (lue par la base pour les droits)
import { describe, it, expect, vi, beforeEach } from 'vitest'

const appels = []
function requete(table) {
  const r = { table, filtres: [] }
  const fin = (res) => Object.assign(Promise.resolve(res), r)
  return {
    insert: (rows) => { appels.push({ table, op: 'insert', rows }); return { select: () => ({ single: async () => ({ data: { id: 'S1', trainer_id: rows[0].trainer_id }, error: null }) }) } },
    upsert: (rows, opts) => { appels.push({ table, op: 'upsert', rows, opts }); return Promise.resolve({ error: null }) },
    delete: () => {
      const op = { table, op: 'delete', filtres: [] }
      appels.push(op)
      const chaine = {
        eq: (c, v) => { op.filtres.push(['eq', c, v]); return chaine },
        not: (c, o, v) => { op.filtres.push(['not', c, o, v]); return chaine },
        then: (ok, ko) => Promise.resolve({ error: null }).then(ok, ko),
      }
      return chaine
    },
    update: () => fin({}),
  }
}
vi.mock('../src/core/supabase', () => ({ supabase: { from: (t) => requete(t) } }))

const { useDataStore } = await import('../src/core/store.js')

beforeEach(() => { appels.length = 0; useDataStore.setState({ fetchSessions: async () => ({}) }) })

describe('formateurs d\'une session (C6)', () => {
  it('createSession enregistre le principal et les autres formateurs', async () => {
    const { error } = await useDataStore.getState().createSession({ client_id: 'k', start_date: '2026-12-10', end_date: '2026-12-10', trainer_ids: ['A', 'B', 'C'], trainee_ids: [] })
    expect(error).toBeNull()
    expect(appels.find((a) => a.table === 'sessions').rows[0].trainer_id).toBe('A')
    const ajout = appels.find((a) => a.table === 'session_trainers' && a.op === 'upsert')
    expect(ajout.rows).toEqual([{ session_id: 'S1', trainer_id: 'A' }, { session_id: 'S1', trainer_id: 'B' }, { session_id: 'S1', trainer_id: 'C' }])
    expect(ajout.opts).toMatchObject({ onConflict: 'session_id,trainer_id', ignoreDuplicates: true })
  })

  it('createSession sans formateur n\'écrit rien dans session_trainers', async () => {
    await useDataStore.getState().createSession({ client_id: 'k', start_date: '2026-12-10', end_date: '2026-12-10', trainer_ids: [], trainee_ids: [] })
    expect(appels.some((a) => a.table === 'session_trainers')).toBe(false)
  })

  it('retire seulement les formateurs qui ne sont plus choisis, après l\'ajout', async () => {
    await useDataStore.getState().enregistrerFormateursSession('S1', 'A', ['B', 'A'])
    const ops = appels.filter((a) => a.table === 'session_trainers').map((a) => a.op)
    expect(ops).toEqual(['upsert', 'delete'])
    const retrait = appels.find((a) => a.op === 'delete')
    expect(retrait.filtres).toEqual([['eq', 'session_id', 'S1'], ['not', 'trainer_id', 'in', '(A,B)']])
  })

  it('sans aucun formateur, retire tout pour la session et seulement elle', async () => {
    await useDataStore.getState().enregistrerFormateursSession('S1', null, [])
    expect(appels.filter((a) => a.table === 'session_trainers').map((a) => a.op)).toEqual(['delete'])
    expect(appels.find((a) => a.op === 'delete').filtres).toEqual([['eq', 'session_id', 'S1']])
  })
})
