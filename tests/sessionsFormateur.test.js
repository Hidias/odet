import { describe, it, expect } from 'vitest'
import { sessionsDuFormateur, fusionnerSessions, LIMITE_LIGNES } from '../api/_lib/sessionsFormateur.js'

const A = '11111111-1111-4111-8111-111111111111'

// Faux client : enregistre les appels de chaque requête et renvoie le résultat prévu selon qu'il y a jointure ou non
function client(resPrincipal, resAutres) {
  const appels = []
  return {
    appels,
    from: () => {
      const q = { cols: null, ops: [] }
      const chaine = {
        select(c) { q.cols = c; return chaine },
        eq(k, v) { q.ops.push(['eq', k, v]); return chaine },
        neq(k, v) { q.ops.push(['neq', k, v]); return chaine },
        then(ok, ko) { appels.push(q); return Promise.resolve(q.cols.includes('session_trainers!inner') ? resAutres : resPrincipal).then(ok, ko) },
      }
      return chaine
    },
  }
}

describe('sessions d\'un formateur pour les agendas (C6)', () => {
  it('principal et autre formateur, fusionnés sans doublon et triés, filtres appliqués aux deux lectures', async () => {
    const c = client(
      { data: [{ id: 's2', start_date: '2026-12-02' }, { id: 's1', start_date: '2026-12-01' }], error: null },
      { data: [{ id: 's1', start_date: '2026-12-01', session_trainers: [{ trainer_id: A }] }, { id: 's3', start_date: '2026-11-30', session_trainers: [] }], error: null },
    )
    const r = await sessionsDuFormateur(c, A, { colonnes: 'id, start_date', filtres: (q) => q.neq('status', 'cancelled') })
    expect(r.sessions.map((s) => s.id)).toEqual(['s3', 's1', 's2'])
    expect(r.sessions.every((s) => !('session_trainers' in s))).toBe(true)
    expect(r.tronque).toBe(false)
    expect(c.appels).toHaveLength(2)
    expect(c.appels.every((q) => q.ops.some((o) => o[0] === 'neq' && o[1] === 'status'))).toBe(true)
    expect(c.appels.find((q) => q.cols.includes('!inner')).ops).toContainEqual(['eq', 'session_trainers.trainer_id', A])
  })
  it('lecture en échec : erreur levée', async () => {
    await expect(sessionsDuFormateur(client({ data: [], error: null }, { data: null, error: { message: 'refus' } }), A)).rejects.toThrow('session_trainers')
  })
  it('identifiant invalide refusé', async () => {
    await expect(sessionsDuFormateur(client({}, {}), 'all')).rejects.toThrow()
  })
  it('signale une lecture peut-être coupée', () => {
    const beaucoup = Array.from({ length: LIMITE_LIGNES }, (_, i) => ({ id: `s${i}`, start_date: '2026-12-01' }))
    expect(fusionnerSessions(beaucoup, []).tronque).toBe(true)
    expect(fusionnerSessions([], beaucoup).tronque).toBe(true)
  })
})
