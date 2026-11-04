import { describe, it, expect } from 'vitest'
import { etatConvention, conventionEnvoyee, groupesParSession, CONVENTION } from '../src/modules/formation/lib/etatConvention.js'
import { estAVenir, stagiairesPresents, pipelineDevis, tauxConversion } from '../src/modules/dashboard/lib/accueil.js'

describe('état de la convention (A1, A2)', () => {
  it('intra : signée sans être marquée envoyée vaut signée', () => {
    expect(etatConvention({ id: 's', convention_signed: true, convention_sent: false })).toBe(CONVENTION.SIGNEE)
    expect(conventionEnvoyee({ id: 's', convention_signed: true })).toBe(true)
  })
  it('intra : envoyée, puis rien', () => {
    expect(etatConvention({ id: 's', convention_sent: true })).toBe(CONVENTION.ENVOYEE)
    expect(etatConvention({ id: 's' })).toBe(CONVENTION.A_ENVOYER)
    expect(etatConvention(null)).toBe(CONVENTION.A_ENVOYER)
  })
  it('inter : calculée depuis les groupes', () => {
    const s = { id: 's', session_type: 'inter', convention_sent: false }
    expect(etatConvention(s, [{ session_id: 's', doc_status: 'signe' }, { session_id: 's', doc_status: 'signe' }])).toBe(CONVENTION.SIGNEE)
    expect(etatConvention(s, [{ session_id: 's', doc_status: 'signe' }, { session_id: 's', doc_status: 'envoye' }])).toBe(CONVENTION.ENVOYEE)
    expect(etatConvention(s, [{ session_id: 's', doc_status: 'signe' }, { session_id: 's', doc_status: 'a_envoyer' }])).toBe(CONVENTION.A_ENVOYER)
  })
  it('inter : les groupes d\'une autre session sont ignorés', () => {
    const s = { id: 's', session_type: 'inter' }
    expect(etatConvention(s, [{ session_id: 'autre', doc_status: 'signe' }])).toBe(CONVENTION.A_ENVOYER)
  })
  it('inter : la signature au niveau de la session prime sur les groupes', () => {
    const g = [{ session_id: 's', doc_status: 'a_envoyer' }]
    expect(etatConvention({ id: 's', session_type: 'inter', convention_signed: true }, g)).toBe(CONVENTION.SIGNEE)
    expect(etatConvention({ id: 's', session_type: 'inter', convention_sent: true }, g)).toBe(CONVENTION.ENVOYEE)
    expect(etatConvention({ id: 's', session_type: 'inter', convention_sent: true }, [{ session_id: 's', doc_status: 'signe' }])).toBe(CONVENTION.SIGNEE)
  })
  it('inter : un groupe annulé ne bloque pas', () => {
    const s = { id: 's', session_type: 'inter' }
    expect(etatConvention(s, [{ session_id: 's', doc_status: 'signe' }, { session_id: 's', doc_status: 'a_envoyer', status: 'cancelled' }])).toBe(CONVENTION.SIGNEE)
  })
  it('sous-traitance : rien à réclamer', () => {
    expect(etatConvention({ id: 's', session_type: 'subcontract' })).toBe(CONVENTION.SANS_OBJET)
    expect(conventionEnvoyee({ id: 's', session_type: 'subcontract' })).toBe(true)
  })
  it('inter sans groupe : colonnes de la session', () => {
    expect(etatConvention({ id: 's', session_type: 'inter', convention_signed: true }, [])).toBe(CONVENTION.SIGNEE)
  })
  it('intra : les groupes ne changent rien', () => {
    expect(etatConvention({ id: 's', session_type: 'intra' }, [{ session_id: 's', doc_status: 'signe' }])).toBe(CONVENTION.A_ENVOYER)
  })
  it('regroupe les groupes par session', () => {
    const m = groupesParSession([{ session_id: 'a' }, { session_id: 'a' }, { session_id: 'b' }, { session_id: null }])
    expect(m.get('a')).toHaveLength(2)
    expect(m.get('b')).toHaveLength(1)
    expect(m.size).toBe(2)
  })
})

describe('accueil (A7, A8, A9)', () => {
  it('une session confirmée est à venir', () => {
    expect(estAVenir({ status: 'planned' })).toBe(true)
    expect(estAVenir({ status: 'confirmed' })).toBe(true)
    expect(estAVenir({ status: 'in_progress' })).toBe(false)
    expect(estAVenir({ status: 'cancelled' })).toBe(false)
  })
  it('les absents sont exclus', () => {
    const s = { session_trainees: [{ trainee_id: 1 }, { trainee_id: 2, absent: true }] }
    expect(stagiairesPresents(s).map((x) => x.trainee_id)).toEqual([1])
    expect(stagiairesPresents({})).toEqual([])
  })
  it('devis partiels et facturés comptés comme signés, remplacés écartés', () => {
    const devis = [
      { status: 'accepted', total_ht: '100' }, { status: 'partial', total_ht: 50, quote_items: [{ total_ht: 20, accepted: true }, { total_ht: 30, accepted: false }] }, { status: 'invoiced', total_ht: 25 },
      { status: 'sent', total_ht: 10 }, { status: 'draft', total_ht: 5 }, { status: 'refused', total_ht: 1 },
      { status: 'replaced', total_ht: 1000 }, { status: 'expired', total_ht: 3 },
    ]
    const p = pipelineDevis(devis)
    expect(p.signed).toHaveLength(3)
    expect(p.totalSigned).toBe(145)
    expect(p.totalSent).toBe(10)
    expect(p.totalDraft).toBe(5)
    expect(p.refused).toHaveLength(1)
    expect(tauxConversion(devis)).toEqual({ signes: 3, total: 7, taux: 43 })
  })
  it('devis partiel : remise globale déduite des lignes acceptées', () => {
    expect(pipelineDevis([{ status: 'partial', total_ht: 1800, discount_percent: 10, quote_items: [{ total_ht: 1000, accepted: true }, { total_ht: 1000, accepted: false }] }]).totalSigned).toBe(900)
  })
  it('devis partiel sans lignes chargées : montant du devis', () => {
    expect(pipelineDevis([{ status: 'partial', total_ht: 50 }]).totalSigned).toBe(50)
  })
  it('aucun devis : taux nul', () => {
    expect(tauxConversion([])).toEqual({ signes: 0, total: 0, taux: 0 })
  })
})
