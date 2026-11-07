import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 0502 : trainee_ssn ne garde plus le numéro en clair ; la reprise du Passeport passe par la fonction réservée au serveur
describe('numéro de sécurité sociale chiffré (0502)', () => {
  const api = readFileSync('api/passeport.js', 'utf8')
  const migration = readFileSync('supabase/migrations/0502_nir_chiffre.sql', 'utf8')
  it('la reprise du Passeport lit les numéros par trainee_ssn_a_reprendre, plus dans la table', () => {
    expect(api).toContain("admin.rpc('trainee_ssn_a_reprendre')")
    expect(api).not.toMatch(/from\('trainee_ssn'\)\.select\(/)
  })
  it('fonction réservée à la clé de service, colonne en clair interdite', () => {
    expect(migration).toContain('grant execute on function public.trainee_ssn_a_reprendre() to service_role;')
    expect(migration).toContain('revoke all on function public.trainee_ssn_a_reprendre() from public, anon, authenticated;')
    expect(migration).toContain('check (ssn is null)')
  })
})
