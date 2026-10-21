import { describe, it, expect, beforeEach } from 'vitest'
import { estPanneReseau, garder, enAttente, envoyerEnAttente } from '../src/modules/portail/lib/fileSignatures'

const memoire = {}
globalThis.localStorage = {
  getItem: (k) => (k in memoire ? memoire[k] : null),
  setItem: (k, v) => { memoire[k] = String(v) },
  removeItem: (k) => { delete memoire[k] },
}

describe('émargement sans réseau (0417)', () => {
  beforeEach(() => { for (const k of Object.keys(memoire)) delete memoire[k] })

  it('reconnaît une coupure de réseau, pas un refus du serveur', () => {
    expect(estPanneReseau(new TypeError('Failed to fetch'))).toBe(true)
    expect(estPanneReseau({ message: 'TypeError: Load failed' })).toBe(true)
    expect(estPanneReseau({ message: 'Cette demi-journée est déjà signée' })).toBe(false)
  })

  it('garde une signature par demi-journée, sans doublon', () => {
    garder({ token: 't', traineeId: 'a', period: 'morning', image: 'x', date: '2026-10-21' })
    garder({ token: 't', traineeId: 'a', period: 'morning', image: 'y', date: '2026-10-21' })
    garder({ token: 'autre', traineeId: 'b', period: 'morning', image: 'z', date: '2026-10-21' })
    expect(enAttente('t')).toHaveLength(1)
    expect(enAttente('t')[0].image).toBe('y')
  })

  it('envoie au retour du réseau, garde en cas de nouvelle coupure, retire un refus', async () => {
    garder({ token: 't', traineeId: 'a', period: 'morning', image: 'x', date: '2026-10-21' })
    garder({ token: 't', traineeId: 'b', period: 'morning', image: 'x', date: '2026-10-21' })
    const coupure = { rpc: async () => ({ error: new TypeError('Failed to fetch') }) }
    expect((await envoyerEnAttente(coupure, 't')).envoyees).toBe(0)
    expect(enAttente('t')).toHaveLength(2)
    let n = 0
    const serveur = { rpc: async () => (n++ === 0 ? { data: { ok: true } } : { data: { ok: false, error: 'Stagiaire noté absent sur cette session' } }) }
    const r = await envoyerEnAttente(serveur, 't')
    expect(r.envoyees).toBe(1)
    expect(r.refus[0].error).toBe('Stagiaire noté absent sur cette session')
    expect(enAttente('t')).toHaveLength(0)
  })

  it('base pas encore à jour : la signature reste gardée', async () => {
    garder({ token: 't', traineeId: 'a', period: 'afternoon', image: 'x', date: '2026-10-21' })
    const ancien = { rpc: async () => ({ error: { message: 'Could not find the function public.portal_sign_halfday_differe' } }) }
    await envoyerEnAttente(ancien, 't')
    expect(enAttente('t')).toHaveLength(1)
  })
})
