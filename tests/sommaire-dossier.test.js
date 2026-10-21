import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/core/supabase', () => ({ supabase: {} }))
vi.mock('../src/core/pdf/pdfOrg', () => ({ loadPdfOrg: async () => ({}) }))
const { libellePiece, moyenneChaud, piecesManquantes } = await import('../src/modules/formation/lib/sommaireDossier')

describe('sommaire du dossier de session', () => {
  it('libellés des pièces d’après les fichiers du ZIP', () => {
    expect(libellePiece('Emargement_SES-1.pdf')).toBe('Feuille d\'émargement')
    expect(libellePiece('Scans/facture.pdf')).toBe('Document téléversé')
    expect(libellePiece('autre.pdf')).toBe('Document')
  })
  it('moyenne à chaud : avis envoyés seulement, notes de 1 à 5', () => {
    expect(moyenneChaud([
      { questionnaire_submitted: true, q_org_accueil: 5, q_global_adequation: 3, q_contenu_duree: 0 },
      { questionnaire_submitted: false, q_org_accueil: 1 },
    ])).toBe(4)
    expect(moyenneChaud([])).toBeNull()
  })
  it('pièces manquantes', () => {
    const m = piecesManquantes({ convention_signed: false }, ['Emargement_X.pdf'], { nbInscrits: 3, nbEvals: 2 })
    expect(m).toEqual(['Convention signée par l\'entreprise', 'Évaluations à chaud : 2 sur 3', 'Certificats de réalisation (résultats à saisir)', 'Attestations de présence'])
  })
})
