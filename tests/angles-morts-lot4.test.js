import { describe, it, expect } from 'vitest'
import { etatBpf, froidARappeler, cleStagiaire } from '../src/modules/dashboard/lib/accueil.js'
import { devisARelancer, addDays } from '../src/modules/prospection/components/suivi/suiviUtils.js'

describe('widget BPF (A3)', () => {
  it('lit la déclaration de l\'exercice', () => {
    expect(etatBpf(null, 2025).cle).toBe('a_faire')
    expect(etatBpf({ status: 'draft' }, 2025).cle).toBe('brouillon')
    const d = etatBpf({ status: 'submitted', submitted_at: '2026-05-20T10:00:00Z' }, 2025)
    expect(d.cle).toBe('depose')
    expect(d.titre).toBe('BPF 2025 déposé')
    expect(d.detail).toBe('Déposé le 20/05/2026')
    expect(etatBpf(null, null).cle).toBe('inconnu')
  })
})

describe('rappel évaluation à froid (A4)', () => {
  const st = (id, extra = {}) => ({ trainee_id: id, presence_complete: true, ...extra })
  const s = { id: 's', status: 'completed', end_date: '2026-09-01', session_trainees: [st('a'), st('b')] }
  const vide = { envoyes: new Set(), repondus: new Set() }
  it('dû au délai réglé (60 jours par défaut), pas avant', () => {
    expect(froidARappeler(s, { ...vide, aujourdhui: '2026-10-30' })).toBe(false)
    expect(froidARappeler(s, { ...vide, aujourdhui: '2026-10-31' })).toBe(true)
    expect(froidARappeler(s, { ...vide, reglage: { premier_envoi_jours: 90 }, aujourdhui: '2026-10-31' })).toBe(false)
    expect(froidARappeler({ ...s, courses: { froid_delai_jours: 30 } }, { ...vide, aujourdhui: '2026-10-01' })).toBe(true)
  })
  it('plus rien quand chacun a reçu son envoi ou répondu', () => {
    const envoyes = new Set([cleStagiaire('s', 'a')])
    expect(froidARappeler(s, { envoyes, repondus: new Set(), aujourdhui: '2026-11-04' })).toBe(true)
    expect(froidARappeler(s, { envoyes, repondus: new Set([cleStagiaire('s', 'b')]), aujourdhui: '2026-11-04' })).toBe(false)
  })
  it('absents et non formés ignorés, sessions trop anciennes exclues sauf inclusion', () => {
    const t = { ...s, session_trainees: [st('a', { absent: true }), { trainee_id: 'b' }] }
    expect(froidARappeler(t, { ...vide, aujourdhui: '2026-11-04' })).toBe(false)
    expect(froidARappeler(s, { ...vide, aujourdhui: '2027-09-10' })).toBe(false)
    expect(froidARappeler({ ...s, froid_inclure: true }, { ...vide, aujourdhui: '2027-09-10' })).toBe(true)
    expect(froidARappeler({ ...s, status: 'planned' }, { ...vide, aujourdhui: '2026-11-04' })).toBe(false)
  })
})

describe('devis à relancer (A5), règle écrite aussi en base (app.devis_a_relancer, 0488)', () => {
  const auj = '2026-11-04'
  const q = { status: 'sent', quote_date: addDays(auj, -8), relance_count: 0, followup_state: 'actif' }
  it('cadence J+7 sans date fixée à la main', () => {
    expect(devisARelancer(q, auj)).toBe(true)
    expect(devisARelancer(q, addDays(auj, -2))).toBe(false)
  })
  it('veille, relances faites, date fixée, statuts', () => {
    expect(devisARelancer({ ...q, followup_state: 'veille', veille_until: addDays(auj, 1) }, auj)).toBe(false)
    expect(devisARelancer({ ...q, followup_state: 'veille', veille_until: auj }, auj)).toBe(true)
    const r = { ...q, quote_date: addDays(auj, -30), relance_count: 1, last_relance_date: addDays(auj, -3) }
    expect(devisARelancer(r, auj)).toBe(false)
    expect(devisARelancer({ ...r, last_relance_date: addDays(auj, -7) }, auj)).toBe(true)
    expect(devisARelancer({ ...r, relance_count: 2, last_relance_date: addDays(auj, -29) }, auj)).toBe(false)
    expect(devisARelancer({ ...q, status: 'partial', lost_reason: 'Prix' }, auj)).toBe(false)
    expect(devisARelancer({ ...q, status: 'accepted' }, auj)).toBe(false)
    expect(devisARelancer({ ...q, next_followup_date: addDays(auj, 3) }, auj)).toBe(false)
  })
})
