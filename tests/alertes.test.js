import { describe, it, expect } from 'vitest'
import { chargeAlerte } from '../api/push-envoi.js'

describe('alertes sur le téléphone', () => {
  it('une alerte seule garde son titre et son lien', () => {
    expect(chargeAlerte([{ id: 'a', title: 'Devis signé en ligne', message: 'DEV-1 signé par Anne', link: '/devis?open=1' }]))
      .toEqual({ title: 'Devis signé en ligne', body: 'DEV-1 signé par Anne', url: '/devis?open=1', tag: 'n-a' })
  })
  it('plusieurs alertes d\'un coup arrivent regroupées', () => {
    const r = chargeAlerte([1, 2, 3, 4].map((i) => ({ id: String(i), title: `Alerte ${i}`, message: '' })))
    expect(r.title).toBe('4 nouvelles alertes')
    expect(r.body).toBe('Alerte 1 · Alerte 2 · Alerte 3…')
    expect(r.url).toBe('/')
  })
})
