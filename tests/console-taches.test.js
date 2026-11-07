import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TACHES, heureDeParis, rythmeDe } from '../src/core/console/TachesEtEnvois.jsx'

const crons = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).crons

describe('Console, heures des tâches planifiées', () => {
  it('heure de Paris : une heure de plus en hiver, deux en été', () => {
    expect(heureDeParis(2, 10, new Date('2026-11-07T12:00:00Z'))).toBe('3h')
    expect(heureDeParis(2, 10, new Date('2026-07-07T12:00:00Z'))).toBe('4h')
    expect(heureDeParis(7, 0, new Date('2026-12-15T12:00:00Z'))).toBe('8h')
  })

  it('le libellé suit le planning de vercel.json', () => {
    for (const t of TACHES.filter((x) => x.utc)) {
      const c = crons.find((x) => x.path === `/api/${t.job}`)
      expect(c, t.job).toBeTruthy()
      const [min, heure] = c.schedule.split(' ')
      expect([Number(heure), Number(min)], t.job).toEqual([t.utc[0], t.utc[1] || 0])
    }
  })

  it('aucun libellé ne garde une heure écrite en dur', () => {
    for (const t of TACHES) expect(rythmeDe(t, new Date('2026-11-07T12:00:00Z'))).not.toMatch(/\{h\}/)
    expect(rythmeDe(TACHES[0], new Date('2026-11-07T12:00:00Z'))).toBe('Chaque nuit, vers 3h')
  })
})
