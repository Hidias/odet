// A11 lot 7 (07/11) : financement d'une session payée par l'entreprise seule, sans barre « reste à financer ».
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('onglet Financement', () => {
  const f = readFileSync('src/modules/formation/pages/SessionDetail.jsx', 'utf8')
  it("entreprise qui paie seule et aucun financeur : phrase neutre à la place de la barre à 0 %", () => {
    expect(f).toContain("sessionFundings.length === 0 && (!session.funding_type || session.funding_type === 'none') ? (")
    expect(f).toContain("L'entreprise cliente paie la formation, sans financeur.")
  })
  it('financement prévu (OPCO, CPF...) sans financeur saisi : invitation à le renseigner gardée', () => {
    expect(f).toContain("(session.funding_type && session.funding_type !== 'none') && <p className=\"text-gray-500 text-center py-8\">Aucun financement renseigné.")
  })
})
