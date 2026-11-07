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
        rendus.forEach((d, i) => expect(dernierePagePeuRemplie(d), `${type}, ${n} objectifs, stagiaire ${i + 1}`).toBe(false))
      }
    }
  })
  it('test de positionnement : chaque stagiaire commence sur une page impaire', async () => {
    rendus = []
    const out = await G.generateAllPDF('positionnement', sessionAvec(3), [stagiaire(1), stagiaire(2), stagiaire(3)], { questions: [{ question: 'Q1', options: ['A', 'B'] }] })
    rendus.forEach((d) => expect(d.getNumberOfPages() % 2).toBe(0))
    expect((await pagesDe(out)) % 2).toBe(0)
  })
  it('aucun stagiaire ou type inconnu : rien', async () => {
    expect(await G.generateAllPDF('evaluation', sessionAvec(1), [])).toBe(null)
    expect(await G.generateAllPDF('inconnu', sessionAvec(1), [stagiaire(1)])).toBe(null)
  })
})
