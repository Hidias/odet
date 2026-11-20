// Piège relevé à l'essai de #384 et #385 (20/11) : un fichier qui importe la fonction commune
// `enregistrer` et déclare aussi une fonction locale du même nom l'écrase. Les écritures
// vérifiées appellent alors le bouton du formulaire au lieu d'écrire, sans erreur visible.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function fichiers(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) return fichiers(chemin)
    return /\.(js|jsx)$/.test(nom) ? [chemin] : []
  })
}

describe('fonction commune enregistrer', () => {
  it("aucun fichier qui l'importe ne déclare un homonyme local", () => {
    const fautifs = fichiers('src').filter((f) => {
      const t = readFileSync(f, 'utf8')
      if (!/import\s*\{[^}]*\benregistrer\b[^}]*\}\s*from/.test(t)) return false
      return /\b(const|let|var|function)\s+enregistrer\b/.test(t)
    })
    expect(fautifs).toEqual([])
  })
})
