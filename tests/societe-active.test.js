// Société active des écrans société par société (contrats de travail) : choisie dans l'onglet, sinon la société par
// défaut du compte (une seule société, aucun choix fait), jamais en vue groupe.
import { describe, it, expect, afterEach } from 'vitest'
import { setCurrentCompanyId } from '../src/core/company/companyContext.js'
import { societeActive, VUE_GROUPE } from '../src/core/company/societes'

const CTX = { current: 'soc-defaut', vue_groupe: false, societes: [{ id: 'soc-defaut' }] }

describe('Société active', () => {
  afterEach(() => setCurrentCompanyId(null))

  it('une seule société, aucun choix : la société par défaut du compte', () => {
    expect(societeActive(CTX)).toBe('soc-defaut')
  })

  it('société choisie dans l\'onglet : celle-ci', () => {
    setCurrentCompanyId('soc-choisie')
    expect(societeActive(CTX)).toBe('soc-choisie')
  })

  it('vue groupe : aucune société', () => {
    setCurrentCompanyId(VUE_GROUPE)
    expect(societeActive({ ...CTX, vue_groupe: true })).toBeNull()
  })

  it('contexte pas encore chargé : aucune société', () => {
    expect(societeActive(null)).toBeNull()
  })
})
