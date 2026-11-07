import { describe, it, expect } from 'vitest'
import { finCycleFroid, statsEmployeurs, REGLAGES_FROID_DEFAUT } from '../src/modules/qualite/lib/froid.js'
import { RULES } from '../src/modules/certification/lib/proofs'

describe('fin du cycle d\'une évaluation à froid (Complétude)', () => {
  it('réglages par défaut : 60 jours, puis une relance 30 jours plus tard', () => {
    expect(finCycleFroid('2026-01-01', null, null)).toBe('2026-04-01')
  })
  it('délai de la formation prioritaire, relances réglées par la société', () => {
    // 20 + 15 + 2 × 45 = 125 jours
    expect(finCycleFroid('2026-01-01', { premier_envoi_jours: 90, relance_apres_jours: 15, entre_relances_jours: 45, relances_max: 3 }, 20)).toBe('2026-05-06')
    // aucune relance : premier envoi seul
    expect(finCycleFroid('2026-01-01', { ...REGLAGES_FROID_DEFAUT, relances_max: 0 }, null)).toBe('2026-03-02')
  })
  it('sans date de fin : rien', () => {
    expect(finCycleFroid(null, null, null)).toBeNull()
  })
})

describe('évaluations à froid des employeurs (Indicateurs)', () => {
  const envois = [
    { session_id: 's1', client_id: 'c1', cible: 'employeur', statut: 'envoye' },
    { session_id: 's1', client_id: 'c2', cible: 'employeur', statut: 'envoye' },
    { session_id: 's1', client_id: 'c3', cible: 'employeur', statut: 'prepare' },
    { session_id: 's2', client_id: 'c1', cible: 'employeur', statut: 'envoye' },
    { session_id: 's1', client_id: 'c1', cible: 'stagiaire', statut: 'envoye' },
  ]
  const reponses = [
    { session_id: 's1', client_id: 'c1', completed_at: '2026-10-01', reponses: { e_pratique: true, e_besoins: false, e_recommande: true } },
    { session_id: 's2', client_id: 'c1', completed_at: '2026-10-01', reponses: { e_pratique: false } },
  ]
  it('ne compte que les envois partis et les sessions retenues', () => {
    const r = statsEmployeurs(envois, reponses, ['s1'])
    expect(r.sollicites).toBe(2)
    expect(r.recues).toBe(1)
    expect(r.tauxRetour).toBe(50)
    expect(r.questions.find((q) => q.cle === 'e_besoins')).toMatchObject({ oui: 0, total: 1, taux: 0 })
  })
  it('aucune session : rien de compté', () => {
    expect(statsEmployeurs(envois, reponses, [])).toMatchObject({ sollicites: 0, recues: 0, tauxRetour: null })
  })
})

describe('indicateur 30', () => {
  const base = { n: { hotEvals: 1, coldEvals: 1, trainerEvals: 1, satisfactionSent: 1, opcoSessions: 0 } }
  it('évaluations à froid des employeurs citées en preuve quand il y en a', () => {
    expect(RULES[30]({ ...base, n: { ...base.n, coldEmployeurs: 2 } }).items.some((i) => i.ok && /employeur : 2/.test(i.label || i.text || JSON.stringify(i)))).toBe(true)
  })
  it('leur absence n\'ajoute pas de manque', () => {
    expect(RULES[30]({ ...base, n: { ...base.n, coldEmployeurs: 0 } }).items.every((i) => i.ok)).toBe(true)
  })
})
