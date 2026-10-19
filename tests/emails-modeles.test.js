import { describe, it, expect } from 'vitest'
import { modeleEnvoiDevis, modeleRelanceDevis } from '../src/core/emails/modeles'

const quote = { reference: 'DEV-20261019-00001', object: 'Vérification des extincteurs', total_ht: 480, quote_date: '2026-10-01', validity_date: '2026-11-30' }

describe('modèles d’emails prêts, sans IA', () => {
  it('envoi de devis de maintenance : ni programme ni formation', () => {
    const m = modeleEnvoiDevis({ quote, contactName: 'M. Martin', org: 'GLD' })
    expect(m.subject).toContain('DEV-20261019-00001')
    expect(m.body).toContain('Bonjour M. Martin,')
    expect(m.body).toContain('30/11/2026')
    expect(m.body).not.toMatch(/la formation|programme/i)
  })
  it('envoi de devis de formation avec programme', () => {
    const m = modeleEnvoiDevis({ quote, org: 'GLD', programmes: ['SST'], formation: true })
    expect(m.body).toContain('le programme de la formation (SST)')
  })
  it('trois niveaux de relance', () => {
    expect(modeleRelanceDevis({ quote, org: 'GLD', numero: 1 }).subject.startsWith('Devis')).toBe(true)
    expect(modeleRelanceDevis({ quote, org: 'GLD', numero: 2 }).subject.startsWith('Relance')).toBe(true)
    expect(modeleRelanceDevis({ quote, org: 'GLD', numero: 3 }).body).toContain('dernière relance')
  })
})
