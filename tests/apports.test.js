import { describe, it, expect } from 'vitest'
import { agreger, facturesDe, valeurOrigine, lireOrigine, periode } from '../src/core/apports/apports.js'

const apporteurs = [
  { id: 'pierre', introduced_by_profile: 'jp', introduced_by_contributor: null },
  { id: 'paul', introduced_by_profile: null, introduced_by_contributor: 'pierre' },
]
const lignes = [
  { invoice_id: 'f1', client_id: 'c1', client: 'A', ht: 50000, encaisse_ht: 30000, apport_c: 'pierre', vente_p: 'hs', realise_p: 'hs', metier: 'formation' },
  { invoice_id: 'f2', client_id: 'c2', client: 'B', ht: 20000, encaisse_ht: 20000, apport_c: 'paul', idee_p: 'anthony', vente_p: 'anthony', metier: 'maintenance' },
  { invoice_id: 'f3', client_id: 'c3', client: 'C', ht: 1000, encaisse_ht: 0, vente_p: 'hs', metier: 'autre' },
  { invoice_id: 'f4', client_id: 'c1', client: 'A', ht: -500, encaisse_ht: 0, apport_c: 'pierre', metier: 'formation' },
]

describe('qui a apporté quoi', () => {
  it('suit la chaîne : Jean-Paul a amené Pierre, qui a amené Paul', () => {
    const r = agreger(lignes, apporteurs, { 'p:jp': 'Jean-Paul', 'c:pierre': 'Pierre' })
    const p = Object.fromEntries(r.personnes.map((x) => [x.cle, x]))
    expect(p['c:pierre'].apport_ht).toBe(49500)
    expect(p['c:pierre'].indirect_ht).toBe(20000)
    expect(p['p:jp'].indirect_ht).toBe(69500)
    expect(p['p:jp'].nom).toBe('Jean-Paul')
    expect(p['p:anthony'].idee_ht).toBe(20000)
    expect(p['p:hs'].vente_ht).toBe(51000)
    expect(r.total).toBe(70500)
    expect(r.sansOrigine).toBe(1000)
    expect(r.sansOrigineClients).toEqual([{ id: 'c3', name: 'C' }])
  })
  it('ne boucle pas sur une chaîne circulaire', () => {
    const boucle = [{ id: 'a', introduced_by_contributor: 'b' }, { id: 'b', introduced_by_contributor: 'a' }]
    const r = agreger([{ invoice_id: 'x', ht: 10, encaisse_ht: 0, apport_c: 'a' }], boucle)
    expect(r.personnes.find((x) => x.cle === 'c:b').indirect_ht).toBe(10)
  })
  it('détaille les factures et les rôles d\'une personne', () => {
    expect(facturesDe(lignes, 'p:jp', apporteurs).map((l) => [l.invoice_id, l.roles.join()])).toEqual([['f1', 'via ses apporteurs'], ['f2', 'via ses apporteurs'], ['f4', 'via ses apporteurs']])
    expect(facturesDe(lignes, 'p:hs', apporteurs).map((l) => l.roles.join())).toEqual(['vente,réalisation', 'vente'])
  })
  it('code et lit une origine, calcule les périodes', () => {
    expect(valeurOrigine('u1', 'c1')).toBe('p:u1')
    expect(lireOrigine('c:x')).toEqual({ introduced_by_profile: null, introduced_by_contributor: 'x' })
    expect(lireOrigine('')).toEqual({ introduced_by_profile: null, introduced_by_contributor: null })
    expect(periode('trimestre', new Date(2026, 9, 21))).toEqual(['2026-10-01', '2026-12-31'])
    expect(periode('mois_dernier', new Date(2026, 0, 15))).toEqual(['2025-12-01', '2025-12-31'])
  })
})
