import { describe, it, expect } from 'vitest'
import { calculerScenarios } from '../src/modules/commercial/lib/scenarios.js'

const h = { certain: { pessimiste: 100, realiste: 100, optimiste: 100 }, devis: { pessimiste: 0, realiste: 50, optimiste: 100 },
  recurrent: { pessimiste: 0, realiste: 50, optimiste: 100 }, retard_paiement_j: { pessimiste: 30, realiste: 0, optimiste: 0 } }
const mois = Array.from({ length: 36 }, (_, i) => ({ mois: `20${26 + Math.floor((9 + i) / 12)}-${String(((9 + i) % 12) + 1).padStart(2, '0')}-01`, certain: i === 0 ? 300 : 0, devis: i === 0 ? 1000 : 0, recurrent: i === 0 ? 200 : 0 }))

describe('prévisionnel trois scénarios (0474)', () => {
  it('pondère chaque source par scénario', () => {
    const r = calculerScenarios({ mois, hypotheses: h, historique: { ratio_ttc: 1.2 }, charges_mensuelles: 100, encaissements: { factures_ouvertes: [{ mois: mois[0].mois, montant: 120 }] } })
    expect(r.lignes[0].ca).toEqual({ pessimiste: 300, realiste: 900, optimiste: 1500 })
    expect(r.total12.realiste).toBe(900)
    // Réaliste : 30 j d'échéance → encaissé le mois suivant, en TTC (900 × 1,2) ; facture ouverte au mois de son échéance
    expect(r.lignes[1].encaissement.realiste).toBe(1080)
    expect(r.lignes[0].encaissement.realiste).toBe(120)
    // Pessimiste : 30 j + 30 j de retard → deux mois plus tard ; facture ouverte décalée d'un mois
    expect(r.lignes[2].encaissement.pessimiste).toBe(360)
    expect(r.lignes[1].encaissement.pessimiste).toBe(120)
    expect(r.lignes[1].solde.realiste).toBe(980)
  })
  it('sans historique TTC ni charges : HT, solde non calculé', () => {
    const r = calculerScenarios({ mois, hypotheses: h, historique: {}, charges_mensuelles: null })
    expect(r.ratioTtc).toBe(null)
    expect(r.lignes[1].encaissement.realiste).toBe(900)
    expect(r.lignes[1].solde).toBe(null)
  })
})
