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
