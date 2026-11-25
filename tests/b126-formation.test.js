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
import { estRealisee, STATUTS_REALISEE, statutAffiche, maintenantParis, finSession, LIBELLES_STATUT } from '../src/core/session/realisee.js'

describe('B126 règle « réalisée »', () => {
  it('réalisée = À clôturer, À facturer ou Terminée', () => {
    expect(STATUTS_REALISEE).toEqual(['to_close', 'to_invoice', 'completed'])
    for (const s of ['completed', 'to_close', 'to_invoice', 'planned', 'confirmed', 'in_progress', 'cancelled', null, undefined, '']) {
      const attendu = ['completed', 'to_close', 'to_invoice'].includes(s)
      expect(estRealisee({ status: s })).toBe(attendu)
      if (typeof s === 'string') expect(estRealisee(s)).toBe(attendu)
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

describe('B126 parcours du statut (partie 3)', () => {
  it('maintenantParis donne l\'heure de Paris, hiver comme été', () => {
    expect(maintenantParis(new Date('2026-11-25T13:00:00Z'))).toBe('2026-11-25T14:00')
    expect(maintenantParis(new Date('2026-07-01T22:30:00Z'))).toBe('2026-07-02T00:30')
  })

  it('« À clôturer » affiché dès l\'heure de fin, verrou compris, sauf sous-traitance et annulée', () => {
    const s = { status: 'planned', start_date: '2026-11-25', end_date: '2026-11-25', end_time: '16:00:00' }
    expect(finSession(s)).toBe('2026-11-25T16:00')
    expect(statutAffiche(s, '2026-11-25T15:59')).toBe('planned')
    expect(statutAffiche(s, '2026-11-25T16:00')).toBe('to_close')
    expect(statutAffiche({ ...s, status_locked: true }, '2026-11-25T18:00')).toBe('to_close')
    expect(statutAffiche({ ...s, status: 'in_progress' }, '2026-11-26T09:00')).toBe('to_close')
    expect(statutAffiche({ ...s, session_type: 'subcontract' }, '2026-11-26T09:00')).toBe('planned')
    for (const st of ['cancelled', 'to_invoice', 'completed']) expect(statutAffiche({ ...s, status: st }, '2026-11-26T09:00')).toBe(st)
    expect(statutAffiche({ status: 'planned', start_date: '2026-11-25' }, '2026-11-25T23:58')).toBe('planned')
    expect(LIBELLES_STATUT.to_close).toBe('À clôturer')
    expect(LIBELLES_STATUT.to_invoice).toBe('À facturer')
  })

  it('le navigateur n\'écrit plus « Terminée » que pour la sous-traitance', () => {
    const src = lire('src/core/store.js')
    const debut = src.indexOf('Statuts des sessions (B126)')
    const bloc = src.slice(debut, src.indexOf('Créer des maps pour accès rapide', debut))
    expect(bloc).toContain("s.session_type === 'subcontract' && endDate < today && s.status !== 'completed'")
    expect(bloc).toContain('statutAffiche(s, maintenant)')
    expect(bloc.match(/newStatus = 'completed'/g)).toHaveLength(1)
  })

  it('les libellés connaissent À clôturer et À facturer partout', () => {
    for (const f of ['src/modules/formation/pages/SessionDetail.jsx', 'src/modules/formation/pages/Sessions.jsx',
      'src/modules/formation/components/SessionPlanning.jsx', 'src/ui/StatusBadge.jsx']) {
      const src = lire(f)
      expect(src, f).toMatch(/to_close: .*'À clôturer'/)
      expect(src, f).toMatch(/to_invoice: .*'À facturer'/)
    }
  })

  it('la fiche session montre la clôture et propose la facture dès « À facturer »', () => {
    const src = lire('src/modules/formation/pages/SessionDetail.jsx')
    expect(src).toContain("import ClotureSession from '../components/ClotureSession'")
    expect(src).toContain("['to_invoice', 'completed'].includes(session.status) && !session.sans_facture_motif && sessionHasInvoice === false")
    const c = lire('src/modules/formation/components/ClotureSession.jsx')
    expect(c).toContain("supabase.rpc('session_avancer_statut'")
    expect(c).toContain("supabase.rpc('session_cloture_etat'")
    expect(c).toContain('enregistrer(supabase.from(\'sessions\').update({ sans_facture_motif')
  })

  it('la migration 0528 pose le parcours, garde la sous-traitance et le verrou vers Terminée seulement', () => {
    const m = lire('supabase/migrations/0528_parcours_statut_session.sql')
    expect(m).toContain("array['to_close', 'to_invoice', 'completed']")
    expect(m).toContain("at time zone 'Europe/Paris'")
    expect(m).toMatch(/if v = 'to_invoice' and not s\.verrou/)
    expect(m).toContain("s.type_session = 'subcontract'")
    expect(m).toContain('public.session_half_days(p_session)')
    expect(m).toContain("m.email_type = 'after'")
    expect(m).toContain("i.status not in ('draft', 'cancelled')")
    expect(m).toContain('invoice_sessions')
    expect(m).toContain("raise exception '0528 : appliquer 0527")
    expect(m).toContain("'0528_parcours_statut_session'")
    expect(m).toMatch(/grant execute on function public\.session_avancer_statut\(uuid\) to authenticated/)
    const r = lire('supabase/rollback/0528_parcours_statut_session_retour.sql')
    expect(r).toContain('retour arrière refusé')
    expect(r).toContain("array['completed']")
  })
})
