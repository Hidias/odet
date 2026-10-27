import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { nomContact } from '../src/core/genre.js'
import { donneesDecharge } from '../src/modules/prevention/lib/dechargeNir.js'

// S19 : plus aucune forme « (e) » visant une personne précise dans le code (documents, e-mails, écrans)
const fichiers = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? fichiers(p) : (/\.(jsx?|mjs)$/.test(n) ? [p] : [])
})

describe('S19 : accords', () => {
  it('aucun « soussigné(e) », « inscrit(e) », « désigné(e) », « informé(e) » dans le code', () => {
    const motif = /(soussign|inscrit|désign|inform|convoqu)é?\(e\)/
    const fautes = [...fichiers('src'), ...fichiers('api')].filter((f) => motif.test(readFileSync(f, 'utf8')))
    expect(fautes).toEqual([])
  })
  it('contact : « M. » avec un point, nom complet quand la civilité manque', () => {
    expect(nomContact({ civilite: 'M', name: 'Ronan Le Meur' })).toBe('M. Ronan Le Meur')
    expect(nomContact({ civilite: 'Mme', last_name: 'Le Meur', name: 'Anne Le Meur' }, { courte: false, nomDeFamille: true })).toBe('Madame Le Meur')
    expect(nomContact({ civilite: null, last_name: 'Le Meur', name: 'Anne Le Meur' }, { courte: false, nomDeFamille: true })).toBe('Anne Le Meur')
  })
  it('décharge NIR : le genre du stagiaire part avec les données du document', () => {
    expect(donneesDecharge({}, { first_name: 'Anne', last_name: 'Le Meur', gender: 'female' }).genre).toBe('female')
  })
})
