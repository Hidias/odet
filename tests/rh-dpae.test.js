import { describe, it, expect } from 'vitest'
import { etatDpae, dpaeOuvreLe, dpaeConcernee, recapitulatifDpae, texteRecapitulatif } from '../src/modules/rh/lib/rhDpae'

describe('DPAE (0521)', () => {
  it('fenêtre de 8 jours avant l\'embauche (R1221-4)', () => {
    expect(dpaeOuvreLe('2026-12-01')).toBe('2026-11-23')
    expect(dpaeOuvreLe('2026-03-02')).toBe('2026-02-22')
  })
  it('états selon la date du jour', () => {
    const c = { contract_type: 'cdi', start_on: '2026-12-01' }
    expect(etatDpae(c, '2026-11-18').etat).toBe('trop_tot')
    expect(etatDpae(c, '2026-11-23').etat).toBe('a_faire')
    expect(etatDpae(c, '2026-11-30').etat).toBe('a_faire')
    expect(etatDpae(c, '2026-12-01').etat).toBe('en_retard')
    expect(etatDpae({ ...c, dpae_sent_on: '2026-11-24' }, '2026-12-05').etat).toBe('faite')
  })
  it('stage, intérim, mandataire et autre : sans objet', () => {
    for (const t of ['stage', 'interim', 'mandataire', 'autre']) {
      expect(dpaeConcernee({ contract_type: t })).toBe(false)
      expect(etatDpae({ contract_type: t, start_on: '2026-12-01' }, '2026-11-30').etat).toBe('sans_objet')
    }
    for (const t of ['cdi', 'cdd', 'apprentissage', 'professionnalisation']) expect(dpaeConcernee({ contract_type: t })).toBe(true)
  })
  it('récapitulatif : rien d\'inventé, le numéro de sécurité sociale jamais rempli', () => {
    const lignes = recapitulatifDpae({
      societe: { legal_name: 'Société essai', naf: '8559A', address: '1 rue X', postal_code: '29000', city: 'Quimper' },
      personne: { last_name: 'DURAND', first_name: 'Paul', gender: 'M', birth_date: '1990-05-04' },
      contrat: { contract_type: 'cdd', start_on: '2026-12-01', end_on: '2027-05-31' },
    })
    const val = (l) => lignes.find((x) => x.label === l)
    expect(val('Numéro de sécurité sociale').valeur).toBeNull()
    expect(val('Numéro de sécurité sociale').aide).toContain('jamais conservé')
    expect(val('SIRET de l\'établissement').valeur).toBeNull()
    expect(val('Date de naissance').valeur).toBe('04/05/1990')
    expect(val('Fin du contrat').valeur).toBe('31/05/2027')
    expect(val('Adresse').valeur).toBe('1 rue X 29000 Quimper')
    expect(texteRecapitulatif(lignes)).not.toMatch(/sécurité sociale/)
    expect(lignes.every((l) => l.valeur || l.aide)).toBe(true)
  })
  it('établissement prioritaire sur le siège', () => {
    const lignes = recapitulatifDpae({ societe: { address: 'Siège', city: 'A' }, etablissement: { siret: '12345678900011', address: 'Agence', city: 'B' }, contrat: { contract_type: 'cdi' } })
    expect(lignes.find((l) => l.label === 'SIRET de l\'établissement').valeur).toBe('12345678900011')
    expect(lignes.find((l) => l.label === 'Adresse').valeur).toBe('Agence B')
    expect(lignes.find((l) => l.label === 'Fin du contrat').valeur).toBe('Sans objet')
  })
})
