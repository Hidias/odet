// A11 lot 4 (06/11) : accords de l'état du document d'un groupe, champs nommés du formulaire client,
// libellé du bouton de signature de l'émargement.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { etatDocumentGroupe } from '../src/modules/formation/lib/conventionGroupe'

describe('etatDocumentGroupe', () => {
  it('accorde la convention au féminin', () => {
    expect(etatDocumentGroupe({ kind: 'entreprise', doc_status: 'signe' })).toEqual({ document: 'Convention', etat: 'signée' })
    expect(etatDocumentGroupe({ kind: 'entreprise', doc_status: 'envoye' }).etat).toBe('envoyée')
  })
  it('accorde le contrat au masculin', () => {
    expect(etatDocumentGroupe({ kind: 'particulier', doc_status: 'signe' })).toEqual({ document: 'Contrat', etat: 'signé' })
    expect(etatDocumentGroupe({ kind: 'particulier', doc_status: 'envoye' }).etat).toBe('envoyé')
  })
  it('état vide ou inconnu : à envoyer', () => {
    expect(etatDocumentGroupe({ kind: 'entreprise' }).etat).toBe('à envoyer')
    expect(etatDocumentGroupe({ kind: 'entreprise', doc_status: 'xyz' }).etat).toBe('à envoyer')
    expect(etatDocumentGroupe(null)).toEqual({ document: 'Convention', etat: 'à envoyer' })
  })
})

describe('formulaire Nouveau client', () => {
  const src = readFileSync('src/modules/commercial/pages/Clients.jsx', 'utf8')
  it('chaque étiquette est reliée à son champ', () => {
    for (const id of ['client-nom', 'client-siret', 'client-adresse', 'client-cp', 'client-ville', 'client-tel', 'client-email', 'client-tva', 'client-contact', 'client-fonction', 'client-notes']) {
      expect(src).toContain(`htmlFor="${id}"`)
      expect(src).toContain(`id="${id}"`)
    }
  })
})

describe('fiche session', () => {
  it('le bouton de signature dit ce qu\'on signe', () => {
    const src = readFileSync('src/modules/formation/pages/SessionDetail.jsx', 'utf8')
    expect(src).toContain("Faire signer l'émargement")
  })
})
