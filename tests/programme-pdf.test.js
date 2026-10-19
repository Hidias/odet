import { describe, it, expect } from 'vitest'
import { lireContenu, effectifTexte, heuresTexte, referenceProgramme, programmeModifie, versionSuivante, buildProgrammePDF } from '../src/modules/formation/pdf/programmePDF'

describe('programme de formation', () => {
  it('lit intertitres, puces et sous-puces', () => {
    expect(lireContenu('Partie théorique\n- Le feu\n-- Le triangle du feu\n  - La combustion')).toEqual([
      { niveau: 0, texte: 'Partie théorique' },
      { niveau: 1, texte: 'Le feu' },
      { niveau: 2, texte: 'Le triangle du feu' },
      { niveau: 2, texte: 'La combustion' },
    ])
  })
  it('écrit effectif, durée et référence', () => {
    expect(effectifTexte({ min_participants: 1, max_participants: 10 })).toBe('De 1 à 10 personnes')
    expect(effectifTexte({ max_participants: 12 })).toBe('12 personnes maximum')
    expect(effectifTexte({})).toBe('')
    expect(heuresTexte({ duration_hours: 2 })).toBe('2 heures')
    expect(heuresTexte({ duration_hours: 14, duration_days: 2 })).toBe('14 heures (2 jours)')
    expect(referenceProgramme({ code: 'INC-EXT' })).toBe('PROG-INC-EXT')
    expect(referenceProgramme({ code: 'INC-EXT', program_ref: 'PROG-EXT' })).toBe('PROG-EXT')
  })
  it('détecte une modification du programme et numérote les versions', () => {
    expect(programmeModifie(null, { title: 'A' })).toBe(true)
    expect(programmeModifie({ title: 'A', price_ht: 10 }, { title: 'A', price_ht: 20 })).toBe(false)
    expect(programmeModifie({ title: 'A', objectives: 'x' }, { title: 'A', objectives: 'y' })).toBe(true)
    expect(programmeModifie({ max_participants: 10 }, { max_participants: '10' })).toBe(false)
    expect(versionSuivante(null)).toBe('1.0')
    expect(versionSuivante('1.0')).toBe('1.1')
    expect(versionSuivante('1.9')).toBe('1.10')
  })
  it('tient sur une page avec un contenu ordinaire', () => {
    const doc = buildProgrammePDF({ title: 'Essai', duration_hours: 2, objectives: 'Un\nDeux', program: 'Partie\n- a\n- b' }, { name: 'Organisme' })
    expect(doc.getNumberOfPages()).toBe(1)
  })
})

import { buildCataloguePDF } from '../src/modules/formation/pdf/programmePDF'
import { PICTOGRAMMES, pictogrammePNG } from '../src/modules/formation/pdf/pictogrammes'

describe('catalogue et pictogrammes', () => {
  it('page de garde puis un programme par formation', () => {
    const doc = buildCataloguePDF([{ title: 'B', duration_hours: 7 }, { title: 'A', duration_hours: 2 }], { name: 'Organisme' })
    expect(doc.getNumberOfPages()).toBe(3)
  })
  it('liste fermée de pictogrammes, sans rendu hors navigateur', () => {
    expect(Object.keys(PICTOGRAMMES)).toEqual(['flamme', 'secours', 'coeur', 'electricite', 'posture', 'conduite', 'document', 'bouclier', 'alarme', 'chantier'])
    expect(pictogrammePNG('flamme')).toBeNull()
    expect(pictogrammePNG('inconnu')).toBeNull()
  })
})
