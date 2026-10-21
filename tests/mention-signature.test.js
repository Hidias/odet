import { describe, it, expect } from 'vitest'
import { mentionValable } from '../src/modules/portail/components/SignerConvention'

describe('mention écrite au clavier', () => {
  it('mention du document, sans tenir compte des accents ni de la ponctuation', () => {
    expect(mentionValable('Lu et approuvé, bon pour accord')).toBe(true)
    expect(mentionValable('lu et approuve bon pour accord')).toBe(true)
  })
  it('forme courte', () => { expect(mentionValable('Bon pour accord')).toBe(true); expect(mentionValable(' bon  pour accord. ')).toBe(true) })
  it('refus', () => { expect(mentionValable('')).toBe(false); expect(mentionValable('ok')).toBe(false); expect(mentionValable('bon pour')).toBe(false) })
})
