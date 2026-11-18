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


describe('affaires gagnées et perdues récentes (retour du 09/11)', () => {
  it('fermées depuis 90 jours au plus, la plus récente d\'abord, total des gagnées', async () => {
    const { fermeesRecentes, TONS_FERMEES } = await import('../src/modules/commercial/lib/affaires')
    const auj = new Date(2026, 10, 18, 18, 0)
    const r = fermeesRecentes([
      { id: 1, stage: 'gagnee', amount_ht: '208.00', closed_at: '2026-11-09 11:32:20+00' },
      { id: 2, stage: 'perdue', amount_ht: 500, closed_at: '2026-11-15T09:00:00Z' },
      { id: 3, stage: 'gagnee', amount_ht: 1000, closed_at: '2026-08-01T09:00:00Z' },
      { id: 4, stage: 'negociation', amount_ht: 50, closed_at: null },
      { id: 5, stage: 'gagnee', amount_ht: 10.5, closed_at: '2026-08-20T09:00:00Z' },
    ], 90, auj)
    expect(r.lignes.map((x) => x.id)).toEqual([2, 1, 5])
    expect(r.nbGagnees).toBe(2)
    expect(r.montantGagne).toBe(218.5)
    expect(TONS_FERMEES).toEqual({ gagnee: 'success', perdue: 'neutral' })
  })
})

describe('badge de relance des devis envoyés (retour du 09/11)', () => {
  it('relance datée dans le futur : neutre ; sinon jours depuis la date du devis', async () => {
    const { etatRelanceDevis } = await import('../src/modules/prospection/components/suivi/suiviUtils')
    const auj = '2026-11-18'
    expect(etatRelanceDevis({ status: 'sent', quote_date: '2026-10-19', next_followup_date: '2026-12-04' }, auj)).toEqual({ type: 'relance', date: '2026-12-04' })
    expect(etatRelanceDevis({ status: 'sent', quote_date: '2026-10-19', next_followup_date: '2026-11-18', updated_at: '2026-11-17T10:00:00Z' }, auj)).toEqual({ type: 'sans_reponse', jours: 30, ton: 'danger' })
    expect(etatRelanceDevis({ status: 'sent', quote_date: '2026-11-09' }, auj)).toEqual({ type: 'sans_reponse', jours: 9, ton: 'warning' })
    expect(etatRelanceDevis({ status: 'sent', quote_date: '2026-11-16' }, auj)).toBeNull()
    expect(etatRelanceDevis({ status: 'accepted', quote_date: '2026-10-01' }, auj)).toBeNull()
    expect(etatRelanceDevis({ status: 'sent', quote_date: '2026-10-01', followup_state: 'veille', veille_until: '2026-12-01' }, auj)).toBeNull()
  })
})
