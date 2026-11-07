import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { estASigner } from '../src/modules/portail/components/MesDocuments'

// 0498 : la base dit si un document de l'espace client se signe encore
describe('Document signable rendu par la base', () => {
  it('signable faux : ni bandeau ni bouton « Signer », même non signé et sans dépôt', () => {
    expect(estASigner({ id: 'a', kind: 'devis', signable: false })).toBe(false)
    expect(estASigner({ id: 'b', kind: 'contrat', signable: false })).toBe(false)
    expect(estASigner({ id: 'c', kind: 'rapport', signable: false }, { aSignerEnPlus: new Set(['c']) })).toBe(false)
  })
  it('signable vrai ou absent (base pas encore à jour) : règle d\'avant', () => {
    expect(estASigner({ id: 'a', kind: 'devis', signable: true })).toBe(true)
    expect(estASigner({ id: 'b', kind: 'contrat' })).toBe(true)
  })
  it('le dépôt d\'un devis signé à la main suit la même règle', () => {
    const liste = readFileSync('src/modules/portail/components/MesDocuments.jsx', 'utf8')
    expect(liste).toMatch(/const deposable = [^\n]*d\.signable !== false/)
    const api = readFileSync('api/documents-client.js', 'utf8')
    expect(api).toMatch(/!\['draft', 'sent', 'partial'\]\.includes\(q\.status\)/)
  })
  it('la migration rend signable dans la liste et refuse la signature', () => {
    const sql = readFileSync('supabase/migrations/0498_signable_devis_sessions.sql', 'utf8')
    expect(sql).toMatch(/'signable', app\.document_signable\(d\)/)
    expect(sql).toMatch(/if not app\.document_signable\(d\) then/)
  })
})
