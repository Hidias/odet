// 0513 : postes et titres exigés (idée n° 3 reprise d'Odoo). Règles de l'écran ; la règle des écarts est en base
// (app.habilitations_ecarts, essai supabase/tests/postes_habilitations_0513.sql).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { libelleExigence, emploiDuContrat, erreurNomPoste } from '../src/modules/rh/lib/rhPostes'

describe('libelleExigence', () => {
  it('nomme le type, puis les symboles acceptés', () => {
    expect(libelleExigence('sst')).toBe('Sauveteur secouriste du travail')
    expect(libelleExigence('habilitation_electrique', ['BS'])).toBe('Habilitation électrique BS')
    expect(libelleExigence('habilitation_electrique', ['BS', 'BR', 'B1V'])).toBe('Habilitation électrique BS, BR ou B1V')
    expect(libelleExigence('inconnu', [])).toBe('Titre')
  })
})

describe('emploiDuContrat', () => {
  it('garde le texte saisi, sinon prend le nom du poste', () => {
    expect(emploiDuContrat('Chef d\'équipe', { name: 'Technicien' })).toBe('Chef d\'équipe')
    expect(emploiDuContrat('  ', { name: 'Technicien ' })).toBe('Technicien')
    expect(emploiDuContrat('', null)).toBe('')
  })
  it('suit le poste tant que l\'emploi reprend l\'ancien poste', () => {
    expect(emploiDuContrat('Technicien', { name: 'Formateur' }, { name: 'Technicien' })).toBe('Formateur')
    expect(emploiDuContrat('Technicien', null, { name: 'Technicien' })).toBe('Technicien')
    expect(emploiDuContrat('Chef d\'équipe', { name: 'Formateur' }, { name: 'Technicien' })).toBe('Chef d\'équipe')
  })
})

describe('erreurNomPoste', () => {
  const postes = [{ id: 'a', name: 'Technicien' }]
  it('refuse un nom trop court, trop long ou en double', () => {
    expect(erreurNomPoste(' x ', postes)).toMatch(/court/)
    expect(erreurNomPoste('x'.repeat(101), postes)).toMatch(/long/)
    expect(erreurNomPoste(' technicien ', postes)).toMatch(/existe/)
    expect(erreurNomPoste('Technicien', postes, 'a')).toBeNull()
    expect(erreurNomPoste('Formateur', postes)).toBeNull()
  })
})

describe('préparation de la nuit', () => {
  it('lance la préparation des actions sur les titres exigés', () => {
    const src = readFileSync('api/maintenance-nuit.js', 'utf8')
    expect(src).toMatch(/rpc\('habilitations_actions_generer'\)/)
    expect(src).toMatch(/habilitations, \.\.\.\(nbErreurs/)
  })
  it('affiche la source des actions préparées', () => {
    const src = readFileSync('src/core/point/ActionsEquipe.jsx', 'utf8')
    expect(src).toMatch(/habilitation: 'titres exigés'/)
    expect(src).toMatch(/a\.source !== 'habilitation' && \(direction/)
  })
})
