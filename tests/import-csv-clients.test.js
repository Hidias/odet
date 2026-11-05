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
  it('un guillemet au milieu d\'une cellule ne fait pas perdre les lignes suivantes', () => {
    const r = lireCsv('Nom;Note;Ville\nA;Ecran 27" fourni;Rennes\nB;x;Brest\nC;y;Vannes')
    expect(r.lignes).toEqual([['A', 'Ecran 27" fourni', 'Rennes'], ['B', 'x', 'Brest'], ['C', 'y', 'Vannes']])
  })
  it('guillemet jamais refermé : ligne écartée avec motif, fins de ligne CR seules comptées', () => {
    const r = lireCsv('Nom;V\n"ACME;R\nB;Brest\nC;Vannes')
    const { societes, ecartees } = construireSocietes(r.lignes, { name: 0 }, r.infos, r.entetes.length)
    expect(societes).toHaveLength(0)
    expect(ecartees[0]).toMatchObject({ ligne: 2 })
    expect(ecartees[0].motif).toContain('Guillemet ouvert jamais refermé')
    expect(lireCsv('Nom;V\r"a\rb";R\rC;D').infos.map((x) => x.numero)).toEqual([2, 4])
  })
  it('cellules en trop et numéros de ligne réels : ligne écartée avec son vrai numéro', () => {
    const r = lireCsv('Nom,Adresse,Ville\nACME,12 rue X, bat B,Rennes\n\nB,"1 rue\nbis",Brest\nC,2 rue,Vannes,')
    expect(r.infos.map((x) => x.numero)).toEqual([2, 4, 6])
    const { societes, ecartees } = construireSocietes(r.lignes, { name: 0, address: 1, city: 2 }, r.infos, r.entetes.length)
    expect(societes.map((s) => s.name)).toEqual(['B', 'C'])
    expect(ecartees).toHaveLength(1)
    expect(ecartees[0]).toMatchObject({ ligne: 2, nom: 'ACME' })
    expect(ecartees[0].motif).toContain('4 cellules pour 3 colonnes')
  })
  it('décode un fichier Windows-1252 (export Excel français)', () => {
    const octets = new Uint8Array([0x53, 0x6f, 0x63, 0x69, 0xe9, 0x74, 0xe9]) // « Société » en Windows-1252
    expect(decoderFichier(octets.buffer)).toBe('Société')
    const utf16 = new Uint8Array([0xff, 0xfe, 0x4e, 0x00, 0xe9, 0x00]) // « Né » en UTF-16 (Texte Unicode d'Excel)
    expect(decoderFichier(utf16.buffer)).toBe('Né')
  })
  it('propose une correspondance, une colonne par champ', () => {
    const c = correspondanceAuto(['ID SOCIETE', 'NOM SOCIETE', 'SIRET SOCIETE', 'Code postal', 'VILLE', 'NOM CONTACT', 'PRENOM CONTACT', 'EMAIL CONTACT', 'EMAIL SOCIETE', 'TELEPHONE CONTACT', 'MOBILE CONTACT'])
    expect(c).toMatchObject({ external_ref: 0, name: 1, siret: 2, postal_code: 3, city: 4, contact_last_name: 5, contact_first_name: 6, contact_email: 7, email: 8, contact_phone: 9, contact_mobile: 10 })
    expect(correspondanceAuto(['Raison sociale', 'Commune']).name).toBe(0)
    expect(correspondanceAuto(['Raison sociale', 'Commune']).city).toBe(1)
  })
  it('regroupe les contacts d\'une même société et écarte les lignes invalides avec un motif', () => {
    const lignes = [
      ['S1', 'ACME', '12345678901234', 'Martin', 'Léa', 'oui'],
      ['S1', 'ACME', '12345678901234', 'Durand', 'Paul', 'oui'],
      ['', '', '', '', '', ''],
      ['S3', 'Beta', '123', '', '', ''],
      ['', 'Gamma', '', '', '', ''],
    ]
    const corr = { external_ref: 0, name: 1, siret: 2, contact_last_name: 3, contact_first_name: 4, contact_primary: 5 }
    const { societes, ecartees } = construireSocietes(lignes, corr)
    expect(societes.map((s) => s.name)).toEqual(['ACME', 'Gamma'])
    expect(societes[0].contacts.map((c) => c.name)).toEqual(['Léa Martin', 'Paul Durand'])
    // Un seul contact principal par société : le premier marqué
    expect(societes[0].contacts.map((c) => c.is_primary)).toEqual([true, false])
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
    // Même nom deux fois dans le fichier, sans SIRET : le second n'est pas coché
    const f = marquerDoublons([{ name: 'Zeta', siret: '' }, { name: 'ZETA', siret: '' }], [])
    expect(f.map((s) => s.etat)).toEqual(['nouveau', 'nom_connu'])
    // Contacts d'un doublon interne signalés
    const d = marquerDoublons([{ name: 'A', siret: '33333333333333', contacts: [] }, { name: 'A2', siret: '33333333333333', contacts: [{ name: 'Léa Martin' }] }], [])
    expect(d[1].motif).toContain('1 contact(s) non importé(s) : Léa Martin')
  })
  it('ligne client : source csv, identifiant gardé, contacts prioritaires sur les coordonnées', () => {
    const l = ligneClient({ name: 'acme', siret: '', external_ref: 'S1', email: 'a@b.fr', phone: '02', contacts: [{}] })
    expect(l).toMatchObject({ name: 'ACME', siret: null, external_source: 'csv', external_ref: 'S1', contact_email: null, contact_phone: null, email: 'a@b.fr', status: 'a_completer' })
    // Le standard n'est pas perdu quand il y a des contacts
    expect(l.notes).toBe('Téléphone de la société : 02')
    expect(ligneClient({ name: 'b', phone: '02', contacts: [] })).toMatchObject({ contact_phone: '02', notes: null })
  })
})
