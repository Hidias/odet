import { describe, it, expect, vi } from 'vitest'
import jsPDF from 'jspdf'
import { PDFDocument } from 'pdf-lib'

vi.mock('../src/core/supabase', () => ({ supabase: { from: () => ({ update: () => ({ eq: async () => ({}) }) }) } }))
const { mentionsDevis, totalEco, formulaireRetractation } = await import('../src/modules/commercial/lib/mentionsDevis')
const { devisAvecConditions, resumeConditions, libelleDevisPublie } = await import('../src/modules/commercial/lib/conditionsDevis')
const { avecConditions, ACCORD_CONDITIONS } = await import('../src/modules/portail/components/SignerConvention')

const T = {
  cgv: 'CGV acceptées.', distance: 'À distance le {date} ({infos}).', materiel: 'Sous réserve.', acompte: 'Acompte {pct} %.',
  delai: 'Délai : {delai}.', eco: 'Dont éco {montant}.', retractation: 'Rétractation 14 jours.', garanties: 'Garanties légales.',
  tva_reduite: 'J’atteste.', decennale: 'Décennale {assureur} {contrat} {couverture}.', rc_pro: 'RC {assureur}.', dechets: 'Déchets : {dechets}.',
}
const baes = { description_title: 'BAES', nature: 'bien', quantity: 4, eco_ht: 0.5, tva_rate: 20 }
const pro = { client_type: 'entreprise' }
const part = { client_type: 'particulier' }

describe('Mentions des devis (0444)', () => {
  it('vente à un professionnel : CGV près de la signature, réserve, acompte, délai, éco-participation', () => {
    const m = mentionsDevis({ quote: { acompte_pct: 30, delai_execution: '2 semaines' }, items: [baes], client: pro, textes: T })
    expect(m.signature).toEqual(['CGV acceptées.'])
    expect(m.legal.slice(0, 3)).toEqual(['Sous réserve.', 'Acompte 30 %.', 'Délai : 2 semaines.'])
    expect(m.legal[3].replace(/\s/g, ' ')).toBe('Dont éco 2,00 €.')
    expect(m.legal.join(' ')).not.toMatch(/Rétractation|Garanties/)
  })
  it('vente à un particulier démarché : rétractation et garanties légales', () => {
    const m = mentionsDevis({ quote: { hors_etablissement: true, delai_execution: 'x' }, items: [baes], client: part, textes: T })
    expect(m.legal).toContain('Rétractation 14 jours.')
    expect(m.legal).toContain('Garanties légales.')
  })
  it('devis établi à distance : date et informations reçues', () => {
    const m = mentionsDevis({ quote: { a_distance: true, a_distance_le: '2026-10-20', a_distance_infos: ['Photos', 'Plans'] }, items: [{ description_title: 'Visite', metier: 'maintenance' }], client: pro, textes: T })
    expect(m.legal[0]).toBe('À distance le 20/10/2026 (photos, plans).')
  })
  it('travaux : assurances valables, déchets, taux réduit d’un particulier ; ce qui manque est signalé', () => {
    const pieces = [{ kind: 'decennale', insurer: 'Assur', policy_number: 'D1', coverage: 'France', valid_until: '2027-01-01' }, { kind: 'rc_pro', insurer: 'RC', valid_until: '2026-01-01' }]
    const m = mentionsDevis({ quote: { metier: 'installation' }, items: [{ description_title: 'Pose', tva_rate: 10 }], client: part, textes: T, pieces, jour: '2026-10-24' })
    expect(m.legal).toContain('Décennale Assur D1 France.')
    expect(m.legal.some((l) => l.startsWith('RC'))).toBe(false)
    expect(m.signature).toContain('J’atteste.')
    expect(m.avertissements.join(' ')).toMatch(/responsabilité civile/)
    expect(m.avertissements.join(' ')).toMatch(/Déchets/)
    expect(m.avertissements.join(' ')).toMatch(/Délai/)
  })
  it('formation : aucune mention de matériel, de travaux ni de vente', () => {
    const m = mentionsDevis({ quote: {}, items: [{ course_id: 'c', description_title: 'SST' }], client: pro, textes: T })
    expect(m.signature).toEqual(['CGV acceptées.'])
    expect(m.legal).toEqual([])
    expect(m.avertissements).toEqual([])
  })
  it('sans réglages : rien d’imprimé', () => {
    expect(mentionsDevis({ quote: { a_distance: true }, items: [baes], client: pro, textes: null }).legal).toEqual([])
    expect(totalEco([baes, { eco_ht: '1', quantity: 2 }])).toBe(4)
  })
  it('formulaire type de rétractation', () => {
    const f = formulaireRetractation({ legal_name: 'ESSAI SARL', email: 'a@b.fr' })
    expect(f[1]).toContain('ESSAI SARL')
    expect(f.join(' ')).toMatch(/Rayez la mention inutile/)
  })
})

describe('Devis remis avec ses conditions générales', () => {
  const pdf = (texte, keywords) => {
    const d = new jsPDF()
    d.text(texte, 10, 10)
    if (keywords) d.setProperties({ keywords })
    return d.output('datauristring').split(',')[1]
  }
  it('un seul document : devis puis conditions, cadre de signature gardé', async () => {
    const devis = pdf('Devis', 'odet-zone-signature 1 0.5 0.6 0.3 0.1')
    const out = await devisAvecConditions(devis, [{ base64: pdf('CGV 1') }, { base64: pdf('CGV 2') }])
    const d = await PDFDocument.load(Uint8Array.from(atob(out), (c) => c.charCodeAt(0)))
    expect(d.getPageCount()).toBe(3)
    expect(d.getKeywords()).toMatch(/odet-zone-signature 1/)
    expect(await devisAvecConditions(devis, [])).toBe(devis)
  })
  it('liste gardée sans le fichier ; libellé qui déclenche la case de l’espace client', () => {
    const r = resumeConditions([{ doc: 'cgv-vente', label: 'CGV', version: 2, audience: 'pro', validated_at: 'x', base64: 'AAA' }])
    expect(r).toEqual([{ doc: 'cgv-vente', label: 'CGV', version: 2, audience: 'pro', validated_at: 'x' }])
    const lib = libelleDevisPublie({ reference: 'DEV-1' }, r)
    expect(lib).toBe('Devis DEV-1 et conditions générales')
    expect(avecConditions(lib)).toBe(true)
    expect(avecConditions('Devis DEV-1')).toBe(false)
    expect(ACCORD_CONDITIONS).toMatch(/conditions générales/)
  })
})
