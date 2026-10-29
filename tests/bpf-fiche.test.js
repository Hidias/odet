import { describe, it, expect } from 'vitest'
import { specialiteSuggeree, manquesBpf, OBJECTIFS_BPF } from '../src/modules/formation/lib/bpf'

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
