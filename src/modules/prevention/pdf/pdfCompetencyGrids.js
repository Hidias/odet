// ═══════════════════════════════════════════════════════════════
// pdfCompetencyGrids.js - Grilles d'évaluation compétences pratiques
// Formations : Incendie, Gestes/Postures, R489, R485
// Format : Passé / Pas passé par compétence
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { buildORG } from '../../../core/org/orgUtils'

// Identité de l'organisme : uniquement depuis organization_settings (aucun repli)
let ORG = { name: '', address: '', phone: '', email: '', nda: '', siret: '', theme: null }

function applyOrgSettings(orgSettings) {
  const base = buildORG(orgSettings || {})
  ORG = { name: base.name, address: base.address, phone: base.phone, email: base.email, nda: base.nda, siret: base.siret, theme: base.theme }
}

// ─── Templates de compétences par formation ──────────────

const GRIDS = {
  incendie: {
    title: 'Sécurité Incendie / EPI',
    subtitle: 'Équipier de Première Intervention',
    reference: 'AF-GRID-INC',
    duration: '4h à 7h',
    categories: [
      {
        name: 'Connaissances théoriques',
        competences: [
          { code: 'INC-T1', label: 'Identifier les causes et mécanismes d\'un incendie (triangle du feu)' },
          { code: 'INC-T2', label: 'Connaître les différentes classes de feux (A, B, C, D, F)' },
          { code: 'INC-T3', label: 'Identifier les moyens d\'extinction adaptés à chaque classe de feu' },
          { code: 'INC-T4', label: 'Connaître les consignes d\'évacuation de l\'établissement' },
          { code: 'INC-T5', label: 'Connaître le rôle de l\'EPI (guide-file, serre-file, responsable évacuation)' },
        ]
      },
      {
        name: 'Manipulation des extincteurs',
        competences: [
          { code: 'INC-P1', label: 'Identifier le type d\'extincteur adapté à la situation' },
          { code: 'INC-P2', label: 'Dégoupiller et percuter l\'extincteur correctement' },
          { code: 'INC-P3', label: 'Adopter la bonne posture et distance d\'attaque' },
          { code: 'INC-P4', label: 'Diriger le jet à la base des flammes avec la technique du balayage' },
          { code: 'INC-P5', label: 'Éteindre un feu réel (bac à feu) en toute sécurité' },
        ]
      },
      {
        name: 'Procédure d\'évacuation',
        competences: [
          { code: 'INC-E1', label: 'Déclencher l\'alarme et donner l\'alerte correctement' },
          { code: 'INC-E2', label: 'Guider les occupants vers les sorties de secours (rôle guide-file)' },
          { code: 'INC-E3', label: 'Vérifier l\'évacuation complète d\'une zone (rôle serre-file)' },
          { code: 'INC-E4', label: 'Se diriger vers le point de rassemblement sans panique' },
          { code: 'INC-E5', label: 'Réaliser le comptage et signaler les personnes manquantes' },
        ]
      },
    ]
  },

  gestes_postures: {
    title: 'Gestes et Postures / PRAP',
    subtitle: 'Prévention des Risques liés à l\'Activité Physique',
    reference: 'AF-GRID-GP',
    duration: '7h (1 jour)',
    categories: [
      {
        name: 'Connaissances théoriques',
        competences: [
          { code: 'GP-T1', label: 'Identifier les principaux risques de TMS liés à son activité' },
          { code: 'GP-T2', label: 'Connaître les bases de l\'anatomie du dos (vertèbres, disques, muscles)' },
          { code: 'GP-T3', label: 'Comprendre les mécanismes de survenue des lombalgies et TMS' },
          { code: 'GP-T4', label: 'Identifier les facteurs aggravants (répétition, posture, charge, vibrations)' },
        ]
      },
      {
        name: 'Techniques de manutention manuelle',
        competences: [
          { code: 'GP-P1', label: 'Évaluer la charge avant de la soulever (poids, forme, prise)' },
          { code: 'GP-P2', label: 'Adopter la position de sécurité (dos droit, jambes fléchies, pieds écartés)' },
          { code: 'GP-P3', label: 'Soulever une charge au sol en utilisant la force des jambes' },
          { code: 'GP-P4', label: 'Porter une charge en la maintenant proche du corps' },
          { code: 'GP-P5', label: 'Déposer une charge en contrôlant la descente' },
          { code: 'GP-P6', label: 'Effectuer un transfert de charge avec pivotement des pieds (pas de torsion du tronc)' },
          { code: 'GP-P7', label: 'Utiliser les aides techniques disponibles (diable, transpalette, chariot)' },
        ]
      },
      {
        name: 'Aménagement du poste de travail',
        competences: [
          { code: 'GP-A1', label: 'Analyser son poste de travail et identifier les améliorations possibles' },
          { code: 'GP-A2', label: 'Proposer des solutions d\'aménagement réduisant les contraintes physiques' },
          { code: 'GP-A3', label: 'Adapter sa posture au travail sur écran (hauteur, distance, position)' },
          { code: 'GP-A4', label: 'Intégrer des pauses et exercices d\'étirement dans sa routine de travail' },
        ]
      },
    ]
  },

  r489: {
    title: 'Conduite de chariots élévateurs (R489)',
    subtitle: 'Conduite en sécurité des chariots automoteurs de manutention à conducteur porté',
    reference: 'AF-GRID-R489',
    duration: '14h à 21h (2 à 3 jours)',
    categories: [
      {
        name: 'Connaissances théoriques',
        competences: [
          { code: 'R489-T1', label: 'Connaître la réglementation relative à la conduite des chariots (R489, Code du travail)' },
          { code: 'R489-T2', label: 'Identifier les principaux risques liés à la conduite de chariots (renversement, heurt, chute de charge)' },
          { code: 'R489-T3', label: 'Connaître les règles de circulation en entreprise (vitesse, priorités, signalisation)' },
          { code: 'R489-T4', label: 'Comprendre les notions de stabilité, centre de gravité et capacité nominale' },
          { code: 'R489-T5', label: 'Connaître les responsabilités du cariste et le rôle de l\'autorisation de conduite' },
        ]
      },
      {
        name: 'Vérifications et prise en main',
        competences: [
          { code: 'R489-V1', label: 'Effectuer les vérifications quotidiennes avant prise de poste (VGP, état général)' },
          { code: 'R489-V2', label: 'Vérifier les niveaux (huile, eau, batterie/carburant) et l\'état des pneumatiques' },
          { code: 'R489-V3', label: 'Contrôler les dispositifs de sécurité (klaxon, feux, gyrophare, rétroviseurs)' },
          { code: 'R489-V4', label: 'Vérifier le fonctionnement du mât, des fourches et du tablier' },
          { code: 'R489-V5', label: 'Régler le siège et les commandes avant la conduite' },
        ]
      },
      {
        name: 'Conduite et manoeuvres',
        competences: [
          { code: 'R489-C1', label: 'Circuler en charge et à vide sur sol plat en respectant les règles de circulation' },
          { code: 'R489-C2', label: 'Prendre et déposer une charge au sol en sécurité' },
          { code: 'R489-C3', label: 'Gerber et dégerber en pile à différentes hauteurs' },
          { code: 'R489-C4', label: 'Stocker et déstocker en palettier (rack) à différents niveaux' },
          { code: 'R489-C5', label: 'Effectuer un chargement/déchargement de véhicule' },
          { code: 'R489-C6', label: 'Manoeuvrer dans un espace restreint sans heurter d\'obstacles' },
          { code: 'R489-C7', label: 'Circuler sur plan incliné en charge en respectant les règles de sécurité' },
          { code: 'R489-C8', label: 'Immobiliser le chariot en fin de poste (position de parking)' },
        ]
      },
      {
        name: 'Situations particulières',
        competences: [
          { code: 'R489-S1', label: 'Adapter sa conduite aux conditions (sol mouillé, passage piétons, visibilité réduite)' },
          { code: 'R489-S2', label: 'Réagir correctement face à une situation d\'urgence ou un défaut technique' },
          { code: 'R489-S3', label: 'Signaler et rendre compte de toute anomalie ou incident' },
        ]
      },
    ]
  },

  r485: {
    title: 'Conduite de gerbeurs accompagnants (R485)',
    subtitle: 'Conduite en sécurité des gerbeurs à conducteur accompagnant',
    reference: 'AF-GRID-R485',
    duration: '7h à 14h (1 à 2 jours)',
    categories: [
      {
        name: 'Connaissances théoriques',
        competences: [
          { code: 'R485-T1', label: 'Connaître la réglementation relative à la conduite des gerbeurs (R485, Code du travail)' },
          { code: 'R485-T2', label: 'Identifier les risques spécifiques au gerbeur accompagnant (écrasement des pieds, coincement)' },
          { code: 'R485-T3', label: 'Connaître les règles de circulation en zone de stockage' },
          { code: 'R485-T4', label: 'Comprendre les notions de stabilité et limites de charge du gerbeur' },
        ]
      },
      {
        name: 'Vérifications et prise en main',
        competences: [
          { code: 'R485-V1', label: 'Effectuer les vérifications journalières (état général, batterie, fourches)' },
          { code: 'R485-V2', label: 'Vérifier les dispositifs de sécurité (bouton d\'arrêt d\'urgence, klaxon, protections)' },
          { code: 'R485-V3', label: 'Identifier et comprendre les commandes du gerbeur (timon, accélérateur, frein)' },
        ]
      },
      {
        name: 'Conduite et manoeuvres',
        competences: [
          { code: 'R485-C1', label: 'Se positionner correctement par rapport au timon pendant la conduite' },
          { code: 'R485-C2', label: 'Circuler en charge et à vide en respectant les allures de sécurité' },
          { code: 'R485-C3', label: 'Prendre et déposer une charge au sol sans heurt' },
          { code: 'R485-C4', label: 'Gerber et dégerber à différentes hauteurs (cat. 1 ou cat. 2 selon contexte)' },
          { code: 'R485-C5', label: 'Stocker et déstocker en palettier en respectant les emplacements' },
          { code: 'R485-C6', label: 'Manoeuvrer dans un espace restreint (allées étroites)' },
          { code: 'R485-C7', label: 'Immobiliser le gerbeur en fin de poste (fourches au sol, contact coupé)' },
        ]
      },
      {
        name: 'Sécurité et situations particulières',
        competences: [
          { code: 'R485-S1', label: 'Protéger ses pieds et son corps pendant les manoeuvres (zone de sécurité)' },
          { code: 'R485-S2', label: 'Réagir en cas de défaut technique ou situation dangereuse' },
          { code: 'R485-S3', label: 'Respecter la coactivité avec les piétons et autres engins' },
        ]
      },
    ]
  },
}

// ─── Génération PDF ───────────────────────────────────────

function addGridHeader(doc, grid) {
  const pw = doc.internal.pageSize.getWidth()

  // Bandeau bleu
  doc.setFillColor(0, 102, 204)
  doc.rect(0, 0, pw, 28, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(`GRILLE D'ÉVALUATION DES COMPÉTENCES`, pw / 2, 11, { align: 'center' })
  doc.setFontSize(10)
  doc.text(grid.title, pw / 2, 18, { align: 'center' })
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(`${grid.reference} | ${ORG.name} | ${ORG.nda}`, pw / 2, 24, { align: 'center' })
  doc.setTextColor(0, 0, 0)

  let y = 34

  // Infos session (vierge)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('Formation :', 15, y)
  doc.text('Date(s) :', 110, y)
  doc.setFont('helvetica', 'normal')
  doc.text(grid.subtitle, 38, y)
  doc.line(130, y + 0.5, 195, y + 0.5)
  y += 6

  doc.setFont('helvetica', 'bold')
  doc.text('Stagiaire :', 15, y)
  doc.text('Entreprise :', 110, y)
  doc.setFont('helvetica', 'normal')
  doc.line(38, y + 0.5, 105, y + 0.5)
  doc.line(135, y + 0.5, 195, y + 0.5)
  y += 6

  doc.setFont('helvetica', 'bold')
  doc.text('Formateur :', 15, y)
  doc.text('Durée :', 110, y)
  doc.setFont('helvetica', 'normal')
  doc.line(38, y + 0.5, 105, y + 0.5)
  doc.text(grid.duration, 128, y)
  y += 8

  return y
}

function drawCheckboxCell(doc, x, y, size = 3.5) {
  doc.setDrawColor(150, 150, 150)
  doc.setLineWidth(0.3)
  doc.rect(x, y, size, size, 'S')
}

function generateGrid(gridKey) {
  const grid = GRIDS[gridKey]
  if (!grid) throw new Error(`Grille inconnue: ${gridKey}`)

  const doc = new jsPDF()
  const pw = doc.internal.pageSize.getWidth()
  let y = addGridHeader(doc, grid)

  // Instructions
  doc.setFillColor(255, 250, 230)
  doc.roundedRect(15, y, pw - 30, 10, 1, 1, 'F')
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'italic')
  doc.text('Instructions : Cocher Acquis (A) si la compétence est maîtrisée, ou Non Acquis (NA) si elle doit être travaillée.', 19, y + 4)
  doc.text('En cas de NA, préciser dans Observations les points à améliorer ou la proposition de remédiation.', 19, y + 8)
  y += 14

  // Pour chaque catégorie
  grid.categories.forEach((cat) => {
    // Vérifier si on a assez de place
    const needed = 10 + cat.competences.length * 8
    if (y + needed > 270) {
      doc.addPage()
      y = 15
    }

    // Titre catégorie
    doc.setFillColor(0, 102, 204)
    doc.rect(15, y, pw - 30, 7, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(cat.name.toUpperCase(), 19, y + 5)
    doc.setTextColor(0, 0, 0)
    y += 9

    // En-tête du tableau
    doc.setFillColor(230, 240, 250)
    doc.rect(15, y, pw - 30, 6, 'F')
    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    doc.text('Code', 17, y + 4)
    doc.text('Compétence évaluée', 35, y + 4)
    doc.text('A', 152, y + 4)
    doc.text('NA', 162, y + 4)
    doc.text('Observations', 172, y + 4)
    y += 7

    // Lignes de compétences
    cat.competences.forEach((comp, idx) => {
      if (y + 8 > 275) {
        doc.addPage()
        y = 15
      }

      const bgColor = idx % 2 === 0 ? [255, 255, 255] : [248, 250, 252]
      doc.setFillColor(...bgColor)
      doc.rect(15, y, pw - 30, 7.5, 'F')

      // Bordure
      doc.setDrawColor(220, 220, 220)
      doc.setLineWidth(0.2)
      doc.rect(15, y, pw - 30, 7.5, 'S')

      doc.setFontSize(6.5)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(100, 100, 100)
      doc.text(comp.code, 17, y + 5)

      doc.setFont('helvetica', 'normal')
      doc.setTextColor(0, 0, 0)
      doc.setFontSize(7)
      const lines = doc.splitTextToSize(comp.label, 112)
      doc.text(lines, 35, y + 4)

      // Checkboxes A et NA
      drawCheckboxCell(doc, 150.5, y + 1.5, 4)
      drawCheckboxCell(doc, 160.5, y + 1.5, 4)

      // Zone observations (ligne)
      doc.setDrawColor(200, 200, 200)
      doc.line(172, y + 6, 193, y + 6)

      y += 7.5
    })

    y += 4
  })

  // Section résultat global
  if (y + 50 > 270) {
    doc.addPage()
    y = 15
  }

  y += 4
  doc.setFillColor(0, 70, 130)
  doc.rect(15, y, pw - 30, 7, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('RÉSULTAT GLOBAL', pw / 2, y + 5, { align: 'center' })
  doc.setTextColor(0, 0, 0)
  y += 11

  // Checkboxes résultat
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')

  drawCheckboxCell(doc, 30, y, 5)
  doc.text('ACQUIS - Le stagiaire maîtrise l\'ensemble des compétences évaluées', 38, y + 4)
  y += 10

  drawCheckboxCell(doc, 30, y, 5)
  doc.text('NON ACQUIS - Des compétences restent à acquérir (voir observations)', 38, y + 4)
  y += 14

  // Observations
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('Observations / Points à travailler :', 15, y)
  y += 3
  for (let i = 0; i < 4; i++) {
    doc.setDrawColor(200, 200, 200)
    doc.line(15, y + 5, pw - 15, y + 5)
    y += 7
  }
  y += 4

  // Signatures
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('Signature du formateur :', 15, y)
  doc.text('Signature du stagiaire :', pw / 2 + 10, y)
  y += 3
  doc.setDrawColor(200, 200, 200)
  doc.rect(15, y, 75, 20, 'S')
  doc.rect(pw / 2 + 10, y, 75, 20, 'S')

  doc.setFontSize(7)
  doc.setFont('helvetica', 'italic')
  doc.text('Date :', 17, y + 17)
  doc.text('Date :', pw / 2 + 12, y + 17)

  // Footer
  const ph = doc.internal.pageSize.getHeight()
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFontSize(6.5)
    doc.setTextColor(120, 120, 120)
    doc.text(
      `${ORG.name} - ${grid.reference} - ${grid.title} - Page ${p}/${totalPages}`,
      pw / 2, ph - 6, { align: 'center' }
    )
    doc.setTextColor(0, 0, 0)
  }

  return doc
}

// ═══════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════

export const GRID_KEYS = Object.keys(GRIDS)
export const GRID_INFO = Object.fromEntries(
  Object.entries(GRIDS).map(([key, grid]) => [key, { title: grid.title, subtitle: grid.subtitle, reference: grid.reference }])
)

export function downloadCompetencyGrid(gridKey, orgSettings = null) {
  const grid = GRIDS[gridKey]
  if (!grid) { console.error('Grille inconnue:', gridKey); return }
  applyOrgSettings(orgSettings)
  const doc = generateGrid(gridKey)
  doc.save(`Grille_Competences_${gridKey.toUpperCase()}_Vierge.pdf`)
}

export function generateCompetencyGridPDF(gridKey, orgSettings = null) {
  applyOrgSettings(orgSettings)
  return generateGrid(gridKey)
}
