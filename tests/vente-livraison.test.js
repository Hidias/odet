import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/core/supabase', () => ({ supabase: {} }))
const { createInvoiceDraft } = await import('../src/modules/interventions/lib/itvData.js')

describe('livraison d\'un devis signé (0467)', () => {
  it('ne se facture jamais une seconde fois depuis l\'intervention', async () => {
    await expect(createInvoiceDraft({ kind: 'livraison', quote_id: 'q1', client_id: 'c1' }, [], {})).rejects.toThrow('depuis le devis')
  })
})
