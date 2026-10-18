// Socle multi-sociétés (chantier C1a) : enveloppe des requêtes vers la base.
// Sans société choisie, rien ne change (aucun en-tête) ; la trace ne concerne que le super administrateur.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createCompanyFetch, setCurrentCompanyId, configureCompanyContext, setTraceSender, envoyerTrace,
  tableLue, _etatTrace, _reinitialiser,
} from '../src/core/company/companyContext.js'

const URL_BASE = 'https://exemple.supabase.co/rest/v1/'

function fauxFetch() {
  const appels = []
  const fn = (input, init) => {
    appels.push({ input, init })
    return Promise.resolve({ ok: true })
  }
  return { fn, appels }
}

describe('Société courante', () => {
  beforeEach(() => _reinitialiser())

  it("sans société choisie : requête transmise telle quelle, sans en-tête", async () => {
    const { fn, appels } = fauxFetch()
    const enveloppe = createCompanyFetch(fn)
    const init = { method: 'GET', headers: { apikey: 'x' } }
    await enveloppe(URL_BASE + 'clients?select=*', init)
    expect(appels[0].init).toBe(init)
  })

  it('société choisie : en-tête x-company-id ajouté aux requêtes de la base, autres en-têtes gardés', async () => {
    const { fn, appels } = fauxFetch()
    const enveloppe = createCompanyFetch(fn)
    setCurrentCompanyId('11111111-2222-3333-4444-555555555555')
    await enveloppe(URL_BASE + 'clients?select=*', { method: 'GET', headers: { apikey: 'x' } })
    const h = appels[0].init.headers
    expect(h.get('x-company-id')).toBe('11111111-2222-3333-4444-555555555555')
    expect(h.get('apikey')).toBe('x')
  })

  it("pas d'en-tête de société vers l'authentification ni le stockage", async () => {
    const { fn, appels } = fauxFetch()
    const enveloppe = createCompanyFetch(fn)
    setCurrentCompanyId('11111111-2222-3333-4444-555555555555')
    const init = { method: 'POST' }
    await enveloppe('https://exemple.supabase.co/auth/v1/token', init)
    expect(appels[0].init).toBe(init)
  })

  it('déconnexion : la société choisie est oubliée', async () => {
    const { fn, appels } = fauxFetch()
    const enveloppe = createCompanyFetch(fn)
    setCurrentCompanyId('11111111-2222-3333-4444-555555555555')
    configureCompanyContext({})
    const init = { method: 'GET' }
    await enveloppe(URL_BASE + 'clients', init)
    expect(appels[0].init).toBe(init)
  })
})

describe('Trace de l\'accès de support', () => {
  beforeEach(() => _reinitialiser())

  it('reconnaît la table lue, ignore les fonctions et les écritures', () => {
    expect(tableLue(URL_BASE + 'clients?select=*&id=eq.1', 'GET')).toBe('clients')
    expect(tableLue(URL_BASE + 'sessions', 'HEAD')).toBe('sessions')
    expect(tableLue(URL_BASE + 'rpc/my_companies', 'POST')).toBeNull()
    expect(tableLue(URL_BASE + 'rpc/get_x', 'GET')).toBeNull()
    expect(tableLue(URL_BASE + 'clients', 'PATCH')).toBeNull()
    expect(tableLue('https://exemple.supabase.co/storage/v1/object/x', 'GET')).toBeNull()
  })

  it('aucune trace pour un autre rôle que super administrateur', async () => {
    const envoi = vi.fn()
    setTraceSender(envoi)
    configureCompanyContext({ role: 'admin' })
    const { fn } = fauxFetch()
    await createCompanyFetch(fn)(URL_BASE + 'clients', { method: 'GET' })
    await envoyerTrace()
    expect(envoi).not.toHaveBeenCalled()
  })

  it('super administrateur : tables lues envoyées par lot, sans valeur ni recherche', async () => {
    const envoi = vi.fn().mockResolvedValue({ error: null })
    setTraceSender(envoi)
    configureCompanyContext({ role: 'superadmin' })
    const { fn } = fauxFetch()
    const enveloppe = createCompanyFetch(fn)
    await enveloppe(URL_BASE + 'clients?name=ilike.*dupont*', { method: 'GET' })
    await enveloppe(URL_BASE + 'clients', { method: 'GET' })
    await enveloppe(URL_BASE + 'invoices', { method: 'GET' })
    await envoyerTrace()
    expect(envoi).toHaveBeenCalledTimes(1)
    expect(envoi.mock.calls[0][0].sort()).toEqual(['clients', 'invoices'])
    expect(JSON.stringify(envoi.mock.calls[0])).not.toContain('dupont')
    expect(_etatTrace().tables).toEqual([])
  })

  it('fonction absente en base : la trace s\'arrête sans erreur', async () => {
    const envoi = vi.fn().mockResolvedValue({ error: { code: 'PGRST202' } })
    setTraceSender(envoi)
    configureCompanyContext({ role: 'superadmin' })
    const { fn } = fauxFetch()
    const enveloppe = createCompanyFetch(fn)
    await enveloppe(URL_BASE + 'clients', { method: 'GET' })
    await envoyerTrace()
    await enveloppe(URL_BASE + 'sessions', { method: 'GET' })
    await envoyerTrace()
    expect(envoi).toHaveBeenCalledTimes(1)
    expect(_etatTrace().traceCoupee).toBe(true)
  })

  it('une erreur d\'envoi ne bloque jamais la requête', async () => {
    setTraceSender(() => Promise.reject(new Error('réseau')))
    configureCompanyContext({ role: 'superadmin' })
    const { fn, appels } = fauxFetch()
    await createCompanyFetch(fn)(URL_BASE + 'clients', { method: 'GET' })
    await expect(envoyerTrace()).resolves.toBeUndefined()
    expect(appels).toHaveLength(1)
  })
})
