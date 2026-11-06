import { describe, it, expect } from 'vitest'
import { groupeDuStagiaire, prixDuGroupe, refusPublicationGroupe } from '../src/modules/formation/lib/conventionGroupe'
import { confirmationSignatureGroupe } from '../src/core/portail/alertesPublication'

// Défauts relevés par l'inter d'essai en production (06/11 au soir)
describe('Rattachement d\'office d\'un stagiaire au groupe de son entreprise', () => {
  const groupes = [
    { id: 'a', client_id: 'A', status: 'active', doc_status: 'a_envoyer' },
    { id: 'b', client_id: 'B', status: 'active', doc_status: 'envoye' },
  ]
  it('rejoint le seul groupe de son entreprise', () => {
    expect(groupeDuStagiaire(groupes, 'A')?.id).toBe('a')
    expect(groupeDuStagiaire(groupes, 'B')?.id).toBe('b')
  })
  it('aucun groupe pour son entreprise, ou entreprise inconnue : à la main', () => {
    expect(groupeDuStagiaire(groupes, 'C')).toBeNull()
    expect(groupeDuStagiaire(groupes, null)).toBeNull()
    expect(groupeDuStagiaire(null, 'A')).toBeNull()
  })
  it('deux groupes pour la même entreprise (deux financements) : à la main', () => {
    expect(groupeDuStagiaire([...groupes, { id: 'a2', client_id: 'A', status: 'active' }], 'A')).toBeNull()
  })
  it('un groupe annulé ne compte pas', () => {
    expect(groupeDuStagiaire([...groupes, { id: 'a2', client_id: 'A', status: 'cancelled' }], 'A')?.id).toBe('a')
    expect(groupeDuStagiaire([{ id: 'x', client_id: 'A', status: 'cancelled' }], 'A')).toBeNull()
  })
  it('convention déjà signée : jamais en silence', () => {
    expect(groupeDuStagiaire([{ id: 'a', client_id: 'A', status: 'active', doc_status: 'signe' }], 'A')).toBeNull()
  })
})

describe('Groupe au prix par personne seul (prix total enregistré à 0)', () => {
  it('le prix du document vient du prix par personne', () => {
    expect(prixDuGroupe({ price_total: 0, price_per_person: 150 }, 2)).toBe(300)
    expect(prixDuGroupe({ price_total: '0.00', price_per_person: '150.00' }, 1)).toBe(150)
  })
  it('ni total ni prix par personne : refus clair', () => {
    expect(refusPublicationGroupe({ price_total: 0, price_per_person: null }, 1, 'Anne')).toMatch(/Aucun prix/)
  })
})

describe('Mise à signer pour un client sans accès à son espace', () => {
  const g = { kind: 'entreprise', doc_status: 'a_envoyer', clients: { name: 'Alpha' } }
  it('le dit avant de publier', () => {
    expect(confirmationSignatureGroupe(g, { sansAcces: true }).message).toMatch(/pas encore d'accès à son espace/)
  })
  it('rien de plus quand l\'accès existe ou n\'est pas connu', () => {
    expect(confirmationSignatureGroupe(g).message).not.toMatch(/accès/)
    expect(confirmationSignatureGroupe(g, { sansAcces: false }).message).not.toMatch(/accès/)
  })
  it('particulier : « le contrat »', () => {
    expect(confirmationSignatureGroupe({ ...g, kind: 'particulier' }, { sansAcces: true }).message).toMatch(/ne verra pas le contrat/)
  })
})

describe('Montant saisi dans un groupe', () => {
  it('lit les écritures courantes', async () => {
    const { lireMontant } = await import('../src/modules/formation/lib/conventionGroupe')
    expect(lireMontant('')).toBeNull()
    expect(lireMontant(null)).toBeNull()
    expect(lireMontant('600')).toBe(600)
    expect(lireMontant('150,50')).toBe(150.5)
    expect(lireMontant('1 200 €')).toBe(1200)
    expect(lireMontant('1 200,5')).toBe(1200.5)
    expect(lireMontant(0)).toBe(0)
  })
  it('refuse l\'illisible et le négatif', async () => {
    const { lireMontant } = await import('../src/modules/formation/lib/conventionGroupe')
    expect(lireMontant('abc')).toBeNaN()
    expect(lireMontant('1.200,50')).toBeNaN()
    expect(lireMontant('-5')).toBeNaN()
  })
})

describe('Alerte « pas d\'accès » aussi pour une convention déjà envoyée', () => {
  it('le dit dans les deux cas', () => {
    const g = { kind: 'entreprise', doc_status: 'envoye', clients: { name: 'Alpha' } }
    expect(confirmationSignatureGroupe(g, { sansAcces: true }).message).toMatch(/pas encore d'accès/)
    expect(confirmationSignatureGroupe(g).message).not.toMatch(/pas encore d'accès/)
  })
})
