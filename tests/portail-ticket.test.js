import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ACCES_EXPIRE, messagePortail } from '../src/modules/portail/lib/accesExpire'

const portail = readFileSync('src/modules/portail/pages/TraineePortal.jsx', 'utf8')
const migration = readFileSync('supabase/migrations/0501_portail_ticket.sql', 'utf8')
const FONCTIONS = ['save_evaluation', 'save_positioning_test_answers', 'portal_set_email_refused', 'portal_quiz_questions',
  'portal_quiz_finish', 'portal_quiz_summary', 'portal_sign_halfday']

describe('ticket du code personnel dans le portail (0501)', () => {
  it('chaque appel du portail transmet le ticket', () => {
    for (const f of FONCTIONS) {
      const appels = [...portail.matchAll(new RegExp(`rpc\\('${f}', \\{[^}]*\\}`, 'g'))].map((m) => m[0])
      expect(appels.length, f).toBeGreaterThan(0)
      for (const a of appels) expect(a, f).toMatch(/p_ticket: /)
    }
  })
  it('le quiz lancé à l\'entrée reçoit le ticket qui vient d\'être délivré', () => {
    expect(portail).toContain("startQuiz('positioning', trainee, ticket)")
    expect(portail).toContain('loadQuizSummary(trainee.id, ticket)')
  })
  it('chaque fonction de la migration passe par la règle commune', () => {
    for (const f of FONCTIONS) {
      expect(migration).toContain(`create or replace function public.${f}(`)
      expect(migration).toMatch(new RegExp(`return app\\.${f}_corps\\(`))
    }
    expect((migration.match(/perform app\.portal_session_for\(p_token, p_trainee_id, p_ticket\)/g) || []).length).toBe(FONCTIONS.length)
  })
  it('même texte à l\'écran et dans la base', () => {
    expect(migration).toContain(`'${ACCES_EXPIRE}'`)
    expect(messagePortail({ code: '42501' }, 'x')).toBe(ACCES_EXPIRE)
    expect(messagePortail({ code: 'P0001' }, 'x')).toBe('x')
    expect(messagePortail(null, 'x')).toBe('x')
  })
})

describe('émargement gardé sans réseau (0501)', () => {
  it('le ticket est gardé avec la signature et transmis à l\'envoi différé', async () => {
    const memoire = {}
    globalThis.localStorage = { getItem: (k) => memoire[k] ?? null, setItem: (k, v) => { memoire[k] = v } }
    const { garder, envoyerEnAttente } = await import('../src/modules/portail/lib/fileSignatures.js')
    garder({ token: 't', traineeId: 'a', period: 'morning', image: 'x', date: '2026-11-07', ticket: 'tic' })
    const appels = []
    const supabase = { rpc: async (nom, args) => { appels.push([nom, args]); return { data: { ok: true }, error: null } } }
    await envoyerEnAttente(supabase, 't')
    expect(appels).toHaveLength(1)
    expect(appels[0][0]).toBe('portal_sign_halfday_differe')
    expect(appels[0][1].p_ticket).toBe('tic')
    expect(portail).toContain('ticket: portalTicket })) throw reponse.error')
  })
})
