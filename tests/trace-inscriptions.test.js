import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
vi.mock('../src/core/supabase', () => ({ supabase: {} }))
const { detailBase, detailInscription, actionDe } = await import('../src/core/audit/AuditLogs')

const retrait = {
  source: 'base', entity_type: 'inscription', action: 'delete',
  details: { session_reference: 'GLD-ESSAI', convention_signee: true, demi_journees_emargees: 3, fiche_remplie: true, evaluation_remplie: false },
}

describe('trace des inscriptions (0485)', () => {
  it('retrait : session, convention et données déjà saisies', () => {
    expect(detailBase(retrait)).toBe('Session GLD-ESSAI, convention signée, 3 demi-journées émargées, fiche de renseignement remplie')
    expect(actionDe(retrait).label).toBe('Retrait')
  })
  it('retrait sans émargement, ajout', () => {
    expect(detailInscription({ action: 'delete', details: { session_reference: 'X', demi_journees_emargees: 0 } })).toBe('Session X, aucun émargement')
    expect(detailInscription({ action: 'delete', details: { demi_journees_emargees: 1 } })).toBe('Session sans référence, 1 demi-journée émargée')
    const ajout = { source: 'base', entity_type: 'inscription', action: 'create', details: { session_reference: 'X' } }
    expect(detailBase(ajout)).toBe('Session X')
    expect(actionDe(ajout).label).toBe('Ajout')
  })
  it('retrait par suppression de la session ou du stagiaire : aucun faux « aucun émargement »', () => {
    expect(detailInscription({ action: 'delete', details: { suppression: 'session', convention_signee: null } })).toBe('Session supprimée avec ses inscriptions')
    expect(detailInscription({ action: 'delete', details: { suppression: 'stagiaire', session_reference: 'X' } })).toBe('Session X, fiche du stagiaire supprimée')
  })
  it('les autres lignes gardent leur libellé', () => {
    expect(actionDe({ entity_type: 'facture', action: 'delete' }).label).toBe('Suppression')
    expect(detailBase({ source: 'base', entity_type: 'facture', details: { table: 'invoices', champs: ['status'] } })).toBe('invoices : status')
  })
  it('la migration ne journalise jamais le nom du stagiaire', () => {
    const sql = readFileSync('supabase/migrations/0485_trace_inscriptions.sql', 'utf8').replace(/--.*$/gm, '')
    expect(sql).not.toMatch(/first_name|last_name|email|birth|ssn/)
    expect(sql).toMatch(/after insert or delete on public\.session_trainees/)
  })
})
