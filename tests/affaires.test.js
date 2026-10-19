import { describe, it, expect } from 'vitest'
import { urgence, trierAFaire, colonnesPipeline, totauxPipeline, cadence, dansJours, ETAPES_DEPART } from '../src/modules/commercial/lib/affaires'

const base = new Date(2026, 9, 19, 15, 0)

describe('suivi des affaires (0380)', () => {
  it('urgence de la prochaine action', () => {
    expect(urgence('2026-10-18', base)).toBe('retard')
    expect(urgence('2026-10-19', base)).toBe('aujourdhui')
    expect(urgence('2026-10-26', base)).toBe('semaine')
    expect(urgence('2026-10-27', base)).toBe('plus_tard')
    expect(urgence(null, base)).toBe('plus_tard')
  })

  it('liste à faire : la plus ancienne action d\'abord', () => {
    const l = trierAFaire([{ id: 1, next_action_on: '2026-10-20' }, { id: 2, next_action_on: '2026-10-01' }, { id: 3, next_action_on: null }])
    expect(l.map((x) => x.id)).toEqual([2, 1, 3])
  })

  it('pipeline : étapes ouvertes seulement, totaux par colonne et pondérés', () => {
    const lignes = [
      { stage: 'a_qualifier', amount_ht: 1000, montant_pondere: 100 },
      { stage: 'devis_envoye', amount_ht: 800, montant_pondere: 400 },
      { stage: 'devis_envoye', amount_ht: 200.4, montant_pondere: 100.2 },
      { stage: 'gagnee', amount_ht: 5000, montant_pondere: 5000 },
    ]
    const cols = colonnesPipeline(lignes, ETAPES_DEPART)
    expect(cols.map((c) => c.code)).toEqual(['a_qualifier', 'rdv', 'devis_envoye', 'negociation'])
    expect(cols[2].lignes).toHaveLength(2)
    expect(cols[2].montant).toBe(1000.4)
    expect(cols[2].pondere).toBe(500.2)
    expect(totauxPipeline(lignes.slice(0, 3))).toEqual({ nb: 3, montant: 2000.4, pondere: 600.2 })
  })

  it('cadence : objectif personnel avant celui de l\'équipe', () => {
    const reel = [{ profile_id: 'a', kind: 'appel', realise: 12 }, { profile_id: 'b', kind: 'appel', realise: 4 }, { profile_id: 'a', kind: 'rdv', realise: 1 }]
    const obj = [{ profile_id: null, kind: 'appel', per_week: 15 }, { profile_id: 'a', kind: 'rdv', per_week: 1 }]
    const c = cadence(reel, obj, 'a')
    expect(c.appel).toEqual({ reel: 12, objectif: 15, atteint: false })
    expect(c.rdv).toEqual({ reel: 1, objectif: 1, atteint: true })
    expect(c.email.objectif).toBeNull()
  })

  it('date à n jours', () => {
    expect(dansJours(2, base)).toBe('2026-10-21')
    expect(dansJours(13, base)).toBe('2026-11-01')
  })
})
