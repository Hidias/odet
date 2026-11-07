import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { nomMajuscules, prenomForme, nomAffiche, champsNomContact } from '../src/core/nomPersonne.js'

describe('contacts en « NOM Prénom » (même règle que 0508)', () => {
  it('nom en majuscules, accents et particules compris, espaces en trop retirés', () => {
    expect(nomMajuscules('  le   régent ')).toBe('LE RÉGENT')
    expect(nomMajuscules('bou-sahla')).toBe('BOU-SAHLA')
    expect(nomMajuscules('   ')).toBeNull()
  })

  it('prénom : majuscule au début de chaque partie, prénoms composés compris', () => {
    expect(prenomForme('jEAN-pierre  marie')).toBe('Jean-Pierre Marie')
    expect(prenomForme('ÉLODIE')).toBe('Élodie')
    expect(prenomForme('laïna')).toBe('Laïna')
    expect(prenomForme('')).toBeNull()
  })

  it('nom affiché « NOM Prénom », ou le seul élément connu', () => {
    expect(nomAffiche('durand', 'paul')).toBe('DURAND Paul')
    expect(nomAffiche('martin', '')).toBe('MARTIN')
    expect(nomAffiche('', ' olga ')).toBe('Olga')
    expect(nomAffiche('', '')).toBeNull()
  })

  it('formulaire : nom libre gardé sans nom ni prénom, erreur sans rien', () => {
    expect(champsNomContact({ last_name: 'durand', first_name: 'paul' }, 'Contact général'))
      .toEqual({ last_name: 'DURAND', first_name: 'Paul', name: 'DURAND Paul' })
    expect(champsNomContact({ last_name: '', first_name: '' }, 'Contact général'))
      .toEqual({ last_name: null, first_name: null, name: 'Contact général' })
    expect(champsNomContact({ last_name: ' ', first_name: '' }).erreur).toBeTruthy()
  })

  it('les deux formulaires de contact passent par la règle commune', () => {
    for (const f of ['src/modules/commercial/pages/ClientDetail.jsx', 'src/modules/commercial/pages/Clients.jsx']) {
      const s = readFileSync(f, 'utf8')
      expect(s, f).toContain('champsNomContact(')
      expect(s, f).not.toMatch(/Prénom Nom \*|Nom complet \*/)
    }
  })
})
