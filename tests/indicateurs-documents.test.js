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
  it('un seul indicateur par document : fiche de renseignements 4, convention 5, programme 6 (décision de H du 07/11)', () => {
    expect(Q.ficheRenseignements).toBe('4')
    expect(Q.convention).toBe('5')
    expect(Q.programme).toBe('6')
    const s = readFileSync('src/modules/formation/pages/SessionDetail.jsx', 'utf8')
    for (const id of ['convention', 'programme', 'ficheRenseignements']) expect(s).toMatch(new RegExp(`id: '${id}'[^\n]*qualiopi: Number\\(Q\\.${id}\\)`))
    const p = readFileSync('src/modules/certification/lib/proofs.js', 'utf8')
    expect(p.slice(p.indexOf('  10: (e)'), p.indexOf('  11: ('))).not.toContain('infoSheets')
    expect(p.slice(p.indexOf('  4: (e)'), p.indexOf('  5: (e)'))).toContain('infoSheets')
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

describe('preuves des indicateurs 4 et 10', async () => {
  const { RULES, evaluateIndicators } = await import('../src/modules/certification/lib/proofs.js')
  const base = { n: { needs: 1, sessionsTotal: 1, infoSheets: 0, psh: 0 }, courses: {}, org: {} }
  it('indicateur 10 sans demande d\'adaptation : pas de preuve affichée comme trouvée', () => {
    const r = RULES[10](base)
    expect(r.items.some((i) => i.ok)).toBe(false)
    expect(r.missing.length).toBe(1)
    expect(RULES[10]({ ...base, n: { ...base.n, psh: 2 } }).missing).toEqual([])
  })
  it('indicateur 10 : une preuve ajoutée à la main le passe en « preuves trouvées »', () => {
    const ev = { ...base, courses: {}, org: {}, settings: {} }
    expect(evaluateIndicators([{ number: 10 }], ev)[0].status).not.toBe('preuves')
    expect(evaluateIndicators([{ number: 10 }], ev, { proofs: [{ indicator_number: 10 }] })[0].status).toBe('preuves')
  })
  it('indicateur 4 : fiches de renseignements remplies seulement', () => {
    expect(RULES[4](base).items.find((i) => /renseignements/.test(i.label || i.text || JSON.stringify(i))).ok).toBe(false)
    const src = readFileSync('src/modules/certification/lib/proofs.js', 'utf8')
    expect(src).toContain("count('trainee_info_sheets', (q) => q.not('filled_at', 'is', null))")
  })
})
