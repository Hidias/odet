import { describe, it, expect } from 'vitest'
import { motifCode, motifMotDePasse } from '../src/core/portail/appareil'

describe('Accès à l’espace client', () => {
  it('code choisi par le client : même règle que la base', () => {
    expect(motifCode('246813')).toBeNull()
    expect(motifCode('13579024')).toBeNull()
    expect(motifCode('12345')).toMatch(/6 à 8/)
    expect(motifCode('123456789')).toMatch(/6 à 8/)
    expect(motifCode('777777')).toMatch(/répété/)
    expect(motifCode('123456')).toMatch(/suite/)
    expect(motifCode('987654')).toMatch(/suite/)
    expect(motifCode('890123')).toMatch(/suite/)
  })
  it('mot de passe du compte : 10 caractères, lettres et chiffres', () => {
    expect(motifMotDePasse('court1')).toMatch(/10/)
    expect(motifMotDePasse('seulementdeslettres')).toMatch(/chiffres/)
    expect(motifMotDePasse('Securite2026')).toBeNull()
  })
})
