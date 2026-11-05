import { describe, it, expect } from 'vitest'
import { lireCsv, correspondanceAuto, construireSocietes, marquerDoublons, ligneClient, decoderFichier } from '../src/modules/commercial/lib/importCsv'

describe('import CSV générique (B3)', () => {
  it('lit les séparateurs ; , et tabulation, guillemets et retours à la ligne dans une cellule', () => {
    expect(lireCsv('Nom;Ville\n"A; B";Rennes\n').lignes).toEqual([['A; B', 'Rennes']])
    expect(lireCsv('Nom,Ville\r\n"Dupont ""et fils""",Brest\r\n').lignes).toEqual([['Dupont "et fils"', 'Brest']])
    expect(lireCsv('Nom\tVille\nX\tQuimper').lignes).toEqual([['X', 'Quimper']])
    expect(lireCsv('Nom;Adresse\nX;"1 rue\nbât. B"\n').lignes).toEqual([['X', '1 rue\nbât. B']])
    expect(lireCsv('﻿Nom;Ville\n\n;\nX;Y').lignes).toEqual([['X', 'Y']])
  })
  it('décode un fichier Windows-1252 (export Excel français)', () => {
    const octets = new Uint8Array([0x53, 0x6f, 0x63, 0x69, 0xe9, 0x74, 0xe9]) // « Société » en Windows-1252
    expect(decoderFichier(octets.buffer)).toBe('Société')
  })
  it('propose une correspondance, une colonne par champ', () => {
    const c = correspondanceAuto(['ID SOCIETE', 'NOM SOCIETE', 'SIRET SOCIETE', 'Code postal', 'VILLE', 'NOM CONTACT', 'PRENOM CONTACT', 'EMAIL CONTACT', 'EMAIL SOCIETE'])
    expect(c).toMatchObject({ external_ref: 0, name: 1, siret: 2, postal_code: 3, city: 4, contact_last_name: 5, contact_first_name: 6, contact_email: 7, email: 8 })
    expect(correspondanceAuto(['Raison sociale', 'Commune']).name).toBe(0)
    expect(correspondanceAuto(['Raison sociale', 'Commune']).city).toBe(1)
  })
  it('regroupe les contacts d\'une même société et écarte les lignes invalides avec un motif', () => {
    const lignes = [
      ['S1', 'ACME', '12345678901234', 'Martin', 'Léa', 'oui'],
      ['S1', 'ACME', '12345678901234', 'Durand', 'Paul', ''],
      ['', '', '', '', '', ''],
      ['S3', 'Beta', '123', '', '', ''],
      ['', 'Gamma', '', '', '', ''],
    ]
    const corr = { external_ref: 0, name: 1, siret: 2, contact_last_name: 3, contact_first_name: 4, contact_primary: 5 }
    const { societes, ecartees } = construireSocietes(lignes, corr)
    expect(societes.map((s) => s.name)).toEqual(['ACME', 'Gamma'])
    expect(societes[0].contacts.map((c) => c.name)).toEqual(['Léa Martin', 'Paul Durand'])
    expect(societes[0].contacts[0].is_primary).toBe(true)
    expect(societes[0].lignes).toEqual([2, 3])
    expect(ecartees).toEqual([
      { ligne: 4, motif: 'Nom de la société vide' },
      { ligne: 5, nom: 'Beta', motif: 'SIRET invalide (123) : 14 chiffres attendus' },
    ])
  })
  it('doublons par SIRET (base et fichier), nom connu non coché', () => {
    const societes = [
      { name: 'Un', siret: '11111111111111' }, { name: 'Deux', siret: '22222222222222' },
      { name: 'Deux bis', siret: '22222222222222' }, { name: 'Trois', siret: '' }, { name: 'quatre', siret: '' },
    ]
    const r = marquerDoublons(societes, [{ name: 'Existant', siret: '111 111 111 11111' }, { name: 'QUATRE', siret: null }])
    expect(r.map((s) => [s.etat, s.selected])).toEqual([
      ['doublon', false], ['nouveau', true], ['doublon', false], ['nouveau', true], ['nom_connu', false],
    ])
  })
  it('ligne client : source csv, identifiant gardé, contacts prioritaires sur les coordonnées', () => {
    const l = ligneClient({ name: 'acme', siret: '', external_ref: 'S1', email: 'a@b.fr', phone: '02', contacts: [{}] })
    expect(l).toMatchObject({ name: 'ACME', siret: null, external_source: 'csv', external_ref: 'S1', contact_email: null, contact_phone: null, email: 'a@b.fr', status: 'a_completer' })
  })
})
