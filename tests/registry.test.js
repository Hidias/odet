import { describe, it, expect } from 'vitest'
import { normaliserEntreprise, ecartsFiche, etablissementsDe, chercherEntreprises, photographie } from '../src/modules/commercial/lib/registry'

const REPONSE = {
  siren: '830695649', nom_complet: 'GLD SECURITE (GLD)', nom_raison_sociale: 'GLD SECURITE', nature_juridique: '5499',
  activite_principale: '33.12Z', libelle_activite_principale: 'Réparation de machines', tranche_effectif_salarie: '02',
  date_creation: '2017-07-01', etat_administratif: 'A', nombre_etablissements_ouverts: 2,
  dirigeants: [{ nom: 'POUPARD', prenoms: 'Hubert', qualite: 'Gérant' }],
  complements: { est_organisme_formation: true, liste_idcc: ['1486'] },
  siege: { siret: '83069564900020', numero_voie: '40', indice_repetition: 'B', type_voie: 'AV', libelle_voie: 'DE LA LIBERATION', code_postal: '29000', libelle_commune: 'QUIMPER', est_siege: true, etat_administratif: 'A', latitude: '47.99', longitude: '-4.1' },
  matching_etablissements: [],
}

describe('répertoire des entreprises (lot 2)', () => {
  it('normalise une entreprise : TVA calculée, forme, effectif, dirigeant, siège', () => {
    const e = normaliserEntreprise(REPONSE)
    expect(e.tva).toBe('FR13830695649')
    expect(e.forme_juridique).toBe('SARL')
    expect(e.effectif).toBe('3-5')
    expect(e.naf).toBe('33.12Z')
    expect(e.dirigeant_nom).toBe('Hubert POUPARD')
    expect(e.siege).toMatchObject({ siret: '83069564900020', adresse: '40 B AV DE LA LIBERATION', code_postal: '29000', ville: 'QUIMPER', est_siege: true, etat: 'A' })
    expect(photographie(e).etablissements).toBeUndefined()
  })

  it('écarts : seulement ce qui diffère, jamais la TVA d\'un non assujetti', () => {
    const e = normaliserEntreprise(REPONSE)
    const ecarts = ecartsFiche({ legal_name: 'GLD SECURITE', address: '40 B AV DE LA LIBERATION', postal_code: '29000', city: 'Quimper', siret: '83069564900020', effectif: '6-9', vat_exempt: true }, e)
    const champs = ecarts.map((x) => x.champ)
    expect(champs).toContain('effectif')
    expect(champs).not.toContain('legal_name')
    expect(champs).not.toContain('address')
    expect(champs).not.toContain('city')
    expect(champs).not.toContain('tva')
    const adresse = ecartsFiche({ address: '1 rue autre' }, e).find((x) => x.champ === 'address')
    expect(adresse.valeur).toEqual({ address: '40 B AV DE LA LIBERATION', postal_code: '29000', city: 'QUIMPER' })
  })

  it('établissements : filtre géographique obligatoire, réponse normalisée', async () => {
    await expect(etablissementsDe('830695649')).rejects.toThrow(/code postal ou un département/)
    let appel = ''
    const fetchImpl = async (url) => { appel = url; return { ok: true, status: 200, json: async () => ({ results: [{ ...REPONSE, matching_etablissements: [{ siret: '83069564900038', libelle_voie: 'RUE DE KERBLEIZ', code_postal: '29900', libelle_commune: 'CONCARNEAU', etat_administratif: 'F' }] }] }) } }
    const etabs = await etablissementsDe('830 695 649', { codePostal: '29900', fetchImpl })
    expect(appel).toContain('code_postal=29900')
    expect(etabs[0]).toMatchObject({ siret: '83069564900038', etat: 'F', ville: 'CONCARNEAU', siren: '830695649' })
  })

  it('recherche : rien sous 3 caractères, SIRET nettoyé', async () => {
    expect(await chercherEntreprises('gl')).toEqual([])
    let appel = ''
    const fetchImpl = async (url) => { appel = url; return { ok: true, status: 200, json: async () => ({ results: [REPONSE] }) } }
    const r = await chercherEntreprises('830 695 649 00020', { fetchImpl })
    expect(appel).toContain('q=83069564900020')
    expect(r[0].siren).toBe('830695649')
  })
})
