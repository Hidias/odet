import { describe, expect, it } from 'vitest'
import { CHAMPS_EVALUATION, evaluationRecue, reponsesDe } from '../src/modules/formation/components/ReponseEvaluation.jsx'

describe('réponses figées (0481)', () => {
  it('reçue : mêmes critères que la base', () => {
    expect(evaluationRecue('chaud', { questionnaire_submitted: true })).toBe(true)
    expect(evaluationRecue('chaud', { questionnaire_submitted: false })).toBe(false)
    expect(evaluationRecue('froid', { sent_at: '2026-01-01' })).toBe(false)
    expect(evaluationRecue('froid', { completed_at: '2026-01-02' })).toBe(true)
    expect(evaluationRecue('formateur', { overall_score: 4 })).toBe(false)
    expect(evaluationRecue('formateur', { submitted_at: '2026-01-02' })).toBe(true)
    expect(evaluationRecue('froid', null)).toBe(false)
  })
  it('n’envoie que les réponses du type, vides en null, sans les champs techniques', () => {
    const r = reponsesDe('froid', { id: 'x', sent_at: 'y', completed_at: null, skills_applied: 5, would_recommend: false, objectives_met: '' })
    expect(Object.keys(r).sort()).toEqual([...CHAMPS_EVALUATION.froid].sort())
    expect(r.skills_applied).toBe(5)
    expect(r.would_recommend).toBe(false)
    expect(r.objectives_met).toBeNull()
    expect(r.job_impact).toBeNull()
  })
})
