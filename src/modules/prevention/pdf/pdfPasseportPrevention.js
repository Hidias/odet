// ═══════════════════════════════════════════════════════════════
// pdfPasseportPrevention.js — Notice Passeport Prévention
// Deux versions : stagiaire et entreprise
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf'
import { buildORG } from '../../../core/org/orgUtils'

const ORG_DEFAULTS = {
  name: 'Access Formation',
  address: '24 rue Kerbleiz, 29900 Concarneau',
  phone: '02 98 90 30 24',
  email: 'contact@accessformation.pro',
  website: 'www.accessformation.pro',
  nda: '53 29 10261 29',
  siret: '943 563 866 00012',
}

let ORG = { ...ORG_DEFAULTS }

function applyOrgSettings(orgSettings) {
  if (!orgSettings) {
    ORG = { ...ORG_DEFAULTS }
    return
  }
  const base = buildORG(orgSettings)
  ORG = {
    ...ORG_DEFAULTS,
    name: base.name,
    address: base.address,
    phone: base.phone,
    email: base.email,
    website: base.website,
    nda: base.nda,
    siret: base.siret,
  }
}

function addOrgHeader(doc) {
  const pw = doc.internal.pageSize.getWidth()
  doc.setFillColor(0, 102, 204)
  doc.rect(0, 0, pw, 35, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('ACCESS FORMATION', pw / 2, 15, { align: 'center' })
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`${ORG.address} | ${ORG.phone} | ${ORG.email}`, pw / 2, 22, { align: 'center' })
  doc.text(`NDA : ${ORG.nda} | SIRET : ${ORG.siret} | Certifié Qualiopi`, pw / 2, 28, { align: 'center' })
  doc.setTextColor(0, 0, 0)
}

function addFooter(doc, pageNum) {
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  doc.setFontSize(7)
  doc.setTextColor(120, 120, 120)
  doc.text(`${ORG.name} — Notice Passeport Prévention — Page ${pageNum}`, pw / 2, ph - 8, { align: 'center' })
  doc.setTextColor(0, 0, 0)
}

function drawSectionTitle(doc, y, title, color = [0, 102, 204]) {
  const pw = doc.internal.pageSize.getWidth()
  doc.setFillColor(...color)
  doc.rect(15, y, pw - 30, 8, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(title, 19, y + 5.5)
  doc.setTextColor(0, 0, 0)
  return y + 12
}

function drawInfoBox(doc, y, text, bgColor = [240, 248, 255]) {
  const pw = doc.internal.pageSize.getWidth()
  const lines = doc.splitTextToSize(text, pw - 40)
  const boxH = lines.length * 5 + 6
  doc.setFillColor(...bgColor)
  doc.roundedRect(15, y, pw - 30, boxH, 2, 2, 'F')
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(lines, 19, y + 5)
  return y + boxH + 4
}

function drawBulletPoint(doc, y, text, indent = 22) {
  const pw = doc.internal.pageSize.getWidth()
  doc.setFillColor(0, 102, 204)
  doc.circle(indent - 4, y - 1.2, 1.2, 'F')
  const lines = doc.splitTextToSize(text, pw - indent - 18)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(lines, indent, y)
  return y + lines.length * 4.5 + 1.5
}

// ═══════════════════════════════════════════════════════════
// VERSION STAGIAIRE
// ═══════════════════════════════════════════════════════════
function generateVersionStagiaire() {
  const doc = new jsPDF()
  const pw = doc.internal.pageSize.getWidth()
  let y = 0

  // Page 1
  addOrgHeader(doc)
  y = 42

  // Titre principal
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(0, 70, 150)
  doc.text('PASSEPORT DE PRÉVENTION', pw / 2, y, { align: 'center' })
  y += 7
  doc.setFontSize(12)
  doc.setTextColor(100, 100, 100)
  doc.text('Guide à destination des stagiaires', pw / 2, y, { align: 'center' })
  y += 12
  doc.setTextColor(0, 0, 0)

  // Qu'est-ce que c'est ?
  y = drawSectionTitle(doc, y, "QU'EST-CE QUE LE PASSEPORT DE PRÉVENTION ?")

  y = drawInfoBox(doc, y,
    "Le Passeport de Prévention est un outil numérique créé par la loi du 2 août 2021 pour renforcer " +
    "la prévention en santé au travail. Il recense toutes les formations, attestations et certifications " +
    "que vous avez suivies en matière de santé et sécurité au travail tout au long de votre carrière.")

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('Concrètement, votre Passeport de Prévention contient :', 15, y)
  y += 6
  doc.setFont('helvetica', 'normal')

  const items1 = [
    "Les attestations, certificats et diplômes obtenus dans le cadre de formations relatives à la santé et sécurité au travail",
    "Les formations suivies à l'initiative de votre employeur (SST, incendie, CACES, habilitation électrique, gestes et postures...)",
    "Les formations que vous avez suivies de votre propre initiative",
    "Les compétences acquises lors de ces formations",
  ]
  items1.forEach(item => { y = drawBulletPoint(doc, y, item) })

  y += 4
  y = drawSectionTitle(doc, y, 'QUI GÈRE LE PASSEPORT DE PRÉVENTION ?')

  y = drawInfoBox(doc, y,
    "Le Passeport de Prévention est géré par la Caisse des Dépôts et Consignations, via la plateforme " +
    "Mon Compte Formation (moncompteformation.gouv.fr). Il est rattaché à votre compte personnel.")

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('Trois acteurs peuvent alimenter votre passeport :', 15, y)
  y += 6
  doc.setFont('helvetica', 'normal')

  const actors = [
    "VOUS-MÊME : vous pouvez y renseigner vos formations et certifications",
    "VOTRE EMPLOYEUR : il peut y inscrire les formations qu'il a financées pour vous",
    "VOTRE ORGANISME DE FORMATION : Access Formation peut y inscrire directement vos formations SST, CACES, etc.",
  ]
  actors.forEach(item => { y = drawBulletPoint(doc, y, item) })

  y += 4
  y = drawSectionTitle(doc, y, 'COMMENT ACCÉDER À VOTRE PASSEPORT ?')

  const steps = [
    "1. Rendez-vous sur www.moncompteformation.gouv.fr",
    "2. Connectez-vous avec votre identité numérique (FranceConnect+) ou créez votre compte",
    "3. Accédez à la rubrique \"Mon Passeport de Prévention\"",
    "4. Consultez vos formations et attestations enregistrées",
    "5. Complétez manuellement si nécessaire avec vos justificatifs",
  ]
  steps.forEach(step => {
    doc.setFontSize(9)
    doc.text(step, 22, y)
    y += 5.5
  })

  y += 4
  y = drawSectionTitle(doc, y, 'VOS FORMATIONS ACCESS FORMATION ET LE PASSEPORT')

  y = drawInfoBox(doc, y,
    "Toutes les formations dispensées par Access Formation en santé et sécurité au travail sont éligibles " +
    "au Passeport de Prévention. En tant qu'organisme certifié Qualiopi, nous vous remettons systématiquement " +
    "les attestations et certificats nécessaires à l'alimentation de votre passeport.", [230, 255, 230])

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('Formations concernées :', 15, y)
  y += 5

  const formations = [
    'SST — Sauveteur Secouriste du Travail (certification INRS)',
    'MAC SST — Maintien et Actualisation des Compétences SST',
    'Sécurité Incendie — EPI (Équipier de Première Intervention)',
    'CACES R489 — Conduite de chariots élévateurs',
    'CACES R485 — Conduite de gerbeurs à conducteur accompagnant',
    'Habilitation Électrique B0/H0V — Opérations d\'ordre non-électrique',
    'Gestes et Postures / PRAP — Prévention des Risques liés à l\'Activité Physique',
  ]
  doc.setFont('helvetica', 'normal')
  formations.forEach(f => { y = drawBulletPoint(doc, y, f) })

  // Page 2
  doc.addPage()
  addOrgHeader(doc)
  y = 42

  y = drawSectionTitle(doc, y, 'QUE DEVEZ-VOUS FAIRE APRÈS VOTRE FORMATION ?')

  const postFormation = [
    "Conservez précieusement votre attestation de formation ou certificat remis par Access Formation",
    "Connectez-vous à votre Passeport de Prévention sur moncompteformation.gouv.fr",
    "Vérifiez que votre formation y figure bien (elle peut être renseignée par Access Formation ou votre employeur)",
    "Si elle n'apparaît pas, ajoutez-la manuellement en joignant votre attestation/certificat",
    "Notez les dates de recyclage (MAC SST tous les 24 mois, habilitation électrique tous les 3 ans, CACES tous les 5 ans)",
  ]
  postFormation.forEach(item => { y = drawBulletPoint(doc, y, item) })

  y += 6
  y = drawSectionTitle(doc, y, 'POURQUOI C\'EST IMPORTANT POUR VOUS ?')

  const benefits = [
    "Traçabilité : un historique complet de toutes vos compétences en prévention, disponible à tout moment",
    "Portabilité : votre passeport vous suit tout au long de votre carrière, même si vous changez d'employeur",
    "Valorisation : vos compétences en sécurité sont reconnues et valorisées auprès de futurs employeurs",
    "Conformité : vous pouvez prouver que vos certifications sont à jour en cas de contrôle",
    "Simplicité : un seul endroit pour retrouver toutes vos attestations au lieu de chercher dans vos papiers",
  ]
  benefits.forEach(item => { y = drawBulletPoint(doc, y, item) })

  y += 6
  y = drawSectionTitle(doc, y, 'DATES DE VALIDITÉ ET RECYCLAGES')

  doc.autoTable({
    startY: y,
    head: [['Formation', 'Validité', 'Recyclage']],
    body: [
      ['SST', '24 mois', 'MAC SST (1 jour)'],
      ['Incendie / EPI', 'Recommandé : 12 mois', 'Recyclage incendie'],
      ['CACES R489 / R485', '5 ans', 'Recyclage CACES'],
      ['Habilitation Électrique', '3 ans', 'Recyclage habilitation'],
      ['Gestes et Postures', 'Pas de limite', 'Recommandé tous les 2 ans'],
    ],
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [0, 102, 204], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [240, 248, 255] },
    margin: { left: 15, right: 15 },
  })
  y = doc.lastAutoTable.finalY + 8

  y = drawInfoBox(doc, y,
    "BESOIN D'AIDE ? N'hésitez pas à contacter Access Formation pour toute question concernant " +
    "le Passeport de Prévention ou vos attestations de formation.\n\n" +
    `Tel : ${ORG.phone} | Email : ${ORG.email} | Web : ${ORG.website}`, [255, 248, 230])

  addFooter(doc, 1)
  doc.setPage(1)
  addFooter(doc, 1)
  doc.setPage(2)
  addFooter(doc, 2)

  return doc
}

// ═══════════════════════════════════════════════════════════
// VERSION ENTREPRISE
// ═══════════════════════════════════════════════════════════
function generateVersionEntreprise() {
  const doc = new jsPDF()
  const pw = doc.internal.pageSize.getWidth()
  let y = 0

  // Page 1
  addOrgHeader(doc)
  y = 42

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(0, 70, 150)
  doc.text('PASSEPORT DE PRÉVENTION', pw / 2, y, { align: 'center' })
  y += 7
  doc.setFontSize(12)
  doc.setTextColor(100, 100, 100)
  doc.text('Guide à destination des employeurs', pw / 2, y, { align: 'center' })
  y += 12
  doc.setTextColor(0, 0, 0)

  y = drawSectionTitle(doc, y, "LE PASSEPORT DE PRÉVENTION : CE QUE VOUS DEVEZ SAVOIR")

  y = drawInfoBox(doc, y,
    "Créé par la loi du 2 août 2021 (loi Santé au Travail), le Passeport de Prévention est un outil " +
    "numérique qui recense l'ensemble des formations suivies par chaque salarié en matière de santé " +
    "et sécurité au travail. En tant qu'employeur, vous avez des obligations concernant son alimentation.")

  y = drawSectionTitle(doc, y, 'VOS OBLIGATIONS EN TANT QU\'EMPLOYEUR')

  const obligations = [
    "Renseigner les formations santé-sécurité dispensées à vos salariés dans leur Passeport de Prévention",
    "Fournir les attestations et certificats de formation à vos salariés pour qu'ils puissent compléter leur passeport",
    "Veiller au recyclage des formations à échéance (SST, CACES, habilitation électrique...)",
    "Consulter le passeport de vos salariés pour vérifier la validité de leurs certifications (avec leur accord)",
    "Conserver les preuves de formation dans vos registres (obligation Code du travail, art. L.4141-5)",
  ]
  obligations.forEach(item => { y = drawBulletPoint(doc, y, item) })

  y += 4
  y = drawSectionTitle(doc, y, 'FORMATIONS CONCERNÉES')

  y = drawInfoBox(doc, y,
    "Toutes les formations relatives à la santé et sécurité au travail sont concernées. " +
    "Access Formation, certifié Qualiopi, vous accompagne dans les formations suivantes :")

  doc.autoTable({
    startY: y,
    head: [['Formation', 'Durée', 'Validité', 'Obligation']],
    body: [
      ['SST (Sauveteur Secouriste du Travail)', '14h (2 jours)', '24 mois', 'Obligatoire (ateliers dangereux)'],
      ['MAC SST (recyclage)', '7h (1 jour)', 'Renouvelle 24 mois', 'Obligatoire'],
      ['Incendie / EPI', '4h à 7h', '12 mois (reco.)', 'Code du travail R.4227-39'],
      ['CACES R489 (chariots)', '14 à 21h', '5 ans', 'Recommandation CNAM'],
      ['CACES R485 (gerbeurs)', '7 à 14h', '5 ans', 'Recommandation CNAM'],
      ['Habilitation Électrique B0/H0V', '7h (1 jour)', '3 ans', 'NF C18-510 obligatoire'],
      ['Gestes et Postures / PRAP', '7h (1 jour)', 'Pas de limite', 'Code du travail R.4541-8'],
    ],
    styles: { fontSize: 7.5, cellPadding: 2.5 },
    headStyles: { fillColor: [0, 102, 204], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [240, 248, 255] },
    margin: { left: 15, right: 15 },
    columnStyles: { 0: { cellWidth: 55 }, 3: { cellWidth: 45 } },
  })
  y = doc.lastAutoTable.finalY + 8

  y = drawSectionTitle(doc, y, 'COMMENT ACCESS FORMATION VOUS ACCOMPAGNE')

  const accompagnement = [
    "Remise systématique des attestations et certificats conformes aux exigences réglementaires",
    "Traçabilité complète via notre plateforme Access Campus (émargement, évaluations, fiches)",
    "Alertes de recyclage : nous vous prévenons avant l'échéance de validité des certifications",
    "Conseil personnalisé sur votre plan de formation en prévention des risques",
    "Formations intra-entreprise dans vos locaux, adaptées à vos risques spécifiques",
  ]
  accompagnement.forEach(item => { y = drawBulletPoint(doc, y, item) })

  // Page 2
  doc.addPage()
  addOrgHeader(doc)
  y = 42

  y = drawSectionTitle(doc, y, 'INTÉGRATION AVEC VOTRE DUERP')

  y = drawInfoBox(doc, y,
    "Le Passeport de Prévention s'articule directement avec votre Document Unique d'Évaluation des " +
    "Risques Professionnels (DUERP). Les formations identifiées comme mesures de prévention dans votre " +
    "DUERP doivent être effectivement réalisées et tracées — le passeport en est la preuve.", [230, 255, 230])

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('Le cercle vertueux de la prévention :', 15, y)
  y += 6
  doc.setFont('helvetica', 'normal')

  const circle = [
    "1. Vous identifiez les risques dans votre DUERP (Access Formation peut réaliser votre Document Unique)",
    "2. Vous planifiez les formations de prévention correspondantes",
    "3. Access Formation dispense les formations et délivre les attestations",
    "4. Les formations sont inscrites dans le Passeport de Prévention de chaque salarié",
    "5. Lors de votre prochain audit ou contrôle, tout est tracé et conforme",
  ]
  circle.forEach(item => {
    doc.setFontSize(9)
    doc.text(item, 22, y)
    y += 6
  })

  y += 6
  y = drawSectionTitle(doc, y, 'CALENDRIER DE MISE EN PLACE')

  doc.autoTable({
    startY: y,
    head: [['Échéance', 'Action']],
    body: [
      ['Depuis octobre 2022', 'Le Passeport de Prévention est accessible aux salariés'],
      ['Depuis 2023', 'Les organismes de formation peuvent alimenter les passeports'],
      ['2024-2025', 'Montée en charge progressive — alimentation par les employeurs'],
      ['2025-2026', 'Généralisation — tous les acteurs doivent alimenter le passeport'],
    ],
    styles: { fontSize: 8.5, cellPadding: 3.5 },
    headStyles: { fillColor: [0, 102, 204], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [240, 248, 255] },
    margin: { left: 15, right: 15 },
    columnStyles: { 0: { cellWidth: 45 } },
  })
  y = doc.lastAutoTable.finalY + 8

  y = drawSectionTitle(doc, y, 'PROCHAINES ÉTAPES RECOMMANDÉES')

  const nextSteps = [
    "Faites un état des lieux des formations santé-sécurité de vos salariés",
    "Identifiez les certifications arrivant à échéance dans les 6 prochains mois",
    "Planifiez les recyclages nécessaires (MAC SST, CACES, habilitations...)",
    "Contactez Access Formation pour établir un plan de formation adapté",
    "Informez vos salariés de l'existence du Passeport de Prévention",
  ]
  nextSteps.forEach(item => { y = drawBulletPoint(doc, y, item) })

  y += 6
  y = drawInfoBox(doc, y,
    `CONTACTEZ-NOUS POUR UN ACCOMPAGNEMENT PERSONNALISÉ\n\n` +
    `Access Formation — Organisme certifié Qualiopi\n` +
    `Tel : ${ORG.phone} | Email : ${ORG.email}\n` +
    `Web : ${ORG.website}\n\n` +
    `Nos indicateurs qualité : 4.96/5 satisfaction | 100% réussite | 98% assiduité`, [255, 248, 230])

  addFooter(doc, 1)
  doc.setPage(1)
  addFooter(doc, 1)
  doc.setPage(2)
  addFooter(doc, 2)

  return doc
}

// ═══════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════
export function downloadPasseportPrevention(version = 'stagiaire', orgSettings = null) {
  applyOrgSettings(orgSettings)
  const doc = version === 'entreprise' ? generateVersionEntreprise() : generateVersionStagiaire()
  doc.save(`Notice_Passeport_Prevention_${version === 'entreprise' ? 'Entreprise' : 'Stagiaire'}.pdf`)
}
