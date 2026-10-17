// Chaque route /api doit se charger sans erreur dans Node, comme sur Vercel : un import cassé
// rend la route inutilisable en production (erreur 500 avant même d'exécuter le code).
// Le chargement se fait dans un processus Node séparé : Vitest transforme les modules
// et laisserait passer un export manquant.
import { describe, it, expect } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

function routes(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== '_lib') out.push(...routes(p)) }
    else if (name.endsWith('.js')) out.push(p)
  }
  return out
}

describe('Routes /api', () => {
  it('toutes les routes se chargent dans Node', () => {
    const liste = routes('api')
    const script = `
      const echecs = []
      for (const f of ${JSON.stringify(liste)}) {
        try {
          const m = await import('./' + f)
          if (typeof m.default !== 'function') echecs.push(f + ' : pas de fonction par défaut')
        } catch (e) { echecs.push(f + ' : ' + e.message) }
      }
      console.log(JSON.stringify(echecs))
    `
    const sortie = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: process.env })
    const echecs = JSON.parse(sortie.trim().split('\n').pop())
    expect(echecs).toEqual([])
    expect(liste.length).toBeGreaterThan(40)
  }, 60000)
})
