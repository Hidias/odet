import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const reponse = { value: { data: null, error: null } }
vi.mock('../src/core/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => reponse.value }) }) }) },
}))
const { froidEnLigne, PHRASE_FROID_EN_LIGNE } = await import('../src/modules/formation/lib/froidMail')

describe('Mail « Après formation » : évaluation à froid en ligne, plus de papier (décision de H du 08/11)', () => {
  it('annoncée si la société l’a activée, ou sans réglage enregistré (actif par défaut en base)', async () => {
    reponse.value = { data: null, error: null }
    expect(await froidEnLigne('c1')).toBe(true)
    reponse.value = { data: { actif: true }, error: null }
    expect(await froidEnLigne('c1')).toBe(true)
    reponse.value = { data: { actif: false }, error: null }
    expect(await froidEnLigne('c1')).toBe(false)
    reponse.value = { data: null, error: { message: 'x' } }
    expect(await froidEnLigne('c1')).toBe(false)
    expect(await froidEnLigne(null)).toBe(false)
  })
  it('le mail ne joint plus de questionnaire à froid papier ni « d’ici 90 jours »', () => {
    const f = readFileSync('src/modules/formation/components/SessionEmailModal.jsx', 'utf8')
    expect(f).not.toMatch(/90 jours/)
    expect(f).not.toMatch(/generateAllPDF\('evaluationFroid'/)
    expect(f).toMatch(/PHRASE_FROID_EN_LIGNE/)
    expect(PHRASE_FROID_EN_LIGNE).not.toMatch(/—|–/)
  })
})
