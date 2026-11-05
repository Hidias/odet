import { describe, it, expect } from 'vitest'
import { bornesExercice, libelleExercice, dateLimiteBpf, premierExerciceBpf, exerciceBpfSuivi } from '../src/modules/formation/lib/bpf'
import { etatBpf } from '../src/modules/dashboard/lib/accueil.js'

describe('BPF : premier exercice soumis (règle tranchée par H le 05/11/2026)', () => {
  it('bornes, nom et date limite', () => {
    expect(bornesExercice(2027, 10)).toEqual({ debut: '2026-10-01', fin: '2027-09-30' })
    expect(bornesExercice(2026, 1)).toEqual({ debut: '2026-01-01', fin: '2026-12-31' })
    expect(bornesExercice(2028, 3)).toEqual({ debut: '2027-03-01', fin: '2028-02-29' })
    expect(libelleExercice(2027, 10)).toBe('2026-2027')
    expect(libelleExercice(2026, 1)).toBe('2026')
    expect(dateLimiteBpf(2027)).toBe('2028-04-30')
  })
  it('GLD Sécurité : dépôt le 27/10/2026, rien pour l\'exercice clos le 30/09/2026', () => {
    expect(premierExerciceBpf(10, '2026-10-27')).toBe(2027)
    expect(premierExerciceBpf(10, '2026-09-15')).toBe(2026)
    expect(premierExerciceBpf(1, '2026-10-27')).toBe(2026)
    expect(premierExerciceBpf(10, null)).toBeNull()
  })
  it('suivi du widget', () => {
    const j = new Date(2026, 10, 5)
    expect(exerciceBpfSuivi({ nda: '', deposeeLe: '2026-10-27', moisDebut: 10, aujourdhui: j }).cle).toBe('sans_numero')
    expect(exerciceBpfSuivi({ nda: '   ', moisDebut: 10, aujourdhui: j }).cle).toBe('sans_numero')
    const p = exerciceBpfSuivi({ nda: '53291026129', deposeeLe: '2026-10-27', moisDebut: 10, aujourdhui: j })
    expect(p).toMatchObject({ cle: 'pas_encore', annee: 2027, debut: '2026-10-01', fin: '2027-09-30', limite: '2028-04-30', libelle: '2026-2027' })
    // Une fois l'exercice 2026-2027 clos : dû
    expect(exerciceBpfSuivi({ nda: 'x', deposeeLe: '2026-10-27', moisDebut: 10, aujourdhui: new Date(2027, 9, 1) })).toMatchObject({ cle: 'du', annee: 2027, limite: '2028-04-30' })
    // Date de dépôt inconnue : dernier exercice clos, comme avant
    expect(exerciceBpfSuivi({ nda: 'x', moisDebut: 1, aujourdhui: j })).toMatchObject({ cle: 'du', annee: 2025, libelle: '2025' })
  })
  it('textes du widget', () => {
    expect(etatBpf(null, null, { cle: 'sans_numero' }).titre).toBe('BPF pas encore dû')
    const p = exerciceBpfSuivi({ nda: 'x', deposeeLe: '2026-10-27', moisDebut: 10, aujourdhui: new Date(2026, 10, 5) })
    const e = etatBpf(null, null, p)
    expect(e.titre).toBe('Premier BPF : exercice 2026-2027')
    expect(e.detail).toBe('Exercice du 01/10/2026 au 30/09/2027, à transmettre avant le 30/04/2028')
    const du = exerciceBpfSuivi({ nda: 'x', deposeeLe: '2026-10-27', moisDebut: 10, aujourdhui: new Date(2027, 10, 5) })
    expect(etatBpf(null, du.annee, du).titre).toBe('BPF 2026-2027 à préparer')
    expect(etatBpf(null, du.annee, du).detail).toContain('avant le 30/04/2028')
  })
})
