import { describe, it, expect } from 'vitest'
import {
  bilanSession, blocageSuppressionSession, alerteSuppressionSession, alerteAnnulationSession,
  bilanStagiaire, alerteSuppressionStagiaire, erreurSuppressionSession,
} from '../src/modules/formation/lib/alertesAction.js'

// Faux client : chaque table renvoie le nombre donné (ou une erreur), quel que soit le filtre
const fauxSupabase = (compte) => ({
  from: (table) => {
    const filtres = []
    const q = {
      select: () => q,
      eq: (col, val) => { filtres.push(`${col}=${val}`); return q },
      then: (ok) => ok(compte(table, filtres)),
    }
    return q
  },
})

describe('Suppression de session', () => {
  it('liste ce qui sera effacé et propose le statut Annulée', () => {
    const a = alerteSuppressionSession({ reference: 'SES-1', convention_signed: true }, { inscrits: 3, demiJournees: 5, evaluations: 2, factures: 0, devis: 0 })
    expect(a.danger).toBe(true)
    expect(a.confirmLabel).toBe('Supprimer quand même')
    expect(a.message).toContain('3 inscriptions de stagiaires')
    expect(a.message).toContain('5 demi-journées émargées')
    expect(a.message).toContain('2 évaluations')
    expect(a.message).toContain('la convention signée')
    expect(a.message).toContain('« Annulée »')
  })
  it('session vide : message court, singulier correct', () => {
    const a = alerteSuppressionSession({}, { inscrits: 0, demiJournees: 0, evaluations: 0 })
    expect(a.confirmLabel).toBe('Supprimer')
    expect(a.message).toContain('sera supprimée définitivement')
    expect(alerteSuppressionSession({}, { inscrits: 1 }).message).toContain('1 inscription de stagiaire')
  })
  it('certificats SST, attestations, évaluations à froid et fiches sont cités', () => {
    const m = alerteSuppressionSession({}, { certificats: 2, documents: 1, froid: 3, fiches: 4 }).message
    expect(m).toContain('2 certificats SST')
    expect(m).toContain('1 attestation ou document remis')
    expect(m).toContain('3 évaluations à froid')
    expect(m).toContain('4 fiches de renseignements')
  })
  it('refus de clé étrangère : texte clair, pas le message technique', () => {
    expect(erreurSuppressionSession({ code: '23503', message: 'violates foreign key' })).not.toContain('foreign')
    expect(erreurSuppressionSession({ code: '42501', message: 'refus' })).toBe('Suppression impossible : refus')
  })
  it('bilan incomplet : le dit', () => {
    expect(alerteSuppressionSession({}, { inscrits: null }).message).toContain('pas pu être vérifiée')
  })
  it('facture ou devis lié : suppression bloquée avec la raison', () => {
    expect(blocageSuppressionSession({ factures: 0, devis: 0 })).toBeNull()
    expect(blocageSuppressionSession({ factures: 1 })).toContain('1 facture')
    expect(blocageSuppressionSession({ factures: 2, devis: 1 })).toContain('2 factures et 1 devis')
  })
  it('bilan lu en base : demi-journées = matins + après-midi, erreur = null', async () => {
    const sb = fauxSupabase((table, f) => {
      if (table === 'attendance_halfdays') return { count: f.includes('morning=true') ? 4 : 3 }
      if (table === 'quotes') return { count: null, error: { message: 'refus' } }
      return { count: 1 }
    })
    const b = await bilanSession(sb, 's1')
    expect(b).toEqual({ inscrits: 1, demiJournees: 7, evaluations: 1, factures: 1, devis: null, froid: 1, certificats: 1, documents: 1, fiches: 1 })
  })
})

describe('Annulation de session', () => {
  it('rien d\'engagé : pas de fenêtre', () => {
    expect(alerteAnnulationSession({ status: 'confirmed', session_trainees: [] })).toBeNull()
    expect(alerteAnnulationSession({ status: 'cancelled', convention_signed: true })).toBeNull()
  })
  it('convention signée et convocations envoyées : alerte', () => {
    const a = alerteAnnulationSession({ status: 'confirmed', convention_signed: true, session_trainees: [{ convocation_sent_at: '2026-11-01' }, {}] })
    expect(a.danger).toBe(true)
    expect(a.message).toContain('la convention est signée')
    expect(a.message).toContain('1 stagiaire a reçu sa convocation')
    expect(a.message).toContain('ne prévient personne')
  })
  it('sous-traitance : la convention du donneur d\'ordre ne compte pas', () => {
    expect(alerteAnnulationSession({ status: 'confirmed', convention_signed: true, session_type: 'subcontract', session_trainees: [] })).toBeNull()
  })
})

describe('Suppression de stagiaire', () => {
  it('liste les preuves effacées', () => {
    const a = alerteSuppressionStagiaire({ first_name: 'Jeanne', last_name: 'Fictive' }, { sessions: 2, demiJournees: 4, evaluations: 1, certificats: 1, documents: 0 })
    expect(a.danger).toBe(true)
    expect(a.message).toContain('Supprimer Jeanne Fictive')
    expect(a.message).toContain('2 inscriptions à des sessions')
    expect(a.message).toContain('1 certificat SST')
    expect(a.message).toContain('preuves Qualiopi')
  })
  it('stagiaire sans historique', () => {
    const a = alerteSuppressionStagiaire({ first_name: 'Paul' }, { sessions: 0 })
    expect(a.confirmLabel).toBe('Supprimer')
    expect(a.message).toContain('Paul sera supprimé définitivement')
  })
  it('bilan lu en base', async () => {
    const sb = fauxSupabase((table, f) => ({ count: table === 'attendance_halfdays' ? (f.includes('morning=true') ? 2 : 1) : 1 }))
    expect(await bilanStagiaire(sb, 't1')).toEqual({ sessions: 1, demiJournees: 3, evaluations: 1, certificats: 1, documents: 1 })
  })
})

describe('Nombre de mails des évaluations à froid', () => {
  it('un mail par stagiaire, un seul par session et adresse pour les contacts', async () => {
    const { nombreDeMails } = await import('../src/modules/qualite/lib/froid.js')
    expect(nombreDeMails([
      { id: 1, cible: 'stagiaire', session_id: 's', destinataire: 'a@x.fr' },
      { id: 2, cible: 'stagiaire', session_id: 's', destinataire: 'b@x.fr' },
      { id: 3, cible: 'contact', session_id: 's', destinataire: 'RH@x.fr' },
      { id: 4, cible: 'employeur', session_id: 's', destinataire: 'rh@x.fr' },
      { id: 5, cible: 'contact', session_id: 't', destinataire: 'rh@x.fr' },
    ])).toBe(4)
  })
})
