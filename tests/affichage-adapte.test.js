import { describe, it, expect } from 'vitest'
import { normalizeUiPrefs, normaliserAdapte } from '../src/core/branding/presets'

describe('affichage adapté', () => {
  it('ne garde que les quatre options connues, à vrai seulement', () => {
    expect(normaliserAdapte({ facile: true, voix: false, motif: 'x', grand: 'oui' })).toEqual({ facile: true })
  })
  it('survit à la normalisation des préférences', () => {
    expect(normalizeUiPrefs({ density: 'large', adapte: { contraste: true } }).adapte).toEqual({ contraste: true })
    expect(normalizeUiPrefs({}).adapte).toEqual({})
  })
})

describe('voix : découpage des phrases à lire', async () => {
  const { decouperPhrases } = await import('../src/core/branding/adapte')
  it('coupe aux points et garde chaque phrase', () => {
    expect(decouperPhrases('Bonjour. Regardez l\'appareil ! Puis appuyez sur Bon.')).toEqual(['Bonjour.', 'Regardez l\'appareil !', 'Puis appuyez sur Bon.'])
  })
  it('coupe une phrase trop longue sans couper un mot', () => {
    const longue = Array.from({ length: 80 }, (_, i) => `mot${i}`).join(' ')
    const morceaux = decouperPhrases(longue, 100)
    expect(morceaux.every((m) => m.length <= 100)).toBe(true)
    expect(morceaux.join(' ')).toBe(longue)
  })
  it('ne lit rien pour un texte vide', () => {
    expect(decouperPhrases('   ')).toEqual([])
    expect(decouperPhrases(null)).toEqual([])
  })
})
