import { describe, it, expect } from 'vitest'
import { etatRappelNda, incoherencesNda } from '../src/core/org/rappelNdaEtat.js'

describe("Rappel de déclaration d'activité", () => {
  it('le numéro saisi fait disparaître le rappel', () => {
    expect(etatRappelNda({ nda: '11111111111', suivi: { nda_status: 'preparation' } }).type).toBe('aucun')
  })
  it('déposée ou dossier complet : en attente du numéro', () => {
    expect(etatRappelNda({ nda: '', suivi: { nda_status: 'depose', nda_filed_at: '2026-10-27' } })).toEqual({ type: 'attente', deposeeLe: '2026-10-27', completLe: null })
    expect(etatRappelNda({ nda: ' ', suivi: { nda_status: 'complet', nda_filed_at: '2026-10-27', nda_complete_at: '2026-10-30' } }).type).toBe('attente')
  })
  it('dossier repris en préparation avec une ancienne date de dépôt : à déposer', () => {
    expect(etatRappelNda({ nda: '', suivi: { nda_status: 'preparation', nda_filed_at: '2026-10-27' } }).type).toBe('a_deposer')
  })
  it('refusée, même avec une date de dépôt : alerte', () => {
    expect(etatRappelNda({ nda: '', suivi: { nda_status: 'refuse', nda_filed_at: '2026-10-27' } }).type).toBe('refusee')
  })
  it('enregistrée sans numéro saisi : numéro à saisir', () => {
    expect(etatRappelNda({ nda: '', suivi: { nda_status: 'enregistre' } }).type).toBe('numero_a_saisir')
  })
  it('suivi illisible ou vide : à déposer, avec la première convention des sessions', () => {
    expect(etatRappelNda({ nda: '', suivi: null, premiereConventionSession: '2026-11-01' })).toEqual({ type: 'a_deposer', premiere: '2026-11-01' })
    expect(etatRappelNda({ nda: '', suivi: {} }).type).toBe('a_deposer')
  })
  it('la première convention du suivi passe avant celle des sessions', () => {
    expect(etatRappelNda({ nda: '', suivi: { nda_status: 'preparation', first_convention_date: '2026-10-22' }, premiereConventionSession: '2026-11-01' }).premiere).toBe('2026-10-22')
  })
  it('signale un dossier complet daté avant le dépôt', () => {
    expect(incoherencesNda({ nda_filed_at: '2026-10-27', nda_complete_at: '2026-10-22' })).toHaveLength(1)
    expect(incoherencesNda({ nda_filed_at: '2026-10-27', nda_complete_at: '2026-10-30' })).toEqual([])
    expect(incoherencesNda(null)).toEqual([])
  })
})
