// Avis des financeurs (0517, Qualiopi 30) : règles d'affichage, ligne de l'indicateur 30, liens avec la base.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { anneesFinanceurs, resumeFinanceurs, lignesIndicateur30, raisonSansDemande, TYPES_ECHANGE, TYPES_FINANCEUR, QUESTIONS_FINANCEUR } from '../src/modules/certification/lib/financeurs.js'
import { RULES } from '../src/modules/certification/lib/proofs.js'

const migration = readFileSync(new URL('../supabase/migrations/0517_avis_financeurs.sql', import.meta.url), 'utf8')

describe('avis des financeurs', () => {
  it('résumé de l\'année : couverts, avis reçus, sessions sans financeur ; lecture impossible = null', () => {
    expect(resumeFinanceurs(null)).toBeNull()
    expect(resumeFinanceurs({ financeurs: [{ couvert: true, demande: 'repondue' }, { couvert: true, demande: 'envoyee' }, { couvert: false, demande: null }], sans_financeur: [{ id: 1 }] }))
      .toEqual({ total: 3, couverts: 2, avis: 1, sansFinanceur: 1 })
  })

  it('lignes de l\'indicateur 30 : aucune sans financeur, rouges tant qu\'un financeur reste à solliciter ou n\'est pas renseigné', () => {
    expect(lignesIndicateur30(null, 2026)).toEqual([])
    expect(lignesIndicateur30({ total: 0, couverts: 0, avis: 0, sansFinanceur: 0 }, 2026)).toEqual([])
    expect(lignesIndicateur30({ total: 2, couverts: 2, avis: 1, sansFinanceur: 0 }, 2026)).toEqual([{ ok: true, label: 'Financeurs 2026 : 2 sur 2 sollicités ou rencontrés, 1 avis reçu' }])
    expect(lignesIndicateur30({ total: 3, couverts: 1, avis: 0, sansFinanceur: 0 }, 2026)).toEqual([{ ok: false, label: 'Financeurs 2026 : 1 sur 3 sollicités ou rencontrés ; 2 restent à solliciter' }])
    expect(lignesIndicateur30({ total: 0, couverts: 0, avis: 0, sansFinanceur: 2 }, 2026)).toEqual([{ ok: false, label: '2 sessions financées en 2026 sans financeur renseigné : ajoutez-le sur la session' }])
  })

  it('raison affichée quand rien n\'est préparé', () => {
    expect(raisonSansDemande({ couvert: true })).toBeNull()
    expect(raisonSansDemande({ demande: 'preparee' })).toBeNull()
    expect(raisonSansDemande({ type: 'cpf', sessions_terminees: 2, email_valide: true })).toMatch(/plateforme/)
    expect(raisonSansDemande({ type: 'opco', sessions_terminees: 1, email_valide: true, preparable: false }, false)).toMatch(/Année close/)
    expect(raisonSansDemande({ type: 'opco', sessions_terminees: 0, email_valide: true })).toMatch(/première session terminée/)
    expect(raisonSansDemande({ type: 'opco', sessions_terminees: 1, email: null, email_valide: false })).toMatch(/Aucune adresse/)
    expect(raisonSansDemande({ type: 'opco', sessions_terminees: 1, email: 'x@y', email_valide: false })).toMatch(/mal écrite/)
    expect(raisonSansDemande({ type: 'opco', sessions_terminees: 1, email: 'x@y.fr', email_valide: true, preparable: true })).toMatch(/nuit prochaine/)
  })

  it('indicateur 30 : la ligne des financeurs remplace « recueil à prévoir »', () => {
    const base = { n: { hotEvals: 1, coldEvals: 1, trainerEvals: 1, satisfactionSent: 1 } }
    expect(anneesFinanceurs(new Date('2027-03-31T21:00:00Z'))).toEqual([2027, 2026])
    expect(anneesFinanceurs(new Date('2027-03-31T22:30:00Z'))).toEqual([2027])
    const deux = RULES[30]({ ...base, financeurs: [{ annee: 2027, resume: { total: 0, couverts: 0, avis: 0, sansFinanceur: 0 } }, { annee: 2026, resume: { total: 1, couverts: 0, avis: 0, sansFinanceur: 0 } }] }).items
    expect(deux.find((i) => /Financeurs 2026/.test(i.label)).ok).toBe(false)
    const sans = RULES[30]({ ...base, financeurs: null }).items
    expect(sans.some((i) => /Financeurs/.test(i.label))).toBe(false)
    const avec = RULES[30]({ ...base, financeurs: [{ annee: 2026, resume: { total: 2, couverts: 1, avis: 0, sansFinanceur: 0 } }] }).items
    expect(avec.find((i) => /Financeurs 2026/.test(i.label)).ok).toBe(false)
    expect(JSON.stringify(avec)).not.toMatch(/recueil à prévoir/)
  })

  it('mêmes valeurs que la base (types, échanges, questions)', () => {
    expect(migration).toMatch(/funder_type in \('opco', 'region', 'autre', 'cpf', 'pole_emploi'\)\),/)
    for (const t of Object.keys(TYPES_FINANCEUR)) expect(migration).toContain(`'${t}'`)
    expect(migration).toContain(`kind in (${TYPES_ECHANGE.map(([v]) => `'${v}'`).join(', ')})`)
    for (const [q] of QUESTIONS_FINANCEUR) expect(migration).toMatch(new RegExp(`${q} smallint check`))
  })

  it('textes sans tiret cadratin', () => {
    const textes = [migration, readFileSync(new URL('../src/modules/certification/pages/AvisFinanceur.jsx', import.meta.url), 'utf8'),
      readFileSync(new URL('../src/modules/certification/components/SuiviFinanceurs.jsx', import.meta.url), 'utf8')]
    for (const t of textes) expect(t).not.toContain('—')
  })

  it('préparée la nuit et page publique déclarée', () => {
    expect(readFileSync(new URL('../api/maintenance-nuit.js', import.meta.url), 'utf8')).toMatch(/rpc\('financeurs_avis_preparer'\)/)
    expect(readFileSync(new URL('../src/app/App.jsx', import.meta.url), 'utf8')).toMatch(/path="\/avis-financeur\/:token"/)
    expect(migration).toMatch(/'\/#\/avis-financeur\/' \|\| v_d\.token/)
  })
})
