import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Tables qui ont deux liens vers les clients : une jointure « clients(...) » sans précision est refusée par l'API
// (réponse 300) et la liste reste vide. Vu le 21/10 sur la page Devis après l'ajout du financeur (0397).
const AMBIGUES = ['quotes', 'invoices', 'session_groups']

function fichiers(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : fichiers(p)
    return /\.(js|jsx)$/.test(n) ? [p] : []
  })
}

describe('jointures vers les clients', () => {
  it('précisent le lien quand la table en a deux', () => {
    const fautes = []
    for (const f of [...fichiers('src'), ...fichiers('api')]) {
      const s = readFileSync(f, 'utf8')
      for (const t of AMBIGUES) {
        const re = new RegExp(`from\\('${t}'\\)[\\s\\S]{0,300}?\\.select\\(\\s*['\`]([^'\`]*)['\`]`, 'g')
        for (const m of s.matchAll(re)) {
          if (/\bclients\s*\(/.test(m[1])) fautes.push(`${f} : ${t} → ${m[1].slice(0, 80)}`)
        }
      }
    }
    expect(fautes).toEqual([])
  })
})
