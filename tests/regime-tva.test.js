import { describe, it, expect } from 'vitest'
import { tvaLigne, appliquerRegime, mentionsTvaDevis, ajusterAuTtc, ligneAForfaitiser, forfaitiser, erreursTva, regimesPermis } from '../src/core/billing/regimeTva'
import { calcTotals } from '../src/modules/commercial/lib/quoteTotals'

const assujetti = { charge: true, franchise: false, exoFormation: false, mentions: { exoneration: 'Exo.', franchise: 'Franchise.', autoliquidation: 'Auto.' } }
const exo = { ...assujetti, exoFormation: true }
const franchise = { ...assujetti, franchise: true }

describe('régime de TVA de l\'organisme', () => {
  it('taux des nouvelles lignes', () => {
    expect(tvaLigne(true, assujetti)).toEqual({ tva_rate: 20, vat_regime: 'normal' })
    expect(tvaLigne(true, exo)).toEqual({ tva_rate: 0, vat_regime: 'exonere' })
    expect(tvaLigne(false, exo)).toEqual({ tva_rate: 20, vat_regime: 'normal' })
    expect(tvaLigne(false, franchise).tva_rate).toBe(0)
  })
  it('à l\'enregistrement : formation exonérée, maintenance à la TVA', () => {
    const r = appliquerRegime([{ course_id: 'c', tva_rate: 20, vat_regime: 'normal' }, { course_id: null, tva_rate: 20, vat_regime: 'normal' }], exo)
    expect(r[0]).toMatchObject({ tva_rate: 0, vat_regime: 'exonere' })
    expect(r[1]).toMatchObject({ tva_rate: 20, vat_regime: 'normal' })
  })
  it('mentions du devis', () => {
    expect(mentionsTvaDevis([{ vat_regime: 'normal' }], {}, franchise)).toEqual(['Franchise.'])
    expect(mentionsTvaDevis([{ vat_regime: 'exonere' }], {}, exo)).toEqual(['Exo.'])
    expect(mentionsTvaDevis([{ vat_regime: 'normal' }], {}, assujetti)).toEqual([])
  })
  it('ligne exonérée à 0 % dans les totaux du devis', () => {
    const t = calcTotals([{ quantity: 1, unit_price_ht: 100, vat_regime: 'exonere' }, { quantity: 1, unit_price_ht: 100, vat_regime: 'normal' }], 0, 20, true)
    expect(t.totalTva).toBe(20)
    expect(t.totalTtc).toBe(220)
  })
  it('ajuster au TTC voulu : 500 € TTC pour un client qui ne récupère pas la TVA', () => {
    const calc = (l) => calcTotals(l, 0, 20, true)
    const r = ajusterAuTtc([{ quantity: 1, unit_price_ht: 418 }], 500, 20, calc)
    expect(r.ttc).toBe(500)
    expect(r.lignes[0].unit_price_ht).toBe(416.67)
  })
})

describe('TTC rond avec plusieurs unités', () => {
  const calc = (l) => calcTotals(l, 0, 20, true)
  it('2 × 250 TTC : arrondi signalé, puis forfait juste à 500', () => {
    const lignes = [{ description_title: 'SST', quantity: 2, unit: 'jour', unit_price_ht: 250, vat_regime: 'normal' }]
    const r = ajusterAuTtc(lignes, '500', 20, calc)
    expect(r.exact).toBe(false)
    const k = ligneAForfaitiser(r.lignes)
    expect(k).toBe(0)
    const f = ajusterAuTtc(forfaitiser(r.lignes, k), '500', 20, calc)
    expect(f.exact).toBe(true)
    expect(f.ttc).toBe(500)
    expect(f.lignes[0]).toMatchObject({ quantity: 1, unit: 'forfait', unit_price_ht: 416.67, description_detail: '(2 jours)' })
  })
  it('quantité 1 : juste sans forfait', () => {
    const r = ajusterAuTtc([{ description_title: 'SST', quantity: 1, unit_price_ht: 500, vat_regime: 'normal' }], '500', 20, calc)
    expect(r.exact).toBe(true)
  })
})

describe('TVA à 0 % verrouillée pour un organisme assujetti', () => {
  const avecAttestation = { ...exo, attestation: 'ATT-1' }
  const pro = { client_type: 'entreprise', tva: 'FR00123456789' }
  it('TVA non applicable refusée', () => {
    expect(erreursTva({ tvaApplicable: false, taux: 20, lignes: [] }, assujetti).length).toBe(1)
  })
  it('franchise : rien à redire', () => {
    expect(erreursTva({ tvaApplicable: false, taux: 0, lignes: [] }, franchise)).toEqual([])
  })
  it('exonération sans attestation refusée, avec attestation sur une formation permise', () => {
    const l = [{ description_title: 'SST', vat_regime: 'exonere', course_id: 'c' }]
    expect(erreursTva({ tvaApplicable: true, taux: 20, lignes: l }, exo).length).toBe(1)
    expect(erreursTva({ tvaApplicable: true, taux: 20, lignes: l }, avecAttestation)).toEqual([])
    expect(erreursTva({ tvaApplicable: true, taux: 20, lignes: [{ ...l[0], course_id: null }] }, avecAttestation).length).toBe(1)
  })
  it('autoliquidation seulement pour un professionnel avec numéro de TVA', () => {
    const l = [{ description_title: 'Pose', vat_regime: 'autoliquidation' }]
    expect(erreursTva({ tvaApplicable: true, taux: 20, lignes: l, client: pro }, assujetti)).toEqual([])
    expect(erreursTva({ tvaApplicable: true, taux: 20, lignes: l, client: { client_type: 'public' } }, assujetti).length).toBe(1)
  })
  it('facture : ligne normale à 0 % refusée', () => {
    expect(erreursTva({ tvaApplicable: true, lignes: [{ description_title: 'x', tva_rate: 0 }], tauxParLigne: true }, assujetti).length).toBe(1)
  })
  it('options de régime proposées', () => {
    expect(regimesPermis({ course_id: 'c' }, pro, avecAttestation).map(([k]) => k)).toEqual(['normal', 'exonere', 'autoliquidation'])
    expect(regimesPermis({ course_id: 'c' }, { client_type: 'public' }, assujetti).map(([k]) => k)).toEqual(['normal'])
  })
})
