import { describe, it, expect } from 'vitest'
import { etatEcheance, nomFichierSur, CATEGORIES_DOC } from '../src/modules/rh/lib/rhDocuments'

describe('RH documents : échéances', () => {
  it('dépassée, proche, à jour', () => {
    expect(etatEcheance('2026-10-01', '2026-10-19').label).toBe('Dépassée')
    expect(etatEcheance('2026-10-19', '2026-10-19').label).toBe("Aujourd'hui")
    expect(etatEcheance('2026-11-18', '2026-10-19').label).toBe('Dans 30 j')
    expect(etatEcheance('2027-10-19', '2026-10-19').label).toBe('À jour')
    expect(etatEcheance(null)).toBeNull()
  })
})

describe('RH documents : noms de fichier', () => {
  it('sans accent ni caractère spécial', () => {
    expect(nomFichierSur('Avis d’aptitude été 2026.pdf')).toBe('Avis-d-aptitude-ete-2026.pdf')
    expect(nomFichierSur('')).toBe('document')
    expect(nomFichierSur('a/b\\c.pdf')).toBe('a-b-c.pdf')
  })
})

describe('RH documents : confidentialité imposée', () => {
  it('bulletin privé, justificatif et santé restreints, contrat dans le dossier', () => {
    expect(CATEGORIES_DOC.bulletin.conf).toBe('prive')
    expect(CATEGORIES_DOC.justificatif.conf).toBe('restreint')
    expect(CATEGORIES_DOC.sante.conf).toBe('restreint')
    expect(CATEGORIES_DOC.contrat.conf).toBe('normal')
  })
})
