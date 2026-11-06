// A11 lot 4 (06/11) : accords de l'état du document d'un groupe, champs nommés du formulaire client,
// libellé du bouton de signature de l'émargement.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { etatDocumentGroupe } from '../src/modules/formation/lib/conventionGroupe'

describe('etatDocumentGroupe', () => {
  it('accorde la convention au féminin', () => {
    expect(etatDocumentGroupe({ kind: 'entreprise', doc_status: 'signe' })).toEqual({ document: 'Convention', etat: 'signée' })
    expect(etatDocumentGroupe({ kind: 'entreprise', doc_status: 'envoye' }).etat).toBe('envoyée')
  })
  it('accorde le contrat au masculin', () => {
    expect(etatDocumentGroupe({ kind: 'particulier', doc_status: 'signe' })).toEqual({ document: 'Contrat', etat: 'signé' })
    expect(etatDocumentGroupe({ kind: 'particulier', doc_status: 'envoye' }).etat).toBe('envoyé')
  })
  it('état vide ou inconnu : à envoyer', () => {
    expect(etatDocumentGroupe({ kind: 'entreprise' }).etat).toBe('à envoyer')
    expect(etatDocumentGroupe({ kind: 'entreprise', doc_status: 'xyz' }).etat).toBe('à envoyer')
    expect(etatDocumentGroupe(null)).toEqual({ document: 'Convention', etat: 'à envoyer' })
  })
})

describe('formulaire Nouveau client', () => {
  const src = readFileSync('src/modules/commercial/pages/Clients.jsx', 'utf8')
  it('chaque étiquette est reliée à son champ', () => {
    for (const id of ['client-nom', 'client-siret', 'client-adresse', 'client-cp', 'client-ville', 'client-tel', 'client-email', 'client-tva', 'client-contact', 'client-fonction', 'client-notes']) {
      expect(src).toContain(`htmlFor="${id}"`)
      expect(src).toContain(`id="${id}"`)
    }
  })
})

describe('fiche session', () => {
  it('le bouton de signature dit ce qu\'on signe', () => {
    const src = readFileSync('src/modules/formation/pages/SessionDetail.jsx', 'utf8')
    expect(src).toContain("Faire signer l'émargement")
  })
})

import { finApresDebut, jourDeWeekEnd, alerteWeekEnd } from '../src/modules/formation/components/CircuitSession'

describe('Contrôler et confirmer : dates', () => {
  it('une session d\'un jour suit le nouveau début', () => {
    expect(finApresDebut({ start_date: '2026-12-06', end_date: '2026-12-06' }, '2026-12-08')).toBe('2026-12-08')
  })
  it('une session de plusieurs jours se décale en bloc, dans les deux sens', () => {
    expect(finApresDebut({ start_date: '2026-12-08', end_date: '2026-12-09' }, '2026-12-15')).toBe('2026-12-16')
    expect(finApresDebut({ start_date: '2026-12-08', end_date: '2026-12-09' }, '2026-12-01')).toBe('2026-12-02')
    expect(finApresDebut({ start_date: '2026-12-30', end_date: '2027-01-02' }, '2027-02-27')).toBe('2027-03-02')
  })
  it('début effacé : la fin est gardée', () => {
    expect(finApresDebut({ start_date: '2026-12-08', end_date: '2026-12-09' }, '')).toBe('2026-12-09')
  })
  it('sans fin saisie, rien ne change', () => {
    expect(finApresDebut({ start_date: '2026-12-06', end_date: '' }, '2026-12-08')).toBe('')
  })
  it('passage à l\'heure d\'hiver sans décalage d\'un jour', () => {
    expect(finApresDebut({ start_date: '2026-10-24', end_date: '2026-10-26' }, '2026-10-24')).toBe('2026-10-26')
    expect(finApresDebut({ start_date: '2026-10-20', end_date: '2026-10-21' }, '2026-10-25')).toBe('2026-10-26')
  })
  it('signale samedi et dimanche, au début comme à la fin', () => {
    expect(jourDeWeekEnd('2026-12-06')).toBe('dimanche')
    expect(jourDeWeekEnd('2026-12-05')).toBe('samedi')
    expect(jourDeWeekEnd('2026-12-08')).toBe(null)
    expect(jourDeWeekEnd('')).toBe(null)
    expect(alerteWeekEnd({ start_date: '2026-12-08', end_date: '2026-12-08' })).toBe(null)
    expect(alerteWeekEnd({ start_date: '2026-12-06', end_date: '2026-12-06' })).toContain('début tombe un dimanche')
    expect(alerteWeekEnd({ start_date: '2026-12-04', end_date: '2026-12-05' })).toContain('fin tombe un samedi')
    expect(alerteWeekEnd({ start_date: '2026-12-05', end_date: '2026-12-06' })).toContain('et la fin un dimanche')
  })
})

describe('textes', () => {
  it('participants : pluriel accordé, genre annoncé obligatoire', () => {
    for (const f of ['src/modules/portail/pages/ClientPortal.jsx', 'src/modules/portail/pages/EspaceEntreprise.jsx']) {
      expect(readFileSync(f, 'utf8')).not.toContain('participant(s)')
    }
    expect(readFileSync('src/modules/portail/components/ParticipantsSession.jsx', 'utf8')).toContain('le nom et le genre sont obligatoires')
  })
  it('bandeau du mode démonstration : le super administrateur est prévenu de ses envois réels', () => {
    expect(readFileSync('src/app/Layout.jsx', 'utf8')).toContain('partent aux vrais destinataires, avec une copie cachée pour vous')
  })
  it('devis : contact proposé d\'office', () => {
    const q = readFileSync('src/modules/commercial/pages/Quotes.jsx', 'utf8')
    expect(q).toContain('loadClientContacts(clientId).then((liste) => proposerContact(clientId, liste))')
    expect(q).toContain('proposerContact(client.id, await loadClientContacts(client.id))')
  })
})
