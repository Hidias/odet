import { describe, it, expect, beforeEach } from 'vitest'
import { multiSocietes, nomSociete, VUE_GROUPE } from '../src/core/company/societes'
import { setOrgCache, setSocieteCache, orgName, orgLegalName, orgSiret, orgWebsite } from '../src/core/org/currentOrg'

describe('sociétés (C3)', () => {
  it('sélecteur seulement à partir de deux sociétés', () => {
    expect(multiSocietes(null)).toBe(false)
    expect(multiSocietes({ societes: [{ id: 'a' }] })).toBe(false)
    expect(multiSocietes({ societes: [{ id: 'a' }, { id: 'b' }] })).toBe(true)
    expect(VUE_GROUPE).toBe('groupe')
  })
  it('nom court, sinon raison sociale', () => {
    expect(nomSociete({ legal_name: 'GLD RESTAURATION SARL', short_name: 'Chez Mam' })).toBe('Chez Mam')
    expect(nomSociete({ legal_name: 'GLD RESTAURATION SARL' })).toBe('GLD RESTAURATION SARL')
  })
})

describe('identité des documents par société', () => {
  beforeEach(() => {
    setOrgCache({ org_name: 'Organisme', legal_name: 'ORGANISME SAS', siret: '11111111100011', website: 'https://organisme.example' })
    setSocieteCache(null)
  })
  it('société de l\'instance : réglages de l\'organisme', () => {
    expect(orgName()).toBe('Organisme')
    expect(orgSiret()).toBe('11111111100011')
  })
  it('autre société : sa fiche, sans reprendre le site de l\'organisme', () => {
    setSocieteCache({ name: 'Restaurant', legal_name: 'RESTAURANT SARL', siret: '22222222200022', website: null })
    expect(orgName()).toBe('Restaurant')
    expect(orgLegalName()).toBe('RESTAURANT SARL')
    expect(orgSiret()).toBe('22222222200022')
    expect(orgWebsite()).toBe('')
  })
})
