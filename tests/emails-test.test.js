// Redirection des emails en environnement de test (préversions Vercel).
import { describe, it, expect, afterEach } from 'vitest'
import { isTestEnvironment, applyTestRedirect, guardTransport } from '../api/_lib/mailer.js'

const envInitial = { ...process.env }
afterEach(() => {
  for (const k of ['EMAIL_MODE', 'EMAIL_TEST_TO', 'VERCEL_ENV']) {
    if (envInitial[k] === undefined) delete process.env[k]; else process.env[k] = envInitial[k]
  }
})

const message = { from: 'a@organisme.fr', to: ['client@exemple.fr'], cc: 'cc@exemple.fr', bcc: 'archive@organisme.fr', subject: 'Convocation', html: '<p>Bonjour</p>' }

describe('Environnement de test', () => {
  it('production : rien ne change', () => {
    process.env.VERCEL_ENV = 'production'; delete process.env.EMAIL_MODE
    expect(isTestEnvironment()).toBe(false)
    expect(applyTestRedirect(message)).toBe(message)
  })

  it('préversion sans EMAIL_MODE : protégée quand même', () => {
    process.env.VERCEL_ENV = 'preview'; delete process.env.EMAIL_MODE
    expect(isTestEnvironment()).toBe(true)
  })

  it('EMAIL_MODE=test : tout part vers EMAIL_TEST_TO, objet [TEST], copies supprimées', () => {
    process.env.EMAIL_MODE = 'test'; process.env.EMAIL_TEST_TO = 'test@organisme.fr'
    const m = applyTestRedirect(message)
    expect(m.to).toBe('test@organisme.fr')
    expect(m.cc).toBeUndefined()
    expect(m.bcc).toBeUndefined()
    expect(m.subject).toBe('[TEST] Convocation')
    expect(m.html).toContain('client@exemple.fr')
    expect(m.html).toContain('<p>Bonjour</p>')
  })

  it('test sans EMAIL_TEST_TO : envoi refusé', () => {
    process.env.EMAIL_MODE = 'test'; delete process.env.EMAIL_TEST_TO
    expect(() => applyTestRedirect(message)).toThrow(/EMAIL_TEST_TO/)
  })

  it('transporteur créé directement : redirigé aussi', async () => {
    process.env.EMAIL_MODE = 'test'; process.env.EMAIL_TEST_TO = 'test@organisme.fr'
    const envoyes = []
    const t = guardTransport({ sendMail: async (o) => { envoyes.push(o); return { ok: true } } })
    await t.sendMail(message)
    expect(envoyes[0].to).toBe('test@organisme.fr')
  })
})
