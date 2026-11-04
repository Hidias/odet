import { describe, expect, it } from 'vitest'
import { filtrerEnvois, grouperParSession, libelleEnvoi, nouvelleQuestion, reponsesCompletes, QUESTIONS_BASE } from '../src/modules/qualite/lib/froid.js'

const auj = new Date('2026-11-04T12:00:00')
const e = (o) => ({ id: Math.random().toString(36), session_id: 's1', statut: 'prepare', fin: '2026-09-01', rang: 0, cible: 'stagiaire', ...o })

describe('page des évaluations à froid (0482)', () => {
  it('filtre par état et par ancienneté', () => {
    const l = [e({}), e({ statut: 'envoye' }), e({ fin: '2025-06-01' }), e({ statut: 'en_cours' })]
    expect(filtrerEnvois(l, { vue: 'prepare' }, auj)).toHaveLength(3)
    expect(filtrerEnvois(l, { vue: 'envoye' }, auj)).toHaveLength(1)
    expect(filtrerEnvois(l, { vue: 'tous', anciennete: 'plus' }, auj)).toHaveLength(1)
    expect(filtrerEnvois(l, { vue: 'tous', anciennete: '90' }, auj)).toHaveLength(3)
  })
  it('groupe par session et nomme les envois', () => {
    const g = grouperParSession([e({ session_id: 'a' }), e({ session_id: 'b' }), e({ session_id: 'a' })])
    expect(g.map((x) => [x.session_id, x.lignes.length])).toEqual([['a', 2], ['b', 1]])
    expect(libelleEnvoi({ rang: 0, cible: 'stagiaire' })).toBe('Premier envoi')
    expect(libelleEnvoi({ rang: 1, cible: 'contact' })).toBe("Relance par le contact de l'entreprise")
    expect(libelleEnvoi({ rang: 0, cible: 'employeur' })).toBe("Premier envoi à l'employeur")
  })
  it('questions : réponses fermées obligatoires, clés nouvelles jamais en double', () => {
    expect(reponsesCompletes(QUESTIONS_BASE, { skills_applied: true })).toBe(false)
    expect(reponsesCompletes(QUESTIONS_BASE, { skills_applied: true, objectives_met: false, knowledge_retained: true, job_impact: true, would_recommend: false })).toBe(true)
    expect(nouvelleQuestion([...QUESTIONS_BASE, { cle: 'q_1' }]).cle).toBe('q_2')
  })
})
