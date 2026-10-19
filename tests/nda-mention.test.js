import { describe, it, expect } from 'vitest'
import { ligneNda, phraseNda, orgHorsFormation } from '../src/core/org/orgUtils'

describe('NDA sur les documents de formation', () => {
  const sansNumero = { name: 'GLD', nda: "en cours d'enregistrement", ndaFull: "en cours d'enregistrement", ndaAttribue: false }
  const avecNumero = { name: 'AF', nda: '53 29 10261 29', ndaFull: '53 29 10261 29 auprès du préfet de la région Bretagne', ndaAttribue: true }
  it('mention obligatoire tant que le numéro manque', () => {
    expect(ligneNda(sansNumero)).toBe("Déclaration d'activité en cours d'enregistrement")
    expect(phraseNda(sansNumero)).toBe("déclaration d'activité en cours d'enregistrement")
  })
  it('numéro dès qu’il est saisi', () => {
    expect(ligneNda(avecNumero)).toBe('NDA 53 29 10261 29')
    expect(ligneNda(avecNumero, { complet: true })).toContain('Bretagne')
    expect(phraseNda(avecNumero)).toBe("déclaration d'activité n° 53 29 10261 29 auprès du préfet de la région Bretagne")
  })
  it('rien sur un document hors formation', () => {
    expect(ligneNda(orgHorsFormation(sansNumero))).toBe('')
    expect(phraseNda(orgHorsFormation(avecNumero))).toBe('')
  })
})
