// Validation réservée (0458) : seules les personnes désignées confirment les documents choisis
import { describe, it, expect } from 'vitest'
import { reservation } from '../src/modules/qualite/richdocs/circuit'

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
