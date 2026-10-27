import { describe, it, expect } from 'vitest'
import { conditionsDevis, phraseConditions, fraisEtablissement, lignesAvecFrais, echeanceInitiale, limiteRefus, CODE_FRAIS_CONTRAT } from '../src/modules/interventions/lib/contrat.js'

describe('contrats de maintenance : conditions (0460)', () => {
  it('valeurs par défaut : réglages de l\'entreprise, trimestriel pour un client public', () => {
    expect(conditionsDevis({}, { contrat_preavis_mois: 3, contrat_reconduction_ans: 1 })).toMatchObject({ duree_ans: 1, reconduction: true, preavis_mois: 3, reconduction_ans: 1, periodicite: 'annuel' })
    expect(conditionsDevis({}, {}, { client_type: 'public' }).periodicite).toBe('trimestriel')
    expect(conditionsDevis({ duree_ans: 4 }).duree_ans).toBe(1)
    expect(conditionsDevis({ preavis_mois: 0 }).preavis_mois).toBe(0)
  })
  it('phrase reprise sur le devis', () => {
    expect(phraseConditions({ duree_ans: 3, reconduction: true, reconduction_ans: 1, preavis_mois: 3, periodicite: 'trimestriel' }))
      .toBe("Contrat de maintenance d'une durée de 3 ans, reconduit tacitement par périodes de 1 an, sauf refus notifié au moins 3 mois avant l'échéance. Facturation trimestrielle.")
    expect(phraseConditions({ duree_ans: 5, reconduction: false })).toContain('non reconduit à son terme')
  })
  it('frais d\'établissement : seulement si un montant est réglé', () => {
    expect(fraisEtablissement({ contrat_frais_etablissement: { 3: 50 } }, 3)).toBe(50)
    expect(fraisEtablissement({ contrat_frais_etablissement: {} }, 3)).toBe(null)
    expect(fraisEtablissement({}, 5)).toBe(null)
  })
  it('ligne de frais ajoutée, mise à jour, retirée', () => {
    const reg = { contrat_frais_etablissement: { 3: 50, 5: 80 } }
    const a = lignesAvecFrais([{ description_title: 'Vérification' }], reg, 3)
    expect(a).toHaveLength(2)
    expect(a[1]).toMatchObject({ code: CODE_FRAIS_CONTRAT, unit_price_ht: 50 })
    const b = lignesAvecFrais(a, reg, 5)
    expect(b).toHaveLength(2)
    expect(b[1].unit_price_ht).toBe(80)
    expect(lignesAvecFrais(b, reg, 1)).toHaveLength(1)
    expect(lignesAvecFrais([{ description_title: 'x' }], reg, 3, { retiree: true })).toHaveLength(1)
  })
  it('échéance et date limite de refus (mêmes calculs qu\'en base)', () => {
    expect(echeanceInitiale('2026-11-01', 3)).toBe('2029-10-31')
    expect(limiteRefus('2029-10-31', 3)).toBe('2029-07-31')
    expect(limiteRefus('2027-02-28', 0)).toBe('2027-02-28')
    // fin de mois comme PostgreSQL : 31 mai moins 3 mois = 28 février
    expect(limiteRefus('2027-05-30', 3)).toBe('2027-02-27')
    expect(echeanceInitiale('2028-02-29', 1)).toBe('2029-02-27')
  })
})
