import { describe, it, expect } from 'vitest'
import { fichierDeLInstance } from '../src/core/fichiersInstance'

const BASE = 'https://thcngystpaiamejoaejn.supabase.co'

describe('fichierDeLInstance', () => {
  it('écarte un fichier hébergé sur un autre projet Supabase', () => {
    expect(fichierDeLInstance('https://ibvtdiiwlpocibjvlgxr.supabase.co/storage/v1/object/public/documents/programmes/p.pdf', BASE)).toBeNull()
  })
  it('garde un fichier du stockage de l\'instance', () => {
    const u = `${BASE}/storage/v1/object/public/documents/programmes/p.pdf`
    expect(fichierDeLInstance(u, BASE)).toBe(u)
  })
  it('garde une adresse hors Supabase et un chemin relatif', () => {
    expect(fichierDeLInstance('https://exemple.fr/programme.pdf', BASE)).toBe('https://exemple.fr/programme.pdf')
    expect(fichierDeLInstance('documents/p.pdf', BASE)).toBe('documents/p.pdf')
  })
  it('renvoie null pour une valeur vide', () => {
    expect(fichierDeLInstance(null, BASE)).toBeNull()
    expect(fichierDeLInstance('', BASE)).toBeNull()
  })
  it('écarte tout projet Supabase quand l\'adresse de l\'instance est inconnue', () => {
    expect(fichierDeLInstance('https://abc.supabase.co/x.pdf', '')).toBeNull()
  })
})
