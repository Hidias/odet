// Onglets communs (07/11, signalé par H sur Stock) : « Plus » seulement quand la place manque.
import { describe, it, expect } from 'vitest'
import { ongletsQuiTiennent, ongletsAffiches } from '../src/ui/Tabs.jsx'

describe('onglets et menu « Plus »', () => {
  it('8 onglets qui tiennent : les 8 affichés, même avec visible = 6', () => {
    const tient = ongletsQuiTiennent(Array(8).fill(120), 1600)
    expect(ongletsAffiches(8, tient, 6)).toBe(8)
  })
  it('place insuffisante : les premiers qui tiennent, au plus `visible`', () => {
    expect(ongletsAffiches(8, ongletsQuiTiennent(Array(8).fill(120), 600), 6)).toBe(4)
    expect(ongletsAffiches(8, ongletsQuiTiennent(Array(8).fill(120), 950), 6)).toBe(6)
  })
  it('au moins un onglet reste visible', () => {
    expect(ongletsAffiches(5, ongletsQuiTiennent([400, 400, 400, 400, 400], 300), 6)).toBe(1)
  })
})

describe('onglets : cas limites et largeur du cadre', () => {
  it('rangée qui tient tout juste, visible plus grand que ce qui tient, liste vide', () => {
    expect(ongletsQuiTiennent([100, 100, 100], 300)).toBe(3)
    expect(ongletsAffiches(8, 3, 6)).toBe(3)
    expect(ongletsAffiches(0, ongletsQuiTiennent([], 500), 6)).toBe(0)
  })
  it('le cadre prend la place libre dans une rangée flex (Affaires, Conformité) et la rangée de mesure est observée', async () => {
    const { readFileSync } = await import('node:fs')
    const t = readFileSync('src/ui/Tabs.jsx', 'utf8')
    expect(t).toMatch(/className=\{`tabs flex-1 /)
    expect(t).toContain('ro?.observe(m)')
  })
})
