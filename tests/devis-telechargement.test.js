// Télécharger le PDF d'un devis (liste ou formulaire) ne republie rien dans l'espace client (constat du 06/11) :
// la mise à disposition reste à l'envoi, au passage en « envoyé » et à l'enregistrement (regenererEtPublier).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync('src/modules/commercial/pages/Quotes.jsx', 'utf8')
const corps = (nom) => {
  const debut = src.indexOf(`async function ${nom}(`)
  expect(debut).toBeGreaterThan(-1)
  const fin = src.indexOf('\n  }\n', debut)
  return src.slice(debut, fin)
}

describe('téléchargement du PDF d\'un devis', () => {
  it.each(['downloadPDF', 'downloadCurrentPDF'])('%s ne publie pas', (nom) => {
    expect(corps(nom)).not.toMatch(/\b(publierDevisPdf|publierDevis|mettreADisposition|regenererEtPublier)\(/)
  })
  it('l\'enregistrement d\'un devis remis republie toujours', () => {
    expect(src).toMatch(/includes\(currentQuote\.status\)\) regenererEtPublier\(quoteId\)/)
  })
})
