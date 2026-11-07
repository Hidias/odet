import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Q, DOCS_ADMINISTRATIFS, DOCS_FORMATION } from '../src/modules/formation/lib/indicateursDocuments'

describe('indicateurs Qualiopi des documents vierges', () => {
  it('émargement au 12, livret au 9, grilles au 11 (décret 2026-728, décision de H du 07/11)', () => {
    expect(Q.emargement).toBe('12')
    expect(Q.livret).toBe('9')
    expect(Q.grilles).toBe('11')
    expect(DOCS_FORMATION.find((d) => d.id === 'emargement').qualiopi).toBe('12')
    expect(DOCS_ADMINISTRATIFS.find((d) => d.id === 'livret').qualiopi).toBe('9')
  })
  it('une seule liste pour Documents, Documents vierges et la fiche session', () => {
    for (const f of ['src/modules/formation/pages/Documents.jsx', 'src/modules/formation/pages/DocumentsVierges.jsx']) {
      const s = readFileSync(f, 'utf8')
      expect(s).toContain('const adminDocs = DOCS_ADMINISTRATIFS')
      expect(s).not.toMatch(/qualiopi: '\d+'/)
      expect(s).not.toContain('Q22')
    }
    expect(readFileSync('src/modules/formation/pages/SessionDetail.jsx', 'utf8')).toContain("qualiopi: Number(Q.emargement)")
  })
})
