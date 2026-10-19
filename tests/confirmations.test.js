import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// useConfirm répond « non » sans fournisseur : l'application doit monter ConfirmProvider une fois, à la racine.
describe('confirmations communes', () => {
  it('ConfirmProvider monté dans App', () => {
    const app = readFileSync(new URL('../src/app/App.jsx', import.meta.url), 'utf8')
    expect(app).toMatch(/<ConfirmProvider>/)
  })
  it('Factures : plus de confirm() natif pour supprimer un brouillon', () => {
    const src = readFileSync(new URL('../src/modules/commercial/pages/Invoices.jsx', import.meta.url), 'utf8')
    expect(src).not.toMatch(/confirm\('Supprimer \?'\)/)
  })
})
