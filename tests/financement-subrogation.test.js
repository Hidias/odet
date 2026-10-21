import { describe, it, expect } from 'vitest'
import { trancheEffectif, subrogationPossible } from '../src/core/financement/subrogation'

describe('effectif des clients', () => {
  it('lit le code de tranche INSEE puis le texte', () => {
    expect(trancheEffectif({ taille_entreprise: '12' })).toEqual({ min: 20, max: 49 })
    expect(trancheEffectif({ effectif: '20-49' })).toEqual({ min: 20, max: 49 })
    expect(trancheEffectif({ effectif: '50 à 99 salariés' })).toEqual({ min: 50, max: 99 })
    expect(trancheEffectif({ effectif: null })).toBe(null)
  })
})

describe('subrogation OPCO après le 1er octobre 2026', () => {
  const petite = { effectif: '10-19' }
  const grande = { effectif: '50-99' }
  it('accord daté d\'avant : ancien circuit', () => {
    expect(subrogationPossible({ client: grande, dateAccord: '2026-09-15' }).etat).toBe('possible')
  })
  it('moins de 50 salariés : sur demande', () => {
    expect(subrogationPossible({ client: petite, dateAccord: '2026-10-21' }).etat).toBe('sur_demande')
  })
  it('50 salariés ou plus : plus de subrogation, facture TTC à l\'entreprise', () => {
    const r = subrogationPossible({ client: grande, dateAccord: '2026-10-21' })
    expect(r.etat).toBe('impossible')
    expect(r.message).toMatch(/TTC/)
  })
  it('effectif inconnu : à vérifier', () => {
    expect(subrogationPossible({ client: {}, dateAccord: '2026-10-21' }).etat).toBe('a_verifier')
  })
  it('date propre à l\'OPCO prioritaire, apprentissage et cofinancement', () => {
    expect(subrogationPossible({ client: grande, dateAccord: '2026-10-21', finOpco: '2027-01-01' }).etat).toBe('possible')
    expect(subrogationPossible({ client: grande, dateAccord: '2026-10-21', apprentissage: true }).etat).toBe('possible')
    expect(subrogationPossible({ client: petite, dateAccord: '2026-10-21', cofinancement: true }).etat).toBe('impossible')
  })
})

import { champsFinancement, mentionFinancement } from '../src/modules/commercial/lib/financementDevis'

describe('financement du devis', () => {
  it('enregistre les champs proprement', () => {
    expect(champsFinancement({ funding_type: '' })).toMatchObject({ funding_type: null, funding_subrogation: false, funding_amount_ht: null })
    expect(champsFinancement({ funding_type: 'cpf', funding_subrogation: true, funding_amount_ht: '1200,5' }))
      .toMatchObject({ funding_type: 'cpf', funding_subrogation: false, funding_amount_ht: 1200.5 })
  })
  it('mention imprimée selon la subrogation', () => {
    expect(mentionFinancement({})).toBe(null)
    expect(mentionFinancement({ funding_type: 'opco', funding_name: 'OPCO EP' })).toMatch(/TVA comprise.*hors taxes/)
    expect(mentionFinancement({ funding_type: 'opco', funding_name: 'OPCO EP', funding_subrogation: true })).toMatch(/subrogation/)
  })
})
