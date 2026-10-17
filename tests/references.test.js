// Références des factures, avoirs et devis.
// Les références de session (préfixe doc_prefix) sont générées en base par un déclencheur :
// elles se vérifient en transaction annulée sur la production (docs/verification-et-preversions.md).
import { describe, it, expect } from 'vitest'
import { nextInvoiceReference, nextQuoteReference, invoicePrefix } from '../src/modules/commercial/lib/references.js'

const jour = new Date(2026, 9, 14, 10, 0)

describe('Factures et avoirs', () => {
  it('première facture', () => expect(nextInvoiceReference(null, 'invoice', jour)).toBe('FACT-20261014-00001'))
  it('le numéro continue d\'un jour à l\'autre', () => expect(nextInvoiceReference('FACT-20261013-00041', 'invoice', jour)).toBe('FACT-20261014-00042'))
  it('avoir : préfixe AVR', () => {
    expect(invoicePrefix('credit_note')).toBe('AVR')
    expect(nextInvoiceReference('AVR-20260901-00003', 'credit_note', jour)).toBe('AVR-20261014-00004')
  })
  it('type par défaut : facture', () => expect(invoicePrefix()).toBe('FACT'))
  it('référence importée sans numéro final : repart à 1', () => expect(nextInvoiceReference('FACT-IMPORT', 'invoice', jour)).toBe('FACT-20261014-00001'))
})

describe('Devis', () => {
  it('premier devis du jour', () => expect(nextQuoteReference(null, jour)).toBe('DEV-20261014-00001'))
  it('devis suivant le même jour', () => expect(nextQuoteReference('DEV-20261014-00007', jour)).toBe('DEV-20261014-00008'))
})
