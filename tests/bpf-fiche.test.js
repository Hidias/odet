import { describe, it, expect } from 'vitest'
import { specialiteSuggeree, manquesBpf, OBJECTIFS_BPF, dernierExerciceClos } from '../src/modules/formation/lib/bpf'

describe('BPF : fiche formation', () => {
  it('spécialité proposée seulement quand l\'intitulé est clair', () => {
    expect(specialiteSuggeree({ title: 'Sauveteur secouriste du travail (SST)' })).toBe('344')
    expect(specialiteSuggeree({ title: 'Conduite de chariots R489' })).toBe('311')
    expect(specialiteSuggeree({ title: 'Habilitation électrique BR' })).toBe('255')
    expect(specialiteSuggeree({ title: 'Gestes et postures' })).toBeNull()
  })
  it('manques : objectif, niveau RNCP, spécialité', () => {
    expect(manquesBpf({})).toEqual(['objectif', 'spécialité'])
    expect(manquesBpf({ bpf_objectif: 'rncp', nsf_code: '344' })).toEqual(['niveau RNCP'])
    expect(manquesBpf({ bpf_objectif: 'rs', nsf_code: '344' })).toEqual([])
  })
  it('les sept objectifs du cadre F-3', () => {
    expect(OBJECTIFS_BPF.map((o) => o.value)).toEqual(['rncp', 'rncp_cqp', 'rs', 'cqp', 'autre', 'bilan', 'vae'])
  })
})

import { categorieDeduite, CATEGORIES_F1 } from '../src/modules/formation/components/BpfCategories'
describe('BPF : catégorie du stagiaire (F-1)', () => {
  it('déduite du client comme le calcul en base', () => {
    expect(categorieDeduite('entreprise')).toBe('a')
    expect(categorieDeduite('particulier')).toBe('d')
    expect(categorieDeduite('public')).toBe('e')
    expect(categorieDeduite(undefined)).toBe('a')
    expect(CATEGORIES_F1.map((c) => c.value)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

import { valeursRetenues, controlesBpf, LIGNES_BPF } from '../src/modules/formation/lib/bpf'
describe('BPF : valeurs retenues et contrôles', () => {
  const calcul = { 'C-1': 1000.4, 'C-2-h': 900, 'C-9': 300, 'F-1-a': { stagiaires: 2, heures: 25 }, 'F-3-b': { stagiaires: 2, heures: 25 }, 'E-1': { personnes: 1, heures: 21 } }
  it('la saisie l\'emporte, les totaux se recalculent, arrondis à l\'unité', () => {
    const r = valeursRetenues(calcul, { 'C-2-a': 50, 'F-1-b': { stagiaires: 1, heures: 7 }, 'F-3-d': { stagiaires: 1, heures: 7 } })
    expect(r['C-1']).toBe(1000)
    expect(r['C-2']).toBe(950)
    expect(r.C).toBe(2250)
    expect(r['F-1']).toEqual({ stagiaires: 3, heures: 32 })
    expect(r['F-3']).toEqual({ stagiaires: 3, heures: 32 })
    expect(r['E-1']).toEqual({ personnes: 1, heures: 21 })
  })
  it('saisie vide = calcul', () => {
    expect(valeursRetenues(calcul, { 'C-1': '' })['C-1']).toBe(1000)
  })
  it('contrôles de la notice', () => {
    const r = valeursRetenues(calcul, {})
    expect(controlesBpf(r, { stagiaires: 2, heures: 25 }, 46)).toEqual([])
    expect(controlesBpf(r, { stagiaires: 1, heures: 25 }, 46)[0]).toMatch(/F-1 et F-4/)
    expect(controlesBpf(r, { stagiaires: 2, heures: 25 }, 0).join()).toMatch(/1 %/)
    expect(controlesBpf(valeursRetenues(calcul, { D: 10, 'D-1': 20 }), { stagiaires: 2, heures: 25 }, 46).join()).toMatch(/Cadre D/)
  })
  it('chaque code est unique', () => {
    const codes = LIGNES_BPF.map((l) => l.code)
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe('dernierExerciceClos', () => {
  it('exercice civil : année précédente', () => {
    expect(dernierExerciceClos(1, new Date(2026, 9, 29))).toBe(2025)
    expect(dernierExerciceClos(null, new Date(2026, 0, 5))).toBe(2025)
  })
  it('début en octobre : exercice 2026 (01/10/2025 au 30/09/2026) clos dès octobre 2026', () => {
    expect(dernierExerciceClos(10, new Date(2026, 9, 1))).toBe(2026)
    expect(dernierExerciceClos(10, new Date(2026, 8, 30))).toBe(2025)
  })
  it('début en juillet', () => {
    expect(dernierExerciceClos(7, new Date(2026, 6, 1))).toBe(2026)
    expect(dernierExerciceClos(7, new Date(2026, 5, 30))).toBe(2025)
  })
})
