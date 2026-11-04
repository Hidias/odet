import { describe, it, expect } from 'vitest'
import {
  confirmationSignatureGroupe, confirmationModificationDevisPublie, confirmationPassageEnvoye, messageFacturePubliee,
  messageRapportPublie, confirmationEnvoiComptable, confirmationSuppressionDevis, confirmationRetraitPreuve,
  CONFIRMATION_REINITIALISER_ACCUEIL, confirmationDecocherConventionEnvoyee,
} from '../src/core/portail/alertesPublication.js'

const sansTiretLong = (t) => expect(t).not.toMatch(/—/)

describe('publication dans l\'espace client (B4, B5, B6, B12)', () => {
  it('convention d\'un groupe entreprise', () => {
    const c = confirmationSignatureGroupe({ kind: 'entreprise', clients: { name: 'Société A' } })
    expect(c.message).toContain('La convention de formation sera publiée dans l\'espace de Société A, qui pourra la lire et la signer')
    expect(c.message).toContain('Aucun e-mail ne part')
    sansTiretLong(c.message)
  })
  it('contrat d\'un particulier', () => {
    const c = confirmationSignatureGroupe({ kind: 'particulier' })
    expect(c.title).toContain('contrat')
    expect(c.message).toContain('Le contrat de formation sera publié dans l\'espace du client, qui pourra le lire et le signer')
  })
  it('devis déjà publié modifié, passage en envoyé', () => {
    expect(confirmationModificationDevisPublie({ reference: 'DEV-1' }).message).toContain('Le devis DEV-1 est déjà visible par le client')
    expect(confirmationPassageEnvoye().message).toContain('publié dans l\'espace du client')
  })
  it('facture : message seulement à la première publication', () => {
    expect(messageFacturePubliee({ id: 'x' })).toContain('Facture mise aussi à disposition')
    expect(messageFacturePubliee({ id: 'x' }, true)).toContain('Avoir mis aussi')
    expect(messageFacturePubliee({ id: 'x', deja: true })).toBeNull()
    expect(messageFacturePubliee(null)).toBeNull()
  })
  it('rapport : première version, déjà publié, échec', () => {
    expect(messageRapportPublie({ id: 'x' }).ton).toBe('succes')
    expect(messageRapportPublie({ id: 'x', deja: true }).texte).toContain('première version')
    expect(messageRapportPublie(null).ton).toBe('erreur')
  })
})

describe('dernières alertes (B13, B14, B15)', () => {
  it('envoi au comptable avec le nombre et l\'adresse', () => {
    expect(confirmationEnvoiComptable({ nombre: 3, quoi: 'factures', email: 'compta@exemple.fr' }).message).toBe('3 factures partiront par e-mail à compta@exemple.fr, avec les pièces jointes. Un e-mail envoyé ne se reprend pas.')
    expect(confirmationEnvoiComptable({ nombre: 1, quoi: 'releve' }).message).toContain('1 relevé partira par e-mail à votre comptable')
  })
  it('suppressions définitives', () => {
    const d = confirmationSuppressionDevis({ reference: 'DEV-2' })
    expect(d.danger).toBe(true)
    expect(d.message).toContain('DEV-2')
    expect(confirmationSuppressionDevis(null).message).toContain('Le devis et ses lignes')
    expect(confirmationRetraitPreuve({ label: 'Charte', file_path: 'a.pdf' }).message).toContain('et son fichier')
    expect(confirmationRetraitPreuve({ label: 'Lien' }).message).toContain('« Lien » sera supprimée définitivement')
  })
  it('effacements de réglage ou de date', () => {
    expect(CONFIRMATION_REINITIALISER_ACCUEIL.danger).toBe(true)
    expect(confirmationDecocherConventionEnvoyee('2026-11-02T10:00:00Z').message).toContain('02/11/2026')
    expect(confirmationDecocherConventionEnvoyee(null).message).not.toContain('noté le')
  })
})
