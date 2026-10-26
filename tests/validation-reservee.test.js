// Validation réservée (0458) : seules les personnes désignées confirment les documents choisis
import { describe, it, expect } from 'vitest'
import { reservation } from '../src/modules/qualite/richdocs/circuit'
import { modeCommun } from '../src/modules/qualite/richdocs/CircuitDocument'

describe('Validation réservée', () => {
  const g = { validateurs: ['h'], docs_reserves: ['cgv-vente'] }
  it('document réservé : seule la personne désignée (ou le super administrateur) confirme', () => {
    expect(reservation(g, 'cgv-vente', { uid: 'a' })).toEqual({ reservee: true, peutConfirmer: false })
    expect(reservation(g, 'cgv-vente', { uid: 'h' }).peutConfirmer).toBe(true)
    expect(reservation(g, 'cgv-vente', { uid: 'a', superadmin: true }).peutConfirmer).toBe(true)
  })
  it('autres documents, ou personne désignée : validation directe', () => {
    expect(reservation(g, 'politique', { uid: 'a' })).toEqual({ reservee: false, peutConfirmer: true })
    expect(reservation({ validateurs: [], docs_reserves: ['cgv-vente'] }, 'cgv-vente', { uid: 'a' }).peutConfirmer).toBe(true)
    expect(reservation(null, 'cgv-vente', {}).peutConfirmer).toBe(true)
  })
})

describe('circuit commun des conditions commerciales', () => {
  const ids = ['cgv-maintenance', 'cgv-vente']
  it('suit le défaut quand rien n\'est réglé document par document', () => {
    expect(modeCommun({ default_mode: 'direct', per_doc: {} }, ids)).toBe('direct')
  })
  it('donne le circuit commun quand tous sont réglés pareil', () => {
    expect(modeCommun({ default_mode: 'direct', per_doc: { 'cgv-maintenance': 'complet', 'cgv-vente': 'complet' } }, ids)).toBe('complet')
  })
  it('signale des réglages différents', () => {
    expect(modeCommun({ default_mode: 'direct', per_doc: { 'cgv-maintenance': 'complet' } }, ids)).toBe('')
  })
})
