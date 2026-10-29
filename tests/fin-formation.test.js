import { describe, it, expect } from 'vitest'
import { listeObjectifs, objectifsResultats, avecObjectifs, blocageFinFormation, nonEvalues, memesObjectifs, libelleAcquis } from '../src/modules/formation/lib/finFormation'
import { contenuDocument, memeContenu, appliquerEmis, seulementEmis } from '../src/modules/formation/lib/documentsEmis'

const course = { objectives: '- Alerter les secours\n\n• Protéger la victime\nExaminer', duration_hours: 7, duration_days: 1 }
const lignes = [
  { trainee_id: 't1', objective_index: 0, validated: true },
  { trainee_id: 't1', objective_index: 1, validated: false },
  { trainee_id: 't2', objective_index: 0, validated: true },
]

describe('attestation de fin de formation : objectifs', () => {
  it('mêmes index que l\'onglet Suivi, puces retirées à l\'affichage', () => {
    expect(listeObjectifs(course)).toEqual(['- Alerter les secours', '• Protéger la victime', 'Examiner'])
    expect(objectifsResultats(course, lignes, 't1')).toEqual([
      { texte: 'Alerter les secours', acquis: true },
      { texte: 'Protéger la victime', acquis: false },
      { texte: 'Examiner', acquis: null },
    ])
  })
  it('jamais « acquis » par défaut : un objectif sans ligne reste non évalué', () => {
    const [t] = avecObjectifs([{ id: 't3', result: 'acquired' }], course, lignes)
    expect(nonEvalues(t)).toBe(3)
    expect(libelleAcquis(null)).toBe('Non évalué')
  })
  it('blocages : absent, sans résultat, formation sans objectifs', () => {
    const [t] = avecObjectifs([{ id: 't1', result: 'acquired' }], course, lignes)
    expect(blocageFinFormation(t)).toBeNull()
    expect(blocageFinFormation(t, { absent: true })).toMatch(/absent/)
    expect(blocageFinFormation({ ...t, result: null })).toMatch(/résultat/)
    expect(blocageFinFormation({ ...t, result: 'in_progress' })).toMatch(/résultat/)
    const [vide] = avecObjectifs([{ id: 't1', result: 'acquired' }], { objectives: '' }, lignes)
    expect(blocageFinFormation(vide)).toMatch(/objectifs/)
  })
  it('un changement d\'objectif fait une nouvelle version', () => {
    const a = [{ texte: 'A', acquis: true }]
    expect(memesObjectifs(a, [{ texte: 'A', acquis: true }])).toBe(true)
    expect(memesObjectifs(a, [{ texte: 'A', acquis: false }])).toBe(false)
    expect(memesObjectifs(a, [{ texte: 'B', acquis: true }])).toBe(false)
    expect(memesObjectifs(null, null)).toBe(true)
  })
})

describe('attestation de fin de formation : document figé', () => {
  const session = { start_date: '2026-10-20', end_date: '2026-10-20', start_time: '09:00', end_time: '17:00', courses: course, session_trainees: [{ trainee_id: 't1' }] }
  it('le contenu figé porte résultat et objectifs', () => {
    const [t] = avecObjectifs([{ id: 't1', result: 'not_acquired' }], course, lignes)
    const c = contenuDocument(session, 'fin_formation', t)
    expect(c.result).toBe('not_acquired')
    expect(c.objectives).toHaveLength(3)
    expect(memeContenu(c, { ...c, objectives: [...c.objectives] })).toBe(true)
    expect(memeContenu(c, { ...c, objectives: c.objectives.map((o) => ({ ...o, acquis: true })) })).toBe(false)
  })
  it('portails : seulement la version émise, objectifs compris', () => {
    const emis = [{ session_id: 's', trainee_id: 't1', kind: 'fin_formation', version: 1, issued_on: '2026-10-20', hours: '7', result: 'acquired', absences: [], objectives: [{ texte: 'A', acquis: true }] }]
    const liste = seulementEmis(appliquerEmis(emis, 's', 'fin_formation', [{ id: 't1', result: null }, { id: 't2', result: 'acquired' }]))
    expect(liste).toHaveLength(1)
    expect(liste[0].result).toBe('acquired')
    expect(liste[0].objectifs_resultats).toEqual([{ texte: 'A', acquis: true }])
    expect(liste[0].heures_realisees).toBe(7)
  })
})
