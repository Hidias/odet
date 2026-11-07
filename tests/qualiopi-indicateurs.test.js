// A16 (07/11) : numéros d'indicateurs relus sur le décret n° 2026-728 (Légifrance, JORFTEXT000054608509).
// 17 : moyens humains et techniques adaptés ; 21 : compétences des intervenants ; 30 : appréciations des parties prenantes,
// dont les équipes pédagogiques (l'évaluation par le formateur).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('indicateurs Qualiopi des documents', () => {
  it("l'évaluation formateur est rattachée à l'indicateur 30, comme dans les preuves d'audit", () => {
    for (const p of ['src/modules/formation/pages/Documents.jsx', 'src/modules/formation/pages/DocumentsVierges.jsx']) {
      expect(readFileSync(p, 'utf8'), p).toMatch(/id: 'evaluationFormateur', label: 'Évaluation formateur', qualiopi: '30'/)
    }
    expect(readFileSync('src/modules/certification/lib/proofs.js', 'utf8')).toMatch(/30: \(e\) => \(\{[\s\S]{0,400}valuations formateur/)
  })
})
