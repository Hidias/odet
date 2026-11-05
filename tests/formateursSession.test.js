import { describe, it, expect } from 'vitest'
import { formateursVoulus, autresFormateursIds, separerFormateurs, formateursAEnvoyer } from '../src/core/session/formateursSession'

describe('formateurs d\'une session (C6)', () => {
  it('met le principal en premier, sans doublon ni vide', () => {
    expect(formateursVoulus('a', ['b', 'a', '', null, 'c', 'b'])).toEqual(['a', 'b', 'c'])
  })
  it('accepte une session sans principal', () => {
    expect(formateursVoulus('', ['b'])).toEqual(['b'])
    expect(formateursVoulus(null, [])).toEqual([])
  })
  it('retire le principal des autres formateurs', () => {
    expect(autresFormateursIds([{ trainer_id: 'a' }, { trainer_id: 'b' }, { trainer_id: 'b' }], 'a')).toEqual(['b'])
    expect(autresFormateursIds(null, 'a')).toEqual([])
  })
  it('sépare la liste d\'un formulaire', () => {
    expect(separerFormateurs(['a', 'b', 'c'])).toEqual({ principalId: 'a', autresIds: ['b', 'c'] })
    expect(separerFormateurs([])).toEqual({ principalId: null, autresIds: [] })
  })

  describe('formateursAEnvoyer (fiche session)', () => {
    const init = { principalInitial: 'A', autresInitiaux: ['B'] }
    it('rien à envoyer quand un formateur change seulement l\'horaire', () => {
      expect(formateursAEnvoyer({ principalId: 'A', autresIds: ['B'] }, init)).toEqual({ trainerIds: undefined })
    })
    it('ordre des cases sans effet', () => {
      expect(formateursAEnvoyer({ principalId: 'A', autresIds: ['C', 'B'] }, { principalInitial: 'A', autresInitiaux: ['B', 'C'] })).toEqual({ trainerIds: undefined })
    })
    it('principal changé : nouvelle liste complète', () => {
      expect(formateursAEnvoyer({ principalId: 'B', autresIds: [] }, init)).toEqual({ trainerIds: ['B'] })
    })
    it('autre formateur décoché', () => {
      expect(formateursAEnvoyer({ principalId: 'A', autresIds: [] }, init)).toEqual({ trainerIds: ['A'] })
    })
    it('principal vidé : plus aucun formateur', () => {
      expect(formateursAEnvoyer({ principalId: '', autresIds: ['B'] }, init)).toEqual({ trainerIds: [] })
    })
    it('sous-traitance : principal seul, les autres retirés', () => {
      expect(formateursAEnvoyer({ principalId: 'A', autresIds: ['B'], sousTraitance: true }, init)).toEqual({ trainerIds: ['A'] })
      expect(formateursAEnvoyer({ principalId: 'A', autresIds: null, sousTraitance: true }, { principalInitial: 'A', autresInitiaux: [] })).toEqual({ trainerIds: undefined })
    })
    it('liste inconnue côté session : rien sans changement, refus sinon', () => {
      const inconnu = { principalInitial: 'A', autresInitiaux: null }
      expect(formateursAEnvoyer({ principalId: 'A', autresIds: null }, inconnu)).toEqual({ trainerIds: undefined })
      expect(formateursAEnvoyer({ principalId: 'C', autresIds: null }, inconnu).erreur).toMatch(/rechargez la page/)
      expect(formateursAEnvoyer({ principalId: 'A', autresIds: ['B'] }, inconnu).erreur).toMatch(/rechargez la page/)
    })
    it('liste inconnue côté formulaire et connue côté session : rien n\'est retiré', () => {
      expect(formateursAEnvoyer({ principalId: 'A', autresIds: null }, init)).toEqual({ trainerIds: undefined })
      expect(formateursAEnvoyer({ principalId: 'C', autresIds: null }, init).erreur).toMatch(/rechargez la page/)
    })
  })
})
