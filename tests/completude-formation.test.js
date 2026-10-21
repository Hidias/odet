import { describe, it, expect } from 'vitest'
import { piecesManquantes, libellesManquants } from '../src/modules/formation/lib/completude'

describe('pièces manquantes d\'une formation', () => {
  const complete = { objectives: 'Savoir alerter', program: 'Module 1', theme_id: 't1' }
  it('rien ne manque quand tout est là', () => {
    expect(piecesManquantes(complete, { support_formateur: 1, document_stagiaire: 2 }, new Set(['t1']))).toEqual([])
  })
  it('signale chaque pièce absente', () => {
    expect(piecesManquantes({ objectives: ' ', content: '', theme_id: 't2' }, {}, new Set(['t1'])))
      .toEqual(['programme', 'support_formateur', 'document_stagiaire', 'positionnement'])
  })
  it('accepte le contenu dans « content » à la place de « program »', () => {
    expect(piecesManquantes({ objectives: 'x', content: 'y', theme_id: 't1' }, { support_formateur: 1, document_stagiaire: 1 }, new Set(['t1']))).toEqual([])
  })
  it('donne des libellés lisibles', () => {
    expect(libellesManquants(['support_formateur', 'document_stagiaire'])).toEqual(['support formateur', 'livret stagiaire'])
  })
})
