// Règle du chantier F : la face interne des certifications (« erreurs à éviter », table cert_pitfalls)
// est un conseil réservé à la direction. Elle ne doit jamais apparaître dans un export, un PDF,
// un document d'audit, le portail stagiaire ou l'espace entreprise.
// Ce test échoue si un de ces fichiers y fait référence.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function fichiers(dir) {
  const out = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) out.push(...fichiers(p))
    else if (/\.(js|jsx|mjs)$/.test(n)) out.push(p)
  }
  return out
}

const FACE_INTERNE = /cert_pitfalls|pitfall|erreurs[-_ ]a[-_ ]eviter|erreurs à éviter|ErreursAEviter/i
// Fichiers qui produisent un export, un PDF, un document d'audit, ou une page publique
const SORTIE = /(^|\/)(pdf|export|exports|portail|public)(\/|$)|export|pdf|Portal|Portail|dossierAudit|Reclamation/i

describe('Face interne des certifications', () => {
  const candidats = [...fichiers('src'), ...fichiers('api')].filter((f) => SORTIE.test(f))
  it('aucun export, PDF, portail ou espace entreprise n\'y fait référence', () => {
    const fautifs = candidats.filter((f) => FACE_INTERNE.test(readFileSync(f, 'utf8')))
    expect(fautifs).toEqual([])
    expect(candidats.length).toBeGreaterThan(10)
  })
})
