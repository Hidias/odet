import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const chain = () => { const c = { select: () => c, eq: () => c, in: () => c, order: () => c, limit: () => c, maybeSingle: async () => ({ data: null }), single: async () => ({ data: null }), then: (r) => r({ data: [] }) }; return c }
vi.mock('../src/core/supabase', () => ({ supabase: { from: () => chain(), rpc: async () => ({ data: null }), storage: { from: () => ({ createSignedUrl: async () => ({}) }) } } }))
const { lignesAvecPhoto } = await import('../src/modules/commercial/lib/photosDevis')
const { generateQuotePDF } = await import('../src/modules/commercial/pdf/quoteGenerator')

// PNG de 1 × 1 pixel
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('Photos des articles dans les devis (0445)', () => {
  it('seules les lignes cochées qui ont une photo sont imprimées', () => {
    expect(lignesAvecPhoto([{ show_photo: true, photo_path: 'a' }, { show_photo: true }, { photo_path: 'b' }, null])).toHaveLength(1)
  })
  it('le PDF du devis imprime les photos sous les lignes', async () => {
    const quote = { reference: 'DEV-P', quote_date: '2026-10-24', status: 'draft', tva_rate: 20, tva_applicable: true }
    const items = [{ description_title: 'BAES', quantity: 1, unit_price_ht: 10, tva_rate: 20, nature: 'bien', total_ht: 10 }]
    const opts = { skipSave: true, orgSettings: { name: 'ESSAI' }, mentionsDevis: { textes: {}, pieces: [] }, enLigne: false }
    const sans = await generateQuotePDF(quote, items, { name: 'C' }, null, { ...opts, photos: [] })
    const avec = await generateQuotePDF(quote, items, { name: 'C' }, null, { ...opts, photos: [{ title: 'BAES', dataUrl: PNG }, { title: 'Site', dataUrl: PNG }] })
    expect(avec.output('arraybuffer').byteLength).toBeGreaterThan(sans.output('arraybuffer').byteLength)
  })
  it('les fiches techniques des articles vendus sont proposées à l’envoi', () => {
    const src = readFileSync('src/modules/commercial/pages/Quotes.jsx', 'utf8')
    expect(src).toMatch(/kind: 'fiche'/)
    expect(src).toMatch(/supabase\.rpc\('devis_articles'\)/)
  })
})
