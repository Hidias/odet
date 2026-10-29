import { describe, it, expect } from 'vitest'
import { lignesCadre, etatDeclaration } from '../src/modules/qualite/pdf/bpfPDF'
import { valeursRetenues } from '../src/modules/formation/lib/bpf'

describe('BPF : document de travail PDF', () => {
  const calcul = { 'C-1': 900, 'C-2-h': 300, 'F-1-a': { stagiaires: 3, heures: 32 }, 'F-1-c': { stagiaires: 1, heures: 7 } }
  const saisies = { 'C-2-h': 1200, 'F-1-a': { heures: 30 } }
  const retenues = valeursRetenues(calcul, saisies)

  it('montants : saisie prioritaire, origine indiquée, total recalculé', () => {
    const { type, corps } = lignesCadre('C', retenues, saisies)
    expect(type).toBe('montant')
    const ligne = (code) => corps.find((l) => l[0] === code)
    expect(ligne('C-1')[3]).toBe('calcul')
    expect(ligne('C-2-h')[2]).toBe('1 200 €')
    expect(ligne('C-2-h')[3]).toBe('saisi')
    expect(ligne('C')[2]).toBe('2 100 €')
    expect(ligne('C')[3]).toBe('total')
  })

  it('stagiaires et heures : saisie partielle marquée, total F-1', () => {
    const { corps } = lignesCadre('F-1', retenues, saisies)
    const ligne = (code) => corps.find((l) => l[0] === code)
    expect(ligne('F-1-a').slice(2)).toEqual(['3', '30', 'saisi'])
    expect(ligne('F-1-c').slice(2)).toEqual(['1', '7', 'calcul'])
    expect(ligne('F-1').slice(2)).toEqual(['4', '37', 'total'])
  })
})

describe('BPF : état indiqué sur le PDF', () => {
  it('modifié après enregistrement : jamais présenté comme enregistré', () => {
    expect(etatDeclaration(null)).toBe('Non enregistré')
    expect(etatDeclaration({ id: 'x' })).toBe('Enregistré, non déposé')
    expect(etatDeclaration({ id: 'x' }, true)).toMatch(/non enregistrés/)
    expect(etatDeclaration({ id: 'x', submitted_at: '2027-04-10' }, true)).toMatch(/^Noté comme déposé/)
  })
})
