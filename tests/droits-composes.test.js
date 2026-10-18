// Droits composés par société (chantier C1b) : lecture des droits par l'application et pièces sans prix.
// Les droits viennent de la base (my_rights) ; inconnus = comportement d'avant C1b (aucun changement à l'écran).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { normaliserDroits, chargerDroits, aLeDroit, prixMasques, PRIX_INTERVENTIONS } from '../src/core/rights/rights.js'

const appels = []
vi.mock('../src/core/supabase', () => {
  const chaine = (table) => {
    const q = {
      table,
      select: () => q, eq: () => q, order: () => q, insert: () => q, update: () => q, delete: () => q,
      maybeSingle: () => Promise.resolve({ data: { id: 1 }, error: null }),
      single: () => Promise.resolve({ data: { id: 'x' }, error: null }),
      then: (ok) => Promise.resolve({ data: [], error: null }).then(ok),
    }
    appels.push({ type: 'table', nom: table })
    return q
  }
  return {
    supabase: {
      from: chaine,
      rpc: (nom, args) => { appels.push({ type: 'rpc', nom, args }); return Promise.resolve({ data: { id: 'x' }, error: null }) },
    },
  }
})

describe('Lecture des droits', () => {
  it('normalise la réponse de la base', () => {
    const d = normaliserDroits({ company_id: 'c1', role: 'lecture', profiles: ['lecture'], rights: ['b.x', 'a.y'], full_license: false })
    expect(d).toEqual({ companyId: 'c1', role: 'lecture', profiles: ['lecture'], rights: ['a.y', 'b.x'], fullLicense: false })
  })

  it('réponse inutilisable : null (comportement d\'avant)', () => {
    expect(normaliserDroits(null)).toBeNull()
    expect(normaliserDroits({ rights: 'pas une liste' })).toBeNull()
  })

  it('fonction absente ou erreur : null, jamais d\'exception', async () => {
    expect(await chargerDroits({ rpc: () => Promise.resolve({ data: null, error: { code: 'PGRST202' } }) })).toBeNull()
    expect(await chargerDroits({ rpc: () => Promise.reject(new Error('réseau')) })).toBeNull()
  })

  it('aLeDroit : vrai, faux, ou inconnu', () => {
    const d = normaliserDroits({ rights: ['formation.sessions.voir'] })
    expect(aLeDroit(d, 'formation.sessions.voir')).toBe(true)
    expect(aLeDroit(d, 'facturation.factures.voir')).toBe(false)
    expect(aLeDroit(null, 'formation.sessions.voir')).toBeNull()
  })

  it('prix masqués seulement si les droits sont connus et sans le droit des prix', () => {
    expect(prixMasques(null)).toBe(false)
    expect(prixMasques(normaliserDroits({ rights: [PRIX_INTERVENTIONS] }))).toBe(false)
    expect(prixMasques(normaliserDroits({ rights: ['interventions.missions.voir'] }))).toBe(true)
  })
})

describe('Interventions : pièces et réglages sans prix', () => {
  beforeEach(() => { appels.length = 0 })

  it('par défaut (droits inconnus) : tables directes, comme avant', async () => {
    const itv = await import('../src/modules/interventions/lib/itvData.js')
    itv.setPrixMasques(false)
    await itv.loadParts()
    await itv.loadSettings()
    await itv.loadVisitParts('v1')
    expect(appels.map((a) => a.nom)).toEqual(['itv_parts', 'itv_settings', 'itv_visit_parts'])
  })

  it('prix masqués : vues sans prix et fonctions de la base, jamais de prix envoyé', async () => {
    const itv = await import('../src/modules/interventions/lib/itvData.js')
    itv.setPrixMasques(true)
    await itv.loadParts()
    await itv.loadSettings()
    await itv.loadVisitParts('v1')
    await itv.addVisitPart({ visit_id: 'v1', part_id: 'p1', label: 'Pièce', quantity: 1, unit_price_ht: 12 })
    await itv.updateVisitPart('vp1', { quantity: 2 })
    await itv.removeVisitPart('vp1')
    expect(appels.map((a) => a.nom)).toEqual(['itv_parts_terrain', 'itv_settings_terrain', 'itv_visit_parts_terrain',
      'itv_visit_part_add', 'itv_visit_part_set_quantity', 'itv_visit_part_remove'])
    const ajout = appels.find((a) => a.nom === 'itv_visit_part_add')
    expect(ajout.args).toEqual({ p_visit: 'v1', p_part: 'p1', p_label: 'Pièce', p_quantity: 1 })
    expect(JSON.stringify(appels)).not.toContain('price')
    itv.setPrixMasques(false)
  })
})

describe('Migrations de C1b', () => {
  it('les vues terrain ne sélectionnent aucune colonne de prix', () => {
    const sql = readFileSync(new URL('../supabase/migrations/0374_droits_prix_terrain.sql', import.meta.url), 'utf8')
    const vues = sql.split('create or replace view').slice(1).map((v) => v.split(/\bfrom\b/)[0])
    expect(vues).toHaveLength(3)
    for (const v of vues) expect(v).not.toMatch(/price|fee/)
  })

  it('les règles générées n\'utilisent plus les groupes de rôles', () => {
    const sql = readFileSync(new URL('../supabase/migrations/0373_droits_regles.sql', import.meta.url), 'utf8')
    expect(sql).not.toContain('app.grp(')
    expect(sql).toContain("app.a_le_droit('")
  })
})
