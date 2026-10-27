import { describe, it, expect } from 'vitest'
import { normaliserGenre, accorder, mot, leMot, civilite, formuleAppel, pluriel } from '../src/core/genre.js'

describe('genre : conventions des fiches', () => {
  it('lit les trois conventions stockées', () => {
    expect(normaliserGenre('female')).toBe('F')
    expect(normaliserGenre('Mme')).toBe('F')
    expect(normaliserGenre('F')).toBe('F')
    expect(normaliserGenre('male')).toBe('M')
    expect(normaliserGenre('M')).toBe('M')
    expect(normaliserGenre('non_binary')).toBe('X')
    expect(normaliserGenre('')).toBe(null)
    expect(normaliserGenre(null)).toBe(null)
    expect(normaliserGenre('autre chose')).toBe(null)
  })
})

describe('genre : accords', () => {
  it('accorde les mots courants', () => {
    expect(mot('formateur', 'female')).toBe('formatrice')
    expect(mot('formateur', 'M')).toBe('formateur')
    expect(mot('inscrit', 'Mme')).toBe('inscrite')
    expect(mot('soussigne', 'female')).toBe('soussignée')
    expect(mot('dirigeant', 'female', { majuscule: true })).toBe('Dirigeante')
  })
  it('genre non renseigné : masculin générique, jamais « (e) »', () => {
    for (const k of ['inscrit', 'soussigne', 'formateur', 'note']) {
      expect(mot(k, null)).not.toMatch(/\(e\)/)
    }
    expect(accorder(null, 'inscrit', 'inscrite')).toBe('inscrit')
  })
  it('article et civilité', () => {
    expect(leMot('formateur', 'female', { majuscule: true })).toBe('La formatrice')
    expect(leMot('formateur', 'male')).toBe('le formateur')
    expect(civilite('Mme')).toBe('Madame')
    expect(civilite('M', { courte: true })).toBe('M.')
    expect(civilite(null)).toBe('')
  })
  it('formule d\'appel', () => {
    expect(formuleAppel({ genre: 'Mme', nom: 'Le Meur' })).toBe('Madame Le Meur,')
    expect(formuleAppel({ genre: null, prenom: 'Ronan' })).toBe('Bonjour Ronan,')
    expect(formuleAppel({})).toBe('Madame, Monsieur,')
  })
  it('pluriel', () => {
    expect(pluriel(1, 'appareil')).toBe('1 appareil')
    expect(pluriel(0, 'appareil')).toBe('0 appareil')
    expect(pluriel(2, 'appareil')).toBe('2 appareils')
  })
  it('refuse une forme inconnue', () => {
    expect(() => mot('inexistant', 'F')).toThrow()
  })
})
