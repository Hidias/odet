import { describe, it, expect } from 'vitest'
import { empreinte } from '../src/core/portail/journal'
import { appareil } from '../src/modules/commercial/components/JournalEspaceClient'

describe('journal de l\'espace client', () => {
  it('empreinte SHA-256 du document remis', async () => {
    // « abc » en base64 : empreinte connue
    expect(await empreinte(btoa('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('appareil lisible', () => {
    expect(appareil('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari, iPhone ou iPad')
    expect(appareil('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Edge, Windows')
    expect(appareil('')).toBe('')
  })
})
