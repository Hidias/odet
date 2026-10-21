import { describe, it, expect } from 'vitest'
import { salutation } from '../src/modules/portail/components/Vitrine'

// Accueil des espaces extérieurs : « Bonjour » + prénom, ou « Bonjour » seul, jamais le nom de l'entreprise
describe('salutation', () => {
  it('prénom renseigné', () => { expect(salutation('Sophie')).toBe('Bonjour Sophie') })
  it('espaces retirés', () => { expect(salutation('  Yann ')).toBe('Bonjour Yann') })
  it('sans prénom', () => { expect(salutation('')).toBe('Bonjour'); expect(salutation(null)).toBe('Bonjour'); expect(salutation('   ')).toBe('Bonjour') })
})
