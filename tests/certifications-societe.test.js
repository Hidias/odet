import { describe, it, expect } from 'vitest'
import { lireExigences, certValide, prochaineEcheance } from '../src/modules/certification/lib/certSociete'
import { parDomaine } from '../src/modules/certification/lib/certInterne'

describe('Import du texte d\'un référentiel', () => {
  it('lit chapitres, codes, titres et textes', () => {
    const r = lireExigences([
      '# 5 Organisation',
      '5.1 ; Contrat ; Le prestataire établit un contrat',
      '5.2\tLes fréquences sont respectées',
      '',
      '# Moyens',
      'Une ligne sans séparateur',
    ].join('\n'))
    expect(r).toHaveLength(3)
    expect(r[0]).toMatchObject({ chapitre: 1, chapitre_code: '5', chapitre_titre: 'Organisation', code: '5.1', titre: 'Contrat', texte: 'Le prestataire établit un contrat' })
    expect(r[1]).toMatchObject({ chapitre: 1, code: '5.2', titre: null, texte: 'Les fréquences sont respectées' })
    expect(r[2]).toMatchObject({ chapitre: 2, chapitre_code: null, chapitre_titre: 'Moyens', code: null, texte: 'Une ligne sans séparateur' })
  })

  it('range dans « Exigences » ce qui précède le premier chapitre', () => {
    const r = lireExigences('A1 ; Premier point')
    expect(r[0]).toMatchObject({ chapitre: 1, chapitre_titre: 'Exigences', code: 'A1', texte: 'Premier point' })
  })

  it('garde le texte entier quand il contient des points-virgules', () => {
    const r = lireExigences('7.3 ; Titre ; Partie un ; partie deux')
    expect(r[0].texte).toBe('Partie un ; partie deux')
  })

  it('ne prend pas une longue phrase pour un code', () => {
    const r = lireExigences('Le prestataire tient un registre des réclamations ; il le présente à l\'audit')
    expect(r[0].code).toBeNull()
  })

  it('ignore un texte vide', () => {
    expect(lireExigences('  \n\n')).toEqual([])
  })
})

describe('Validité d\'une certification (même règle qu\'en base)', () => {
  it('obtenue et en cours de validité seulement', () => {
    expect(certValide({ statut: 'obtenue', valable_jusqu_au: '2027-01-01' }, '2026-10-19')).toBe(true)
    expect(certValide({ statut: 'obtenue', valable_jusqu_au: '2026-10-18' }, '2026-10-19')).toBe(false)
    expect(certValide({ statut: 'obtenue', valable_jusqu_au: null }, '2026-10-19')).toBe(true)
    expect(certValide({ statut: 'suspendue', valable_jusqu_au: '2027-01-01' }, '2026-10-19')).toBe(false)
    expect(certValide(null)).toBe(false)
  })

  it('prochaine échéance : la plus proche des dates utiles', () => {
    expect(prochaineEcheance({ audit_initial_prevu: '2026-12-01', valable_jusqu_au: '2029-01-01' })).toEqual({ d: '2026-12-01', label: 'Audit initial' })
    expect(prochaineEcheance({ audit_initial_prevu: '2026-12-01', audit_initial_fait: '2026-12-01', valable_jusqu_au: '2029-01-01' }).label).toBe('Fin de validité')
    expect(prochaineEcheance({})).toBeNull()
  })
})

describe('Face interne regroupée par certification', () => {
  it('compte les points à confirmer et masque les domaines vides', () => {
    const g = parDomaine([
      { domaine: 'apsad', statut: 'a_confirmer' }, { domaine: 'apsad', statut: 'confirme' }, { domaine: 'nda', statut: 'ecarte' },
    ])
    expect(g.map((d) => [d.v, d.aConfirmer])).toEqual([['apsad', 1], ['nda', 0]])
  })
})

describe('Remplacement d\'un appareil (même règle que la clôture en base)', async () => {
  const { replaceMissing, replaceBlockers } = await import('../src/modules/interventions/lib/schedule')
  it('motif obligatoire, précision si « autre », client informé si une opération périodique était due', () => {
    expect(replaceMissing({ result: 'conforme' })).toEqual([])
    expect(replaceMissing({ result: 'remplace', operation: 'verification' })).toEqual(['motif'])
    expect(replaceMissing({ result: 'remplace', operation: 'verification', replace_reason: 'autre' })).toEqual(['précision du motif'])
    expect(replaceMissing({ result: 'remplace', operation: 'maa', replace_reason: 'fin_de_vie' })).toEqual(['information du client'])
    expect(replaceMissing({ result: 'remplace', operation: 'revision', replace_reason: 'cout', client_informed: true })).toEqual([])
    expect(replaceBlockers([{ result: 'remplace' }, { result: 'conforme' }])).toHaveLength(1)
  })
})
