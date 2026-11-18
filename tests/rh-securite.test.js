import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  erreurTravailIsole, resumeTravailIsole, pointsProposes, POINTS_ACCUEIL, POINT_ISOLE, erreurAccueil,
  etatAffichage, bilanAffichages, erreurAffichage, AFFICHAGES,
} from '../src/modules/rh/lib/rhSecurite'

describe('Documents obligatoires du personnel (0522)', () => {
  it('travail isolé : « autre » exige une précision, mesure inconnue refusée', () => {
    expect(erreurTravailIsole({ lone_work: false, lone_work_measures: ['inconnue'] })).toBeNull()
    expect(erreurTravailIsole({ lone_work: true, lone_work_measures: [] })).toBeNull()
    expect(erreurTravailIsole({ lone_work: true, lone_work_measures: ['autre'], lone_work_note: ' ' })).toMatch(/Précisez/)
    expect(erreurTravailIsole({ lone_work: true, lone_work_measures: ['autre'], lone_work_note: 'Binôme' })).toBeNull()
    expect(erreurTravailIsole({ lone_work: true, lone_work_measures: ['x'] })).toBe('Mesure inconnue')
  })
  it('résumé du poste', () => {
    expect(resumeTravailIsole({ lone_work: false })).toBe('Ne travaille pas seul')
    expect(resumeTravailIsole({ lone_work: true, lone_work_measures: [] })).toMatch(/aucune mesure/)
    expect(resumeTravailIsole({ lone_work: true, lone_work_measures: ['dati', 'autre'], lone_work_note: 'Binôme' })).toBe('Peut travailler seul : DATI remis, Binôme')
  })
  it('points de l\'accueil : les trois domaines de R4141-3, et le travail isolé si le poste est seul', () => {
    expect(POINTS_ACCUEIL.slice(0, 3).map((p) => p.match(/R4141-3, (\d)°/)?.[1])).toEqual(['1', '2', '3'])
    expect(pointsProposes({ lone_work: false }).map((t) => t.label)).not.toContain(POINT_ISOLE)
    expect(pointsProposes({ lone_work: true }).map((t) => t.label)).toContain(POINT_ISOLE)
    expect(pointsProposes(null).every((t) => t.done === false)).toBe(true)
  })
  it('accueil : date, motif, un point coché et la signature exigés', () => {
    const ok = { done_on: '2026-11-18', reason: 'embauche', topics: [{ label: 'a', done: true }], signature: 'data:image/png;base64,AA' }
    expect(erreurAccueil(ok)).toBeNull()
    expect(erreurAccueil({ ...ok, signature: null })).toMatch(/signer/)
    expect(erreurAccueil({ ...ok, topics: [{ label: 'a', done: false }] })).toMatch(/au moins un point/)
    expect(erreurAccueil({ ...ok, reason: 'x' })).toBe('Motif manquant')
    expect(erreurAccueil({ ...ok, done_on: '2999-01-01' })).toMatch(/futur/)
  })
  it('affichages : états et bilan', () => {
    expect(etatAffichage(null, '2026-11-18')).toBe('a_faire')
    expect(etatAffichage({ status: 'sans_objet' }, '2026-11-18')).toBe('sans_objet')
    expect(etatAffichage({ status: 'fait', done_on: '2026-01-10' }, '2026-11-18')).toBe('fait')
    expect(etatAffichage({ status: 'fait', done_on: '2025-11-17' }, '2026-11-18')).toBe('a_verifier')
    expect(etatAffichage({ status: 'fait', done_on: '2025-01-01', checked_on: '2026-02-01' }, '2026-11-18')).toBe('fait')
    const items = [{ code: 'a' }, { code: 'b' }, { code: 'c' }]
    expect(bilanAffichages(items, [{ item_code: 'a', status: 'fait', done_on: '2026-11-01' }, { item_code: 'b', status: 'sans_objet' }], '2026-11-18'))
      .toEqual({ a_faire: 1, a_verifier: 0, fait: 1, sans_objet: 1 })
  })
  it('affichages : saisie contrôlée', () => {
    expect(erreurAffichage({ status: 'sans_objet', note: '' })).toMatch(/pourquoi/)
    expect(erreurAffichage({ status: 'sans_objet', note: 'Aucun intérimaire' })).toBeNull()
    expect(erreurAffichage({ status: 'fait' })).toMatch(/manquante/)
    expect(erreurAffichage({ status: 'fait', done_on: '2026-11-10', checked_on: '2026-11-01' })).toMatch(/précéder/)
    expect(erreurAffichage({ status: 'fait', done_on: '2026-11-10' })).toBeNull()
  })
  it('référentiel : 21 lignes, mêmes codes que la base (0522)', () => {
    expect(AFFICHAGES).toHaveLength(21)
    const sql = readFileSync(new URL('../supabase/migrations/0522_rh_documents_obligatoires.sql', import.meta.url), 'utf8')
    const codes = [...sql.match(/item_code in \(([^)]*)\)/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect(codes).toEqual(AFFICHAGES.map((a) => a.code))
    expect(AFFICHAGES.find((a) => a.code === 'egalite_remuneration').reference).toBe('Code du travail, L3221-1 à L3221-7')
    expect(AFFICHAGES.every((a) => ['affichage', 'tout_moyen'].includes(a.mode))).toBe(true)
  })
})
