import { describe, it, expect } from 'vitest'
import { visibleSections, sectionIdFor, NAV_SECTIONS, SETTINGS_ITEMS, entreesMenu, ongletsPour, visibleSettingsItems } from '../src/core/modules/registry'

const inconnus = () => null

describe('menu (ergonomie)', () => {
  it("l'accueil reste visible quels que soient les modules actifs", () => {
    const ids = visibleSections(['interventions'], 'admin', inconnus).map((s) => s.id)
    expect(ids[0]).toBe('accueil')
    expect(ids).toContain('entreprise')
    expect(ids).not.toContain('formation')
    expect(sectionIdFor('/')).toBe('accueil')
    expect(sectionIdFor('/sessions/abc')).toBe('formation')
  })

  it('chaque section a sa propre icône et chaque réglage un libellé court', () => {
    NAV_SECTIONS.forEach((s) => expect(s.icon, s.id).toBeTruthy())
    const icones = NAV_SECTIONS.map((s) => s.icon)
    expect(new Set(icones).size).toBe(icones.length)
    SETTINGS_ITEMS.forEach((i) => {
      expect(i.short, i.to).toBeTruthy()
      expect(i.short.length, i.to).toBeLessThanOrEqual(10)
    })
  })
})

describe('menu : rangement du 21/10', () => {
  it('pilotage sous une entrée, maintenance avant formation, DUERP avec la formation, réglages groupés', () => {
    const accueil = entreesMenu(NAV_SECTIONS.find((s) => s.id === 'accueil').items)
    expect(accueil.map((i) => i.label)).toEqual(['Tableau de bord', 'Pilotage'])
    expect(accueil[1].routes).toEqual(['/point-semaine', '/actions', '/reunions'])
    const ids = NAV_SECTIONS.map((s) => s.id)
    expect(ids.indexOf('entreprise')).toBeLessThan(ids.indexOf('formation'))
    expect(ids).not.toContain('prestations')
    expect(NAV_SECTIONS.find((s) => s.id === 'formation').items.map((i) => i.to)).toContain('/duerp')
    // DUERP visible sans le module formation
    const sansFormation = visibleSections(['duerp'], 'superadmin', () => null)
    expect(sansFormation.flatMap((s) => s.items.map((i) => i.to))).toContain('/duerp')
    expect(sansFormation.flatMap((s) => s.items.map((i) => i.to))).not.toContain('/sessions')
    const pied = entreesMenu(visibleSettingsItems('superadmin', () => true))
    expect(pied.map((i) => i.label)).toEqual(['Paramètres', 'Quoi de neuf', 'Retours des utilisateurs', 'Console'])
    expect(pied[0].routes).toEqual(['/parametres', '/regles-gestion'])
    // Direction sans Paramètres : Règles de gestion seule, sous son propre nom
    const direction = entreesMenu(visibleSettingsItems('direction', (c) => c !== 'parametres.ouvrir' && c !== 'plateforme.administrer' && c !== 'organisation.retours.suivre'))
    expect(direction.map((i) => i.label)).toContain('Règles de gestion')
  })
})

describe('menu : groupes de pages', () => {
  it('une entrée par groupe, au nom du groupe, qui mène à sa première page visible', () => {
    const qualite = NAV_SECTIONS.find((s) => s.id === 'qualite')
    const e = entreesMenu(qualite.items)
    expect(e.map((i) => i.label)).toEqual(['Qualiopi', 'Indicateurs', 'Registres', 'Conformité'])
    expect(e[3].routes).toEqual(['/conformite', '/audit-logs'])
    expect(e[0].to).toBe('/qualiopi')
    expect(e[0].routes).toContain('/qualite/completude')
    const formation = NAV_SECTIONS.find((s) => s.id === 'formation')
    expect(entreesMenu(formation.items).map((i) => i.label)).toEqual(['Sessions', 'Catalogue', 'Stagiaires', 'Passeport de prévention', 'Formateurs', 'Documents', 'DUERP'])
    // Groupe réduit à une page (droits, modules) : la page elle-même
    expect(entreesMenu([{ to: '/certification', label: 'Certification', groupe: 'qualiopi' }])[0].label).toBe('Certification')
  })

  it('onglets : pages visibles du même groupe, rien hors groupe', () => {
    const sections = visibleSections(['formation', 'qualite', 'certification'], 'superadmin', inconnus)
    expect(ongletsPour('/qualite/completude', sections).map((i) => i.to)).toEqual(['/qualiopi', '/certification', '/qualite', '/qualite/completude', '/bpf'])
    expect(ongletsPour('/formations/abc', sections).map((i) => i.to)).toEqual(['/formations', '/tests-positionnement', '/obligations'])
    expect(ongletsPour('/sessions', sections)).toEqual([])
  })
})

describe('menu : mode simple et « + Nouveau »', () => {
  it('mode simple : pages du quotidien seulement, les groupes gardent toutes leurs pages en onglets', async () => {
    const { visibleSections: vs, ongletsPour: op, creationsVisibles } = await import('../src/core/modules/registry')
    const mods = ['formation', 'commercial', 'qualite', 'interventions', 'affaires', 'pont', 'previsionnel', 'certification']
    const simple = vs(mods, 'admin', inconnus, { simple: true }).flatMap((s) => s.items).map((i) => i.to)
    expect(simple).toEqual(expect.arrayContaining(['/', '/sessions', '/clients', '/affaires', '/devis', '/factures', '/interventions', '/qualiopi']))
    expect(simple).not.toContain('/documents-vierges')
    expect(simple).not.toContain('/audit-logs')
    const complet = vs(mods, 'admin', inconnus)
    expect(op('/pistes', complet).map((i) => i.to)).toEqual(['/affaires', '/pistes', '/previsionnel', '/apports'])
    expect(creationsVisibles(mods, 'admin', inconnus).map((c) => c.label)).toEqual(['Session', 'Client', 'Affaire', 'Devis', 'Facture', 'Stagiaire', 'Intervention'])
    expect(creationsVisibles(mods, 'formateur', (c) => c === 'formation.sessions.voir_siennes').map((c) => c.label)).toEqual([])
  })
})
