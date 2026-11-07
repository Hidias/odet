import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { positionMenu } from '../src/ui/MenuFlottant'

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

describe('Menu d’actions flottant (07/11)', () => {
  const vw = 1280, vh = 800
  const bouton = { left: 1180, right: 1200, top: 300, bottom: 320 }

  it('aligné sur le bord droit du bouton, ouvert vers le bas quand la place suffit', () => {
    expect(positionMenu(bouton, 160, 180, vw, vh)).toEqual({ left: 1020, top: 324 })
  })

  it('ouvert vers le haut près du bas de l’écran', () => {
    const bas = { ...bouton, top: 740, bottom: 760 }
    expect(positionMenu(bas, 160, 180, vw, vh)).toEqual({ left: 1020, bottom: 64 })
  })

  it('jamais hors de l’écran à gauche (téléphone)', () => {
    expect(positionMenu({ left: 40, right: 60, top: 100, bottom: 120 }, 160, 180, 390, 844).left).toBe(8)
  })

  it('liste des clients : menu hors du tableau qui défile', () => {
    const src = lire('src/modules/commercial/pages/Clients.jsx')
    expect(src).toMatch(/<MenuFlottant ancre=\{actionAncre\}/)
    expect(src).not.toMatch(/ref=\{actionMenuRef\} className="absolute/)
    expect(lire('src/ui/MenuFlottant.jsx')).toMatch(/createPortal\(/)
  })
})
