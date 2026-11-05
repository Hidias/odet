import { describe, it, expect } from 'vitest'
import { signataireDuGroupe, refusPublicationGroupe, contactPropose, nomContact } from '../src/modules/formation/lib/conventionGroupe'
import { rubriqueDocument } from '../src/core/portail/typeDocument'
import { nomSignable } from '../src/modules/portail/lib/signatureDocument'

const contacts = [
  { id: 'c1', first_name: 'Paul', last_name: 'Martin', fonction: 'Comptable', is_primary: true },
  { id: 'c2', name: 'Anne Durand', role: 'Gérante', is_document_contact: true },
]

describe('Convention d\'un groupe inter (C3, C8)', () => {
  it('le signataire est le contact choisi dans le groupe, jamais celui de la session', () => {
    expect(signataireDuGroupe({ kind: 'entreprise', contact_id: 'c1' }, contacts)).toEqual({ name: 'Paul Martin', role: 'Comptable' })
    expect(signataireDuGroupe({ kind: 'entreprise', contact_id: 'c2' }, contacts)).toEqual({ name: 'Anne Durand', role: 'Gérante' })
    expect(signataireDuGroupe({ kind: 'entreprise', contact_id: null }, contacts)).toBeNull()
    expect(signataireDuGroupe({ kind: 'entreprise', contact_id: 'c9' }, contacts)).toBeNull()
    // Contact d'un autre client : jamais signataire
    expect(signataireDuGroupe({ kind: 'entreprise', client_id: 'A', contact_id: 'x' }, [{ id: 'x', client_id: 'B', name: 'Autre' }])).toBeNull()
    expect(signataireDuGroupe({ kind: 'entreprise', client_id: 'A', contact_id: 'x' }, [{ id: 'x', client_id: 'A', name: 'Bon' }])).toEqual({ name: 'Bon', role: '' })
  })
  it('particulier : il signe lui-même', () => {
    expect(signataireDuGroupe({ kind: 'particulier', clients: { name: 'Léa Roux' } })).toEqual({ name: 'Léa Roux', role: '' })
    expect(signataireDuGroupe({ kind: 'particulier', clients: {} })).toBeNull()
  })
  it('contact proposé : « documents », puis principal, puis aucun', () => {
    expect(contactPropose(contacts)).toBe('c2')
    expect(contactPropose([contacts[0]])).toBe('c1')
    expect(contactPropose([{ id: 'c3' }])).toBe('')
    expect(contactPropose(null)).toBe('')
  })
  it('publication refusée pour 0 participant ou sans signataire', () => {
    const g = { kind: 'entreprise' }
    expect(refusPublicationGroupe(g, 0, { name: 'X' })).toMatch(/0 participant/)
    expect(refusPublicationGroupe(g, 2, null)).toMatch(/signataire/)
    expect(refusPublicationGroupe({ kind: 'particulier' }, 1, null)).toMatch(/particulier/)
    expect(refusPublicationGroupe(g, 2, { name: 'X' })).toBeNull()
  })
  it('nom d\'un contact', () => {
    expect(nomContact(null)).toBe('')
    expect(nomContact({ first_name: ' Jo ', last_name: '' })).toBe('Jo')
  })
})

describe('Type affiché d\'un document de l\'espace client (C4)', () => {
  it('convention de groupe publiée en « contrat »', () => {
    expect(rubriqueDocument({ kind: 'contrat', label: 'Convention de formation GLD-001' })).toBe('convention')
    expect(rubriqueDocument({ kind: 'contrat', label: 'Contrat de formation GLD-001' })).toBe('contrat')
    expect(rubriqueDocument({ kind: 'devis', label: 'Convention ?' })).toBe('devis')
  })
  it('fenêtre de signature', () => {
    expect(nomSignable({ kind: 'contrat', label: 'Convention de formation X' }).nom).toBe('la convention')
    expect(nomSignable({ kind: 'contrat', label: 'Convention de formation X' }).titre).toBe('Signer la convention')
    expect(nomSignable({ kind: 'contrat', label: 'Contrat de formation X' }).titre).toBe('Signer le contrat')
    expect(nomSignable({ kind: 'devis', label: 'Devis' }).titre).toBe('Signer le devis')
  })
})
