// Lot fiabilité 2 (B113, 19/11) : les écritures sur les devis passent par « enregistrer ».
// Contrôle de source : une mise à jour ou une suppression de devis écrite sans vérification
// du nombre de lignes ferait passer un refus de la règle d'accès pour un succès.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function fichiers(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom)
    return statSync(chemin).isDirectory() ? fichiers(chemin) : /\.(js|jsx)$/.test(nom) ? [chemin] : []
  })
}

// Écritures volontairement hors « enregistrer », avec leur raison
const EXCEPTIONS = [
  // Suppression des anciennes lignes avant réinsertion : 0 ligne est normal (devis sans ligne), l'erreur est contrôlée
  { fichier: 'Quotes.jsx', motif: "from('quote_items').delete()" },
]

describe('écritures sur les devis', () => {
  const sources = fichiers('src').map((chemin) => ({ chemin, texte: readFileSync(chemin, 'utf8') }))

  it("aucune mise à jour ni suppression de devis sans « enregistrer », hors exceptions listées", () => {
    const fautes = []
    for (const { chemin, texte } of sources) {
      const plat = texte.replace(/\)\s*\n\s*\./g, ').')
      const re = /from\('(quotes|quote_items)'\)\.(update|delete)\(/g
      let m
      while ((m = re.exec(plat))) {
        const avant = plat.slice(Math.max(0, m.index - 40), m.index)
        if (/enregistrer(OuLever)?\(/.test(avant)) continue
        const exception = EXCEPTIONS.find((e) => chemin.endsWith(e.fichier) && plat.slice(m.index - 6, m.index + 40).includes(e.motif))
        if (exception) continue
        fautes.push(`${chemin} : ${m[0]}`)
      }
    }
    expect(fautes).toEqual([])
  })

  it('le devis modifié est vérifié avant de toucher à ses lignes', () => {
    const t = readFileSync('src/modules/commercial/pages/Quotes.jsx', 'utf8')
    const maj = t.indexOf("enregistrer(supabase.from('quotes').update(quoteData)")
    const suppr = t.indexOf("from('quote_items').delete()")
    expect(maj).toBeGreaterThan(0)
    expect(suppr).toBeGreaterThan(maj)
    expect(t.slice(suppr, suppr + 200)).toContain('if (de) throw de')
  })

  it('la relance envoyée signale un devis non mis à jour', () => {
    const t = readFileSync('src/modules/commercial/lib/useRelanceIA.js', 'utf8')
    expect(t).toContain("Relance envoyée, mais devis non mis à jour")
  })
})
