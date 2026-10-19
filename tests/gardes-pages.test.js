import { describe, it, expect } from 'vitest'
import { accesPage, itemAutorise, visibleSections, visibleSettingsItems, entreePourChemin, NAV_SECTIONS } from '../src/core/modules/registry'

// can() comme le magasin : true / false si les droits sont connus, null sinon
const avec = (...droits) => (code) => droits.includes(code)
const inconnus = () => null

describe('gardes des pages (ecrans/gardes)', () => {
  it('droits inconnus : comportement des rôles, Paramètres au seul super administrateur', () => {
    expect(accesPage('/factures', 'formateur', inconnus)).toBe(false)
    expect(accesPage('/factures', 'commercial', inconnus)).toBe(true)
    expect(accesPage('/parametres', 'admin', inconnus)).toBe(false)
    expect(accesPage('/parametres', 'superadmin', inconnus)).toBe(true)
    expect(accesPage('/setup', 'admin', inconnus)).toBe(false)
    expect(accesPage('/budget', 'gestionnaire', inconnus)).toBe(false)
  })

  it('Paramètres : administrateur seulement avec le droit (licence totale), direction jamais', () => {
    expect(accesPage('/parametres', 'admin', avec('parametres.ouvrir'))).toBe(true)
    expect(accesPage('/parametres', 'admin', avec('clients.fiches.voir'))).toBe(false)
    expect(accesPage('/parametres', 'direction', avec('parametres.ouvrir'))).toBe(false)
    expect(accesPage('/audit-logs', 'direction', avec('qualite.registres.voir'))).toBe(false)
    expect(accesPage('/audit-logs', 'admin', avec('conformite.journal.voir'))).toBe(true)
  })

  it('les droits ne font que restreindre : un droit en trop n\'ouvre pas une page hors du rôle', () => {
    expect(accesPage('/budget', 'gestionnaire', avec('finance.budget.gerer'))).toBe(false)
    expect(accesPage('/budget', 'direction', avec('finance.budget.gerer'))).toBe(true)
  })

  it('adresse directe : fiche, sous-page, liste de droits', () => {
    expect(entreePourChemin('/sessions/abc').to).toBe('/sessions')
    expect(accesPage('/sessions/abc', 'formateur', avec('formation.sessions.voir_siennes'))).toBe(true)
    expect(accesPage('/sessions/abc', 'formateur', avec())).toBe(false)
    expect(accesPage('/console/erreurs', 'admin', avec('parametres.ouvrir'))).toBe(false)
    expect(accesPage('/mot-de-passe', 'lecture', avec())).toBe(true)
    expect(accesPage('/adresse-inconnue', 'lecture', avec())).toBe(true)
  })

  it('rôle de base « membre » : seulement ses droits', () => {
    expect(itemAutorise({ to: '/factures', roles: ['admin'], right: 'facturation.factures.voir' }, 'membre', avec('facturation.factures.voir'))).toBe(true)
  })

  it('menu : même table que la garde', () => {
    const can = avec('clients.fiches.voir', 'commercial.devis.voir')
    const items = visibleSections(['commercial'], 'commercial', can).flatMap((s) => s.items).map((i) => i.to)
    expect(items).toContain('/clients')
    expect(items).toContain('/devis')
    expect(items).not.toContain('/factures')
    expect(visibleSettingsItems('admin', avec()).map((i) => i.to)).toEqual([])
    expect(visibleSettingsItems('superadmin', inconnus).map((i) => i.to)).toEqual(['/parametres', '/console'])
  })

  it('chaque entrée du menu (sauf l\'accueil) a un droit', () => {
    const sans = NAV_SECTIONS.flatMap((s) => s.items).filter((i) => i.to !== '/' && !i.right).map((i) => i.to)
    expect(sans).toEqual([])
  })
})

import { peut } from '../src/core/rights/useDroit'

describe('gardes des boutons', () => {
  it('droit connu décide ; inconnu : rôles de repli ou affiché comme avant', () => {
    expect(peut((c) => c === 'formation.sessions.creer', 'lecture', 'formation.sessions.creer')).toBe(true)
    expect(peut(() => false, 'admin', 'formation.sessions.creer')).toBe(false)
    expect(peut(() => null, 'lecture', 'formation.sessions.creer')).toBe(true)
    expect(peut(() => null, 'lecture', 'formation.sessions.creer', ['admin'])).toBe(false)
    expect(peut((c) => c === 'b', 'x', ['a', 'b'])).toBe(true)
  })
})
