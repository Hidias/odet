import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/core/supabase', () => ({ supabase: {} }))
const { siretValide, messageErreur } = await import('../src/modules/portail/components/InscriptionEnLigne')

describe('inscription en ligne : SIRET', () => {
  it('accepte un champ vide ou 14 chiffres, espaces ignorés', () => {
    expect(siretValide('')).toBe(true)
    expect(siretValide('   ')).toBe(true)
    expect(siretValide('123 456 789 01234')).toBe(true)
  })
  it('refuse 13 chiffres ou des lettres', () => {
    expect(siretValide('1234567890123')).toBe(false)
    expect(siretValide('12345678901234A')).toBe(false)
  })
})

describe('inscription en ligne : message montré au visiteur', () => {
  it('garde le message rédigé par la base', () => {
    expect(messageErreur({ code: '22023', message: 'Le SIRET compte 14 chiffres' })).toBe('Le SIRET compte 14 chiffres')
  })
  it('ne montre jamais une contrainte technique', () => {
    const m = messageErreur({ code: '23514', message: 'new row for relation "online_registrations" violates check constraint "x"' })
    expect(m).toMatch(/vérifiez les champs/)
    expect(messageErreur({ message: 'violates check constraint' })).not.toMatch(/violates/)
    expect(messageErreur(null)).toMatch(/Inscription impossible/)
  })
})
