// A11 lot 5 (07/11) : « Voir et signer » du bandeau ouvre la signature, encadré « Session préparée » en tête de fiche,
// une adresse proposée une seule fois à l'envoi d'un devis.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { adressesProposees } from '../src/modules/commercial/lib/adressesEnvoi'

describe("adresses proposées à l'envoi d'un devis", () => {
  it('le contact principal identique à un contact ne sort qu une fois, sous le nom du contact', () => {
    const l = adressesProposees([{ first_name: 'Alice', last_name: 'MARTIN', email: 'alice@ex.fr' }], { contact_email: ' Alice@Ex.fr ' })
    expect(l).toEqual([{ email: 'alice@ex.fr', libelle: 'Alice MARTIN - alice@ex.fr' }])
  })
  it('contact principal différent ajouté à la fin ; contacts sans adresse et doublons ignorés', () => {
    const l = adressesProposees([
      { name: 'Bob', email: 'bob@ex.fr' }, { first_name: 'Sans', email: '' }, { first_name: 'Bob bis', email: 'BOB@ex.fr' },
    ], { contact_email: 'accueil@ex.fr' })
    expect(l.map((a) => a.email)).toEqual(['bob@ex.fr', 'accueil@ex.fr'])
    expect(l[1].libelle).toBe('Contact principal - accueil@ex.fr')
  })
  it('sans contact : le contact principal seul est proposé ; rien du tout : liste vide', () => {
    expect(adressesProposees([], { contact_email: 'a@ex.fr' })).toHaveLength(1)
    expect(adressesProposees(null, null)).toEqual([])
  })
})

describe('écrans', () => {
  const portail = readFileSync('src/modules/portail/pages/ClientPortal.jsx', 'utf8')
  it('« Voir et signer » ouvre la signature du document, « Voir les documents » mène à la liste', () => {
    expect(portail).toMatch(/onVoir=\{\(d\) => \(d \? ouvrirSignatureDocument\(d\)/)
  })
  const fiche = readFileSync('src/modules/formation/pages/SessionDetail.jsx', 'utf8')
  it('encadré du circuit devis (session préparée) avant les infos et le suivi de convention', () => {
    const c = fiche.indexOf('<CircuitSession ')
    expect(c).toBeGreaterThan(0)
    expect(c).toBeLessThan(fiche.indexOf('{/* Infos */}'))
    expect(c).toBeLessThan(fiche.indexOf('{/* Suivi Convention'))
    expect(fiche.split('<CircuitSession ').length).toBe(2)
  })
  const devis = readFileSync('src/modules/commercial/pages/Quotes.jsx', 'utf8')
  it("la liste des contacts de l'envoi passe par la règle commune", () => {
    expect(devis).toContain('adressesProposeesDevis(clientContacts, client)')
    expect(devis).not.toContain('Contact principal - {client.contact_email}')
  })
})
