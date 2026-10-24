// Identité de l'organisme sur les documents (pilotage de H du 24/10) : le nom commercial partout, la forme juridique,
// le capital et le RCS une seule fois, en pied de page ; la mention Qualiopi à part, sur les seuls documents de
// formation ; plus de « GLD Sécurité, GLD Sécurité SARL » dans le texte des conditions générales.
import { describe, it, expect } from 'vitest'
import { buildORG, identiteLegale, ligneIdentiteLegale, orgHorsFormation } from '../src/core/org/orgUtils'
import TEMPLATES_COMMERCE from '../src/modules/qualite/richdocs/templatesCommerce'

const s = {
  name: 'Essai Sécurité', legal_name: 'ESSAI SECURITE', forme_juridique: 'SARL', capital_social: '10 000',
  rcs: 'Quimper 123 456 789', address: '1 rue de l\'Essai', postal_code: '29000', city: 'Quimper', siret: '12345678900011',
  qualiopi_certified: true, nda: '53291026129',
}

describe('Identité légale', () => {
  it('compose raison sociale, forme, capital et RCS, sans rien inventer', () => {
    expect(identiteLegale('ESSAI SECURITE', s)).toBe('ESSAI SECURITE, SARL au capital de 10 000 € · RCS Quimper 123 456 789')
    expect(identiteLegale('Essai SAS', { forme_juridique: 'SAS' })).toBe('Essai SAS')
    expect(identiteLegale('Essai', {})).toBe('Essai')
  })

  it('pied de page : identité légale et siège ; nom commercial seul en tête', () => {
    const ORG = buildORG(s)
    expect(ORG.name).toBe('Essai Sécurité')
    expect(ORG.nameFull).toBe('SARL ESSAI SECURITE')
    expect(ORG.nameFull).not.toMatch(/Qualiopi/)
    expect(ligneIdentiteLegale(ORG)).toBe('ESSAI SECURITE, SARL au capital de 10 000 € · RCS Quimper 123 456 789  ·  Siège social : 1 rue de l\'Essai, 29000 Quimper')
  })

  it('mention Qualiopi à part, retirée hors formation', () => {
    const ORG = buildORG(s)
    expect(ORG.qualiopiMention).toBe('Organisme de formation certifié Qualiopi')
    expect(orgHorsFormation(ORG).qualiopiMention).toBe('')
  })

  it('les conditions générales nomment l\'entreprise par son nom seul', () => {
    const t = JSON.stringify(TEMPLATES_COMMERCE)
    expect(t).not.toContain('{{org.raison_sociale}}')
    expect(t).not.toContain('{{org.siret}}')
  })
})
