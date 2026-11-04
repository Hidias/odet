import { describe, it, expect } from 'vitest'
import { etatRappelNda, incoherencesNda } from '../src/core/org/rappelNdaEtat.js'

describe('Rappel de déclaration d\'activité', () => {
  it('le numéro saisi fait disparaître le rappel', () => {
    expect(etatRappelNda({ nda: '11111111111', suivi: { nda_status: 'preparation' } }).type).toBe('aucun')
  })
  it('déposée ou dossier complet : en attente du numéro, plus « à déposer »', () => {
    expect(etatRappelNda({ nda: '', suivi: { nda_status: 'depose', nda_filed_at: '2026-10-27' } })).toEqual({ type: 'attente', deposeeLe: '2026-10-27', completLe: null })
    expect(etatRappelNda({ nda: ' ', suivi: { nda_status: 'complet', nda_filed_at: '2026-10-27', nda_complete_at: '2026-10-30' } }).type).toBe('attente')
  })
  it('une date de dépôt seule suffit, même si le statut est resté en préparation', () => {
    expect(etatRappelNda({ nda: '', suivi: { nda_status: 'preparation', nda_filed_at: '2026-10-27' } }).type).toBe('attente')
  })
  it('en préparation : à déposer, avec la première convention du suivi en priorité', () => {
    expect(etatRappelNda({ nda: '', suivi: { nda_status: 'preparation', first_convention_date: '2026-10-22' }, premiereConventionSession: '2026-11-01' })).toEqual({ type: 'a_deposer', premiere: '2026-10-22' })
    expect(etatRappelNda({ nda: '', suivi: null, premiereConventionSession: '2026-11-01' }).premiere).toBe('2026-11-01')
  })
  it('refusée : alerte', () => {
    expect(etatRappelNda({ nda: '', suivi: { nda_status: 'refuse' } }).type).toBe('refusee')
  })
  it('signale les dates qui se contredisent', () => {
    expect(incoherencesNda({ nda_filed_at: '2026-10-27', nda_complete_at: '2026-10-22' })).toHaveLength(1)
    expect(incoherencesNda({ nda_filed_at: '2026-10-27', nda_complete_at: '2026-10-30', first_convention_date: '2026-10-22' })).toEqual([])
  })
})
