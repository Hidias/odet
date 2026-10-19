// Garde-fou (incident du 19/10) : un fichier de l'application absent ne doit jamais être servi comme une page HTML,
// et aucun fichier ne doit être mis en cache « immutable » (une réponse de secours restait alors en cache un an).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const v = JSON.parse(readFileSync('vercel.json', 'utf8'))

describe('Cache et réécritures de Vercel', () => {
  it('aucun en-tête immutable', () => {
    expect(JSON.stringify(v.headers || [])).not.toMatch(/immutable/)
  })
  it('la réécriture vers index.html exclut /assets et /api', () => {
    const spa = (v.rewrites || []).filter((r) => r.destination === '/index.html')
    expect(spa.length).toBe(1)
    expect(spa[0].source).toContain('assets/')
    expect(spa[0].source).toContain('api/')
  })
})
