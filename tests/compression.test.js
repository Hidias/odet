import { describe, it, expect } from 'vitest'
import jsPDF from 'jspdf'
import { preparerDepot, allegerPdf, tailleLisible } from '../src/core/fichiers/compression'

const pdf = () => { const d = new jsPDF(); for (let i = 0; i < 3; i++) { d.text('Page ' + i + ' '.repeat(50) + 'x'.repeat(200), 10, 10); d.addPage() } return d.output('arraybuffer') }

describe('compression des dépôts', () => {
  it('PDF allégé ou gardé tel quel, jamais plus lourd', async () => {
    const b = pdf()
    const out = await allegerPdf(b)
    expect(out.length).toBeLessThanOrEqual(b.byteLength)
    expect(new TextDecoder().decode(out.subarray(0, 4))).toBe('%PDF')
  })
  it('un PDF déposé passe', async () => {
    const f = new File([pdf()], 'devis.pdf', { type: 'application/pdf' })
    const r = await preparerDepot([f])
    expect(r.apres).toBeGreaterThan(0)
  })
  it('refus lisibles', async () => {
    await expect(preparerDepot([])).rejects.toThrow('Choisissez')
    await expect(preparerDepot([new File(['x'], 'a.txt', { type: 'text/plain' })])).rejects.toThrow('Format')
    const f = new File([pdf()], 'a.pdf', { type: 'application/pdf' })
    await expect(preparerDepot([f, f])).rejects.toThrow('un seul PDF')
    await expect(preparerDepot([f], { limite: 10 })).rejects.toThrow('trop lourd')
  })
  it('tailles lisibles', () => { expect(tailleLisible(2048)).toBe('2 Ko'); expect(tailleLisible(3.4 * 1024 * 1024)).toBe('3,4 Mo') })
})
