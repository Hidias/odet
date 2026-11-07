// B2 (07/11) : plus de classes « campus » ni d'ancien nom de clé serveur.
// Gardés exprès : identifiants Google Agenda « campus… » (changer le préfixe recréerait tous les événements déjà
// synchronisés), catégorie sociale `campus` et colonnes `campus_balance` (valeurs déjà en base).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const fichiers = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? fichiers(p) : /\.(jsx?|css)$/.test(n) ? [p] : [] })

describe('restes de Campus', () => {
  it('aucune classe badge-campus ou btn-campus, aucun SUPABASE_SERVICE_KEY', () => {
    for (const p of [...fichiers('src'), ...fichiers('api')]) {
      const t = readFileSync(p, 'utf8')
      expect(t, p).not.toMatch(/badge-campus|btn-campus/)
      expect(t, p).not.toMatch(/\bSUPABASE_SERVICE_KEY\b/)
    }
  })
})
