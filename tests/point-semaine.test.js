import { describe, it, expect } from 'vitest'
import { lundi, decaler, parSection, visibles, emailPoint, objetEmail } from '../src/core/point/pointSemaine.js'
import { dateReport, groupeEcheance } from '../src/core/point/actions.js'

describe('point de la semaine', () => {
  it('trouve le lundi et décale les semaines', () => {
    expect(lundi('2026-10-21')).toBe('2026-10-19')
    expect(lundi('2026-10-19')).toBe('2026-10-19')
    expect(lundi('2026-10-25')).toBe('2026-10-19')
    expect(decaler('2026-10-19', 7)).toBe('2026-10-26')
  })
  it('range les lignes gardées par section et cache une action déjà rattachée', () => {
    const lignes = [
      { id: 'inv:1', section: 'urgent', texte: 'Facture', action_id: 'a1' },
      { id: 'act:a1', section: 'semaine', texte: 'Même action', action_id: 'a1' },
      { id: 'act:a2', section: 'semaine', texte: 'Autre action', action_id: 'a2' },
      { id: 'quo:1', section: 'relancer', texte: 'Devis', retire: true },
      { id: 'anniv:1', section: 'anniversaire', texte: 'Client depuis 1 an' },
    ]
    expect(visibles(lignes).map((l) => l.id)).toEqual(['inv:1', 'act:a2', 'anniv:1'])
    expect(parSection(lignes, 'point').map((s) => s.id)).toEqual(['urgent', 'semaine', 'anniversaire'])
    expect(parSection(lignes, 'bilan').map((s) => s.id)).toEqual(['urgent', 'semaine'])
  })
  it('compose un email sans balise injectée, avec la suite au bilan', () => {
    const html = emailPoint({ kind: 'bilan', week_start: '2026-10-19', note: '<b>Merci</b>',
      lines: [{ id: 'm:1', section: 'divers', texte: 'Salon <script>', suite: 'reporte', owner_nom: 'Anthony' }] }, { appUrl: 'https://x.fr' })
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;b&gt;Merci')
    expect(html).toContain('reporté')
    expect(html).toContain('(Anthony)')
    expect(objetEmail({ kind: 'point', week_start: '2026-10-19' }, 'GLD')).toBe('Point de la semaine du 19/10 : GLD')
  })
})

describe('actions', () => {
  it('reporte d\'une semaine et range par échéance', () => {
    expect(dateReport('2099-01-05')).toBe('2099-01-12')
    expect(groupeEcheance({ status: 'a_faire', due_on: '2026-10-20' }, '2026-10-21')).toBe('retard')
    expect(groupeEcheance({ status: 'a_faire', due_on: '2026-10-25' }, '2026-10-21')).toBe('semaine')
    expect(groupeEcheance({ status: 'a_faire', due_on: '2026-10-26' }, '2026-10-21')).toBe('plus_tard')
    expect(groupeEcheance({ status: 'a_faire', due_on: null }, '2026-10-21')).toBe('sans')
    expect(groupeEcheance({ status: 'fait', due_on: null }, '2026-10-21')).toBe('terminees')
  })
})
