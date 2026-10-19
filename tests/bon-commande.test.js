import { describe, it, expect } from 'vitest'
import { buildORG } from '../src/core/org/orgUtils'
import { buildBonCommandePDF } from '../src/modules/formation/pdf/bonCommandePDF'

// Bon de commande de sous-traitance (lot 2, 0045) : le document se construit avec une identité minimale
describe('bon de commande de sous-traitance', () => {
  it('se construit avec ou sans session', () => {
    const ORG = buildORG({ name: 'Organisme essai', siret: '12345678900012' })
    const order = { reference: 'BC-20261019-0001', order_date: '2026-10-19', start_date: '2026-11-02', end_date: '2026-11-03', days: 2, daily_rate: 3000, amount_ht: 6000, object: 'Formation essai' }
    const st = { name: 'Prestataire essai', siret: '98765432100015', contact_name: 'Camille Essai' }
    const a = buildBonCommandePDF(ORG, { order, subcontractor: st, session: { reference: 'SES-1', courses: { title: 'SST' }, location_city: 'Ville' } })
    const b = buildBonCommandePDF(ORG, { order: { ...order, start_date: null }, subcontractor: st })
    expect(a.getNumberOfPages()).toBeGreaterThanOrEqual(1)
    expect(b.output('arraybuffer').byteLength).toBeGreaterThan(1000)
  })
})
