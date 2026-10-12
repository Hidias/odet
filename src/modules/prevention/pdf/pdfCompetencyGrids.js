// ═══════════════════════════════════════════════════════════════
// pdfCompetencyGrids.js - Grilles d'évaluation compétences pratiques
// Formations : Incendie, Gestes/Postures, R489, R485
// Format : Passé / Pas passé par compétence
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { buildORG, prepareOrgForPDF } from '../../../core/org/orgUtils'
import { startDocument, drawCheckbox } from '../../../core/pdf/layout'

// Identité de l'organisme : uniquement depuis organization_settings (aucun repli)
let ORG = buildORG({})

function applyOrgSettings(orgSettings) {
  ORG = { ...(orgSettings || {}), ...buildORG(orgSettings || {}) }
}

// ─── Templates de compétences par formation ──────────────

const GRIDS = {
  incendie: {
    title: 'Sécurité Incendie / EPI',
    subtitle: 'Équipier de Première Intervention',
    reference: 'GRID-INC',
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
    reference: 'GRID-GP',
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
    reference: 'GRID-R489',
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
    reference: 'GRID-R485',
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

// ─── Génération PDF (mise en page commune : core/pdf/layout.js) ───

function generateGrid(gridKey) {
  const grid = GRIDS[gridKey]
  if (!grid) throw new Error(`Grille inconnue: ${gridKey}`)

  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, { docLabel: 'Grille d\'évaluation', code: grid.reference, title: 'Grille d\'évaluation des compétences', subtitle: grid.title })
  const t = ORG.theme
  const { M, W } = f

  f.fields([{ label: 'Formation', value: grid.subtitle, w: 2 }, { label: 'Durée', value: grid.duration, w: 0.8 }, { label: 'Date(s)', value: '', w: 0.8 }])
  f.fields([{ label: 'Stagiaire', value: '', w: 1 }, { label: 'Entreprise', value: '', w: 1 }, { label: 'Formateur', value: '', w: 1 }])
  f.note("Cochez A (acquis) si la compétence est maîtrisée, NA (non acquis) si elle doit être travaillée. En cas de NA, précisez dans la colonne Observations les points à améliorer ou la remédiation proposée.", { after: 3 })

  const codeW = 17, boxW = 9, obsW = 34
  const labelW = W - codeW - boxW * 2 - obsW
  const head = (name) => {
    doc.setFillColor(...t.primary); doc.rect(M, f.y, W, 6.5, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(255, 255, 255)
    doc.text(String(name).toUpperCase(), M + 2.5, f.y + 4.4, { charSpace: 0.3 })
    const x0 = M + codeW + labelW
    doc.text('A', x0 + boxW / 2, f.y + 4.4, { align: 'center' })
    doc.text('NA', x0 + boxW * 1.5, f.y + 4.4, { align: 'center' })
    doc.text('OBSERVATIONS', x0 + boxW * 2 + 2, f.y + 4.4)
    f.y += 6.5
  }

  grid.categories.forEach((cat) => {
    f.ensure(6.5 + 8 * Math.min(cat.competences.length, 3) + 3)
    head(cat.name)
    cat.competences.forEach((comp, idx) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8)
      const lines = doc.splitTextToSize(comp.label, labelW - 3)
      const h = Math.max(6, lines.length * 3.4 + 2.8)
      if (f.y + h > doc.internal.pageSize.getHeight() - 19) { f.newPage(); head(cat.name) }
      if (idx % 2 === 1) { doc.setFillColor(...t.surface); doc.rect(M, f.y, W, h, 'F') }
      doc.setDrawColor(...t.line); doc.setLineWidth(0.2); doc.line(M, f.y + h, M + W, f.y + h)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...t.muted)
      doc.text(comp.code, M + 2.5, f.y + h / 2 + 1.1)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8); doc.setTextColor(...t.text)
      lines.forEach((l, i) => doc.text(l, M + codeW, f.y + h / 2 - (lines.length - 1) * 1.75 + 1.2 + i * 3.5))
      const x0 = M + codeW + labelW
      drawCheckbox(doc, ORG, x0 + boxW / 2 - 1.7, f.y + h / 2 - 1.7, 3.4, false)
      drawCheckbox(doc, ORG, x0 + boxW * 1.5 - 1.7, f.y + h / 2 - 1.7, 3.4, false)
      doc.setDrawColor(...t.line); doc.line(x0 + boxW * 2 + 2, f.y + h - 2, M + W - 2, f.y + h - 2)
      f.y += h
    })
    f.y += 2.5
  })

  f.y += 2
  f.choiceLine('Résultat global :', [{ label: 'Acquis' }, { label: 'Non acquis (voir observations)' }], { colW: 26 })
  f.box('Observations et points à travailler', { height: 16, lined: true })
  f.signatures([
    { label: 'Le formateur', hint: 'Date et signature' },
    { label: 'Le stagiaire', hint: 'Date et signature' },
  ], { height: 20 })
  f.finish()
  return doc
}

// ═══════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════

export const GRID_KEYS = Object.keys(GRIDS)
export const GRID_INFO = Object.fromEntries(
  Object.entries(GRIDS).map(([key, grid]) => [key, { title: grid.title, subtitle: grid.subtitle, reference: grid.reference }])
)

export async function downloadCompetencyGrid(gridKey, orgSettings = null) {
  const grid = GRIDS[gridKey]
  if (!grid) { console.error('Grille inconnue:', gridKey); return }
  applyOrgSettings((await prepareOrgForPDF(orgSettings)) || orgSettings)
  const doc = generateGrid(gridKey)
  doc.save(`Grille_Competences_${gridKey.toUpperCase()}_Vierge.pdf`)
}

export function generateCompetencyGridPDF(gridKey, orgSettings = null) {
  applyOrgSettings(orgSettings)
  return generateGrid(gridKey)
}
