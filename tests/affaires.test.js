import { describe, it, expect } from 'vitest'
import { urgence, trierAFaire, colonnesPipeline, totauxPipeline, cadence, dansJours, ETAPES_DEPART, kEuros, etapesProposees, deplacementPossible, ligneAEtape } from '../src/modules/commercial/lib/affaires'

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

  it('totaux en K€ arrondis, jamais « 0 K€ » pour un petit montant', () => {
    expect(kEuros(0)).toBe('0 K€')
    expect(kEuros(null)).toBe('0 K€')
    expect(kEuros(320)).toBe('< 1 K€')
    expect(kEuros(499.99)).toBe('< 1 K€')
    expect(kEuros(500)).toBe('1 K€')
    expect(kEuros(12499)).toBe('12 K€')
    expect(kEuros(12500)).toBe('13 K€')
    expect(kEuros(1234567).replace(/\s/g, ' ')).toBe('1 235 K€')
  })

  it('changer d\'étape : autres étapes ouvertes dans l\'ordre, puis Gagnée et Perdue', () => {
    expect(etapesProposees(ETAPES_DEPART, 'rdv').map((e) => e.code)).toEqual(['a_qualifier', 'devis_envoye', 'negociation', 'gagnee', 'perdue'])
    const listes = [
      { code: 'negociation', label: 'Négo', position: 40 }, { code: 'a_qualifier', label: 'À qualifier', position: 10 },
      { code: 'rdv', label: 'RDV', position: 20, is_active: false }, { code: 'gagnee', label: 'Signée', position: 90, is_active: false },
    ]
    // Étape inactive écartée ; Gagnée toujours proposée (libellé de la société), Perdue reprise des étapes par défaut
    expect(etapesProposees(listes, 'a_qualifier')).toEqual([{ code: 'negociation', label: 'Négo' }, { code: 'gagnee', label: 'Signée' }, { code: 'perdue', label: 'Perdue' }])
  })

  it('K€ négatifs arrondis comme les positifs', () => {
    expect(kEuros(-1500)).toBe('-2 K€')
    expect(kEuros(-200)).toBe('> -1 K€')
  })

  it('Kanban : seule une affaire se déplace, vers une autre étape, avec le droit de modifier', () => {
    const a = { origine: 'affaire', stage: 'rdv' }
    expect(deplacementPossible(a, 'negociation')).toBe(true)
    expect(deplacementPossible(a, 'rdv')).toBe(false)
    expect(deplacementPossible(a, 'negociation', false)).toBe(false)
    expect(deplacementPossible({ origine: 'devis', stage: 'devis_envoye' }, 'negociation')).toBe(false)
    expect(deplacementPossible(null, 'rdv')).toBe(false)
  })

  it('Kanban : la carte déplacée prend la probabilité et le pondéré de sa nouvelle étape', () => {
    const l = ligneAEtape({ origine: 'affaire', stage: 'a_qualifier', amount_ht: 2480.5, probability: 10, montant_pondere: 248.05 }, 'negociation', ETAPES_DEPART)
    expect(l).toMatchObject({ stage: 'negociation', probability: 75, montant_pondere: 1860.38 })
  })
})

