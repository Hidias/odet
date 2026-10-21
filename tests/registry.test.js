import { describe, it, expect } from 'vitest'
import { normaliserEntreprise, ecartsFiche, etablissementsDe, chercherEntreprises, photographie } from '../src/modules/commercial/lib/registry'

const REPONSE = {
  siren: '123456782', nom_complet: 'ENTREPRISE ESSAI (ESSAI)', nom_raison_sociale: 'ENTREPRISE ESSAI', nature_juridique: '5499',
  activite_principale: '33.12Z', libelle_activite_principale: 'Réparation de machines', tranche_effectif_salarie: '02',
  date_creation: '2017-07-01', etat_administratif: 'A', nombre_etablissements_ouverts: 2,
  dirigeants: [{ nom: 'DURAND', prenoms: 'Jean', qualite: 'Gérant' }],
  complements: { est_organisme_formation: true, liste_idcc: ['1486'] },
  siege: { siret: '12345678200010', numero_voie: '10', indice_repetition: null, type_voie: 'RUE', libelle_voie: 'DES ESSAIS', code_postal: '29000', libelle_commune: 'BREST', est_siege: true, etat_administratif: 'A', latitude: '47.99', longitude: '-4.1' },
  matching_etablissements: [],
}

describe('répertoire des entreprises (lot 2)', () => {
  it('normalise une entreprise : TVA calculée, forme, effectif, dirigeant, siège', () => {
    const e = normaliserEntreprise(REPONSE)
    expect(e.tva).toBe('FR11123456782')
    expect(e.forme_juridique).toBe('SARL')
    expect(e.effectif).toBe('3-5')
    expect(e.naf).toBe('33.12Z')
    expect(e.dirigeant_nom).toBe('Jean DURAND')
    expect(e.siege).toMatchObject({ siret: '12345678200010', adresse: '10 RUE DES ESSAIS', code_postal: '29000', ville: 'BREST', est_siege: true, etat: 'A' })
    expect(photographie(e).etablissements).toBeUndefined()
  })

  it('écarts : seulement ce qui diffère, jamais la TVA d\'un non assujetti', () => {
    const e = normaliserEntreprise(REPONSE)
    const ecarts = ecartsFiche({ legal_name: 'ENTREPRISE ESSAI', address: '10 RUE DES ESSAIS', postal_code: '29000', city: 'Brest', siret: '12345678200010', effectif: '6-9', vat_exempt: true }, e)
    const champs = ecarts.map((x) => x.champ)
    expect(champs).toContain('effectif')
    expect(champs).not.toContain('legal_name')
    expect(champs).not.toContain('address')
    expect(champs).not.toContain('city')
    expect(champs).not.toContain('tva')
    const adresse = ecartsFiche({ address: '1 rue autre' }, e).find((x) => x.champ === 'address')
    expect(adresse.valeur).toEqual({ address: '10 RUE DES ESSAIS', postal_code: '29000', city: 'BREST' })
  })

  it('établissements : filtre géographique obligatoire, réponse normalisée', async () => {
    await expect(etablissementsDe('123456782')).rejects.toThrow(/code postal ou un département/)
    let appel = ''
    const fetchImpl = async (url) => { appel = url; return { ok: true, status: 200, json: async () => ({ results: [{ ...REPONSE, matching_etablissements: [{ siret: '12345678200036', libelle_voie: 'RUE DU PORT', code_postal: '29200', libelle_commune: 'BREST', etat_administratif: 'F' }] }] }) } }
    const etabs = await etablissementsDe('123 456 782', { codePostal: '29200', fetchImpl })
    expect(appel).toContain('code_postal=29200')
    expect(etabs[0]).toMatchObject({ siret: '12345678200036', etat: 'F', ville: 'BREST', siren: '123456782' })
  })

  it('recherche : rien sous 3 caractères, SIRET nettoyé', async () => {
    expect(await chercherEntreprises('gl')).toEqual([])
    let appel = ''
    const fetchImpl = async (url) => { appel = url; return { ok: true, status: 200, json: async () => ({ results: [REPONSE] }) } }
    const r = await chercherEntreprises('123 456 782 00010', { fetchImpl })
    expect(appel).toContain('q=12345678200010')
    expect(r[0].siren).toBe('123456782')
  })
})
