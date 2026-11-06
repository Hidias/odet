import { describe, it, expect } from 'vitest'
import { signeALaPlace, mentionALaPlace } from '../src/modules/portail/lib/signatureDocument'

const prevu = { name: 'Anne Martin', role: 'Gérante' }

describe('Signataire prévu par le document (0496)', () => {
  it('le même nom, aux accents, majuscules et espaces près, n\'est pas signalé', () => {
    expect(signeALaPlace('Anne Martin', prevu)).toBe(false)
    expect(signeALaPlace('  anne   MARTIN ', prevu)).toBe(false)
    expect(signeALaPlace('Anne Mârtin', prevu)).toBe(false)
  })
  it('un autre nom est signalé et écrit dans la preuve', () => {
    expect(signeALaPlace('Paul Durand', prevu)).toBe(true)
    expect(mentionALaPlace(' Paul Durand ', prevu)).toBe(' Signataire prévu sur le document : Anne Martin (Gérante) ; signé par Paul Durand.')
    expect(mentionALaPlace('Paul Durand', { name: 'Anne Martin' })).toBe(' Signataire prévu sur le document : Anne Martin ; signé par Paul Durand.')
  })
  it('sans signataire prévu ou sans nom saisi : rien', () => {
    expect(signeALaPlace('Paul Durand', null)).toBe(false)
    expect(signeALaPlace('Paul Durand', { name: '' })).toBe(false)
    expect(signeALaPlace('', prevu)).toBe(false)
    expect(mentionALaPlace('Paul Durand', null)).toBe('')
  })
})
