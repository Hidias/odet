import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/core/supabase', () => ({ supabase: {} }))
const { questionsDepuisTexte, questionsVersTexte, motifQuestions } = await import('../src/modules/formation/components/ModulesEnLigne')
const { videoIntegrable, resumeModules } = await import('../src/modules/portail/components/ModulesFormation')

describe('Formation mixte', () => {
  it('questions saisies en texte, aller-retour', () => {
    const t = 'Un feu de papier est de classe…\n* A\n- B\n- C\n\n2. Feu d\'huile ?\n- B\n* F'
    const q = questionsDepuisTexte(t)
    expect(q).toEqual([{ q: 'Un feu de papier est de classe…', choix: ['A', 'B', 'C'], bonne: 0 }, { q: 'Feu d\'huile ?', choix: ['B', 'F'], bonne: 1 }])
    expect(questionsDepuisTexte(questionsVersTexte(q))).toEqual(q)
    expect(motifQuestions(q)).toBeNull()
    expect(motifQuestions(questionsDepuisTexte('Sans bonne réponse ?\n- A\n- B'))).toMatch(/étoile/)
  })
  it('vidéos intégrables (YouTube sans cookie, Vimeo), autres en lien', () => {
    expect(videoIntegrable('https://www.youtube.com/watch?v=abcDEF12345')).toBe('https://www.youtube-nocookie.com/embed/abcDEF12345')
    expect(videoIntegrable('https://youtu.be/abcDEF12345')).toBe('https://www.youtube-nocookie.com/embed/abcDEF12345')
    expect(videoIntegrable('https://vimeo.com/123456')).toBe('https://player.vimeo.com/video/123456')
    expect(videoIntegrable('https://exemple.fr/video.mp4')).toBeNull()
  })
  it('résumé : modules obligatoires validés, temps passé', () => {
    expect(resumeModules([{ required: true, suivi: { completed_at: 'x', seconds: 600 } }, { required: true, suivi: null }, { required: false, suivi: { seconds: 120 } }]))
      .toEqual({ total: 2, faits: 1, minutes: 12 })
  })
})
