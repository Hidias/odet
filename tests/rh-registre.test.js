import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/core/supabase', () => ({ supabase: {} }))
vi.mock('../src/core/pdf/layout', () => ({ startDocument: () => ({}), numberPages: () => {} }))
vi.mock('../src/core/pdf/pdfOrg', () => ({ loadPdfOrg: async () => ({}) }))

describe('RH : registre unique du personnel (0313)', () => {
  it('mentions obligatoires selon le contrat', async () => {
    const { mentionsContrat } = await import('../src/modules/rh/lib/rhRegistre')
    expect(mentionsContrat({ contract_type: 'cdd', weekly_hours: 35 })).toBe('Contrat à durée déterminée')
    expect(mentionsContrat({ contract_type: 'cdi', weekly_hours: 24 })).toBe('Salarié à temps partiel')
    expect(mentionsContrat({ contract_type: 'cdi', weekly_hours: 35 })).toBe('CDI')
    expect(mentionsContrat({ contract_type: 'interim', agency_name: 'Agence A', agency_address: 'Quimper' })).toBe('Salarié temporaire (Agence A, Quimper)')
    expect(mentionsContrat({ contract_type: 'apprentissage', weekly_hours: 35 })).toBe('Apprenti')
  })
  it('lignes dans l\'ordre, incomplètes signalées', async () => {
    const { lignesRegistre } = await import('../src/modules/rh/lib/rhRegistre')
    const l = lignesRegistre([
      { contract_type: 'cdi', start_on: '2025-03-01', job_title: 'Technicien', weekly_hours: 35, hr_people: { first_name: 'Camille', last_name: 'Test', nationality: 'Française', gender: 'F', birth_date: '1990-01-01' } },
      { contract_type: 'stage', start_on: '2026-01-05', weekly_hours: 35, hr_people: { first_name: 'Yann', last_name: 'Test' } },
    ])
    expect(l[0]).toMatchObject({ numero: 1, nom: 'TEST Camille', incomplet: false, stagiaire: false })
    expect(l[1]).toMatchObject({ numero: 2, stagiaire: true, incomplet: true })
  })
})
