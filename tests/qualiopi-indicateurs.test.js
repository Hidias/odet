// A16 (07/11) : numéros d'indicateurs relus sur le décret n° 2026-728 (Légifrance, JORFTEXT000054608509).
// 17 : moyens humains et techniques adaptés ; 21 : compétences des intervenants ; 30 : appréciations des parties prenantes,
// dont les équipes pédagogiques (l'évaluation par le formateur).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { RULES, evaluateIndicators } from '../src/modules/certification/lib/proofs'
import { DOCS_FORMATION } from '../src/modules/formation/lib/indicateursDocuments'

describe('indicateurs Qualiopi des documents', () => {
  it("l'évaluation formateur est rattachée à l'indicateur 30, comme dans les preuves d'audit", () => {
    // liste commune aux pages Documents et Documents vierges (indicateursDocuments.js)
    expect(DOCS_FORMATION.find((d) => d.id === 'evaluationFormateur').qualiopi).toBe('30')
    for (const p of ['src/modules/formation/pages/Documents.jsx', 'src/modules/formation/pages/DocumentsVierges.jsx']) {
      expect(readFileSync(p, 'utf8'), p).toContain('const formationDocs = DOCS_FORMATION')
    }
    const proofs = readFileSync('src/modules/certification/lib/proofs.js', 'utf8')
    expect(proofs).toMatch(/30: \(e\) => \(\{[\s\S]{0,400}valuations formateur/)
    const ind21 = proofs.slice(proofs.indexOf('  21: (e) =>'), proofs.indexOf('  22: (e) =>'))
    expect(ind21).not.toMatch(/trainerEvals/)
  })
})

describe('preuves de l\'indicateur 21', () => {
  const evidence = { settings: {}, trainers: { total: 1, qualified: 1 }, n: { trainerCerts: 1, trainerEvals: 3 } }
  it("ne compte pas l'évaluation de la session par le formateur et dit ce qui manque", () => {
    const r = RULES[21](evidence)
    expect(r.items.map((i) => i.label || i.text || JSON.stringify(i)).join(' ')).not.toMatch(/valuations? formateur/)
    expect(r.missing.join(' ')).toMatch(/compétences des formateurs/)
  })
  it('une preuve ajoutée à la main lève le point', () => {
    const [ind] = evaluateIndicators([{ number: 21 }], evidence, { proofs: [{ indicator_number: 21 }] })
    expect(ind.missing).toEqual([])
    expect(ind.status).toBe('preuves')
  })
})
