import { describe, it, expect } from 'vitest'
import { interpreterAnnuaire, consulterAnnuaire, AnnuaireIndisponible } from '../api/_lib/annuaire.js'

const etab = (o) => ({
  siret: '12345678900011', adresse: '1 RUE DE LA PAIX 29000 QUIMPER', code_postal: '29000', libelle_commune: 'QUIMPER',
  etat_administratif: 'A', est_siege: true, ...o,
})
const reponse = (o = {}) => ({
  results: [{
    siren: '123456789', nom_raison_sociale: 'ESSAI SAS', etat_administratif: 'A', tva: ['FR32123456789'],
    siege: etab(), matching_etablissements: [etab()], ...o,
  }],
})

describe('annuaire officiel', () => {
  it('établissement actif, adresse identique : aucun écart', () => {
    const r = interpreterAnnuaire(reponse(), '123 456 789 00011', { address: '1 rue de la Paix', postal_code: '29000', city: 'Quimper' })
    expect(r.etat).toBe('actif')
    expect(r.adresse).toBe('1 RUE DE LA PAIX')
    expect(r.tva).toBe('FR32123456789')
    expect(r.ecarts).toEqual([])
  })
  it('adresse différente : écart signalé', () => {
    const r = interpreterAnnuaire(reponse(), '12345678900011', { address: '9 avenue Foch', postal_code: '29000', city: 'Quimper' })
    expect(r.ecarts).toEqual(['adresse'])
  })
  it('établissement fermé', () => {
    const f = etab({ siret: '12345678900029', est_siege: false, etat_administratif: 'F' })
    const r = interpreterAnnuaire(reponse({ matching_etablissements: [f] }), '12345678900029')
    expect(r.etat).toBe('ferme')
  })
  it('ancien siège fermé : nouveau siège proposé', () => {
    const ancien = etab({ siret: '12345678900029', est_siege: false, ancien_siege: true, etat_administratif: 'F' })
    const nouveau = etab({ siret: '12345678900037', adresse: '5 RUE NEUVE 29900 CONCARNEAU', code_postal: '29900', libelle_commune: 'CONCARNEAU' })
    const r = interpreterAnnuaire(reponse({ siege: nouveau, matching_etablissements: [ancien] }), '12345678900029')
    expect(r.etat).toBe('siege_deplace')
    expect(r.siret).toBe('12345678900037')
    expect(r.ville).toBe('CONCARNEAU')
  })
  it('SIRET inconnu ou autre entreprise', () => {
    expect(interpreterAnnuaire({ results: [] }, '12345678900011').etat).toBe('inconnu')
    expect(interpreterAnnuaire(reponse(), '99999999900011').etat).toBe('inconnu')
    const r = interpreterAnnuaire(reponse(), '12345678900099')
    expect(r.etat).toBe('inconnu')
    expect(r.siret).toBe('12345678900011')
  })
  it('entreprise cessée', () => {
    expect(interpreterAnnuaire(reponse({ etat_administratif: 'C' }), '123456789').etat).toBe('ferme')
  })
  it('annuaire en panne : indisponible, jamais une erreur muette', async () => {
    await expect(consulterAnnuaire('123456789', { fetchImpl: async () => ({ ok: false, status: 503 }) })).rejects.toBeInstanceOf(AnnuaireIndisponible)
    await expect(consulterAnnuaire('123456789', { fetchImpl: async () => { throw new TypeError('réseau') } })).rejects.toBeInstanceOf(AnnuaireIndisponible)
    await expect(consulterAnnuaire('12')).rejects.toThrow('SIREN')
  })
})
