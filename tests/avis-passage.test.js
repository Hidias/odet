import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/core/supabase', () => ({ supabase: {} }))
const { buildAvisPassagePDF, texteAvis } = await import('../src/modules/interventions/pdf/avisPassagePDF')
const { buildORG } = await import('../src/core/org/orgUtils')
const org = { name: 'Société Essai', legal_name: 'Société Essai SAS', phone: '02 98 00 00 00', email: 'contact@essai.invalid', address: '1 rue A', postal_code: '29000', city: 'Quimper' }
const visit = { reference: 'ITV-ESSAI-1', clients: { name: 'Client Essai' }, sites: { name: 'Site principal', address: '3 rue B', postal_code: '29900', city: 'Concarneau' } }
describe('Avis de passage', () => {
  it('texte : passage prévu ou client absent', () => {
    expect(texteAvis({ kind: 'prevu', passageOn: '2026-11-03', fenetre: 'entre 9 h et 12 h' }).corps[0]).toMatch(/passera le mardi 3 novembre 2026, entre 9 h et 12 h/)
    expect(texteAvis({ kind: 'absent', passageOn: '2026-10-24', fenetre: '14 h 30', contact: '02' }).corps.join(' ')).toMatch(/s'est présenté le samedi 24 octobre 2026 à 14 h 30.*02/)
  })
  it('PDF généré', async () => {
    const { filename } = await buildAvisPassagePDF({ visit, kind: 'absent', passageOn: '2026-10-24', fenetre: '14 h 30', message: 'Portail fermé', org: buildORG(org) })
    expect(filename).toBe('Avis-de-passage-ITV-ESSAI-1-2026-10-24.pdf')
  })
})
