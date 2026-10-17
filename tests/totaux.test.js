// Totaux des factures, avoirs et devis.
// Les tests « bug connu » (it.fails) décrivent un comportement actuel jugé faux : ils passent tant que le
// bug existe et deviennent rouges le jour où il est corrigé, pour penser à les transformer en tests normaux.
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

  it.fails('bug connu : une ligne à 0 % de TVA est comptée à 20 %', () => {
    const t = calcInvoiceTotals([ligne(1, 100, 0)], 0, true)
    expect(t.totalTva).toBe(0)
  })

  it.fails('bug connu : montants non arrondis au centime (HT + TVA affichés différent du TTC)', () => {
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

  it.fails('bug connu : écart d\'un centime entre la facture enregistrée et le Factur-X', () => {
    const items = [ligne(1, 33.33), ligne(1, 33.33)]
    const pdf = calcInvoiceTotals(items, 5, true)
    const fx = computeTotals({ discount_percent: 5, amount_paid: 0 }, items, true)
    expect(cents(pdf.totalTtc)).toBe(fx.grandTotal) // 75,99 contre 76,00
  })

  it('Factur-X : reste dû = TTC - déjà payé', () => {
    const fx = computeTotals({ discount_percent: 0, amount_paid: 500 }, [ligne(2, 650)], true)
    expect(fx.grandTotal).toBe(1560)
    expect(fx.due).toBe(1060)
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

  it.fails('bug connu : un devis à 0 % de TVA est calculé à 20 %', () => {
    const t = calcTotals([ligne(1, 100)], 0, 0, true)
    expect(t.totalTva).toBe(0)
  })
})
