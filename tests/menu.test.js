import { describe, it, expect } from 'vitest'
import { visibleSections, sectionIdFor, NAV_SECTIONS, SETTINGS_ITEMS } from '../src/core/modules/registry'

const inconnus = () => null

describe('menu (ergonomie)', () => {
  it("l'accueil reste visible quels que soient les modules actifs", () => {
    const ids = visibleSections(['interventions'], 'admin', inconnus).map((s) => s.id)
    expect(ids[0]).toBe('accueil')
    expect(ids).toContain('entreprise')
    expect(ids).not.toContain('formation')
    expect(sectionIdFor('/')).toBe('accueil')
    expect(sectionIdFor('/sessions/abc')).toBe('formation')
  })

  it('chaque section a sa propre icône et chaque réglage un libellé court', () => {
    NAV_SECTIONS.forEach((s) => expect(s.icon, s.id).toBeTruthy())
    const icones = NAV_SECTIONS.map((s) => s.icon)
    expect(new Set(icones).size).toBe(icones.length)
    SETTINGS_ITEMS.forEach((i) => {
      expect(i.short, i.to).toBeTruthy()
      expect(i.short.length, i.to).toBeLessThanOrEqual(10)
    })
  })
})
