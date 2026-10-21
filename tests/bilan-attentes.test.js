import { describe, it, expect } from 'vitest'
import { lignesBilan, resumeBilan } from '../src/modules/formation/components/BilanAttentes'

describe('bilan des attentes (0413)', () => {
  const inscrits = [
    { id: 'a', trainee_id: 't1', trainees: { first_name: 'Paul', last_name: 'Martin' } },
    { id: 'b', trainee_id: 't2', trainees: { first_name: 'Claire', last_name: 'Durand' } },
    { id: 'c', trainee_id: 't3', trainees: { first_name: 'Luc', last_name: 'Bernard' } },
  ]
  const fiches = [
    { trainee_id: 't1', training_expectations: 'Savoir réagir' },
    { trainee_id: 't2', training_expectations: '  Utiliser le défibrillateur ' },
    { trainee_id: 't3', training_expectations: '   ' },
  ]
  const avis = [{ trainee_id: 't1', attentes_satisfaites: 'oui' }, { trainee_id: 't2', attentes_satisfaites: 'non', attentes_commentaire: 'Trop court' }]

  it('seulement les stagiaires qui ont écrit une attente, par nom', () => {
    const l = lignesBilan(inscrits, fiches, avis)
    expect(l.map((x) => x.id)).toEqual(['b', 'a'])
    expect(l[0].attente).toBe('Utiliser le défibrillateur')
    expect(l[0].avisCommentaire).toBe('Trop court')
  })

  it('résumé selon les avis reçus', () => {
    expect(resumeBilan(lignesBilan(inscrits, fiches, avis))).toEqual({ total: 2, avis: 2, satisfaites: 1, enPartie: 0, non: 1 })
    expect(resumeBilan(lignesBilan(inscrits, fiches, []))).toEqual({ total: 2, avis: 0, satisfaites: 0, enPartie: 0, non: 0 })
  })
})
