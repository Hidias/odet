import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/core/supabase', () => ({ supabase: {} }))
vi.mock('../src/app/PublicLayout', () => ({ default: () => null }))
const { filtrerSessions, placesTexte, heure } = await import('../src/modules/portail/pages/CalendrierPublic')
import vercel from '../vercel.json'

const sessions = [
  { id: 1, course_id: 'sst', city: 'Brest', start_date: '2026-11-03' },
  { id: 2, course_id: 'sst', city: 'Quimper', start_date: '2026-12-01' },
  { id: 3, course_id: 'epi', city: 'brest', start_date: '2026-11-20' },
]

describe('calendrier public (0419)', () => {
  it('filtres formation, ville (sans casse) et mois', () => {
    expect(filtrerSessions(sessions, { formation: 'sst' }).map((s) => s.id)).toEqual([1, 2])
    expect(filtrerSessions(sessions, { ville: 'Brest' }).map((s) => s.id)).toEqual([1, 3])
    expect(filtrerSessions(sessions, { mois: '2026-11', formation: 'epi' }).map((s) => s.id)).toEqual([3])
  })
  it('heures lisibles', () => {
    expect(heure('09:00:00')).toBe('9 h')
    expect(heure('16:30:00')).toBe('16 h 30')
  })
  it('places restantes', () => {
    expect(placesTexte(0)).toBe('Complet')
    expect(placesTexte(1)).toBe('1 place restante')
    expect(placesTexte(5)).toBe('5 places restantes')
    expect(placesTexte(null)).toBe('Places disponibles')
  })
  it('intégration dans un autre site autorisée pour /integration/ seulement', () => {
    const regles = vercel.headers
    const general = regles.find((r) => r.headers.some((h) => h.key === 'X-Frame-Options'))
    expect(general.source).toBe('/((?!integration/).*)')
    const integ = regles.find((r) => r.source === '/integration/(.*)')
    expect(integ.headers.find((h) => h.key === 'Content-Security-Policy').value).toBe('frame-ancestors *')
    expect(integ.headers.some((h) => h.key === 'X-Frame-Options')).toBe(false)
  })
})
