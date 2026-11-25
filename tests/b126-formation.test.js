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
