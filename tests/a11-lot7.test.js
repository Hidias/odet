// A11 lot 7 (07/11) : financement sans financeur extérieur prévu, sans barre « reste à financer ».
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { sansFinanceurPrevu } from '../src/modules/formation/lib/financement'

describe('onglet Financement', () => {
  it('aucun, non choisi ou direct : sans financeur extérieur ; OPCO, CPF... : financeur attendu', () => {
    for (const t of [null, '', 'none', 'direct']) expect(sansFinanceurPrevu(t)).toBe(true)
    for (const t of ['opco', 'cpf', 'faf', 'region', 'france_travail', 'ptp', 'fne', 'other']) expect(sansFinanceurPrevu(t)).toBe(false)
  })
  it('la fiche session choisit la phrase neutre ou la barre par cette règle', () => {
    const f = readFileSync('src/modules/formation/pages/SessionDetail.jsx', 'utf8')
    expect(f).toContain('sessionFundings.length === 0 && sansFinanceurPrevu(session.funding_type) ? (')
    expect(f).toContain('Aucun financeur extérieur prévu (OPCO, CPF...).')
    expect(f).toContain('!sansFinanceurPrevu(session.funding_type) && <p')
  })
})

describe('seuil de maintien', () => {
  const f = readFileSync('src/modules/formation/pages/SessionDetail.jsx', 'utf8')
  const c = readFileSync('src/modules/formation/components/SeuilMaintien.jsx', 'utf8')
  it('en tête de fiche, juste après le circuit devis, avant les infos', () => {
    expect(f.indexOf('<SeuilMaintien ')).toBeGreaterThan(f.indexOf('<CircuitSession '))
    expect(f.indexOf('<SeuilMaintien ')).toBeLessThan(f.indexOf('{/* Infos */}'))
    expect(f.split('<SeuilMaintien ').length).toBe(2)
  })
  it('boutons explicites et texte juste sans inscrit', () => {
    for (const t of ['Maintenir la session', 'Reporter la session', 'Annuler la session']) expect(c).toContain(t)
    expect(c).toContain('Aucun inscrit pour le moment')
  })
})

describe('dossier complet (OPCO, audit)', () => {
  it('formation à venir : pas encore terminée, sauf le dernier jour', async () => {
    const { formationAVenir } = await import('../src/modules/formation/lib/documentsEmis')
    const p = (n) => String(n).padStart(2, '0')
    const d = new Date(); const auj = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    expect(formationAVenir({ end_date: '2999-01-01' })).toBe(true)
    expect(formationAVenir({ end_date: auj })).toBe(false)
    expect(formationAVenir({ end_date: '2020-01-01' })).toBe(false)
    expect(formationAVenir({})).toBe(true)
  })
  it('les attestations de présence ne sont mises dans le ZIP qu après la formation', () => {
    const f = readFileSync('src/modules/formation/pages/SessionDetail.jsx', 'utf8')
    expect(f).toContain("const presents = sessionFinie ? await figerDocuments(session, 'attestation'")
  })
})
