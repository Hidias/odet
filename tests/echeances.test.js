// Dates d'échéance des factures (heure de Paris, voir vitest.config.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { calcDueDate, dueDateFromInvoiceDate } from '../src/modules/commercial/lib/echeances.js'

const aujourdhui = (iso) => vi.setSystemTime(new Date(`${iso}T10:00:00`))

describe('calcDueDate (à partir d\'aujourd\'hui)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('à réception : le jour même', () => { aujourdhui('2026-01-15'); expect(calcDueDate('À réception de facture')).toBe('2026-01-15') })
  it('à 30 jours', () => { aujourdhui('2026-01-15'); expect(calcDueDate('à 30 jours')).toBe('2026-02-14') })
  it('à 45 jours', () => { aujourdhui('2026-01-15'); expect(calcDueDate('à 45 jours')).toBe('2026-03-01') })
  it('à 60 jours', () => { aujourdhui('2026-01-15'); expect(calcDueDate('à 60 jours')).toBe('2026-03-16') })
  it('délai inconnu ou vide : 30 jours', () => { aujourdhui('2026-01-15'); expect(calcDueDate(undefined)).toBe('2026-02-14') })

  // Règle actuelle : date + délai, puis dernier jour de ce mois
  it('30 jours fin de mois', () => { aujourdhui('2026-01-15'); expect(calcDueDate('à 30 jours fin de mois')).toBe('2026-02-28') })
  it('30 jours fin de mois, année bissextile', () => { aujourdhui('2028-01-15'); expect(calcDueDate('à 30 jours fin de mois')).toBe('2028-02-29') })
  it('45 jours fin de mois depuis un 31', () => { aujourdhui('2026-01-31'); expect(calcDueDate('à 45 jours fin de mois')).toBe('2026-03-31') })
  it('60 jours fin de mois à cheval sur l\'année', () => { aujourdhui('2026-12-15'); expect(calcDueDate('à 60 jours fin de mois')).toBe('2027-02-28') })
})

describe('dueDateFromInvoiceDate (changement de délai dans le formulaire)', () => {
  it('à réception', () => expect(dueDateFromInvoiceDate('À réception de facture', '2026-03-10')).toBe('2026-03-10'))
  it('à 30 jours', () => expect(dueDateFromInvoiceDate('à 30 jours', '2026-03-10')).toBe('2026-04-09'))
  it('à 45 jours fin de mois', () => expect(dueDateFromInvoiceDate('à 45 jours fin de mois', '2026-03-10')).toBe('2026-04-30'))
  it('à 60 jours fin de mois', () => expect(dueDateFromInvoiceDate('à 60 jours fin de mois', '2026-10-31')).toBe('2026-12-31'))
  it('30 jours fin de mois depuis un 31 janvier', () => expect(dueDateFromInvoiceDate('à 30 jours fin de mois', '2026-01-31')).toBe('2026-03-31'))

  it('même résultat que calcDueDate pour tous les délais proposés', () => {
    vi.useFakeTimers(); aujourdhui('2026-05-20')
    for (const t of ['À réception de facture', 'à 30 jours', 'à 30 jours fin de mois', 'à 45 jours', 'à 45 jours fin de mois', 'à 60 jours', 'à 60 jours fin de mois']) {
      expect(dueDateFromInvoiceDate(t, '2026-05-20')).toBe(calcDueDate(t))
    }
    vi.useRealTimers()
  })
})
