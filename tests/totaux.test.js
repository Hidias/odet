// Totaux des factures, avoirs et devis.
// Calcul unique (src/core/billing/totals.js) : les deux anciens « bugs connus » (taux 0 % compté à 20 %,
// écart d'un centime avec le Factur-X) sont corrigés et testés comme des cas normaux.
import { describe, it, expect } from 'vitest'
import { calcInvoiceTotals } from '../src/modules/commercial/pdf/invoiceGenerator.js'
import { calcItemTotal, calcTotals } from '../src/modules/commercial/lib/quoteTotals.js'
import { computeTotals } from '../api/generate-facturx.js'

const cents = (v) => Math.round((v + Number.EPSILON) * 100) / 100
const ligne = (quantity, unit_price_ht, tva_rate = 20) => ({ quantity, unit_price_ht, tva_rate })

describe('Facture : calcInvoiceTotals', () => {
  it('une ligne à 20 %', () => {
    const t = calcInvoiceTotals([ligne(2, 650)], 0, true)
    expect(t.subtotalHt).toBe(1300)
    expect(t.discountAmt).toBe(0)
    expect(t.netHt).toBe(1300)
    expect(t.totalTva).toBe(260)
    expect(t.totalTtc).toBe(1560)
  })

  it('remise globale de 10 %', () => {
    const t = calcInvoiceTotals([ligne(2, 650)], 10, true)
    expect(t.discountAmt).toBe(130)
    expect(t.netHt).toBe(1170)
    expect(t.totalTva).toBe(234)
    expect(t.totalTtc).toBe(1404)
  })

  it('remise saisie en texte (champ de formulaire)', () => {
    const t = calcInvoiceTotals([ligne('2', '650')], '10', true)
    expect(t.totalTtc).toBe(1404)
  })

  it('non assujetti à la TVA : TTC = HT', () => {
    const t = calcInvoiceTotals([ligne(3, 210)], 0, false)
    expect(t.netHt).toBe(630)
    expect(t.totalTva).toBe(0)
    expect(t.totalTtc).toBe(630)
  })

  it('plusieurs taux : TVA ventilée par taux, remise répartie', () => {
    const t = calcInvoiceTotals([ligne(1, 1000, 20), ligne(1, 200, 5.5)], 10, true)
    expect(t.netHt).toBe(1080)
    expect(cents(t.tvaByRate['20'].base)).toBe(900)
    expect(cents(t.tvaByRate['20'].tva)).toBe(180)
    expect(cents(t.tvaByRate['5.5'].base)).toBe(180)
    expect(cents(t.tvaByRate['5.5'].tva)).toBe(9.9)
    expect(cents(t.totalTtc)).toBe(1269.9)
  })

  it('ligne vide ou incomplète comptée à zéro', () => {
    const t = calcInvoiceTotals([ligne(1, 100), { quantity: '', unit_price_ht: '' }], 0, true)
    expect(t.subtotalHt).toBe(100)
  })

  it('avoir : mêmes règles de calcul que la facture, montant positif', () => {
    const facture = calcInvoiceTotals([ligne(4, 175)], 0, true)
    const avoirPartiel = calcInvoiceTotals([ligne(1, 175)], 0, true)
    expect(avoirPartiel.totalTtc).toBe(210)
    expect(avoirPartiel.totalTtc).toBeLessThan(facture.totalTtc)
    expect(avoirPartiel.totalTtc).toBeGreaterThan(0)
  })

  it('une ligne à 0 % de TVA reste à 0 % (pas remplacée par 20 %)', () => {
    const t = calcInvoiceTotals([ligne(1, 100, 0)], 0, true)
    expect(t.totalTva).toBe(0)
    expect(t.totalTtc).toBe(100)
  })

  it('taux absent : 20 % par défaut', () => {
    const t = calcInvoiceTotals([{ quantity: 1, unit_price_ht: 100 }], 0, true)
    expect(t.totalTva).toBe(20)
  })

  it('lignes à 20 % et à 0 % sur la même facture', () => {
    const t = calcInvoiceTotals([ligne(1, 100, 20), ligne(1, 50, 0)], 0, true)
    expect(t.totalTva).toBe(20)
    expect(t.totalTtc).toBe(170)
  })

  it('montants arrondis au centime : HT net + TVA = TTC', () => {
    // 2 x 33,33 € HT, remise 5 %, TVA 20 % : le PDF affiche HT 63,33 + TVA 12,67 = 76,00 mais TTC 75,99
    const t = calcInvoiceTotals([ligne(1, 33.33), ligne(1, 33.33)], 5, true)
    expect(cents(cents(t.netHt) + cents(t.totalTva))).toBe(cents(t.totalTtc))
  })
})

describe('Facture : cohérence avec Factur-X (computeTotals)', () => {
  const cas = [
    [[ligne(2, 650)], 0, true],
    [[ligne(2, 650)], 10, true],
    [[ligne(3, 210)], 0, false],
    [[ligne(1, 1000, 20), ligne(1, 200, 5.5)], 10, true],
    [[ligne(3, 33.33)], 0, true],
  ]
  for (const [items, dp, tva] of cas) {
    it(`même TTC au centime : ${items.length} ligne(s), remise ${dp} %, TVA ${tva ? 'oui' : 'non'}`, () => {
      const pdf = calcInvoiceTotals(items, dp, tva)
      const fx = computeTotals({ discount_percent: dp, amount_paid: 0 }, items, tva)
      expect(cents(pdf.totalTtc)).toBe(fx.grandTotal)
      expect(cents(pdf.totalTva)).toBe(fx.taxTotal)
    })
  }

  it('aucun écart d\'un centime entre la facture enregistrée et le Factur-X', () => {
    const items = [ligne(1, 33.33), ligne(1, 33.33)]
    const pdf = calcInvoiceTotals(items, 5, true)
    const fx = computeTotals({ discount_percent: 5, amount_paid: 0 }, items, true)
    expect(pdf.totalTtc).toBe(fx.grandTotal)
    expect(pdf.totalTtc).toBe(76)
  })

  it('Factur-X : reste dû = TTC - déjà payé', () => {
    const fx = computeTotals({ discount_percent: 0, amount_paid: 500 }, [ligne(2, 650)], true)
    expect(fx.grandTotal).toBe(1560)
    expect(fx.due).toBe(1060)
  })

  it('Factur-X : ligne à 0 % en catégorie E, ligne à 20 % en catégorie S', () => {
    const fx = computeTotals({ discount_percent: 0 }, [ligne(1, 100, 20), ligne(1, 50, 0)], true)
    expect(fx.taxTotal).toBe(20)
    expect(fx.breakdown.map((g) => g.cat).sort()).toEqual(['E', 'S'])
  })

  it('Factur-X non assujetti : catégorie E, aucune taxe', () => {
    const fx = computeTotals({ discount_percent: 0 }, [ligne(1, 300)], false)
    expect(fx.taxTotal).toBe(0)
    expect(fx.breakdown[0].cat).toBe('E')
  })
})

describe('Devis : calcTotals', () => {
  it('total de ligne', () => {
    expect(calcItemTotal({ quantity: '3', unit_price_ht: '120.5' })).toBe(361.5)
    expect(calcItemTotal({ quantity: '', unit_price_ht: 100 })).toBe(0)
  })

  it('remise et TVA à 20 %', () => {
    const t = calcTotals([ligne(2, 650)], 10, 20, true)
    expect(t.discountAmount).toBe(130)
    expect(t.totalHt).toBe(1170)
    expect(t.totalTva).toBe(234)
    expect(t.totalTtc).toBe(1404)
  })

  it('non assujetti', () => {
    const t = calcTotals([ligne(2, 650)], 0, 20, false)
    expect(t.totalTva).toBe(0)
    expect(t.totalTtc).toBe(1300)
  })

  it('même TTC que la facture créée depuis le devis (taux unique)', () => {
    const items = [ligne(2, 650), ligne(1, 90)]
    expect(calcTotals(items, 7.5, 20, true).totalTtc).toBeCloseTo(calcInvoiceTotals(items, 7.5, true).totalTtc, 6)
  })

  it('un devis à 0 % de TVA reste à 0 %', () => {
    const t = calcTotals([ligne(1, 100)], 0, 0, true)
    expect(t.totalTva).toBe(0)
  })
})

import { computeDocumentTotals as calcul } from '../src/core/billing/totals'

describe('catégories de TVA par régime de ligne (0363)', () => {
  it('autoliquidation : catégorie AE, aucune TVA ; exonérée : catégorie E', () => {
    const t = calcul([
      { quantity: 1, unit_price_ht: 1200, tva_rate: 0, vat_regime: 'autoliquidation' },
      { quantity: 1, unit_price_ht: 690, tva_rate: 0, vat_regime: 'exonere' },
      { quantity: 2, unit_price_ht: 10, tva_rate: 20 },
    ])
    const cats = t.breakdown.map((g) => g.cat).sort()
    expect(cats).toEqual(['AE', 'E', 'S'])
    expect(t.breakdown.find((g) => g.cat === 'E').exonere).toBe(true)
    expect(t.taxTotal).toBe(4)
    expect(t.grandTotal).toBe(1914)
  })
  it('sans régime : comportement d\'avant (S si taux positif, E sinon)', () => {
    const t = calcul([{ quantity: 1, unit_price_ht: 100, tva_rate: 0 }, { quantity: 1, unit_price_ht: 100, tva_rate: 20 }])
    expect(t.breakdown.map((g) => g.cat).sort()).toEqual(['E', 'S'])
  })
})
