// Vérification du n° de sécurité sociale (22/10, décision de H) : une seule règle pour l'espace entreprise,
// le portail stagiaire, la fiche stagiaire et le Passeport de prévention.
import { describe, it, expect } from 'vitest'
import { verifierNir, formaterNir, cleNir } from '../src/core/nir/verifierNir'
import { normaliserNir } from '../src/modules/passeport/lib/rules'

describe('verifierNir', () => {
  it('accepte 15 caractères avec la bonne clé, espaces ignorés', () => {
    const v = verifierNir('1 85 05 78 006 084 91')
    expect(v).toMatchObject({ ok: true, nir15: '185057800608491', nir13: '1850578006084', erreurs: [], alertes: [] })
  })
  it('demande la clé quand il manque les 2 derniers chiffres', () => {
    expect(verifierNir('1850578006084').erreurs[0]).toMatch(/Il manque la clé/)
  })
  it('refuse une mauvaise clé', () => {
    expect(verifierNir('185057800608492').ok).toBe(false)
    expect(verifierNir('185057800608492').erreurs[0]).toMatch(/clé/)
  })
  it('gère la Corse (2A, 2B)', () => {
    expect(cleNir('185052A012345')).toBe(97 - (1850519012345 % 97))
    expect(verifierNir(`185052A012345${String(cleNir('185052A012345')).padStart(2, '0')}`).ok).toBe(true)
  })
  it('accepte un numéro provisoire avec une alerte', () => {
    const v = verifierNir(`7850578006084${String(cleNir('7850578006084')).padStart(2, '0')}`)
    expect(v.ok).toBe(true)
    expect(v.provisoire).toBe(true)
    expect(v.alertes.join()).toMatch(/provisoire/)
  })
  it('alerte sans bloquer quand la fiche ne correspond pas', () => {
    const v = verifierNir('185057800608491', { gender: 'female', birth_date: '1986-06-02' })
    expect(v.ok).toBe(true)
    expect(v.alertes.length).toBe(3)
    expect(verifierNir('185057800608491', { gender: 'male', birth_date: '1985-05-02' }).alertes).toEqual([])
  })
  it('refuse les lettres hors Corse et les tailles fausses', () => {
    expect(verifierNir('1850578X0608491').ok).toBe(false)
    expect(verifierNir('18505').erreurs[0]).toMatch(/15 caractères/)
    expect(verifierNir('').vide).toBe(true)
  })
  it('affiche par groupes', () => expect(formaterNir('185057800608491')).toBe('1 85 05 78 006 084 91'))
})

describe('Passeport de prévention : numéro tapé', () => {
  it('exige la clé à la saisie, garde la règle d\'origine pour les numéros enregistrés', () => {
    expect(normaliserNir('1850578006084', { saisie: true }).ok).toBe(false)
    expect(normaliserNir('185057800608491', { saisie: true })).toMatchObject({ ok: true, nir: '1850578006084' })
    expect(normaliserNir('1850578006084').ok).toBe(true)
  })
})
