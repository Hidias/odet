import { describe, it, expect } from 'vitest'
import { tvaLigne, appliquerRegime, mentionsTvaDevis, ajusterAuTtc } from '../src/core/billing/regimeTva'
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
