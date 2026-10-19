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
