import { describe, it, expect } from 'vitest'
import { alerteConventionSignee } from '../src/modules/formation/lib/conventionSignee.js'

describe('Alerte convention signée', () => {
  it('aucune alerte sans convention signée', () => {
    expect(alerteConventionSignee({ convention_signed: false }, 'retrait')).toBeNull()
    expect(alerteConventionSignee(null, 'retrait')).toBeNull()
  })
  it('retrait sur convention signée : alerte rouge qui parle d\'avenant', () => {
    const a = alerteConventionSignee({ convention_signed: true, convention_signed_date: '2026-10-22T10:55:18Z' }, 'retrait')
    expect(a.danger).toBe(true)
    expect(a.message).toContain('22/10/2026')
    expect(a.message).toContain('avenant')
  })
  it('ajout sur convention signée : alerte aussi', () => {
    expect(alerteConventionSignee({ convention_signed: true }, 'ajout').confirmLabel).toBe('Ajouter quand même')
  })
  it('sous-traitance : pas d\'alerte', () => {
    expect(alerteConventionSignee({ convention_signed: true, session_type: 'subcontract' }, 'retrait')).toBeNull()
  })
})
