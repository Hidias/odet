import { describe, it, expect } from 'vitest'
import { alerteConventionSignee, confirmationInscriptionInter, groupesDuClientPourInscription } from '../src/modules/formation/lib/conventionSignee.js'

describe('Alerte convention signée', () => {
  it('aucune alerte sans convention signée', () => {
    expect(alerteConventionSignee({ convention_signed: false }, 'retrait')).toBeNull()
    expect(alerteConventionSignee(null, 'retrait')).toBeNull()
  })
  it('retrait sur convention signée : alerte rouge qui parle d\'avenant', () => {
    const a = alerteConventionSignee({ convention_signed: true, convention_signed_date: '2026-10-22T10:55:18Z' }, 'retrait')
    expect(a.danger).toBe(true)
    expect(a.message).toContain('22/10/2026')
    expect(a.message).toContain('avenant')
  })
  it('ajout sur convention signée : alerte aussi', () => {
    expect(alerteConventionSignee({ convention_signed: true }, 'ajout').confirmLabel).toBe('Ajouter quand même')
  })
  it('ajout : bouton non rouge, action inconnue : rien, sans date : message sans date', () => {
    expect(alerteConventionSignee({ convention_signed: true }, 'ajout').danger).toBe(false)
    expect(alerteConventionSignee({ convention_signed: true }, 'autre')).toBeNull()
    expect(alerteConventionSignee({ convention_signed: true }, 'retrait').message).toMatch(/^La convention de cette session a été signée\. /)
  })
  it('sous-traitance : pas d\'alerte', () => {
    expect(alerteConventionSignee({ convention_signed: true, session_type: 'subcontract' }, 'retrait')).toBeNull()
  })
})

describe('Inscription en ligne sur une session inter', () => {
  const ent = { kind: 'entreprise', company_name: 'Société Essai', siret: '12345678900012', postal_code: '99000', participants: [{}, {}] }
  const groupe = (doc_status, clients) => ({ id: 'g', doc_status, clients })
  it('nouveau client : nouveau groupe, pas d\'avenant, une seule fenêtre neutre', () => {
    const c = confirmationInscriptionInter(ent, [groupe('signe', { siret: '99999999900099', name: 'Autre', postal_code: '11000' })])
    expect(c.danger).toBe(false)
    expect(c.message).toContain('nouveau groupe')
    expect(c.message).not.toContain('avenant')
  })
  it('client déjà présent avec convention signée (par SIRET) : alerte avec avenant', () => {
    const c = confirmationInscriptionInter(ent, [groupe('signe', { siret: '12345678900012', name: 'x' })])
    expect(c.danger).toBe(true)
    expect(c.message).toContain('avenant')
  })
  it('client retrouvé par nom et code postal quand le SIRET manque', () => {
    expect(groupesDuClientPourInscription({ ...ent, siret: null }, [groupe('envoye', { name: ' société essai ', postal_code: '99000' })])).toHaveLength(1)
  })
  it('client déjà présent, convention non signée : rejoint le groupe sans alerte', () => {
    const c = confirmationInscriptionInter(ent, [groupe('envoye', { siret: '12345678900012' })])
    expect(c.danger).toBe(false)
    expect(c.message).toContain('groupe existant')
  })
  it('particulier retrouvé par adresse email, contrat signé : alerte qui parle de contrat', () => {
    const c = confirmationInscriptionInter(
      { kind: 'particulier', contact_first_name: 'Paul', contact_last_name: 'Martin', contact_email: 'paul@essai.invalid', participants: [{}] },
      [groupe('signe', { client_type: 'particulier', email: 'PAUL@essai.invalid' })])
    expect(c.danger).toBe(true)
    expect(c.message).toContain('contrat')
  })
  it('textes accordés : convention au féminin, contrat au masculin', () => {
    const c = confirmationInscriptionInter(ent, [groupe('signe', { siret: '12345678900012' })])
    expect(c.title).toBe('Convention déjà signée pour ce client')
    expect(c.message).toContain('sa convention est signée')
    expect(c.message).toContain('cette convention deviendra inexacte')
    expect(c.message).not.toMatch(/son convention|ce convention|un nouveau convention/)
  })
  it('lecture des groupes impossible : fenêtre prudente, jamais « nouveau groupe »', () => {
    const c = confirmationInscriptionInter(ent, [], { lectureImpossible: true })
    expect(c.danger).toBe(true)
    expect(c.message).not.toContain('nouveau groupe')
  })
  it('plusieurs groupes du même client : alerte si l\'un est signé', () => {
    const c = confirmationInscriptionInter(ent, [groupe('envoye', { siret: '12345678900012' }), groupe('signe', { siret: '12345678900012' })])
    expect(c.danger).toBe(true)
  })
  it('SIRET sans correspondance : recherche par nom et code postal', () => {
    expect(groupesDuClientPourInscription(ent, [groupe('signe', { siret: '00000000000000', name: 'Société Essai', postal_code: '99000' })])).toHaveLength(1)
  })
})
