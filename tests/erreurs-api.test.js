// L'enveloppe de suivi des routes /api ne change pas leur comportement.
import { describe, it, expect } from 'vitest'
import { withErrorLog } from '../api/_lib/errors.js'

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
  }
}

describe('withErrorLog', () => {
  it('réponse normale : inchangée', async () => {
    const route = withErrorLog(async (req, res) => res.status(200).json({ ok: true }), 'essai')
    const res = fakeRes()
    await route({ method: 'GET' }, res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('réponse 500 : la même réponse part, l\'enregistrement ne bloque pas', async () => {
    const route = withErrorLog(async (req, res) => res.status(500).json({ error: 'SMTP indisponible' }), 'essai')
    const res = fakeRes()
    await route({ method: 'POST' }, res)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'SMTP indisponible' })
  }, 10000)

  it('exception : toujours levée, comme avant', async () => {
    const route = withErrorLog(async () => { throw new Error('boum') }, 'essai')
    await expect(route({ method: 'GET' }, fakeRes())).rejects.toThrow('boum')
  }, 10000)
})
