import { describe, it, expect } from 'vitest'
import { envoiParGroupe, groupesActifs, prixDuGroupe, inscritsDuGroupe, sessionDuGroupe, destinataireDuGroupe, financementDuGroupe, refusPublicationGroupe } from '../src/modules/formation/lib/conventionGroupe'

// Session inter avec deux entreprises (Alpha, Beta) et un stagiaire sans groupe
const session = {
  id: 's1', session_type: 'inter', client_id: 'principal', clients: { id: 'principal', name: 'Client principal' },
  contact: { id: 'cp', email: 'principal@exemple.fr' }, contact_id: 'cp', signatory_name: 'Signataire principal', signatory_role: 'Gérant',
  total_price: 3000, funding_type: 'opco', funding_details: 'OPCO du client principal, dossier 999',
  session_trainees: [
    { trainee_id: 't1', group_id: 'gA', trainees: { id: 't1' } },
    { trainee_id: 't2', group_id: 'gA', trainees: { id: 't2' } },
    { trainee_id: 't3', group_id: 'gB', trainees: { id: 't3' } },
    { trainee_id: 't4', group_id: null, trainees: { id: 't4' } },
  ],
}
const alpha = {
  id: 'gA', kind: 'entreprise', client_id: 'A', contact_id: 'ca', price_per_person: 250, status: 'confirmed', doc_status: 'a_envoyer',
  clients: { id: 'A', name: 'Alpha', email: 'accueil@alpha.fr' }, contact: { id: 'ca', client_id: 'A', first_name: 'Anne', last_name: 'Alpha', fonction: 'DRH', email: 'anne@alpha.fr' },
}
const beta = { id: 'gB', kind: 'entreprise', client_id: 'B', contact_id: null, price_total: 400, status: 'pending', clients: { id: 'B', name: 'Beta', contact_email: 'contact@beta.fr' } }
const annule = { id: 'gC', kind: 'entreprise', client_id: 'C', status: 'cancelled' }
const particulier = { id: 'gP', kind: 'particulier', client_id: 'P', contact_id: 'cp', clients: { id: 'P', name: 'Paul Particulier', email: 'paul@exemple.fr' }, contact: { id: 'cp', email: 'principal@exemple.fr' } }

describe('Envoi d\'une session inter par groupe (06/11)', () => {
  it('une inter avec au moins un groupe actif s\'envoie par groupe ; une intra ou une inter sans groupe, non', () => {
    expect(envoiParGroupe(session, [alpha])).toBe(true)
    expect(envoiParGroupe(session, [annule])).toBe(false)
    expect(envoiParGroupe(session, [])).toBe(false)
    expect(envoiParGroupe({ ...session, session_type: 'intra' }, [alpha])).toBe(false)
    expect(groupesActifs([alpha, annule, beta, null]).map((g) => g.id)).toEqual(['gA', 'gB'])
  })

  it('la session vue d\'un groupe ne garde que son client, son espace, son signataire, son prix et ses stagiaires', () => {
    const vue = sessionDuGroupe(session, alpha)
    expect(vue.client_id).toBe('A')
    expect(vue.clients.name).toBe('Alpha')
    expect(vue.contact.email).toBe('anne@alpha.fr')
    expect(vue.signatory_name).toBe('Anne Alpha')
    expect(vue.signatory_role).toBe('DRH')
    expect(vue.total_price).toBe(500)
    expect(vue.session_trainees.map((st) => st.trainee_id)).toEqual(['t1', 't2'])
    // La session d'origine n'est pas modifiée
    expect(session.client_id).toBe('principal')
    expect(session.session_trainees).toHaveLength(4)
  })

  it('sans signataire ni contact, rien du client principal ne passe dans la vue du groupe', () => {
    const vue = sessionDuGroupe(session, beta)
    expect(vue.client_id).toBe('B')
    expect(vue.contact).toBeNull()
    expect(vue.signatory_name).toBe('')
    expect(vue.total_price).toBe(400)
    expect(vue.session_trainees.map((st) => st.trainee_id)).toEqual(['t3'])
  })

  it('un particulier n\'a ni contact ni signataire d\'entreprise', () => {
    const vue = sessionDuGroupe(session, particulier)
    expect(vue.contact).toBeNull()
    expect(vue.contact_id).toBeNull()
    expect(vue.signatory_name).toBe('Paul Particulier')
    expect(vue.session_trainees).toEqual([])
    expect(destinataireDuGroupe(particulier)).toBe('paul@exemple.fr')
  })

  it('prix du groupe : total, sinon par personne, sinon rien', () => {
    expect(prixDuGroupe({ price_total: '800' }, 3)).toBe(800)
    expect(prixDuGroupe({ price_per_person: '250' }, 3)).toBe(750)
    expect(prixDuGroupe({ price_per_person: '250' }, 0)).toBe(250)
    expect(prixDuGroupe({}, 3)).toBeNull()
  })

  it('destinataire : contact du groupe, sinon e-mail de l\'entreprise ; jamais une adresse invalide', () => {
    expect(destinataireDuGroupe(alpha)).toBe('anne@alpha.fr')
    expect(destinataireDuGroupe(beta)).toBe('contact@beta.fr')
    expect(destinataireDuGroupe({ kind: 'entreprise', contact: { email: 'pas une adresse' }, clients: {} })).toBe('')
    expect(inscritsDuGroupe(session, null)).toEqual([])
  })

  it('jamais le prix ni le financement du client principal dans la vue d\'un groupe', () => {
    const sansPrix = { ...beta, price_total: null }
    expect(sessionDuGroupe(session, sansPrix).total_price).toBeNull()
    expect(sessionDuGroupe(session, alpha).funding_type).toBe('none')
    expect(sessionDuGroupe(session, alpha).funding_details).toBe('')
    const opco = { ...alpha, payer_kind: 'opco', payeur: { name: 'OPCO Alpha' }, dossier_number: 'D-12' }
    expect(financementDuGroupe(opco)).toEqual({ funding_type: 'opco', funding_details: 'OPCO Alpha, dossier D-12' })
    expect(financementDuGroupe({ payer_kind: 'autre' })).toEqual({ funding_type: 'other', funding_details: '' })
  })

  it('un groupe sans prix est refusé avant toute convention ; le contact est lisible même saisi en prénom et nom', () => {
    const signataire = { name: 'Anne Alpha', role: 'DRH' }
    expect(refusPublicationGroupe({ ...alpha, price_per_person: null }, 2, signataire)).toMatch(/Aucun prix/)
    expect(refusPublicationGroupe(alpha, 2, signataire)).toBeNull()
    expect(refusPublicationGroupe(beta, 1, null)).toMatch(/signataire/)
    const vue = sessionDuGroupe(session, alpha)
    expect(vue.contact.name).toBe('Anne Alpha')
    expect(vue.contact.role).toBe('DRH')
  })
})
