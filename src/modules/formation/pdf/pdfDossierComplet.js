// ═══════════════════════════════════════════════════════════════
// pdfDossierComplet.js — Dossier vierge compilé par formation
// Utilise pdf-lib pour merger les PDFs générés par pdfGenerator
// ═══════════════════════════════════════════════════════════════

import { PDFDocument } from 'pdf-lib'
import { generatePDF, downloadDocument } from './pdfGenerator'
import { generateCompetencyGridPDF } from '../../prevention/pdf/pdfCompetencyGrids'

// Configuration des documents par formation
const DOSSIER_CONFIG = {
  sst: {
    label: 'SST / MAC SST',
    documents: [
      { type: 'emargement', label: 'Feuille d\'émargement' },
      { type: 'ficheRenseignements', label: 'Fiche de renseignements' },
      { type: 'evaluation', label: 'Évaluation à chaud' },
      { type: 'evaluationFroid', label: 'Évaluation à froid' },
      { type: 'evaluationFormateur', label: 'Évaluation formateur' },
    ],
    // SST a déjà sa grille INRS via SSTCertificationTab, pas de grille compétences en plus
    competencyGrid: null,
  },
  incendie: {
    label: 'Incendie / EPI',
    documents: [
      { type: 'emargement', label: 'Feuille d\'émargement' },
      { type: 'ficheRenseignements', label: 'Fiche de renseignements' },
      { type: 'evaluation', label: 'Évaluation à chaud' },
      { type: 'evaluationFroid', label: 'Évaluation à froid' },
      { type: 'evaluationFormateur', label: 'Évaluation formateur' },
    ],
    competencyGrid: 'incendie',
  },
  gestes_postures: {
    label: 'Gestes et Postures / PRAP',
    documents: [
      { type: 'emargement', label: 'Feuille d\'émargement' },
      { type: 'ficheRenseignements', label: 'Fiche de renseignements' },
      { type: 'evaluation', label: 'Évaluation à chaud' },
      { type: 'evaluationFroid', label: 'Évaluation à froid' },
      { type: 'evaluationFormateur', label: 'Évaluation formateur' },
    ],
    competencyGrid: 'gestes_postures',
  },
  r489: {
    label: 'Conduite R489 (chariots)',
    documents: [
      { type: 'emargement', label: 'Feuille d\'émargement' },
      { type: 'ficheRenseignements', label: 'Fiche de renseignements' },
      { type: 'evaluation', label: 'Évaluation à chaud' },
      { type: 'evaluationFroid', label: 'Évaluation à froid' },
      { type: 'evaluationFormateur', label: 'Évaluation formateur' },
    ],
    competencyGrid: 'r489',
  },
  r485: {
    label: 'Conduite R485 (gerbeurs)',
    documents: [
      { type: 'emargement', label: 'Feuille d\'émargement' },
      { type: 'ficheRenseignements', label: 'Fiche de renseignements' },
      { type: 'evaluation', label: 'Évaluation à chaud' },
      { type: 'evaluationFroid', label: 'Évaluation à froid' },
      { type: 'evaluationFormateur', label: 'Évaluation formateur' },
    ],
    competencyGrid: 'r485',
  },
  habilitation_electrique: {
    label: 'Habilitation Électrique',
    documents: [
      { type: 'emargement', label: 'Feuille d\'émargement' },
      { type: 'ficheRenseignements', label: 'Fiche de renseignements' },
      { type: 'evaluation', label: 'Évaluation à chaud' },
      { type: 'evaluationFroid', label: 'Évaluation à froid' },
      { type: 'evaluationFormateur', label: 'Évaluation formateur' },
    ],
    // Habilitation électrique : pas de grille pratique spécifique (évaluation via avis d'habilitation)
    competencyGrid: null,
  },
}

/**
 * Convertit un jsPDF doc en ArrayBuffer utilisable par pdf-lib
 */
function jsPDFToArrayBuffer(jsPdfDoc) {
  const output = jsPdfDoc.output('arraybuffer')
  return output
}

/**
 * Génère et télécharge un dossier compilé pour une formation donnée
 * @param {string} formationKey — Clé de la formation (sst, incendie, etc.)
 * @param {Function} onProgress — Callback optionnel (step, total, label)
 */
export async function downloadDossierComplet(formationKey, onProgress = null) {
  const config = DOSSIER_CONFIG[formationKey]
  if (!config) throw new Error(`Formation inconnue: ${formationKey}`)

  const totalSteps = config.documents.length + (config.competencyGrid ? 1 : 0) + 1 // +1 for merge
  let currentStep = 0

  const report = (label) => {
    currentStep++
    if (onProgress) onProgress(currentStep, totalSteps, label)
  }

  // Créer le document PDF final
  const mergedPdf = await PDFDocument.create()

  // Générer chaque document vierge et l'ajouter
  for (const docConfig of config.documents) {
    try {
      const result = await generatePDF(docConfig.type, null, { isBlank: true })
      if (result && result.base64) {
        const pdfBytes = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0))
        const sourcePdf = await PDFDocument.load(pdfBytes)
        const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices())
        pages.forEach(page => mergedPdf.addPage(page))
      }
      report(docConfig.label)
    } catch (err) {
      console.error(`Erreur génération ${docConfig.type}:`, err)
      report(`${docConfig.label} (erreur)`)
    }
  }

  // Ajouter la grille de compétences si applicable
  if (config.competencyGrid) {
    try {
      const gridDoc = generateCompetencyGridPDF(config.competencyGrid)
      const gridBuffer = jsPDFToArrayBuffer(gridDoc)
      const gridPdf = await PDFDocument.load(gridBuffer)
      const pages = await mergedPdf.copyPages(gridPdf, gridPdf.getPageIndices())
      pages.forEach(page => mergedPdf.addPage(page))
      report('Grille de compétences')
    } catch (err) {
      console.error(`Erreur grille ${config.competencyGrid}:`, err)
      report('Grille de compétences (erreur)')
    }
  }

  // Finaliser et télécharger
  report('Compilation finale')
  const mergedBytes = await mergedPdf.save()
  const blob = new Blob([mergedBytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = `Dossier_Vierge_${formationKey.toUpperCase()}_Access_Formation.pdf`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export { DOSSIER_CONFIG }
