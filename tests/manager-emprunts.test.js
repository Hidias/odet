import { describe, it, expect, vi } from 'vitest'
import * as XLSX from 'xlsx-js-style'

vi.mock('../src/core/supabase', () => ({ supabase: {} }))
const { lireTableauBanque, courbeRestant, nombre } = await import('../src/modules/manager/lib/empruntsData.js')

function fichier(rangs) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rangs), 'Tableau')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return { arrayBuffer: async () => buf }
}

describe('Emprunts : lecture du tableau de la banque', () => {
  it('reconnaît les colonnes françaises et lit les montants', async () => {
    const f = fichier([
      ['Banque Essai', '', '', '', '', ''],
      ['Date d\'échéance', 'Montant échéance', 'Intérêts', 'Capital amorti', 'Assurance', 'Capital restant dû'],
      ['05/01/2026', '1 020,50', '36,00', '984,50', '0', '11 015,50'],
      ['05/02/2026', '1 020,50', '33,05', '987,45', '0', '10 028,05'],
      ['Total', '', '', '', '', ''],
    ])
    const { lignes, alertes } = await lireTableauBanque(f)
    expect(lignes).toHaveLength(2)
    expect(lignes[0]).toMatchObject({ number: 1, due_on: '2026-01-05', payment: 1020.5, interest: 36, principal: 984.5, remaining: 11015.5 })
    expect(lignes[1].due_on).toBe('2026-02-05')
    expect(alertes).toHaveLength(0)
  })
  it('refuse un fichier sans colonnes reconnues', async () => {
    await expect(lireTableauBanque(fichier([['a', 'b'], [1, 2]]))).rejects.toThrow(/Colonnes introuvables/)
  })
  it('nombre() lit les formats français', () => {
    expect(nombre('1 234,56 €')).toBe(1234.56)
    expect(nombre('')).toBeNull()
  })
})

describe('Emprunts : courbe du capital restant dû', () => {
  it('additionne les prêts et descend jusqu\'à zéro', () => {
    const auj = new Date()
    const iso = (m) => new Date(auj.getFullYear(), auj.getMonth() + m, 5).toISOString().slice(0, 10)
    const emprunts = [{ id: 'a', principal: 2000 }]
    const echeances = [{ loan_id: 'a', due_on: iso(0), remaining: 1000 }, { loan_id: 'a', due_on: iso(1), remaining: 0 }]
    const pts = courbeRestant(emprunts, echeances, 12)
    expect(pts[0].restant).toBe(1000)
    expect(pts[pts.length - 1].restant).toBe(0)
  })
})
