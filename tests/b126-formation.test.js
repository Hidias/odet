// B126 : relance à chaud par la route serveur tracée ; « acquis » limité aux dates de la session ; contrainte des types d'envoi
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const lire = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

describe('B126 formation', () => {
  it('la relance des évaluations à chaud passe par /api/send-email-session avec le type relance_chaud', () => {
    const src = lire('src/modules/formation/pages/SessionDetail.jsx')
    expect(src).not.toMatch(/functions\.invoke\(\s*'send-email-session'/)
    const bloc = src.slice(src.indexOf('handleSendHotEvalReminder = async'), src.indexOf('handleSendHotEvalReminder = async') + 4000)
    expect(bloc).toMatch(/apiFetch\('\/api\/send-email-session'/)
    expect(bloc).toMatch(/emailType: 'relance_chaud'/)
    expect(bloc).toMatch(/sessionId: session\.id/)
    expect(src).toMatch(/import \{ apiFetch \} from '\.\.\/\.\.\/\.\.\/core\/api'/)
  })

  it('le résultat acquis ne compte que les demi-journées aux dates de la session', () => {
    const src = lire('src/core/store.js')
    const debut = src.indexOf('updateTraineeResult: async')
    const bloc = src.slice(debut, src.indexOf('\n  },', debut))
    const iSession = bloc.indexOf(".from('sessions')")
    const iDemi = bloc.indexOf(".from('attendance_halfdays')")
    expect(iSession).toBeGreaterThan(-1)
    expect(iDemi).toBeGreaterThan(iSession)
    expect(bloc).toMatch(/\.gte\('date', sessionData\.start_date\)/)
    expect(bloc).toMatch(/\.lte\('date', sessionData\.end_date\)/)
  })

  it('la migration 0526 accepte relance_chaud et demande_nir, avec un retour arrière', () => {
    const m = lire('supabase/migrations/0526_relance_chaud_trace.sql')
    for (const t of ['before', 'after', 'relance_chaud', 'demande_nir']) expect(m).toContain(`'${t}'`)
    expect(m).toContain("'0526_relance_chaud_trace'")
    expect(lire('supabase/rollback/0526_relance_chaud_trace_retour.sql')).toContain('retour arrière refusé')
  })
})

// B126, partie 2 : une seule règle « session réalisée » (changement neutre : aujourd'hui = Terminée)
import { estRealisee, STATUTS_REALISEE } from '../src/core/session/realisee.js'

describe('B126 règle « réalisée »', () => {
  it('estRealisee vaut aujourd\'hui exactement status === completed', () => {
    expect(STATUTS_REALISEE).toEqual(['completed'])
    for (const s of ['completed', 'planned', 'confirmed', 'in_progress', 'cancelled', null, undefined, '']) {
      expect(estRealisee({ status: s })).toBe(s === 'completed')
      if (typeof s === 'string') expect(estRealisee(s)).toBe(s === 'completed')
    }
    expect(estRealisee(null)).toBe(false)
    expect(() => { STATUTS_REALISEE.push('x') }).toThrow()
  })

  const lecteurs = [
    'src/modules/certification/lib/results.js', 'src/modules/certification/lib/proofs.js',
    'src/modules/certification/pages/CertDossier.jsx', 'src/modules/qualite/pages/Indicateurs.jsx',
    'src/modules/qualite/pages/Qualiopi.jsx', 'src/modules/qualite/pages/QualiteEditables.jsx',
    'src/modules/qualite/pages/Completude.jsx', 'src/modules/dashboard/Dashboard.jsx',
    'src/modules/dashboard/lib/accueil.js', 'src/modules/formation/pages/ProfilStagiaires.jsx',
    'api/_lib/orgProfile.js',
  ]
  it('les résultats et indicateurs lisent la règle commune, plus « completed » en dur', () => {
    for (const f of lecteurs) {
      const src = lire(f)
      expect(src, f).toMatch(/from '[./]+(src\/)?core\/session\/realisee\.js'/)
      expect(src, f).not.toMatch(/status\s*[!=]==?\s*'completed'/)
      expect(src, f).not.toMatch(/\.eq\('status', 'completed'\)/)
      expect(src, f).not.toMatch(/'in_progress', 'completed'\]/)
    }
  })

  it('la sélection des sessions à facturer et les statistiques globales lisent la règle commune', () => {
    expect(lire('src/modules/commercial/pages/Invoices.jsx')).toContain(".in('status', [...STATUTS_REALISEE, 'in_progress'])")
    const store = lire('src/core/store.js')
    const debut = store.indexOf('fetchGlobalStats: async')
    expect(store.slice(debut, debut + 600)).toContain(".in('status', STATUTS_REALISEE)")
  })

  it('la migration 0527 crée app.session_realisee et convertit les 5 fonctions du froid, avec retour arrière', () => {
    const m = lire('supabase/migrations/0527_session_realisee.sql')
    expect(m).toMatch(/create or replace function app\.session_realisee\(p_status text\)/)
    expect(m).toContain("p_status = any (array['completed'])")
    for (const f of ['app.froid_employeur_client(uuid,uuid)', 'public.froid_envois_reserver(uuid[])',
      'app.froid_preparer_corps(uuid[],date)', 'public.froid_suivi()', 'public.portail_froid(text,uuid,text)']) {
      expect(m).toContain(`'${f}'`)
    }
    expect(m.split('\n').filter((l) => !l.startsWith('--')).join('\n')).not.toContain('daily_maintenance')
    expect(m).toContain("'0527_session_realisee'")
    expect(m).toMatch(/raise exception '0527/)
    const r = lire('supabase/rollback/0527_session_realisee_retour.sql')
    expect(r).toContain('drop function if exists app.session_realisee(text)')
    expect(r).toContain('retour arrière refusé')
  })
})
