import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Lien direct vers un document qualité (?doc=...) : le document ne s'ouvre qu'une fois les documents
// enregistrés chargés. Avant le correctif, il s'ouvrait depuis le modèle et s'affichait « Brouillon,
// version en vigueur : aucune » alors qu'une version validée existait (relevé le 21/11/2026).
const src = readFileSync(new URL('../src/modules/qualite/pages/QualiteEditables.jsx', import.meta.url), 'utf8')

describe('documents qualité, lien direct', () => {
  it("attend les documents enregistrés avant d'ouvrir le lien", () => {
    expect(src).toMatch(/templates\?\.\[id\] && savedLoaded\) setRichOpen\(id\)/)
    expect(src).toMatch(/\}, \[templates, params, savedLoaded\]\)/)
  })
  it("marque le chargement fait, même sans données", () => {
    const corps = src.slice(src.indexOf('const loadSavedDocs'), src.indexOf('const richPDF'))
    expect(corps).toMatch(/setSavedLoaded\(true\)/)
  })
  it("n'affiche pas l'éditeur avant le chargement", () => {
    expect(src).toMatch(/richOpen && savedLoaded && templates\?\.\[richOpen\]/)
  })
})
