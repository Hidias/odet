import { describe, it, expect, vi } from 'vitest'
// Génération groupée (07/11) : chaque stagiaire a le document qu'il aurait seul, resserré ; jamais une page presque
// vide ni une signature seule, même avec de longs commentaires ou beaucoup d'objectifs
vi.mock('../src/core/supabase', () => ({ supabase: {} }))
vi.mock('../src/core/pdf/pdfOrg', async () => {
  const { buildORG } = await import('../src/core/org/orgUtils')
  const o = buildORG({ name: 'Société Essai', city: 'Quimper' })
  return { loadPdfOrg: async () => o, pdfOrgFrom: async () => o, loadOrgRowForPDF: async () => ({}) }
})
const { default: jsPDF } = await import('jspdf')
// Documents de chaque stagiaire, dans l'ordre où ils sont rendus
let rendus = []
jsPDF.API.events.push(['initialized', function () {
  const doc = this
  const sortie = doc.output
  doc.output = function (...a) { rendus.push(doc); return sortie.apply(doc, a) }
}])
const { PDFDocument } = await import('pdf-lib')
const { dernierePagePeuRemplie } = await import('../src/core/pdf/layout')
const G = await import('../src/modules/formation/pdf/pdfGenerator')
G.setOrganization({ name: 'Société Essai', city: 'Quimper' })

const sessionAvec = (n) => ({
  reference: 'S-ESSAI', start_date: '2026-12-07', end_date: '2026-12-08', start_time: '09:00', end_time: '17:00', attendance_token: 'jeton',
  courses: { title: 'Formation essai', duration_hours: 14, objectives: Array.from({ length: n }, (_, i) => `Objectif pédagogique numéro ${i + 1} : savoir intervenir efficacement face à une situation d'accident`).join('\n') },
})
const stagiaire = (i) => ({ id: `t${i}`, first_name: `Prénom${i}`, last_name: `NOM${i}`, result: 'acquis' })
const pagesDe = async (out) => (await PDFDocument.load(Buffer.from(out.base64, 'base64'))).getPageCount()

describe('Génération groupée des documents', () => {
  it('assemble les documents de chaque stagiaire, sans page presque vide', async () => {
    for (const type of ['convocation', 'attestation', 'certificat', 'fin_formation', 'evaluation', 'evaluationFroid']) {
      for (const n of [1, 8, 18, 30]) {
        rendus = []
        const evals = { t1: { comment_general: 'Très bien. '.repeat(n * 4) } }
        const out = await G.generateAllPDF(type, sessionAvec(n), [stagiaire(1), stagiaire(2)], { evaluationsData: evals })
        expect(rendus.length, `${type} ${n}`).toBe(2)
        expect(await pagesDe(out), `${type} ${n}`).toBe(rendus.reduce((s, d) => s + d.getNumberOfPages(), 0))
        rendus.forEach((d, i) => expect(dernierePagePeuRemplie(d), `${type}, longueur ${n} (objectifs, ou commentaire pour l'évaluation à chaud), stagiaire ${i + 1}`).toBe(false))
      }
    }
  })
  it('test de positionnement : chaque stagiaire commence sur une page impaire', async () => {
    rendus = []
    const out = await G.generateAllPDF('positionnement', sessionAvec(3), [stagiaire(1), stagiaire(2), stagiaire(3)], { questions: [{ question: 'Q1', options: ['A', 'B'] }] })
    rendus.forEach((d) => expect(d.getNumberOfPages() % 2).toBe(0))
    expect((await pagesDe(out)) % 2).toBe(0)
  })
  it('logo et QR code gardés une seule fois : le lot de 12 stagiaires reste léger', async () => {
    // Image PNG de bruit (non compressible), 160 x 160
    const zlib = await import('node:zlib')
    const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)) } return ~c >>> 0 }
    const bloc = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
    const n = 160; const brut = Buffer.alloc((n * 3 + 1) * n); let s = 7
    for (let i = 0; i < brut.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; brut[i] = i % (n * 3 + 1) === 0 ? 0 : s >> 16 }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 2
    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc('IHDR', ihdr), bloc('IDAT', zlib.deflateSync(brut)), bloc('IEND', Buffer.alloc(0))])
    G.setOrganization({ name: 'Société Essai', city: 'Quimper', logo_base64: `data:image/png;base64,${png.toString('base64')}` })
    try {
      for (const type of ['certificat', 'convocation']) {
        const un = await G.generateAllPDF(type, sessionAvec(3), [stagiaire(1)])
        const douze = await G.generateAllPDF(type, sessionAvec(3), Array.from({ length: 12 }, (_, i) => stagiaire(i + 1)))
        expect(await pagesDe(douze)).toBe(12 * (await pagesDe(un)))
        expect(douze.size, type).toBeLessThan(un.size * 3)
      }
    } finally { G.setOrganization({ name: 'Société Essai', city: 'Quimper' }) }
  })
  it('aucun stagiaire ou type inconnu : rien', async () => {
    expect(await G.generateAllPDF('evaluation', sessionAvec(1), [])).toBe(null)
    expect(await G.generateAllPDF('inconnu', sessionAvec(1), [stagiaire(1)])).toBe(null)
  })
})
