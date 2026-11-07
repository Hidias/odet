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
const { APP_VERSION } = await import('../src/core/version')

// Textes écrits page par page, pour vérifier le pied de page (code du document) sur la dernière page
const docs = []
jsPDF.API.events.push(['initialized', function () {
  const doc = this
  const texteOrigine = doc.text
  doc.__textes = []
  docs.push(doc)
  doc.text = function (t, ...a) {
    doc.__textes.push([doc.getCurrentPageInfo().pageNumber, Array.isArray(t) ? t.join(' ') : String(t)])
    return texteOrigine.call(doc, t, ...a)
  }
}])
const piedSurDernierePage = (doc, code) => {
  const n = doc.getNumberOfPages()
  return doc.__textes.some(([p, t]) => p === n && (t === `${code}-${APP_VERSION}` || t.endsWith(`-${code}-${APP_VERSION}`)))
}

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
  it('report de lignes : chaque ligne du tableau est dessinée une fois dans le document rendu', () => {
    // Tableau de n lignes suivi des signatures ; les lignes dessinées sont comptées sur le document lui-même
    const construire = (n) => () => {
      const doc = new jsPDF({ compress: true })
      doc.__vus = []
      const f = startDocument(doc, org, { code: 'ESSAI', title: 'Essai' })
      f.table(['N°', 'Libellé'], Array.from({ length: n }, (_, i) => [String(i), 'Ligne']), {
        didDrawCell: (d) => { if (d.section === 'body' && d.column.index === 0) doc.__vus.push(d.cell.raw) },
      })
      f.signatures([{ label: 'A' }, { label: 'B' }], { height: 34 })
      f.finish()
      return doc
    }
    let reports = 0
    for (let n = 5; n <= 70; n++) {
      const origine = construire(n)()
      const doc = compacter(construire(n))
      expect(dernierePagePeuRemplie(doc), `${n} lignes`).toBe(false)
      expect(doc.__vus.length).toBe(n)
      expect(new Set(doc.__vus).size).toBe(n)
      if (doc.__odetReport) { reports++; expect(pages(doc)).toBe(pages(origine)) }
    }
    // Au moins un cas où serrer ne suffisait pas : les lignes ont été reportées (dernier tableau, sans marque)
    expect(reports).toBeGreaterThan(0)
  })
  it('seconde partie d\'un tableau découpé : les accroches lisent le rang d\'origine (relecture de #315)', () => {
    // Liste externe lue par d.row.index (comme les cases cochées de la check-list ou les couleurs des objectifs)
    let decoupes = 0
    for (let n = 5; n <= 70; n++) {
      const externe = Array.from({ length: n }, (_, i) => `L${i}`)
      const construire = () => {
        const doc = new jsPDF({ compress: true })
        doc.__ecarts = []
        const f = startDocument(doc, org, { code: 'ESSAI', title: 'Essai' })
        const verifier = (nom) => (d) => { if (d.section === 'body' && d.column.index === 0 && externe[d.row.index] !== d.cell.raw) doc.__ecarts.push([nom, d.cell.raw, externe[d.row.index]]) }
        f.table(['N°'], externe.map((x) => [x]), { didParseCell: verifier('parse'), willDrawCell: verifier('will'), didDrawCell: verifier('did') })
        f.signatures([{ label: 'A' }, { label: 'B' }], { height: 34 })
        f.finish()
        return doc
      }
      const doc = compacter(construire)
      if (doc.__odetReport) decoupes++
      expect(doc.__ecarts, `${n} lignes`).toEqual([])
    }
    expect(decoupes).toBeGreaterThan(0)
  })
  it('rapport avec photos : lues avant la construction, section dessinée', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const e = eq(3)
    const items = e.map((x) => ({ equipment_id: x.id, result: 'conforme' }))
    const { doc } = await buildRapportPDF({ visit: { ...visit, photos: ['a', 'b'] }, items, parts: [], equipmentById: Object.fromEntries(e.map((x) => [x.id, x])), settings, technicianName: 'Technicien', org, photos: [png, png] })
    expect(doc.__textes.some(([, t]) => t === 'PHOTOS' || t === 'Photos')).toBe(true)
    expect(dernierePagePeuRemplie(doc)).toBe(false)
  })
})

describe('Pied de page sur la dernière page (il manquait)', () => {
  it('bilan, avis, révision et contrat portent le code du document en dernière page', async () => {
    const data = { appareils: 3, visites: [], remplaces: 0, enRetard: 0, aVerifier: [], anneeProchaine: 2027, finsDeVie: [], budget: {} }
    const b = await buildBilanPDF({ client: { name: 'Client Essai' }, contract: null, data, org })
    expect(piedSurDernierePage(b.doc, 'BIL')).toBe(true)
    const a = await buildAvisPassagePDF({ visit, kind: 'prevu', passageOn: '2026-11-10', org })
    expect(piedSurDernierePage(a.doc, 'AVP')).toBe(true)
    await buildRevisionPDF({ contract: { reference: 'C1', base_price_ht: 100 }, client: { name: 'Client Essai' }, revision: { anniversary: '2026-11-01', new_value: 1, price_after: 101 }, org })
    expect(piedSurDernierePage(docs[docs.length - 1], 'REV')).toBe(true)
    // Contrat de deux pages (grand parc) : le pied de page est aussi sur la seconde
    const parc = Array.from({ length: 40 }, (_, i) => ({ type_name: `Type ${i}` }))
    const { base64 } = await buildContratPDF({ contract: { label: 'Contrat', reference: 'C1', visit_months: [3], annual_price_ht: 100, start_on: '2026-11-01' }, client: { name: 'Client Essai' }, parc, org, avecCgv: false })
    const dernier = docs[docs.length - 1]
    expect(dernier.getNumberOfPages()).toBeGreaterThan(1)
    expect(piedSurDernierePage(dernier, 'CTR')).toBe(true)
    expect((await PDFDocument.load(Buffer.from(base64, 'base64'))).getPageCount()).toBe(dernier.getNumberOfPages())
  })
})

describe('Contrat signé : moment des factures, compris et révision (07/11)', () => {
  const textes = (doc) => doc.__textes.map(([, t]) => t).join(' ')
  const base = { label: 'Contrat', reference: 'C1', visit_months: [3, 9], annual_price_ht: 1200, start_on: '2026-11-01', billing_period: 'trimestriel' }
  it('échéancier : date des factures, compris, clause de révision en mots simples', async () => {
    await buildContratPDF({ contract: { ...base, billing_term: 'echu', includes: { pieces: true, recharges: true }, index_label: 'Coût du travail', index_series: '001234', index_base_value: 132.5, index_base_month: '2026-06-01', base_price_ht: 1200 }, client: { name: 'Client Essai' }, org, avecCgv: false })
    const t = textes(docs[docs.length - 1])
    expect(t).toContain('après chaque période, une fois le service fait')
    expect(t).toContain('Pièces, Recharges')
    expect(t).toContain('Révision du prix')
    expect(t).toContain('132,5')
    expect(t).toMatch(/nouveau prix = prix de départ × dernière valeur/)
    expect(t).not.toMatch(/\bP0\b|\bI0\b/)
  })
  it('client public sans choix : règle par défaut ; rien de compris : dit clairement ; sans valeur de référence : pas de clause', async () => {
    await buildContratPDF({ contract: { ...base, includes: {} }, client: { name: 'Mairie Essai', client_type: 'public' }, org, avecCgv: false })
    const t = textes(docs[docs.length - 1])
    expect(t).toContain('après chaque période')
    expect(t).toContain('les visites seulement')
    expect(t).not.toContain('Révision du prix')
  })
  it('à la visite : ni date des factures ni compris, même si une valeur est restée', async () => {
    await buildContratPDF({ contract: { ...base, billing_period: 'visite', includes: { pieces: true } }, client: { name: 'Client Essai' }, org, avecCgv: false })
    const t = textes(docs[docs.length - 1])
    expect(t).not.toContain('Date des factures')
    expect(t).not.toContain('Compris dans le prix')
  })
  it('aucune dernière page presque vide, de 0 à 40 types d\'appareils, avec la clause de révision', async () => {
    for (let n = 0; n <= 40; n++) {
      const parc = Array.from({ length: n }, (_, i) => ({ type_name: `Type ${i}` }))
      await buildContratPDF({ contract: { ...base, includes: { pieces: true }, index_label: 'Indice', index_base_value: 100, emergency_hours: 48 }, client: { name: 'Client Essai' }, parc, org, avecCgv: false })
      expect(dernierePagePeuRemplie(docs[docs.length - 1]), `${n} types`).toBe(false)
    }
  }, 120000)
  it('courrier de révision : mêmes mots, sans sigles', async () => {
    await buildRevisionPDF({ contract: { reference: 'C1', base_price_ht: 1000, index_base_value: 100, index_label: 'Indice' }, client: { name: 'Client Essai' }, revision: { anniversary: '2026-11-01', new_value: 103, price_after: 1030 }, org })
    const t = textes(docs[docs.length - 1])
    expect(t).toMatch(/nouveau prix = prix de départ × dernière valeur/)
    expect(t).toContain('VALEUR DE RÉFÉRENCE DE L\'INDICE')
    expect(t).not.toMatch(/\bP0\b|\bI0\b|\(I\)|\(P\)/)
    expect(dernierePagePeuRemplie(docs[docs.length - 1])).toBe(false)
  })
})
