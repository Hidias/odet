// Document qualité publié (CGV, règlement, livret, charte) : la copie figée d'une version validée ne porte ni le statut
// ni le numéro. Le PDF doit dire « version 3 », jamais « Projet, version 1 non validée » ni « -V1 » (constat du 06/11).
import { describe, it, expect, vi } from 'vitest'

const ouvertures = []
vi.mock('../src/core/supabase', () => ({
  supabase: {
    rpc: async (nom) => (nom === 'published_quality_doc'
      ? { data: { content: { sections: [{ id: 's1', title: 'Objet', blocks: [] }] }, version: 3, validated_at: '2026-11-04T07:59:44Z' }, error: null }
      : { data: null, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  },
}))
vi.mock('../src/core/pdf/layout', () => {
  const f = { doc: null, M: 10, W: 190, table: () => {}, section: () => {}, space: () => {}, note: () => {}, finish: () => {} }
  return {
    startDocument: (doc, ORG, opts) => { ouvertures.push(opts); f.doc = doc; return f },
    numberPages: () => {}, setF: () => {}, compacter: (fn) => fn(),
  }
})

describe('document qualité publié', () => {
  it('la version validée garde son statut et son numéro', async () => {
    const { loadPublishedDoc } = await import('../src/modules/qualite/richdocs/published')
    const pub = await loadPublishedDoc('cgv', { force: true })
    expect(pub.source).toBe('valide')
    expect(pub.content).toMatchObject({ status: 'valide', version: 3, validated_at: '2026-11-04T07:59:44Z' })
  })
  it('PDF : fichier -V3 et aucune mention de projet', async () => {
    const { loadPublishedDoc } = await import('../src/modules/qualite/richdocs/published')
    const { buildRichDocPDF } = await import('../src/modules/qualite/richdocs/richDocPDF')
    const pub = await loadPublishedDoc('cgv')
    const ORG = { theme: { surface: [240, 240, 240], muted: [100, 100, 100] } }
    const r = buildRichDocPDF(ORG, { tpl: { code: 'QUAL-CGV', name: 'Conditions générales de vente', family: 'commerce' }, code: 'GLD-QUAL-CGV', content: pub.content, ctx: {}, history: [] })
    expect(r.filename).toMatch(/^GLD-QUAL-CGV-V3_/)
    const o = ouvertures.at(-1)
    expect(o.ref).toBe('GLD-QUAL-CGV-V3')
    expect(String(o.subtitle || '')).not.toMatch(/Projet/)
  })
})
