import { describe, it, expect, vi } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'

// Base simulée : aucun brouillon, aucune relecture en cours (le dossier part des modèles)
const vide = () => { const q = { select: () => q, in: () => q, eq: () => q, then: (ok) => Promise.resolve({ data: [] }).then(ok) }; return q }
vi.mock('../src/core/supabase', () => ({ supabase: { from: () => vide() } }))

const { planDossier, documentsDe, pointsAValider, fabriquerDossier, nomFichier } = await import('../src/modules/qualite/richdocs/dossierRelecture')
const { encadresAValider, fromTemplate } = await import('../src/modules/qualite/richdocs/model')
const { buildORG } = await import('../src/core/org/orgUtils')
const commerce = (await import('../src/modules/qualite/richdocs/templatesCommerce')).default
const qualite = (await import('../src/modules/qualite/richdocs/templates')).default
const templates = { ...qualite, ...commerce }

describe('dossier de relecture en PDF', () => {
  it('documents par prestation et mixte, sans doublon', () => {
    expect(documentsDe(['maintenance']).map((d) => d.doc)).toEqual(['cgv-maintenance', 'perimetre-maintenance'])
    expect(documentsDe(['maintenance', 'vente']).map((d) => d.doc)).toEqual(['cgv-maintenance', 'perimetre-maintenance', 'cgv-vente', 'garantie-vente'])
  })

  it('plan : un PDF par prestation, variante particuliers seulement si elle existe, mixtes à deux métiers ou plus', () => {
    const plan = planDossier({ prestations: ['formation', 'maintenance'], particuliers: true, mixtes: [['maintenance', 'vente'], ['vente']] }, (id) => id === 'cgv-maintenance')
    expect(plan.map((e) => e.titre)).toEqual([
      'Formation', 'Maintenance et vérification', 'Maintenance et vérification (particuliers)',
      'Mixte : Maintenance et vérification + Vente de matériel', 'Mixte : Maintenance et vérification + Vente de matériel (particuliers)',
    ])
    expect(nomFichier('Mixte : Maintenance + Vente (particuliers)')).toBe('Mixte Maintenance + Vente (particuliers)')
  })

  it('points à valider repérés avec leur article ; encadrés comptés', () => {
    const c = fromTemplate(templates['cgv-maintenance'])
    const pts = pointsAValider(c)
    expect(pts.length).toBeGreaterThan(5)
    expect(pts.find((p) => p.article === 'Sinistre')?.texte).toMatch(/délai de déclaration/)
    expect(encadresAValider(c)).toBeGreaterThanOrEqual(pts.length)
  })

  it('fabrique les PDF (page pour le relecteur en tête) et les fichiers Word', async () => {
    const ORG = buildORG({ name: 'Société Essai', legal_name: 'Société Essai SAS', city: 'Quimper', postal_code: '29000', address: '1 rue A' })
    const plan = planDossier({ prestations: ['maintenance'], particuliers: true, mixtes: [['maintenance', 'vente']] }, () => true)
    const fichiers = await fabriquerDossier({ plan, templates, ORG, ctx: null, relecteur: 'Essai EXPERT', consigne: 'Merci', echeance: '2026-11-15' })
    const pdfs = fichiers.filter((f) => f.nom.endsWith('.pdf'))
    expect(pdfs.map((f) => f.nom)).toEqual(['01 Maintenance et verification.pdf', '02 Maintenance et verification (particuliers).pdf', '03 Mixte Maintenance et verification + Vente de materiel.pdf', '04 Mixte Maintenance et verification + Vente de materiel (particuliers).pdf'])
    expect(fichiers.filter((f) => f.nom.startsWith('Word/')).length).toBe(4)
    for (const f of pdfs) expect(Buffer.from(f.bytes).subarray(0, 5).toString()).toBe('%PDF-')
    if (process.env.DOSSIER_OUT) { mkdirSync(process.env.DOSSIER_OUT, { recursive: true }); pdfs.forEach((f) => writeFileSync(`${process.env.DOSSIER_OUT}/${f.nom}`, f.bytes)) }
  }, 30000)
})
