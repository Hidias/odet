import { describe, it, expect, vi } from 'vitest'
// Autres familles de documents (06/11) : jamais une dernière page avec seulement quelques lignes ou les signatures
vi.mock('../src/core/supabase', () => ({ supabase: {} }))
vi.mock('../src/core/pdf/pdfOrg', async () => {
  const { buildORG } = await import('../src/core/org/orgUtils')
  const o = buildORG({ name: 'Société Essai', legal_name: 'Société Essai SARL', siret: '00000000000000', city: 'Quimper', address: '1 rue A', postal_code: '29000' })
  return { loadPdfOrg: async () => o, pdfOrgFrom: async () => o, loadOrgRowForPDF: async () => ({}) }
})
const { default: jsPDF } = await import('jspdf')
// Document réellement rendu : celui dont la sortie (blob, base64) a été demandée
let rendu = null
jsPDF.API.events.push(['initialized', function () {
  const doc = this
  const sortie = doc.output
  doc.output = function (...a) { rendu = doc; return sortie.apply(doc, a) }
}])
const { dernierePagePeuRemplie } = await import('../src/core/pdf/layout')
const { buildORG } = await import('../src/core/org/orgUtils')
const { genererFicheRemisePDF } = await import('../src/modules/rh/lib/rhEpi')
const { telechargerRegistrePDF } = await import('../src/modules/rh/lib/rhRegistre')
const { buildCompletudePDF } = await import('../src/modules/qualite/pdf/completudePDF')
const { buildTrainerDevelopmentPDF } = await import('../src/modules/formation/pdf/trainerDevelopmentPDF')
const ORG = buildORG({ name: 'Société Essai', city: 'Quimper' })

describe('Dernière page des autres documents', () => {
  it('fiche de remise d\'EPI, de 1 à 30 équipements', async () => {
    for (let n = 1; n <= 30; n++) {
      await genererFicheRemisePDF({ person: { first_name: 'Léa', last_name: 'Martin' }, handedOn: '2026-11-06', lignes: Array.from({ length: n }, (_, i) => ({ label: `Équipement ${i}`, quantity: 1, renew_on: '2027-11-06' })) })
      expect(dernierePagePeuRemplie(rendu), `${n} équipements`).toBe(false)
    }
  })
  it('registre unique du personnel, de 1 à 70 lignes', async () => {
    for (let n = 1; n <= 70; n += 3) {
      const rows = Array.from({ length: n }, (_, i) => ({ numero: i + 1, nom: `NOM ${i}`, nationalite: 'Française', naissance: '01/01/1990', sexe: 'F', emploi: 'Technicien', entree: '01/01/2025', sortie: '', contrat: 'CDI', autorisation: '', stagiaire: false }))
      expect(dernierePagePeuRemplie(await telechargerRegistrePDF(rows, { enregistrer: false })), `${n} lignes`).toBe(false)
    }
  })
  it('rapport de complétude et suivi des formateurs : document rendu, jamais d\'erreur', () => {
    for (let n = 0; n <= 40; n += 5) {
      const c = buildCompletudePDF(ORG, { issues: Array.from({ length: n }, (_, i) => ({ severity: 'warning', title: `Point ${i}`, message: 'Pièce manquante' })), stats: {} })
      expect(c.getNumberOfPages()).toBeGreaterThan(0)
      const t = buildTrainerDevelopmentPDF(ORG, { trainerName: 'A B', trainings: Array.from({ length: n }, () => ({ title: 'Formation', date: '2026-01-01' })), interviews: [] })
      expect(t.getNumberOfPages()).toBeGreaterThan(0)
    }
  })
})
