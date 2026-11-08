import { describe, it, expect, vi, beforeEach } from 'vitest'

// Ajout d'un type selon la société choisie : instance à une seule société (aucun choix), société choisie, vue groupe
const inserts = []
vi.mock('../src/core/supabase.js', () => ({
  supabase: {
    from: () => ({
      insert: (l) => { inserts.push(l); return { select: () => ({ single: async () => ({ data: { id: 'n', ...l }, error: null }) }) } },
    }),
  },
}))
const { enregistrerType } = await import('../src/core/point/typesActions.js')
const { setCurrentCompanyId } = await import('../src/core/company/companyContext.js')

describe('Ajout d\'un type et société', () => {
  beforeEach(() => { inserts.length = 0 })
  it('aucune société choisie (une seule société) : ajout permis, la base pose la société', async () => {
    setCurrentCompanyId(null)
    await enregistrerType({ name: 'Visite' })
    expect(inserts).toHaveLength(1)
    expect('company_id' in inserts[0]).toBe(false)
  })
  it('société choisie : ajout dans cette société', async () => {
    setCurrentCompanyId('s1')
    await enregistrerType({ name: 'Visite' })
    expect(inserts[0].company_id).toBe('s1')
  })
  it('vue groupe : ajout refusé avec un message clair, rien n\'est envoyé', async () => {
    setCurrentCompanyId('groupe')
    await expect(enregistrerType({ name: 'Visite' })).rejects.toThrow(/Vue groupe : lecture seule/)
    expect(inserts).toHaveLength(0)
    setCurrentCompanyId(null)
  })
})
