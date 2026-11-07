import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { nomMajuscules, prenomForme, nomAffiche, champsNomContact, memesMots } from '../src/core/nomPersonne.js'

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
    expect(prenomForme('jean\u00a0pierre')).toBe('Jean Pierre')
    expect(nomMajuscules('\u00a0durand\u00a0')).toBe('DURAND')
    expect(prenomForme('\ufeffjean\u202fpierre\u200b')).toBe('Jean Pierre')
  })

  it('même personne quel que soit l\'ordre ou la casse', () => {
    expect(memesMots('Paul Durand', 'DURAND Paul')).toBe(true)
    expect(memesMots('Paul Durand', 'DURAND Pierre')).toBe(false)
    expect(memesMots('Jean Pierre Durand', 'DURAND Jean-Pierre')).toBe(true)
    expect(memesMots('Durand, Paul', 'DURAND Paul')).toBe(true)
    expect(memesMots('Helene Durand', 'DURAND Hélène')).toBe(true)
    expect(memesMots('', '')).toBe(false)
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

  it('les formulaires de contact et l\'assistant multi-établissements passent par la règle commune', () => {
    for (const f of ['src/modules/commercial/pages/ClientDetail.jsx', 'src/modules/commercial/pages/Clients.jsx']) {
      const s = readFileSync(f, 'utf8')
      expect(s, f).toContain('champsNomContact(')
      expect(s, f).not.toMatch(/Prénom Nom \*|Nom complet \*/)
    }
    expect(readFileSync('src/modules/formation/components/MultiSiretWizard.jsx', 'utf8')).not.toMatch(/ilike\('name'/)
  })
})

import { nomContact, formuleAppel, nomAppel } from '../src/core/genre.js'
import { adressesProposees } from '../src/modules/commercial/lib/adressesEnvoi.js'
import { nomPourAppel } from '../src/core/nomPersonne.js'

describe('formule d\'appel en casse normale, affichage en « NOM Prénom »', () => {
  const c = { civilite: 'M', name: 'LE MEUR Ronan', last_name: 'LE MEUR', first_name: 'Ronan' }
  it('e-mails : « Ronan Le Meur », « Monsieur Le Meur »', () => {
    expect(nomContact({ ...c, civilite: null }, { appel: true })).toBe('Ronan Le Meur')
    expect(nomContact(c, { courte: false, nomDeFamille: true, appel: true })).toBe('Monsieur Le Meur')
    expect(formuleAppel({ genre: 'Mme', nom: nomAppel({ last_name: 'DURAND' }).nom })).toBe('Madame Durand,')
  })
  it('affichage : nom enregistré', () => {
    expect(nomContact(c)).toBe('M. LE MEUR Ronan')
    expect(nomContact({ name: 'Contact général' }, { appel: true })).toBe('Contact général')
  })
  it('formule d\'appel depuis un nom affiché, apostrophes', () => {
    expect(nomPourAppel('DURAND Paul')).toBe('Paul Durand')
    expect(nomPourAppel('Ronan LE MEUR')).toBe('Ronan Le Meur')
    expect(nomPourAppel('MARTIN')).toBe('Martin')
    expect(nomPourAppel('Contact général')).toBe('Contact général')
    expect(nomContact({ civilite: 'M', last_name: "D'ARTAGNAN", first_name: 'Charles' }, { courte: false, nomDeFamille: true, appel: true })).toBe("Monsieur D'Artagnan")
  })
  it('choix d\'adresse : pas de prénom doublé', () => {
    const l = adressesProposees([{ name: 'Paul', first_name: 'Paul', last_name: null, email: 'p@example.invalid' }])
    expect(l[0].libelle).toBe('Paul - p@example.invalid')
  })
})

import { texteRelance } from '../api/relances-circuit.js'
import { texteDemande } from '../api/nir-demande.js'

describe('e-mails automatiques au contact : formule d\'appel en casse normale', () => {
  it('relance participants et demande de numéro', () => {
    expect(texteRelance({ kind: 'participants', contact_name: 'MARTIN', start_date: '2026-12-01' }, 'Org').corps.startsWith('Bonjour Martin,')).toBe(true)
    expect(texteDemande({ contact_name: 'DURAND Paul', first_name: 'Léa', last_name: 'Roux', start_date: '2026-12-01', end_date: '2026-12-01' }).corps.startsWith('Bonjour Paul Durand,')).toBe(true)
  })
})
