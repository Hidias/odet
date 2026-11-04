import { describe, it, expect, vi, beforeEach } from 'vitest'

// Erreurs de la Console du 19/10 : une clé absente (assistant de rédaction, compte de service Google) n'est pas une
// panne du serveur. Les deux routes répondent sans code 5xx, donc rien ne remonte au suivi des erreurs.
const journal = vi.fn()
vi.mock('../api/_lib/errors.js', () => ({
  withErrorLog: (handler) => async (req, res) => {
    const out = await handler(req, res)
    if (res.statusCode >= 500) journal(res.statusCode)
    return out
  },
}))
vi.mock('../api/_lib/auth.js', () => ({
  requireRight: async () => ({ user: { id: 'u1' }, profile: {}, admin: {} }),
  requireRole: async () => ({ user: { id: 'u1' }, profile: {}, admin: {} }),
  requireCronOrRole: async () => true,
  SALES: [], ADMINS: [], OFFICE_WRITE: [], FINANCE: [], MANAGERS: [],
}))
vi.mock('../api/_lib/orgProfile.js', () => ({
  loadOrgProfile: async () => ({}), orgIdentityBlock: () => '', senderFromProfile: () => ({}),
}))
vi.mock('../api/_lib/mailer.js', () => ({ getOrg: async () => ({}), isTestEnvironment: () => false }))
vi.mock('../api/_lib/team.js', () => ({
  loadTeam: async () => [{ id: 'p1', first_name: 'Test', gcal_enabled: true, email: 'test@example.fr' }],
  leaders: () => [],
  profileFirstName: (p) => p.first_name || '',
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))

function reponse() {
  return {
    statusCode: 200,
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
  }
}

beforeEach(() => {
  journal.mockReset()
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY
})

describe('clés absentes : pas d\'erreur serveur dans la Console', () => {
  it('texte du devis sans assistant : 400 et message clair', async () => {
    const { default: route } = await import('../api/generate-quote-email.js')
    const res = reponse()
    await route({ method: 'POST', body: { quote: { id: 'q' }, client: { id: 'c' } } }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/assistant de rédaction/)
    expect(journal).not.toHaveBeenCalled()
  })

  it('synchronisation Google Agenda sans compte de service : passage sans objet, pas de 500', async () => {
    const { default: route } = await import('../api/sync-google-calendar.js')
    const res = reponse()
    await route({ method: 'GET', query: {} }, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.skipped).toBe(true)
    expect(res.body.reason).toMatch(/Compte de service/)
    expect(journal).not.toHaveBeenCalled()
  })

  it.each([
    'generate-relance-email', 'generate-client-email', 'ai-proxy', 'parse-bank-statement', 'duerp-ai-evaluate',
  ])('%s sans assistant : 400, rien dans la Console', async (nom) => {
    const { default: route } = await import(`../api/${nom}.js`)
    const res = reponse()
    await route({ method: 'POST', headers: {}, body: { quote: { id: 'q' }, client: { id: 'c' }, brief: 'b' } }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/assistant de rédaction/)
    expect(journal).not.toHaveBeenCalled()
  })
})
