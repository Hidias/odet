import { describe, it, expect, beforeEach } from 'vitest'
import { etatInactivite, AVERTISSEMENT_MS, DECONNEXION_MS } from '../src/core/session/inactivite'

describe('déconnexion après une heure sans activité (A1)', () => {
  it('avertissement à 55 minutes, déconnexion à 60', () => {
    expect(etatInactivite(AVERTISSEMENT_MS - 1000).etat).toBe('actif')
    expect(etatInactivite(AVERTISSEMENT_MS)).toEqual({ etat: 'avertissement', reste: 300 })
    expect(etatInactivite(DECONNEXION_MS).etat).toBe('deconnexion')
  })
})

