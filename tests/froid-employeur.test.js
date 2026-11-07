import { describe, it, expect } from 'vitest'
import { finCycleFroid, statsEmployeurs, REGLAGES_FROID_DEFAUT } from '../src/modules/qualite/lib/froid.js'
import { RULES } from '../src/modules/certification/lib/proofs'

describe('fin du cycle d\'une évaluation à froid (Complétude)', () => {
  it('réglages par défaut : envoi à 60 jours, relance 30 jours plus tard, puis 30 jours pour répondre', () => {
    // 60 + 30 + 30 = 120 jours
    expect(finCycleFroid('2026-01-01', null, null)).toBe('2026-05-01')
  })
  it('délai de la formation prioritaire, relances réglées par la société', () => {
    // 20 + 15 + 2 × 45 + 15 = 140 jours
    expect(finCycleFroid('2026-01-01', { premier_envoi_jours: 90, relance_apres_jours: 15, entre_relances_jours: 45, relances_max: 3 }, 20)).toBe('2026-05-21')
    // aucune relance : premier envoi puis délai de réponse (60 + 30)
    expect(finCycleFroid('2026-01-01', { ...REGLAGES_FROID_DEFAUT, relances_max: 0 }, null)).toBe('2026-04-01')
  })
  it('un envoi parti plus tard décale le cycle ; un envoi à l\'heure ne le raccourcit pas', () => {
    // premier envoi validé le 1er avril (rang 0) : relance au 1er mai, réponse jusqu'au 31 mai
    expect(finCycleFroid('2026-01-01', null, null, '2026-04-01', 0)).toBe('2026-05-31')
    // relance partie le 15 mai (rang 1, la dernière) : 30 jours pour répondre
    expect(finCycleFroid('2026-01-01', null, null, '2026-05-15', 1)).toBe('2026-06-14')
    expect(finCycleFroid('2026-01-01', null, null, '2026-03-02', 0)).toBe('2026-05-01')
    // envoi à 0 h 30 à Paris le 2 avril (22 h 30 UTC le 1er) : compté le 2 avril
    expect(finCycleFroid('2026-01-01', null, null, '2026-04-01T22:30:00+00:00', 0)).toBe('2026-06-01')
    // trois relances : relance 2 partie le 1er juin, reste une relance (45) puis 15 jours pour répondre
    expect(finCycleFroid('2026-01-01', { premier_envoi_jours: 20, relance_apres_jours: 15, entre_relances_jours: 45, relances_max: 3 }, null, '2026-06-01', 2)).toBe('2026-07-31')
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
  it('filtre client : seules les réponses et envois de ce client', () => {
    const r = statsEmployeurs(envois, reponses, ['s1'], 'c2')
    expect(r).toMatchObject({ sollicites: 1, recues: 0, tauxRetour: 0 })
  })
  it('réponse reçue sans envoi retrouvé : comptée et sollicitée', () => {
    const r = statsEmployeurs([], [{ session_id: 's9', client_id: 'c9', completed_at: '2026-10-01', reponses: { e_recommande: true } }], ['s9'])
    expect(r).toMatchObject({ sollicites: 1, recues: 1, tauxRetour: 100 })
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
  it('leur absence n\'ajoute pas de manque ni de ligne', () => {
    const sans = RULES[30]({ ...base, n: { ...base.n, coldEmployeurs: 0 } }).items
    expect(sans.every((i) => i.ok)).toBe(true)
    expect(RULES[30]({ ...base, n: { ...base.n, coldEmployeurs: 2 } }).items.length).toBe(sans.length + 1)
  })
})
