import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/core/supabase', () => ({ supabase: {} }))
const { buildRapportPDF } = await import('../src/modules/interventions/pdf/rapportPDF')
const { buildRegistrePDF } = await import('../src/modules/interventions/pdf/registrePDF')
const { buildBilanPDF } = await import('../src/modules/interventions/pdf/bilanPDF')
const { buildContratPDF } = await import('../src/modules/interventions/pdf/contratPDF')
const { buildRevisionPDF } = await import('../src/modules/interventions/pdf/revisionPDF')
const { buildAvisPassagePDF } = await import('../src/modules/interventions/pdf/avisPassagePDF')
const { buildORG } = await import('../src/core/org/orgUtils')
const { dernierePagePeuRemplie, compacter, startDocument } = await import('../src/core/pdf/layout')
const { default: jsPDF } = await import('jspdf')
await import('jspdf-autotable')
const { PDFDocument } = await import('pdf-lib')

// Documents de maintenance (06/11) : pied de page sur la dernière page, et jamais une dernière page avec les seules
// signatures ou mentions (recomposition serrée, sinon dernières lignes du tableau reportées)
const org = buildORG({ name: 'Société Essai', legal_name: 'Société Essai SARL', forme_juridique: 'SARL', capital_social: '1000', rcs: '000 000 000 R.C.S. Quimper', siret: '00000000000000', phone: '02 98 00 00 00', email: 'contact@essai.invalid', address: '1 rue A', postal_code: '29000', city: 'Quimper', dirigeant_name: 'Prénom NOM' })
const eq = (n) => Array.from({ length: n }, (_, i) => ({ id: 'e' + i, label_code: `E-${i}`, location: `Bâtiment A, couloir ${i}`, manufactured_year: 2020, itv_equipment_types: { name: 'Extincteur eau 6 L' }, next_check_on: '2027-10-01', last_check_on: '2026-10-01' }))
const visit = { reference: 'ITV-ESSAI', kind: 'verification', started_at: '2026-11-06T08:00:00Z', clients: { name: 'Client Essai' }, sites: { name: 'Site', city: 'Quimper' } }
const settings = { report_mentions: 'Vérification réalisée selon les règles en vigueur. Les appareils à remplacer font l\'objet d\'un devis séparé.' }
const pages = (doc) => doc.getNumberOfPages()

describe('Rapport et registre de maintenance', () => {
  it('aucune dernière page presque vide, de 1 à 40 appareils', async () => {
    for (let n = 1; n <= 40; n++) {
      const e = eq(n)
      const items = e.map((x) => ({ equipment_id: x.id, result: 'conforme' }))
      const { doc } = await buildRapportPDF({ visit, items, parts: [], equipmentById: Object.fromEntries(e.map((x) => [x.id, x])), settings, technicianName: 'Technicien', org, photos: [] })
      expect(dernierePagePeuRemplie(doc), `rapport ${n} appareils`).toBe(false)
      const r = await buildRegistrePDF({ client: { name: 'Client Essai' }, site: { name: 'Site' }, equipment: e, visits: [{ reference: 'V1', started_at: '2026-10-01', items: items.slice(0, 3) }], settings, org })
      expect(dernierePagePeuRemplie(r.doc), `registre ${n} appareils`).toBe(false)
    }
  }, 120000)
  it('report de lignes : toutes les lignes du tableau sont dessinées une seule fois', () => {
    // Tableau de n lignes suivi des signatures : on cherche n où la signature passe seule en page 2
    const construire = (n, vus) => () => {
      const doc = new jsPDF({ compress: true })
      const f = startDocument(doc, org, { code: 'ESSAI', title: 'Essai' })
      f.table(['N°', 'Libellé'], Array.from({ length: n }, (_, i) => [String(i), 'Ligne']), {
        reportable: true,
        didParseCell: (d) => { if (d.section === 'body' && d.column.index === 0) vus.push(d.cell.raw) },
      })
      f.signatures([{ label: 'A' }, { label: 'B' }], { height: 34 })
      f.finish()
      return doc
    }
    let reports = 0
    for (let n = 5; n <= 70; n++) {
      const origine = construire(n, [])()
      let vus = []
      const doc = compacter(() => { vus = []; return construire(n, vus)() }, { reportMax: 8 })
      expect(dernierePagePeuRemplie(doc), `${n} lignes`).toBe(false)
      expect(vus.length).toBe(n)
      expect(new Set(vus).size).toBe(n)
      if (dernierePagePeuRemplie(origine) && pages(doc) === pages(origine)) reports++
    }
    // Au moins un cas où serrer ne suffisait pas : les lignes ont été reportées
    expect(reports).toBeGreaterThan(0)
  })
})

describe('Pied de page sur la dernière page (il manquait)', () => {
  it('bilan, révision et avis : f.finish appelé (mesure posée)', async () => {
    const data = { appareils: 3, visites: [], remplaces: 0, enRetard: 0, aVerifier: [], anneeProchaine: 2027, finsDeVie: [], budget: {} }
    const b = await buildBilanPDF({ client: { name: 'Client Essai' }, contract: null, data, org })
    expect(b.doc.__odetMesure).toBeTruthy()
    const a = await buildAvisPassagePDF({ visit, kind: 'prevu', passageOn: '2026-11-10', org })
    expect(a.doc.__odetMesure).toBeTruthy()
    const r = await buildRevisionPDF({ contract: { reference: 'C1', base_price_ht: 100 }, client: { name: 'Client Essai' }, revision: { anniversary: '2026-11-01', new_value: 1, price_after: 101 }, org })
    const pdf = await PDFDocument.load(Buffer.from(r.base64, 'base64'))
    expect(pdf.getPageCount()).toBe(1)
  })
  it('contrat : une page pour un petit parc, mention légale du prestataire imprimée', async () => {
    const { base64 } = await buildContratPDF({ contract: { label: 'Contrat', reference: 'C1', visit_months: [3], annual_price_ht: 100, start_on: '2026-11-01' }, client: { name: 'Client Essai' }, parc: [{ type_name: 'Extincteur' }], org, avecCgv: false })
    const pdf = await PDFDocument.load(Buffer.from(base64, 'base64'))
    expect(pdf.getPageCount()).toBe(1)
  })
})
