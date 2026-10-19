import { describe, it, expect } from 'vitest'
import { buildORG } from '../src/core/org/orgUtils'
import { buildDossierControlePDF } from '../src/modules/registre/pdf/dossierControlePDF'

// Dossier de contrôle du registre de sécurité (fonction 11, 0140) : se construit avec un registre vide ou rempli
describe('dossier de contrôle', () => {
  it('se construit avec un registre vide ou rempli', () => {
    const ORG = buildORG({ name: 'Organisme essai' })
    const vide = buildDossierControlePDF(ORG, { client: { name: 'Client' }, sites: [], dossier: [] })
    const plein = buildDossierControlePDF(ORG, {
      client: { name: 'Client essai' }, site: 's1', sites: [{ id: 's1', name: 'Siège' }],
      dossier: [{ piece: 'Consigne de sécurité incendie', ref: 'R4227-37', etat: 'manquant' }],
      verifications: [{ id: 'v', date: '2026-09-01', reference: 'VIS-1', site: 'Siège', appareils: 12, conformes: 11, a_remplacer: 1 }],
      parc: { appareils: 12, prochaine_verification: '2027-09-01', en_retard: 0 },
      exercices: [{ id: 'e', done_on: '2026-06-01', label: 'Exercice d\'évacuation', done_by: 'Entreprise', participants: 20, observations: 'RAS' }],
      personnel: [{ id: 'p', first_name: 'Alice', last_name: 'Essai', validites: [{ label: 'SST', valide_le: '2025-01-10', echeance: '2027-01-10', statut: 'a_jour' }] }],
      echeances: [{ due_on: '2026-12-01', label: 'Exercice', status: 'a_prevoir' }],
      documents: [{ title: 'Plan', issued_on: '2026-01-01', source: 'entreprise' }],
      duerp: { reference: 'DUERP-1', version: 2, date_prochaine_maj: '2027-03-01' },
    })
    expect(vide.getNumberOfPages()).toBeGreaterThanOrEqual(1)
    expect(plein.output('arraybuffer').byteLength).toBeGreaterThan(2000)
  })
})
