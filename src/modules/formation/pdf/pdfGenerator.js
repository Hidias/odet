import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { format, eachDayOfInterval, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'
import QRCode from 'qrcode'
import { buildORG } from '../../../core/org/orgUtils'

const APP_VERSION = 'V2.0.0'
const DOC_CODES = {
  convention: 'AF-CONV', convocation: 'AF-CONVOC', attestation: 'AF-ATTP',
  certificat: 'AF-CERT', emargement: 'AF-EMARG', programme: 'AF-PROG',
  evaluation: 'AF-EVAL', evaluationFroid: 'AF-EVALF', reglement: 'AF-RI',
  livret: 'AF-LIVRET', analyseBesoin: 'AF-BESOIN', evaluationFormateur: 'AF-EVFORM',
  positionnement: 'AF-POS',
}

// Masque le NSS pour impression : garde sexe + année + mois (5 premiers chiffres), masque le reste
// Ex: 1 89 10 75 056 433 67 → 1 89 10 ** *** *** **
// Le n° de sécurité sociale n'est plus imprimé sur aucun document (INRS).

// État courant de l'organisation pour les PDFs.
// Initialisé avec les valeurs par défaut (cf. orgUtils.js).
// Mis à jour par setOrganization() depuis les composants React qui détiennent organization_settings.
let ORG = buildORG(null)

/**
 * Met à jour les infos organisation utilisées par tous les générateurs PDF du fichier.
 * À appeler depuis les composants React avant la génération (typiquement dans un useEffect
 * qui dépend de organization du store).
 *
 * @param {object|null} orgSettings - ligne de la table organization_settings
 */
export function setOrganization(orgSettings) {
  if (orgSettings) {
    ORG = buildORG(orgSettings)
  }
}

// ============================================================
// Fonctions utilitaires pour les accords genrés
// ============================================================

/**
 * Retourne "le" ou "la" selon le genre
 * @param {string} gender - 'male', 'female', ou 'non_binary'
 * @returns {string} - "le" ou "la"
 */
function getArticle(gender) {
  if (gender === 'female') return 'la'
  return 'le'
}

/**
 * Retourne le mot "stagiaire" avec l'article approprié
 * @param {string} gender - 'male', 'female', ou 'non_binary'
 * @returns {string} - "le stagiaire" ou "la stagiaire"
 */
function getStagiaireWithArticle(gender) {
  return `${getArticle(gender)} stagiaire`
}


// Tampon et signature : uniquement depuis organization_settings (ORG.stamp_base64). Aucun repli embarqué.
const STAMP_BASE64 = null

const formatDate = (d) => d ? format(new Date(d), 'dd/MM/yyyy') : ''
const formatDateLong = (d) => d ? format(new Date(d), 'd MMMM yyyy', { locale: fr }) : ''

// Helper pour obtenir les infos de contact pour une session
// Priorité: 1) contact spécifique session > 2) contact "documents" du client > 3) contact générique
function getSessionContact(session) {
  const client = session?.clients || {}
  
  // 1. Contact spécifique défini pour cette session
  if (session?.contact) {
    return {
      name: session.contact.name || '',
      role: session.contact.role || '',
      email: session.contact.email || client.contact_email || '',
      phone: session.contact.phone || client.contact_phone || '',
      isSpecific: true
    }
  }
  
  // 2. Contact "documents" du client (is_document_contact = true)
  if (client.contacts && client.contacts.length > 0) {
    const docContact = client.contacts.find(c => c.is_document_contact)
    if (docContact) {
      return {
        name: docContact.name || '',
        role: docContact.role || '',
        email: docContact.email || client.contact_email || '',
        phone: docContact.phone || client.contact_phone || '',
        isSpecific: true
      }
    }
  }
  
  // 3. Fallback : contact générique du client
  return {
    name: client.contact_name || '',
    role: client.contact_function || '',
    email: client.contact_email || '',
    phone: client.contact_phone || '',
    isSpecific: false
  }
}

// Helper pour obtenir le signataire de la convention
// Priorité: 1) signatory_name/role de la session > 2) contact de la session (fallback)
function getSessionSignatory(session) {
  if (session?.signatory_name) {
    return { name: session.signatory_name, role: session.signatory_role || '' }
  }
  const contact = getSessionContact(session)
  return { name: contact.name, role: contact.role }
}

// ============================================================
// HELPERS - DESSINER DES FORMES (PAS DE CARACTÈRES UNICODE)
// ============================================================

// Dessine une case à cocher vide (carré)
function drawCheckbox(doc, x, y, size = 3, checked = false) {
  doc.setDrawColor(0)
  doc.setLineWidth(0.3)
  doc.rect(x, y - size + 0.5, size, size)
  if (checked) {
    // Dessiner un X ou checkmark
    doc.setLineWidth(0.5)
    doc.line(x + 0.5, y - size + 1, x + size - 0.5, y - 0.5)
    doc.line(x + 0.5, y - 0.5, x + size - 0.5, y - size + 1)
  }
}

// Dessine un carré vide (pour les choix multiples)
function drawSquare(doc, x, y, size = 3, filled = false) {
  doc.setDrawColor(0)
  doc.setLineWidth(0.3)
  if (filled) {
    doc.setFillColor(0)
    doc.rect(x, y - size, size, size, 'FD')
  } else {
    doc.rect(x, y - size, size, size, 'S')
  }
}

// Alias pour compatibilité
function drawCircle(doc, x, y, radius = 1.5, filled = false) {
  drawSquare(doc, x, y, radius * 2, filled)
}

// ============================================================
// HEADER AVEC LOGO
// ============================================================
function addHeader(doc, sessionRef = null, options = {}) {
  const pw = doc.internal.pageSize.getWidth()
  // Utilise le logo de ORG si disponible
  const logoBase64 = options.logoBase64 || ORG.logo_base64
  const org = options.orgInfo || ORG
  
  // Logo: soit image paramétrable, soit rectangle bleu par défaut
  // Ratio correct du logo Access Formation: environ 4:1 (largeur/hauteur)
  if (logoBase64) {
    try {
      // Détecter le format (PNG ou JPEG)
      const format = logoBase64.includes('image/png') ? 'PNG' : 'JPEG'
      // Logo avec ratio 4:1 : largeur 50, hauteur 12.5
      doc.addImage(logoBase64, format, 15, 10, 50, 12.5)
    } catch (e) {
      console.warn('Erreur chargement logo:', e)
      // Fallback: rectangle bleu + texte
      doc.setFillColor(0, 102, 204)
      doc.rect(15, 10, 50, 12, 'F')
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(255, 255, 255)
      doc.text('ACCESS FORMATION', 20, 18)
      doc.setTextColor(0, 0, 0)
    }
  } else {
    // Rectangle bleu + texte par défaut
    doc.setFillColor(0, 102, 204)
    doc.rect(15, 10, 50, 12, 'F')
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(255, 255, 255)
    doc.text('ACCESS FORMATION', 20, 18)
    doc.setTextColor(0, 0, 0)
  }
  
  // Infos société (depuis ORG global) - décalées à droite du logo
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(0, 0, 0)
  doc.text((org.nameFull || org.name).toUpperCase(), 70, 12)
  doc.text(org.address, 70, 17)
  doc.text(`Tél : ${org.phone} - Email : ${org.email}`, 70, 22)
  doc.text(`SIRET : ${org.siret} - NDA : ${org.nda}`, 70, 27)
  
  // Référence session en haut à droite
  if (sessionRef) {
    doc.setFontSize(8)
    doc.setTextColor(150, 150, 150)
    doc.text(sessionRef, pw - 15, 10, { align: 'right' })
    doc.setTextColor(0, 0, 0)
  }
  
  return 38
}

function addTitle(doc, title, y) {
  const pw = doc.internal.pageSize.getWidth()
  doc.setFillColor(0, 102, 204)
  doc.rect(15, y, pw - 30, 10, 'F')
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(255, 255, 255)
  doc.text(title, pw / 2, y + 7, { align: 'center' })
  doc.setTextColor(0, 0, 0)
  return y + 18
}

function addFooter(doc, docCode, pageNum = null) {
  const ph = doc.internal.pageSize.getHeight()
  const pw = doc.internal.pageSize.getWidth()
  doc.setDrawColor(200)
  doc.setLineWidth(0.3)
  doc.line(15, ph - 22, pw - 15, ph - 22)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100)
  doc.text(`${ORG.name} - ${ORG.addressFull}`, pw / 2, ph - 17, { align: 'center' })
  doc.text(`NDA : ${ORG.ndaFull}`, pw / 2, ph - 13, { align: 'center' })
  doc.text(`SIRET: ${ORG.siret} - NAF: ${ORG.naf} - TVA: ${ORG.tva}`, pw / 2, ph - 9, { align: 'center' })
  doc.setFontSize(6)
  doc.setTextColor(180)
  doc.text(`${docCode}-${APP_VERSION}`, pw - 15, ph - 5, { align: 'right' })
  if (pageNum) doc.text(`Page ${pageNum}`, 15, ph - 5)
  doc.setTextColor(0)
}

// ============================================================
// HELPER - Obtenir le lieu (Intra = adresse client)
// ============================================================
function getLocation(session) {
  if (session?.is_intra && session?.clients?.address) {
    return session.clients.address
  }
  return session?.location_name || session?.location || ''
}

// ============================================================
// CONVENTION DE FORMATION
// ============================================================
function generateConvention(session, trainees = [], trainer = null, costs = []) {
  const doc = new jsPDF({ compress: true })
  const pw = doc.internal.pageSize.getWidth()
  const client = session?.clients || {}
  const course = session?.courses || {}
  const ref = session?.reference || ''
  const lieu = getLocation(session)
  const contact = getSessionContact(session)
  const signatory = getSessionSignatory(session)
  
  let y = addHeader(doc, ref)
  y = addTitle(doc, 'CONVENTION DE FORMATION PROFESSIONNELLE', y)
  
  doc.setFontSize(8)
  doc.setFont('helvetica', 'italic')
  doc.text('Conformément aux articles L6353-1 à L6353-9 et D6313-3-1 du Code du travail', pw / 2, y, { align: 'center' })
  y += 10
  
  // ═══════════════════════════════════════════════════════════
  // ENTRE LES SOUSSIGNÉS - Plus espacé avec ligne de séparation
  // ═══════════════════════════════════════════════════════════
  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.3)
  doc.line(20, y, pw - 20, y)
  y += 6
  
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('ENTRE LES SOUSSIGNÉS', pw / 2, y, { align: 'center' })
  y += 8
  
  // ─────────────────────────────────────────────────────────
  // ORGANISME DE FORMATION - Bloc avec fond léger
  // ─────────────────────────────────────────────────────────
  doc.setFillColor(248, 250, 252)
  doc.roundedRect(18, y - 2, pw - 36, 38, 2, 2, 'F')
  
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(0, 102, 153)
  doc.text("L'ORGANISME DE FORMATION", 22, y + 4)
  doc.setTextColor(0, 0, 0)
  
  y += 10
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(ORG.nameFull, 22, y); y += 4
  doc.text(`SIRET : ${ORG.siret}  |  NDA : ${ORG.nda}`, 22, y); y += 4
  doc.text(`Siège : ${ORG.address}`, 22, y); y += 4
  doc.text(`Représenté par : ${ORG.dirigeant}, Dirigeant`, 22, y); y += 4
  doc.text(`Tél. : ${ORG.phone}  |  Courriel : ${ORG.email}`, 22, y); y += 4
  doc.setFont('helvetica', 'italic')
  doc.text('Ci-après dénommé « l\'Organisme de Formation »', 22, y)
  y += 10
  
  // ET
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('ET', pw / 2, y, { align: 'center' })
  y += 8
  
  // ─────────────────────────────────────────────────────────
  // BÉNÉFICIAIRE - Bloc avec fond léger
  // ─────────────────────────────────────────────────────────
  const benefHeight = contact.role ? 34 : 30
  doc.setFillColor(248, 250, 252)
  doc.roundedRect(18, y - 2, pw - 36, benefHeight, 2, 2, 'F')
  
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(0, 102, 153)
  doc.text("LE BÉNÉFICIAIRE", 22, y + 4)
  doc.setTextColor(0, 0, 0)
  
  y += 10
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Raison sociale : ${client.name || ''}`, 22, y); y += 4
  doc.text(`Adresse : ${client.address || ''}`, 22, y); y += 4
  doc.text(`Représenté par : ${signatory.name || ''}${signatory.role ? '  |  Fonction : ' + signatory.role : ''}`, 22, y); y += 4
  doc.text(`SIRET : ${client.siret || ''}`, 22, y); y += 4
  doc.setFont('helvetica', 'italic')
  doc.text('Ci-après dénommé « le Bénéficiaire »', 22, y)
  y += 12
  
  // Pied de page 1 et nouvelle page pour les articles
  addFooter(doc, DOC_CODES.convention)
  doc.addPage()
  y = 25
  
  // ═══════════════════════════════════════════════════════════
  // ARTICLE 1 - Commence en page 2
  // ═══════════════════════════════════════════════════════════
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(0, 51, 102)
  doc.text('ARTICLE 1 – Objet, durée et effectif de la formation', 20, y)
  doc.setTextColor(0, 0, 0)
  y += 7
  
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('Le Bénéficiaire souhaite faire participer une partie de son personnel à la formation suivante :', 20, y)
  y += 7
  
  // Tableau des infos formation
  doc.setFont('helvetica', 'bold')
  doc.text('Intitulé :', 20, y)
  doc.setFont('helvetica', 'normal')
  doc.text(course.title || '', 55, y); y += 5
  
  doc.setFont('helvetica', 'bold')
  doc.text("Type d'action :", 20, y)
  doc.setFont('helvetica', 'normal')
  doc.text('Action de formation', 55, y); y += 5
  
  // Objectifs avec retour à la ligne si nécessaire
  doc.setFont('helvetica', 'bold')
  doc.text('Objectif(s) :', 20, y)
  doc.setFont('helvetica', 'normal')
  const objText = course.objectives || ''
  if (objText.length > 70) {
    const objLines = doc.splitTextToSize(objText, 135)
    doc.text(objLines[0], 55, y); y += 4
    for (let i = 1; i < objLines.length; i++) {
      doc.text(objLines[i], 55, y); y += 4
    }
  } else {
    doc.text(objText, 55, y); y += 5
  }
  y += 2
  
  // Liste des stagiaires si présents
  if (trainees.length > 0) {
    // Vérifier si on a besoin d'une nouvelle page
    const traineeHeight = trainees.length * 4 + 10
    if (y + traineeHeight > 270) {
      addFooter(doc, DOC_CODES.convention)
      doc.addPage()
      y = 25
    }
    
    doc.setFont('helvetica', 'bold')
    doc.text('Apprenants désignés par le Bénéficiaire :', 20, y); y += 5
    doc.setFont('helvetica', 'normal')
    trainees.forEach((t, idx) => { 
      doc.text(`${idx + 1}. ${t.last_name?.toUpperCase() || ''} ${t.first_name || ''}`, 25, y); y += 4 
    })
    y += 3
  }
  
  // Mention du type de financement si renseigné
  if (session.funding_type && session.funding_type !== 'none') {
    // Vérifier si on a assez d'espace
    if (y + 15 > 270) {
      addFooter(doc, DOC_CODES.convention)
      doc.addPage()
      y = 25
    }
    
    const fundingLabels = {
      opco: 'OPCO',
      cpf: 'CPF (Compte Personnel de Formation)',
      faf: 'FAF (Fonds d\'Assurance Formation)',
      region: 'Région',
      france_travail: 'France Travail',
      ptp: 'PTP (Plan de Transition Professionnel)',
      fne: 'FNE (Fonds National de l\'Emploi)',
      direct: 'Financement direct',
      other: 'Autre'
    }
    
    doc.setFont('helvetica', 'bold')
    doc.text('Mode de financement :', 20, y)
    doc.setFont('helvetica', 'normal')
    const fundingLabel = fundingLabels[session.funding_type] || session.funding_type
    const fundingText = session.funding_details 
      ? `${fundingLabel} (${session.funding_details})` 
      : fundingLabel
    doc.text(fundingText, 55, y)
    y += 5
  }
  
  // Infos pratiques en tableau plus compact
  const infoStartY = y
  doc.setFont('helvetica', 'bold')
  doc.text('Durée :', 20, y)
  doc.setFont('helvetica', 'normal')
  doc.text(`${course.duration_hours || course.duration || '7'} heures`, 55, y)
  
  doc.setFont('helvetica', 'bold')
  doc.text('Effectif :', 105, y)
  doc.setFont('helvetica', 'normal')
  doc.text(`${trainees.length} participant(s)`, 130, y)
  y += 5
  
  doc.setFont('helvetica', 'bold')
  doc.text('Dates :', 20, y)
  doc.setFont('helvetica', 'normal')
  doc.text(`Du ${formatDate(session?.start_date)} au ${formatDate(session?.end_date)}`, 55, y)
  
  doc.setFont('helvetica', 'bold')
  doc.text('Horaires :', 105, y)
  doc.setFont('helvetica', 'normal')
  doc.text(`${session?.start_time || ''} - ${session?.end_time || ''}`, 130, y)
  y += 5
  
  // Lieu - avec gestion des textes longs
  doc.setFont('helvetica', 'bold')
  doc.text('Lieu :', 20, y)
  doc.setFont('helvetica', 'normal')
  const lieuLines = doc.splitTextToSize(lieu || 'À définir', 135)
  lieuLines.forEach((line, i) => { doc.text(line, 55, y + (i * 4)) })
  y += Math.max(5, lieuLines.length * 4)
  
  // Public - avec gestion des textes longs
  doc.setFont('helvetica', 'bold')
  doc.text('Public :', 20, y)
  doc.setFont('helvetica', 'normal')
  const publicText = course.target_audience || 'Tout public'
  const publicLines = doc.splitTextToSize(publicText, 135)
  publicLines.forEach((line, i) => { doc.text(line, 55, y + (i * 4)) })
  y += Math.max(5, publicLines.length * 4)
  
  // Prérequis - avec gestion des textes longs
  doc.setFont('helvetica', 'bold')
  doc.text('Prérequis :', 20, y)
  doc.setFont('helvetica', 'normal')
  const prerequisText = course.prerequisites || 'Aucun'
  const prerequisLines = doc.splitTextToSize(prerequisText, 135)
  prerequisLines.forEach((line, i) => { doc.text(line, 55, y + (i * 4)) })
  y += Math.max(5, prerequisLines.length * 4)
  
  doc.setFont('helvetica', 'bold')
  doc.text('Formateur :', 20, y)
  doc.setFont('helvetica', 'normal')
  doc.text(trainer ? `${trainer.first_name} ${trainer.last_name}` : ORG.dirigeant, 55, y)
  y += 10
  
  // ═══════════════════════════════════════════════════════════
  // Calcul des coûts
  // ═══════════════════════════════════════════════════════════
  const coutFormationHT = parseFloat(session?.total_price || course.price_ht || course.price_per_day || 0)
  let totalCostsSupp = 0
  const costDetails = []
  if (costs && costs.length > 0) {
    costs.forEach(cost => {
      const amount = parseFloat(cost.amount || 0)
      const total = cost.per_trainee ? amount * trainees.length : amount
      totalCostsSupp += total
      costDetails.push({ label: cost.label, amount, per_trainee: cost.per_trainee, total })
    })
  }
  const coutTotalHT = coutFormationHT + totalCostsSupp
  
  // Construire le texte de l'article 3
  let article3Text = `Coût de la formation : ${coutFormationHT.toFixed(2)} € HT`
  
  // ─── Mention inter-entreprises ───────────────────────────
  const isInter = session?.inter_group_id && session?.inter_total_price
  if (isInter) {
    // Seule la quote-part de ce bénéficiaire est mentionnée : le total global de la session
    // n'apparaît pas (entreprises éventuellement de groupes différents, et total non recalculé
    // quand le prix d'une des sessions est modifié)
    const nbStagiaires = trainees.length || 1
    const prixParTete = coutFormationHT > 0 ? (coutFormationHT / nbStagiaires) : 0
    article3Text += `\n(${nbStagiaires} stagiaire${nbStagiaires > 1 ? 's' : ''} × ${prixParTete.toFixed(2)} €/stagiaire — session inter-entreprises)`
  }
  
  if (costDetails.length > 0) {
    article3Text += `\n\nCoûts supplémentaires :`
    costDetails.forEach(c => {
      if (c.per_trainee) {
        article3Text += `\n• ${c.label} : ${c.amount.toFixed(2)} € × ${trainees.length} stagiaire(s) = ${c.total.toFixed(2)} € HT`
      } else {
        article3Text += `\n• ${c.label} : ${c.total.toFixed(2)} € HT`
      }
    })
    article3Text += `\n\nCOÛT TOTAL : ${coutTotalHT.toFixed(2)} € HT`
  } else {
    article3Text += `\nCoût total : ${coutTotalHT.toFixed(2)} € HT`
  }
  article3Text += `\n\nModalités de paiement : par virement bancaire à réception de facture\nIBAN : ${ORG.iban}  |  BIC : ${ORG.bic}\n\nAucun acompte ne sera demandé avant la formation.`
  
  // ═══════════════════════════════════════════════════════════
  // ARTICLES 2 à 10
  // ═══════════════════════════════════════════════════════════
  const articles = [
    { title: 'ARTICLE 2 – Engagements des parties', text: "Le Bénéficiaire s'engage à assurer la présence des stagiaires inscrits et à fournir les moyens nécessaires à la réalisation de la formation (salle, matériel, conditions d'accueil). L'Organisme de Formation s'engage à mettre en œuvre les moyens pédagogiques, techniques et d'encadrement nécessaires pour atteindre les objectifs visés." },
    { title: 'ARTICLE 3 – Dispositions financières', text: article3Text },
    { title: 'ARTICLE 4 – Moyens et modalités pédagogiques', text: "La formation est dispensée selon une approche pédagogique active et participative, combinant apports théoriques, mises en situation pratiques et évaluations formatives continues. Les supports pédagogiques utilisés sont adaptés aux objectifs de la formation et aux spécificités du public accueilli.\n\nLa présence des stagiaires est attestée par un dispositif d'émargement dématérialisé par QR Code individuel, ou sur support papier en cas d'indisponibilité du réseau numérique. Un émargement est réalisé par demi-journée, signé par chaque stagiaire et contresigné par le formateur." },
    { title: "ARTICLE 5 – Modalités de suivi et d'évaluation", text: "Un positionnement préalable des participants est réalisé en amont de la formation afin d'adapter le déroulé pédagogique au niveau et aux besoins de chaque stagiaire.\n\nTout au long de la formation, des évaluations formatives permettent de mesurer la progression des acquis (mises en situation, exercices pratiques, questionnements oraux ou écrits). En fin de parcours, une évaluation sommative est conduite selon les critères du référentiel applicable à la formation suivie.\n\nUn certificat de réalisation mentionnant le niveau d'atteinte des objectifs est remis à l'issue de la formation." },
    { title: 'ARTICLE 6 – Sanction et documents délivrés', text: "À l'issue de la formation, l'Organisme de Formation délivrera : une attestation de présence, un certificat de réalisation (Acquis / Non acquis) et, le cas échéant, une attestation officielle selon le module suivi." },
    { title: 'ARTICLE 7 – Annulation et dédommagement', text: "En cas de désistement du Bénéficiaire moins de 14 jours avant le début de la formation, une indemnité forfaitaire de 50 % du coût total sera facturée. En cas de désistement moins de 7 jours avant, une indemnité de 75 % sera facturée. En cas d'annulation par Access Formation moins de 7 jours avant, une nouvelle date sera proposée sans frais." },
    { title: 'ARTICLE 8 – Accessibilité', text: `Access Formation s'engage à favoriser l'accès à ses formations pour toute personne en situation de handicap. Toute demande d'adaptation doit être signalée en amont à ${ORG.email} afin de mettre en place les mesures nécessaires.` },
    { title: 'ARTICLE 9 – Protection des données (RGPD)', text: "Les données personnelles collectées sont utilisées exclusivement dans le cadre de la gestion administrative et pédagogique des formations. Elles sont conservées 5 ans et accessibles sur demande conformément au RGPD." },
    { title: 'ARTICLE 10 – Litiges', text: "En cas de différend, les parties s'efforceront de trouver une solution amiable. À défaut, le litige sera porté devant le tribunal de commerce de Quimper." },
  ]
  
  articles.forEach(art => {
    // Découper le texte en paragraphes sur les sauts de ligne doubles
    const paragraphs = art.text.split('\n\n')
    // Calculer la hauteur totale (paragraphes + espaces entre eux + titre)
    let totalLines = 0
    paragraphs.forEach(p => { totalLines += doc.splitTextToSize(p.replace(/\n/g, ' '), 170).length })
    const articleHeight = 8 + (totalLines * 4) + ((paragraphs.length - 1) * 3)

    // Nouvelle page si pas assez de place
    if (y + articleHeight > 265) {
      addFooter(doc, DOC_CODES.convention)
      doc.addPage()
      y = 25
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(0, 51, 102)
    doc.text(art.title, 20, y)
    doc.setTextColor(0, 0, 0)
    y += 6

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    paragraphs.forEach((para, pi) => {
      // Remplacer les sauts de ligne simples par un espace dans chaque paragraphe
      const lines = doc.splitTextToSize(para.replace(/\n/g, ' '), 170)
      lines.forEach(l => { doc.text(l, 20, y); y += 4 })
      // Espace entre paragraphes (sauf après le dernier)
      if (pi < paragraphs.length - 1) y += 3
    })
    y += 6
  })
  
  // ═══════════════════════════════════════════════════════════
  // SIGNATURES
  // ═══════════════════════════════════════════════════════════
  if (y > 220) {
    addFooter(doc, DOC_CODES.convention)
    doc.addPage()
    y = 25
  }
  
  // Ligne de séparation
  y += 5
  doc.setDrawColor(100, 100, 100)
  doc.line(20, y, pw - 20, y)
  y += 10
  
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(`Fait en deux exemplaires originaux à ${ORG.city}, le ${formatDate(new Date())}`, pw / 2, y, { align: 'center' })
  y += 12
  
  // Deux colonnes pour les signatures
  const col1X = 30
  const col2X = pw / 2 + 20
  
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text("Pour l'Organisme de Formation", col1X, y)
  doc.text('Pour le Bénéficiaire', col2X, y)
  y += 5
  
  doc.setFont('helvetica', 'normal')
  doc.text(ORG.name, col1X, y)
  doc.text(client.name || '', col2X, y)
  y += 5
  doc.text(ORG.dirigeant, col1X, y)
  if (signatory.name) doc.text(signatory.name + (signatory.role ? ', ' + signatory.role : ''), col2X, y)
  y += 5
  
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.text('(Cachet et signature)', col1X, y)
  doc.text('(Cachet et signature)', col2X, y)
  y += 8
  
  // Tampon OF
  try { doc.addImage(ORG.stamp_base64, 'JPEG', col1X - 5, y, 50, 18) } catch {}
  
  addFooter(doc, DOC_CODES.convention)
  return doc
}

// ============================================================
// CONVOCATION
// ============================================================
function generateConvocation(session, trainee, trainer = null) {
  const doc = new jsPDF({ compress: true })
  const pw = doc.internal.pageSize.getWidth()
  const course = session?.courses || {}
  const client = session?.clients || {}
  const ref = session?.reference || ''
  const lieu = getLocation(session)
  
  let y = addHeader(doc, ref)
  y = addTitle(doc, 'CONVOCATION À LA FORMATION', y)
  
  // Civilité selon le genre
  const civilite = trainee?.gender === 'female' ? 'Madame' : (trainee?.gender === 'non_binary' ? '' : 'Monsieur')
  const fullName = civilite ? `${civilite} ${trainee?.first_name || ''} ${trainee?.last_name?.toUpperCase() || ''}` : `${trainee?.first_name || ''} ${trainee?.last_name?.toUpperCase() || ''}`
  
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text(fullName, pw / 2, y, { align: 'center' })
  y += 10
  
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('Merci de vous présenter à la session de formation selon les informations suivantes :', 20, y)
  y += 10
  
  doc.setFont('helvetica', 'bold')
  doc.text(`Intitulé de la formation : ${course.title || ''}`, 20, y); y += 6
  doc.setFont('helvetica', 'normal')
  if (course.objectives) {
    const objLines = doc.splitTextToSize(`Objectif(s) : ${course.objectives}`, 170)
    objLines.forEach(l => { doc.text(l, 20, y); y += 5 })
  }
  y += 3
  
  doc.setFont('helvetica', 'bold')
  doc.text(`Date(s) de formation : ${formatDate(session?.start_date)} au ${formatDate(session?.end_date)}`, 20, y); y += 6
  doc.text(`Horaires : ${session?.start_time || ''} - ${session?.end_time || ''}`, 20, y); y += 6
  doc.setFont('helvetica', 'normal')
  doc.text(`Durée totale : ${course.duration_hours || course.duration || '7'} heures`, 20, y); y += 8
  
  doc.setFont('helvetica', 'bold')
  doc.text(`Lieu de formation : ${lieu}`, 20, y); y += 6
  doc.setFont('helvetica', 'normal')
  doc.text(`Formateur : ${trainer ? `${trainer.first_name} ${trainer.last_name}` : ORG.dirigeant}`, 20, y); y += 10
  
  // Documents requis
  doc.setFont('helvetica', 'bold')
  doc.text('Nous vous demandons de venir avec :', 20, y); y += 6
  doc.setFont('helvetica', 'normal')
  doc.text('• Votre pièce d\'identité', 25, y); y += 5
  doc.text('• Votre numéro de sécurité sociale', 25, y); y += 8
  
  if (course.material) {
    doc.text(`Merci de vous munir d'une tenue adaptée et du matériel indiqué par le formateur, le cas échéant : ${course.material}`, 20, y, { maxWidth: 170 }); y += 10
  } else {
    doc.text("Merci de vous munir d'une tenue adaptée et du matériel indiqué par le formateur, le cas échéant.", 20, y, { maxWidth: 170 }); y += 8
  }
  
  doc.text(`Accessibilité : en cas de besoins spécifiques (mobilité, auditif, visuel...), merci de nous en informer à ${ORG.email} au moins 72 heures avant la formation.`, 20, y, { maxWidth: 170 }); y += 12
  
  // Mention émargement QR Code
  doc.setFont('helvetica', 'bold')
  doc.text('Émargement dématérialisé :', 20, y); y += 5
  doc.setFont('helvetica', 'normal')
  doc.text('Votre présence sera enregistrée via votre QR Code personnel (ou sur feuille papier en cas d\'indisponibilité du réseau).', 20, y, { maxWidth: 170 }); y += 10
  
  doc.text(`Contact Access Formation : Pour toute question, contactez-nous au ${ORG.phone} ou par mail à ${ORG.email}`, 20, y, { maxWidth: 170 }); y += 8
  
  const convContact = getSessionContact(session)
  if (convContact.name) {
    doc.text(`Contact de votre entreprise : ${convContact.name}${convContact.role ? ' - ' + convContact.role : ''}`, 20, y, { maxWidth: 170 }); y += 10
  } else if (client.contact_name) {
    doc.text(`Contact de votre entreprise : ${client.contact_name}${client.contact_function ? ' - ' + client.contact_function : ''}`, 20, y, { maxWidth: 170 }); y += 10
  }
  
  doc.text('Nous vous remercions pour votre ponctualité et votre participation active.', 20, y); y += 15
  
  // Signature et tampon
  doc.setFont('helvetica', 'normal')
  doc.text(`Fait à ${ORG.city}, le ${new Date().toLocaleDateString('fr-FR')}`, 20, y); y += 10
  try { doc.addImage(ORG.stamp_base64, 'PNG', 165, y - 5, 30, 30) } catch {}
  
  doc.text(`${ORG.dirigeant}`, 20, y + 5)
  doc.text(`Dirigeant ${ORG.name}`, 20, y + 10)
  
  addFooter(doc, DOC_CODES.convocation)
  return doc
}

// ============================================================
// ÉMARGEMENT - AVEC N° SÉCU, SANS SIGNATURE FORMATEUR
// ============================================================
// attendanceData = { signatures: [...], halfdays: [...] } passé depuis SessionDetail
function generateEmargement(session, trainees = [], trainer = null, isBlank = false, attendanceData = null) {
  const doc = new jsPDF({ orientation: 'landscape', compress: true })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const course = session?.courses || {}
  const ref = session?.reference || ''
  const lieu = isBlank ? '________________________________' : getLocation(session)

  const signatures = attendanceData?.signatures || []   // table "attendances" (ancien format)
  const halfdays = attendanceData?.halfdays || []       // table "attendance_halfdays"
  const proxies = attendanceData?.proxies || []         // table "attendance_proxy_signatures"
  const absents = attendanceData?.absents || []         // ids des stagiaires notés absents
  const trainerSignatureBase64 = attendanceData?.trainerSignatureBase64

  const ROWS_PER_PAGE = 12

  // Helper : signature électronique de l'ancien format
  const getSignature = (traineeId, dateStr, period) => {
    const periodMap = { morning: 'am', afternoon: 'pm' }
    const target = periodMap[period]
    return signatures.find(s =>
      s.trainee_id === traineeId &&
      s.date === dateStr &&
      (s.period === target || s.period === 'full')
    )
  }

  // Helper : présence enregistrée pour cette demi-journée
  const getHalfday = (traineeId, dateStr, period) => {
    const hd = halfdays.find(h => h.trainee_id === traineeId && String(h.date).substring(0, 10) === dateStr)
    if (!hd) return null
    const isPresent = period === 'morning' ? hd.morning : hd.afternoon
    return isPresent ? hd : null
  }

  // Helper : signature recueillie par un tiers
  const getProxy = (traineeId, dateStr, period) =>
    proxies.find(p => p.trainee_id === traineeId && String(p.date).substring(0, 10) === dateStr && p.period === period)

  // ============ JOURS ============
  let days = []
  if (!isBlank && session?.start_date && session?.end_date) {
    try { days = eachDayOfInterval({ start: parseISO(session.start_date), end: parseISO(session.end_date) }) } catch {}
  }
  const displayDays = isBlank ? [1, 2, 3] : (days.length > 0 ? days : [new Date()])
  const isHalfDay = session?.day_type === 'half'
  const halfDayPeriod = isHalfDay && session?.start_time ? (parseInt(session.start_time.split(':')[0], 10) >= 12 ? 'afternoon' : 'morning') : 'morning'
  const colsPerDay = isHalfDay ? 1 : 2

  // ============ COLONNES ============
  // Plus de n° de sécurité sociale (INRS) ni d'email (RGPD) : le nom reprend la place
  const nameColW = 78
  const remainingW = pw - 30 - nameColW
  const dayColW = Math.min(40, remainingW / (displayDays.length * colsPerDay))
  const startX = 15
  const tableW = nameColW + displayDays.length * dayColW * colsPerDay

  // Découpage en pages de 12 stagiaires
  const rowsAll = isBlank
    ? [...trainees, ...Array(Math.max(0, 10 - trainees.length)).fill({})]
    : (trainees.length > 0 ? trainees : [{}])
  const pages = []
  for (let i = 0; i < rowsAll.length; i += ROWS_PER_PAGE) pages.push(rowsAll.slice(i, i + ROWS_PER_PAGE))
  const totalPages = pages.length

  // Hauteur de ligne : identique sur toutes les pages
  const hasAnySignatureImage = !isBlank && (
    signatures.some(s => s.signature_data || s.signature) ||
    halfdays.some(hd => hd.signature_morning || hd.signature_afternoon) ||
    proxies.length > 0
  )
  const FIXED_OVERHEAD = 108
  const availableForRows = ph - FIXED_OVERHEAD
  const maxRowH = hasAnySignatureImage ? 18 : 14
  const minRowH = hasAnySignatureImage ? 9 : 8
  const nRowsMax = Math.min(rowsAll.length, ROWS_PER_PAGE)
  const rowH = isBlank ? 10 : Math.min(maxRowH, Math.max(minRowH, Math.floor(availableForRows / Math.max(nRowsMax, 1))))

  // ============ HELPERS DE DESSIN ============
  const drawCheckmark = (cx, cy, size, color) => {
    doc.setDrawColor(color[0], color[1], color[2])
    doc.setLineWidth(0.6)
    doc.setFillColor(color[0], color[1], color[2])
    doc.roundedRect(cx, cy, size, size, 0.8, 0.8, 'F')
    doc.setDrawColor(255, 255, 255)
    doc.setLineWidth(0.7)
    doc.line(cx + size * 0.25, cy + size * 0.58, cx + size * 0.45, cy + size * 0.78)
    doc.line(cx + size * 0.45, cy + size * 0.78, cx + size * 0.8, cy + size * 0.3)
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(0.2)
  }

  // Image insérée sans déformation, centrée dans la case
  const drawSignatureImage = (imageData, cellX, cellY, boxW, boxH) => {
    if (!imageData || typeof imageData !== 'string' || !imageData.startsWith('data:image')) return false
    try {
      let ratio = 2.5
      try {
        const props = doc.getImageProperties(imageData)
        if (props?.width && props?.height) ratio = props.width / props.height
      } catch { /* proportions par défaut */ }
      let w = boxW
      let h = w / ratio
      if (h > boxH) { h = boxH; w = h * ratio }
      doc.addImage(imageData, 'PNG', cellX + (boxW - w) / 2, cellY + (boxH - h) / 2, w, h)
      return true
    } catch (e) {
      console.warn('Erreur addImage signature:', e)
      return false
    }
  }

  const drawHeader = (pageNum) => {
    if (isBlank) {
      const logoBase64 = ORG.logo_base64
      if (logoBase64) {
        try {
          const fmt = logoBase64.includes('image/png') ? 'PNG' : 'JPEG'
          doc.addImage(logoBase64, fmt, 15, 10, 50, 12.5)
        } catch (e) {
          doc.setFillColor(0, 102, 204)
          doc.rect(15, 10, 50, 12, 'F')
          doc.setFontSize(10)
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(255, 255, 255)
          doc.text('ACCESS FORMATION', 20, 18)
          doc.setTextColor(0, 0, 0)
        }
      } else {
        doc.setFillColor(0, 102, 204)
        doc.rect(15, 10, 50, 12, 'F')
        doc.setFontSize(10)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(255, 255, 255)
        doc.text('ACCESS FORMATION', 20, 18)
        doc.setTextColor(0, 0, 0)
      }
      doc.setFontSize(8)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(0, 0, 0)
      doc.text('N° Session : __________', pw - 55, 15)
    } else {
      doc.setFontSize(8)
      doc.setTextColor(150, 150, 150)
      doc.text(ref, pw - 15, 10, { align: 'right' })
      doc.setTextColor(0, 0, 0)
    }

    let y = 15
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text("FEUILLE D'ÉMARGEMENT", pw / 2, y, { align: 'center' })
    y += 10

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    const halfW = pw / 2 - 20
    const rightW = pw / 2 - 18
    const truncText = (prefix, text, maxW) => {
      const full = `${prefix}${text}`
      const lines = doc.splitTextToSize(full, maxW)
      return lines[0] || full
    }
    doc.text(truncText('Formation : ', isBlank ? '________________________________________' : (course.title || ''), halfW), 15, y)
    doc.text(truncText('Client : ', isBlank ? '________________________' : (session?.clients?.name || ''), rightW), pw / 2, y); y += 5

    if (isBlank) {
      doc.text(`Dates : Du ___/___/______ au ___/___/______`, 15, y)
    } else {
      doc.text(`Dates : ${formatDate(session?.start_date)} au ${formatDate(session?.end_date)}`, 15, y)
    }
    doc.text(truncText('Lieu : ', isBlank ? '________________________________' : lieu, rightW), pw / 2, y); y += 5
    doc.text(`Formateur : ${isBlank ? '________________________________' : (trainer ? `${trainer.first_name} ${trainer.last_name}` : ORG.dirigeant)}`, 15, y)
    if (totalPages > 1) {
      doc.setFontSize(8)
      doc.setTextColor(120, 120, 120)
      doc.text(`Page ${pageNum} / ${totalPages}`, pw - 15, y, { align: 'right' })
      doc.setTextColor(0, 0, 0)
      doc.setFontSize(9)
    }
    y += 6

    // En-tête du tableau
    doc.setFillColor(240, 240, 240)
    doc.rect(startX, y, tableW, 14, 'F')

    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    doc.text('Nom Prénom', startX + 2, y + 10)

    let x = startX + nameColW
    displayDays.forEach((day, idx) => {
      const dateStr = isBlank ? `J${idx + 1}` : format(day, 'dd/MM', { locale: fr })
      if (isHalfDay) {
        doc.text(dateStr, x + dayColW / 2, y + 4, { align: 'center' })
        doc.text(halfDayPeriod === 'afternoon' ? 'A-midi' : 'Matin', x + dayColW / 2, y + 10, { align: 'center' })
        x += dayColW
      } else {
        doc.text(dateStr, x + dayColW, y + 4, { align: 'center' })
        doc.text('Matin', x + dayColW / 2, y + 10, { align: 'center' })
        doc.text('A-midi', x + dayColW + dayColW / 2, y + 10, { align: 'center' })
        x += dayColW * 2
      }
    })
    doc.setFont('helvetica', 'normal')
    return y + 14
  }

  // ============ PAGES ============
  let proxyNumber = 0
  const proxyNotes = []

  pages.forEach((rows, pageIdx) => {
    if (pageIdx > 0) doc.addPage()
    let y = drawHeader(pageIdx + 1)

    rows.forEach(t => {
      const isAbsent = t.id && absents.includes(t.id)

      doc.setFontSize(7)
      doc.rect(startX, y, nameColW, rowH)

      if (t.first_name) {
        const fullName = `${t.last_name?.toUpperCase() || ''} ${t.first_name || ''}`
        const lines = doc.splitTextToSize(fullName, nameColW - 3)
        doc.text(lines[0] || fullName, startX + 1.5, y + rowH / 2 - 0.5)
      }

      let xx = startX + nameColW
      displayDays.forEach((day) => {
        const dateStr = isBlank ? null : format(day, 'yyyy-MM-dd')

        const drawCell = (cellX, period) => {
          doc.rect(cellX, y, dayColW, rowH)
          if (isBlank || !t.id || !dateStr) return

          if (isAbsent) {
            doc.setFontSize(6)
            doc.setTextColor(150, 150, 150)
            doc.text('ABS', cellX + dayColW / 2, y + rowH / 2 + 1, { align: 'center' })
            doc.setTextColor(0, 0, 0)
            doc.setFontSize(7)
            return
          }

          const proxy = getProxy(t.id, dateStr, period)
          const sig = getSignature(t.id, dateStr, period)
          const hd = getHalfday(t.id, dateStr, period)
          if (!proxy && !sig && !hd) return   // case vide

          const pad = 1
          const boxW = dayColW - pad * 2
          const boxH = rowH - pad * 2

          // 1) Signature recueillie par un tiers → image + renvoi vers l'annexe
          if (proxy) {
            const drawn = drawSignatureImage(proxy.proxy_signature, cellX + pad, y + pad, boxW - 3, boxH)
            if (!drawn) drawCheckmark(cellX + (dayColW - 4.5) / 2, y + (rowH - 4.5) / 2, 4.5, [0, 80, 160])
            let note = proxyNotes.find(n =>
              n.trainee_id === proxy.trainee_id && n.date === String(proxy.date).substring(0, 10) && n.period === proxy.period)
            if (!note) {
              proxyNumber += 1
              note = { ...proxy, num: proxyNumber, trainee: t, date: String(proxy.date).substring(0, 10) }
              proxyNotes.push(note)
            }
            doc.setFontSize(5)
            doc.text(`(${note.num})`, cellX + dayColW - 1.5, y + rowH - 1.5, { align: 'right' })
            doc.setFontSize(7)
            return
          }

          // 2) Signature du stagiaire
          const imageToUse = (sig && (sig.signature_data || sig.signature))
            || (hd && (period === 'morning' ? hd.signature_morning : hd.signature_afternoon))
          if (drawSignatureImage(imageToUse, cellX + pad, y + pad, boxW, boxH)) return

          // 3) Présence validée par le formateur, sans signature
          drawCheckmark(cellX + (dayColW - 4.5) / 2, y + (rowH - 4.5) / 2, 4.5, [0, 80, 160])
        }

        if (isHalfDay) {
          drawCell(xx, halfDayPeriod)
          xx += dayColW
        } else {
          drawCell(xx, 'morning')
          drawCell(xx + dayColW, 'afternoon')
          xx += dayColW * 2
        }
      })
      y += rowH
    })

    // ── Ligne formateur : sa signature enregistrée, sur chaque demi-journée tenue ──
    const ligneFormateurDessinee = !isBlank && !!trainerSignatureBase64
    if (ligneFormateurDessinee) {
      doc.setFillColor(248, 248, 248)
      doc.rect(startX, y, tableW, rowH, 'F')
      doc.rect(startX, y, nameColW, rowH)
      doc.setFontSize(7)
      doc.setFont('helvetica', 'bold')
      doc.text(`Formateur : ${trainer ? `${trainer.last_name?.toUpperCase() || ''} ${trainer.first_name || ''}` : ORG.dirigeant}`, startX + 1.5, y + rowH / 2 - 0.5)
      doc.setFont('helvetica', 'normal')

      let xt = startX + nameColW
      displayDays.forEach((day) => {
        const dateStr = format(day, 'yyyy-MM-dd')
        const drawTrainerCell = (cellX, period) => {
          doc.rect(cellX, y, dayColW, rowH)
          const tenue = trainees.some(t => t.id && !absents.includes(t.id) && (
            getProxy(t.id, dateStr, period) || getSignature(t.id, dateStr, period) || getHalfday(t.id, dateStr, period)
          ))
          if (tenue) drawSignatureImage(trainerSignatureBase64, cellX + 1, y + 1, dayColW - 2, rowH - 2)
        }
        if (isHalfDay) {
          drawTrainerCell(xt, halfDayPeriod)
          xt += dayColW
        } else {
          drawTrainerCell(xt, 'morning')
          drawTrainerCell(xt + dayColW, 'afternoon')
          xt += dayColW * 2
        }
      })
      y += rowH
    }

    // ── Légende (sur chaque page) ──
    if (!isBlank) {
      y += 4
      doc.setFontSize(6)
      doc.setFont('helvetica', 'normal')
      doc.text('Signature du stagiaire, recueillie le jour même', 15, y)
      doc.setTextColor(0, 0, 0)

      const x2 = Math.min(150, startX + tableW / 2)
      doc.text('Présence validée par le formateur', x2 + 5, y)
      doc.setFillColor(0, 80, 160)
      doc.rect(x2, y - 3.5, 3.5, 3.5, 'F')
      doc.setTextColor(0, 0, 0)

      doc.text('ABS : absent  ·  (n) : signature recueillie par un tiers, voir annexe', pw - 15, y, { align: 'right' })
      y += 5
    }

    // ── Case de signature du formateur : uniquement si la ligne du tableau
    //    n'a pas pu être remplie (feuille vierge, ou signature non enregistrée) ──
    if (pageIdx === totalPages - 1 && !ligneFormateurDessinee) {
      y += 3
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(0, 0, 0)
      doc.text('Signature du formateur :', 15, y)
      doc.rect(15, y + 2, 60, 18)
    }

    addFooter(doc, DOC_CODES.emargement, totalPages > 1 ? pageIdx + 1 : null)
  })

  // ============ ANNEXE : SIGNATURES PAR UN TIERS ============
  if (proxyNotes.length > 0) {
    doc.addPage()
    doc.setFontSize(8)
    doc.setTextColor(150, 150, 150)
    doc.text(ref, pw - 15, 10, { align: 'right' })
    doc.setTextColor(0, 0, 0)

    let y = 18
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.text('ANNEXE — SIGNATURES RECUEILLIES PAR UN TIERS', pw / 2, y, { align: 'center' })
    y += 8
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.text(`Formation : ${course.title || ''} — ${formatDate(session?.start_date)} au ${formatDate(session?.end_date)} — ${session?.clients?.name || ''}`, 15, y)
    y += 7

    proxyNotes.forEach(n => {
      if (y > ph - 60) { doc.addPage(); y = 20 }
      const blockH = 34
      doc.setDrawColor(200)
      doc.rect(15, y, pw - 30, blockH)

      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.text(`(${n.num})  ${n.trainee?.last_name?.toUpperCase() || ''} ${n.trainee?.first_name || ''}`, 18, y + 6)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.text(`Demi-journée : ${formatDate(n.date)} — ${n.period === 'morning' ? 'Matin' : 'Après-midi'}`, 18, y + 12)
      doc.text(`Motif : ${n.reason || ''}`, 18, y + 17)
      doc.text(`Signataire : ${n.proxy_first_name || ''} ${n.proxy_last_name?.toUpperCase() || ''} — ${n.proxy_role || ''}`, 18, y + 22)
      doc.setFontSize(7)
      doc.setTextColor(120, 120, 120)
      doc.text("Le stagiaire n'étant pas en mesure de signer, la signature a été recueillie par la personne ci-dessus, en présence du formateur.", 18, y + 28, { maxWidth: 150 })
      doc.setTextColor(0, 0, 0)

      // Signatures : tiers et formateur
      const sigW = 55
      const sigX1 = pw - 30 - sigW * 2 - 6
      const sigX2 = pw - 22 - sigW
      doc.setFontSize(7)
      doc.text('Signature du tiers', sigX1, y + 6)
      doc.rect(sigX1, y + 8, sigW, 20)
      drawSignatureImage(n.proxy_signature, sigX1 + 1, y + 9, sigW - 2, 18)
      doc.text('Contresignature du formateur', sigX2, y + 6)
      doc.rect(sigX2, y + 8, sigW, 20)
      drawSignatureImage(n.trainer_signature, sigX2 + 1, y + 9, sigW - 2, 18)

      doc.setDrawColor(0)
      y += blockH + 5
    })

    addFooter(doc, DOC_CODES.emargement)
  }

  return doc
}

// ============================================================
// ATTESTATION DE PRÉSENCE
// ============================================================
function generateAttestation(session, trainee, trainer = null) {
  const doc = new jsPDF({ compress: true })
  const pw = doc.internal.pageSize.getWidth()
  const course = session?.courses || {}
  const client = session?.clients || {}
  const ref = session?.reference || ''
  const lieu = getLocation(session)
  
  let y = addHeader(doc, ref)
  y = addTitle(doc, 'ATTESTATION DE PRÉSENCE', y)
  
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Je soussigné, ${ORG.dirigeant}, représentant l'organisme de formation ${ORG.name}, atteste que :`, 20, y, { maxWidth: 170 })
  y += 12
  
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(`${trainee?.first_name || ''} ${trainee?.last_name?.toUpperCase() || ''}`, pw / 2, y, { align: 'center' })
  y += 8
  
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Entreprise : ${client.name || ''}`, 20, y); y += 8
  doc.text(`A participé à la formation intitulée : ${course.title || ''}`, 20, y); y += 8
  doc.text(`Dates : du ${formatDate(session?.start_date)} au ${formatDate(session?.end_date)}`, 20, y); y += 8
  doc.text(`Durée totale : ${course.duration_hours || course.duration || '7'} heures`, 20, y); y += 8
  doc.text(`Lieu : ${lieu}`, 20, y); y += 8
  doc.text(`Cette formation a été animée par : ${trainer ? `${trainer.first_name} ${trainer.last_name}` : ORG.dirigeant}`, 20, y); y += 8
  doc.text(`Horaires suivis : ${session?.start_time || ''} - ${session?.end_time || ''}`, 20, y); y += 8
  doc.text(`Nombre total d'heures de présence : ${course.duration_hours || course.duration || '7'}`, 20, y); y += 12
  
  doc.text('Fait pour servir et valoir ce que de droit.', 20, y); y += 10
  doc.text(`Fait à ${ORG.city}, le ${formatDate(session?.end_date || new Date())}`, 20, y); y += 10
  
  doc.text(`Pour ${ORG.name}`, 20, y); y += 5
  try { doc.addImage(ORG.stamp_base64, 'PNG', 155, y - 5, 30, 30) } catch {}
  doc.text(ORG.dirigeant, 20, y + 10)
  
  addFooter(doc, DOC_CODES.attestation)
  return doc
}

// ============================================================
// CERTIFICAT DE RÉALISATION - AVEC CASES GRAPHIQUES
// ============================================================
function generateCertificat(session, trainee, trainer = null) {
  const doc = new jsPDF({ compress: true })
  const pw = doc.internal.pageSize.getWidth()
  const course = session?.courses || {}
  const client = session?.clients || {}
  const ref = session?.reference || ''
  const result = trainee?.result || 'acquired' // Par défaut acquis si non défini
  const isAcquired = result === 'acquired'
  
  let y = addHeader(doc, ref)
  y = addTitle(doc, 'CERTIFICAT DE RÉALISATION', y)
  
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  const introLines1 = doc.splitTextToSize(`Je soussigné, ${ORG.dirigeant}, représentant légal du dispensateur de l'action concourant au développement des compétences ${ORG.name}, ${ORG.address}`, 170)
  doc.text(introLines1, 20, y)
  y += introLines1.length * 5 + 4
  
  doc.setFont('helvetica', 'bold')
  doc.text('Atteste que :', 20, y)
  y += 8
  
  doc.setFontSize(12)
  doc.text(`${trainee?.first_name || ''} ${trainee?.last_name?.toUpperCase() || ''}`, pw / 2, y, { align: 'center' })
  y += 8
  
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  const salarie = trainee?.gender === 'female' ? 'Salariée' : 'Salarié'
  if (trainee?.gender === 'non_binary') {
    doc.text(`Salarié·e de l'entreprise : ${client.name || ''}`, 20, y)
  } else {
    doc.text(`${salarie} de l'entreprise : ${client.name || ''}`, 20, y)
  }
  y += 10
  
  doc.setFont('helvetica', 'bold')
  doc.text("A suivi l'action :", 20, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.text(`${course.title || ''}`, pw / 2, y, { align: 'center' })
  y += 12
  
  doc.setFont('helvetica', 'bold')
  doc.text("Nature de l'action concourant au développement des compétences :", 20, y)
  y += 8
  
  // Cases à cocher graphiques
  doc.setFont('helvetica', 'normal')
  
  // Action de formation - cochée
  drawCheckbox(doc, 25, y, 3, true)
  doc.text('  Action de formation', 30, y)
  y += 6
  
  // Bilan de compétences - non cochée
  doc.setTextColor(150, 150, 150)
  drawCheckbox(doc, 25, y, 3, false)
  doc.text('  Bilan de compétences', 30, y)
  y += 6
  
  // Action de VAE - non cochée
  drawCheckbox(doc, 25, y, 3, false)
  doc.text('  Action de VAE', 30, y)
  y += 6
  
  // Formation par apprentissage - non cochée
  drawCheckbox(doc, 25, y, 3, false)
  doc.text('  Action de formation par apprentissage', 30, y)
  y += 10
  
  doc.setTextColor(0, 0, 0)
  
  doc.text(`Qui s'est déroulée du ${formatDate(session?.start_date)} au ${formatDate(session?.end_date)}`, 20, y)
  y += 6
  doc.text(`Pour une durée de ${course.duration_hours || course.duration || '7'} heures.`, 20, y)
  y += 12
  
  // === RÉSULTAT : ACQUIS / NON ACQUIS ===
  doc.setFont('helvetica', 'bold')
  doc.text("Résultat de l'action de formation :", 20, y)
  y += 8
  
  doc.setFont('helvetica', 'normal')
  
  // Case ACQUIS
  drawCheckbox(doc, 25, y, 3, isAcquired)
  if (isAcquired) {
    doc.setTextColor(0, 128, 0)
    doc.setFont('helvetica', 'bold')
  }
  doc.text('  ACQUIS - Les objectifs de formation ont été atteints', 30, y)
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  y += 6
  
  // Case NON ACQUIS
  drawCheckbox(doc, 25, y, 3, !isAcquired)
  if (!isAcquired) {
    doc.setTextColor(180, 0, 0)
    doc.setFont('helvetica', 'bold')
  }
  doc.text('  NON ACQUIS - Les objectifs de formation n\'ont pas été atteints', 30, y)
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  y += 10
  
  // === SECTION NON ACQUIS : Objectifs non validés + Actions correctives + Remédiation ===
  if (!isAcquired) {
    // Objectifs non validés (simple liste)
    const failedObjectives = trainee?.failed_objectives || []
    if (failedObjectives.length > 0) {
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(180, 0, 0)
      doc.text('Objectifs non validés :', 20, y)
      y += 6
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(0, 0, 0)
      
      failedObjectives.forEach((obj, idx) => {
        const objLines = doc.splitTextToSize(`• ${obj}`, 160)
        objLines.forEach(line => {
          doc.text(line, 25, y)
          y += 5
        })
      })
      y += 4
    }
    
    // Actions correctives (nouveau - commentaires par objectif)
    const failedWithComments = trainee?.failed_objectives_with_comments || []
    const objectivesWithComments = failedWithComments.filter(o => o.comment && o.comment.trim())
    
    if (objectivesWithComments.length > 0) {
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(220, 100, 0)
      doc.text('Actions correctives préconisées :', 20, y)
      y += 6
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(0, 0, 0)
      
      objectivesWithComments.forEach((obj, idx) => {
        // Nom de l'objectif
        doc.setFont('helvetica', 'bold')
        const objTitleLines = doc.splitTextToSize(`❌ ${obj.text}`, 160)
        objTitleLines.forEach(line => {
          doc.text(line, 25, y)
          y += 5
        })
        
        // Commentaire (actions correctives)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(60, 60, 60)
        const commentLines = doc.splitTextToSize(`→ ${obj.comment}`, 155)
        commentLines.forEach(line => {
          doc.text(line, 30, y)
          y += 5
        })
        doc.setTextColor(0, 0, 0)
        y += 3
      })
      y += 2
    }
    
    // Proposition de remédiation globale (garde l'ancien système)
    const remediation = trainee?.remediation_proposal || ''
    if (remediation) {
      doc.setFont('helvetica', 'bold')
      doc.text('Proposition pour valider la formation :', 20, y)
      y += 6
      doc.setFont('helvetica', 'normal')
      const remLines = doc.splitTextToSize(remediation, 165)
      remLines.forEach(line => {
        doc.text(line, 25, y)
        y += 5
      })
      y += 4
    }
  }
  
  doc.setFontSize(8)
  doc.text("Sans préjudice des délais imposés par les règles fiscales, comptables ou commerciales, je m'engage à conserver l'ensemble des pièces justificatives ayant permis d'établir le présent certificat pendant une durée de 3 ans à compter de la fin de l'année du dernier paiement. En cas de cofinancement des fonds européens, la durée de conservation est étendue conformément aux obligations conventionnelles spécifiques.", 20, y, { maxWidth: 170 })
  y += 18
  
  doc.setFontSize(10)
  doc.text(`Fait à : Concarneau`, 20, y); y += 6
  doc.text(`Le : ${formatDate(session?.end_date || new Date())}`, 20, y); y += 10
  
  doc.text('Cachet et signature du responsable du dispensateur de formation :', 20, y); y += 5
  try { doc.addImage(ORG.stamp_base64, 'JPEG', 20, y, 50, 18) } catch {}
  const sigLines1 = doc.splitTextToSize(`${ORG.dirigeant}, Dirigeant ${ORG.name}`, pw - 75 - 15)
  doc.text(sigLines1, 75, y + 8)
  
  addFooter(doc, DOC_CODES.certificat)
  return doc
}

// ============================================================
// ÉVALUATION À CHAUD - AVEC CERCLES GRAPHIQUES (9 critères qualité)
// ============================================================
function generateEvaluation(session, trainee = null, isBlank = false) {
  const doc = new jsPDF({ compress: true })
  const pw = doc.internal.pageSize.getWidth()
  const ref = session?.reference || ''
  const course = session?.courses || {}
  
  let y = addHeader(doc, isBlank ? '' : ref)
  
  // Rectangle N° Session pour documents vierges
  if (isBlank) {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.text('N° Session : __________', pw - 55, 10)
  }
  
  y = addTitle(doc, 'ÉVALUATION À CHAUD', y)
  
  // Plus d'espace après le titre pour documents vierges
  if (isBlank) {
    y += 3
  }
  
  doc.setFontSize(9)
  doc.text(`Formation : ${isBlank ? '________________________' : (course?.title || '')}`, 20, y)
  doc.text(`Date : ${isBlank ? '___/___/______' : formatDate(session?.start_date)}`, 130, y)
  y += 6
  doc.text(`Stagiaire : ${isBlank ? '________________________' : (trainee ? `${trainee.first_name} ${trainee.last_name}` : '')}`, 20, y)
  y += 8
  
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('Échelle de notation :', 20, y)
  y += 4
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('1 = Mauvais   2 = Passable   3 = Moyen   4 = Satisfaisant   5 = Très Satisfaisant   N/C = Non concerné', 20, y)
  y += 6
  
  const colW = 10
  const ncW = 12
  const labelW = pw - 40 - colW * 5 - ncW
  
  // Fonction pour dessiner une section
  const drawSection = (title, questions) => {
    // Titre section
    doc.setFillColor(230, 230, 230)
    doc.rect(20, y, pw - 40, 6, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text(title, 22, y + 4)
    y += 6
    
    // En-tête colonnes
    doc.setFillColor(245, 245, 245)
    doc.rect(20, y, labelW, 5, 'F')
    for (let i = 1; i <= 5; i++) {
      doc.rect(20 + labelW + (i - 1) * colW, y, colW, 5, 'F')
    }
    doc.rect(20 + labelW + 5 * colW, y, ncW, 5, 'F')
    
    doc.setFontSize(6)
    doc.setFont('helvetica', 'bold')
    for (let i = 1; i <= 5; i++) {
      doc.text(String(i), 20 + labelW + (i - 1) * colW + colW / 2, y + 3.5, { align: 'center' })
    }
    doc.text('N/C', 20 + labelW + 5 * colW + ncW / 2, y + 3.5, { align: 'center' })
    y += 5
    
    // Questions
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    questions.forEach(q => {
      doc.rect(20, y, labelW, 6)
      for (let i = 1; i <= 5; i++) {
        doc.rect(20 + labelW + (i - 1) * colW, y, colW, 6)
        drawCircle(doc, 20 + labelW + (i - 1) * colW + colW / 2, y + 3, 1.2, false)
      }
      doc.rect(20 + labelW + 5 * colW, y, ncW, 6)
      drawCircle(doc, 20 + labelW + 5 * colW + ncW / 2, y + 3, 1.2, false)
      doc.text(q, 22, y + 4)
      y += 6
    })
    y += 2
  }
  
  // 1. Organisation
  drawSection('1. ORGANISATION DE LA FORMATION', [
    'Communication des documents avant la formation',
    'Accueil sur le lieu de la formation',
    'Qualité des locaux (salles, signalétique)',
    'Adéquation des moyens matériels',
  ])
  
  // 2. Contenu
  drawSection('2. LE CONTENU DE LA FORMATION', [
    'Organisation et déroulement',
    'Qualité des supports pédagogiques',
    'Durée de la formation',
    'Respect du programme de formation',
  ])
  
  // 3. Formateur
  drawSection('3. L\'INTERVENTION DE L\'ANIMATEUR', [
    'La pédagogie du formateur',
    'L\'expertise du formateur (maîtrise du sujet)',
    'Progression de la formation (rythme)',
    'Adéquation des moyens mis à disposition',
  ])
  
  // 4. Perception globale
  drawSection('4. PERCEPTION GLOBALE', [
    'Adéquation formation / métier ou secteur',
    'Amélioration de vos connaissances',
  ])
  
  // Recommandation
  y += 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('Recommanderiez-vous cette formation ?', 20, y)
  doc.setFont('helvetica', 'normal')
  drawCircle(doc, 100, y - 1, 1.5, false)
  doc.text('  Oui', 103, y)
  drawCircle(doc, 125, y - 1, 1.5, false)
  doc.text('  Non', 128, y)
  y += 8
  
  // Commentaires
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('5. COMMENTAIRES', 20, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('Commentaire général (remarques, suggestions) :', 20, y)
  y += 3
  doc.rect(20, y, pw - 40, 18)
  y += 21
  
  doc.text('Projet de formation (besoins futurs) :', 20, y)
  y += 3
  doc.rect(20, y, pw - 40, 15)
  y += 18
  
  doc.setFontSize(8)
  if (isBlank) doc.text('Date : ___/___/______', 20, y)
  doc.text('Signature :', 130, y)
  
  addFooter(doc, DOC_CODES.evaluation)
  return doc
}

// ============================================================
// ÉVALUATION À FROID - AVEC CERCLES GRAPHIQUES
// ============================================================
function generateEvaluationFroid(session, trainee = null, isBlank = false) {
  const doc = new jsPDF({ compress: true })
  const pw = doc.internal.pageSize.getWidth()
  const ref = session?.reference || ''
  const course = session?.courses || {}
  
  let y = addHeader(doc, isBlank ? '' : ref)
  
  // Rectangle N° Session pour documents vierges
  if (isBlank) {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.text('N° Session : __________', pw - 55, 10)
  }
  
  y = addTitle(doc, 'ÉVALUATION À FROID', y)
  
  // Plus d'espace après le titre pour documents vierges
  if (isBlank) {
    y += 3
  }
  
  doc.setFontSize(9)
  doc.text(`Formation : ${isBlank ? '________________________' : (course?.title || '')}`, 20, y)
  y += 6
  doc.text(`Date de formation : ${isBlank ? '___/___/______' : formatDate(session?.start_date)}`, 20, y)
  y += 6
  doc.text(`Stagiaire : ${isBlank ? '________________________' : (trainee ? `${trainee.first_name} ${trainee.last_name}` : '')}`, 20, y)
  y += 8
  
  // Objectifs de la formation
  const objectives = (course?.objectives || '').split('\n').map(o => o.trim()).filter(o => o.length > 0)
  if (objectives.length > 0 && !isBlank) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('Objectifs de la formation :', 20, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    objectives.forEach((obj, idx) => {
      // Utiliser splitTextToSize pour gérer les retours à la ligne automatiques
      const maxWidth = 168 // 210mm - 20mm marge gauche - 22mm marge droite
      const lines = doc.splitTextToSize(`• ${obj}`, maxWidth)
      lines.forEach((line, lineIdx) => {
        // La première ligne a la puce, les suivantes sont indentées
        const xPos = lineIdx === 0 ? 22 : 26
        doc.text(line.replace('• ', lineIdx === 0 ? '• ' : ''), xPos, y)
        y += 4
      })
    })
    y += 4
  }
  
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(9)
  doc.text('Cette évaluation est à remplir 1 à 3 mois après la formation.', 20, y)
  y += 10
  
  const questions = [
    'Avez-vous pu mettre en pratique les compétences acquises ?',
    'Les objectifs de la formation ont-ils été atteints ?',
    'La formation a-t-elle répondu à vos besoins professionnels ?',
    'Avez-vous constaté une amélioration dans votre travail ?',
  ]
  
  doc.setFont('helvetica', 'normal')
  questions.forEach(q => {
    doc.setFont('helvetica', 'bold')
    doc.text(q, 20, y)
    y += 6
    doc.setFont('helvetica', 'normal')
    
    // Cercles graphiques Oui/Non
    drawCircle(doc, 25, y, 1.5, false)
    doc.text(' Oui', 29, y)
    drawCircle(doc, 55, y, 1.5, false)
    doc.text(' Non', 59, y)
    y += 10
  })
  
  doc.setFont('helvetica', 'bold')
  doc.text('Commentaires :', 20, y)
  y += 5
  doc.rect(20, y, 170, 30)
  y += 38
  
  doc.setFont('helvetica', 'normal')
  doc.text(`Date : ${isBlank ? '___/___/______' : ''}`, 20, y)
  doc.text('Signature :', 120, y)
  
  addFooter(doc, DOC_CODES.evaluationFroid)
  return doc
}

// ============================================================
// ÉVALUATION FORMATEUR - AVEC CERCLES GRAPHIQUES
// ============================================================
function generateEvaluationFormateur(session = null, isBlank = false) {
  const doc = new jsPDF({ compress: true })
  const pw = doc.internal.pageSize.getWidth()
  const ref = session?.reference || ''
  
  let y = addHeader(doc, isBlank ? '' : ref)
  
  // Rectangle N° Session pour documents vierges
  if (isBlank) {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.text('N° Session : __________', pw - 55, 10)
  }
  
  y = addTitle(doc, 'ÉVALUATION DE LA SESSION PAR LE FORMATEUR', y)
  
  // Plus d'espace après le titre pour documents vierges
  if (isBlank) {
    y += 3
  }
  
  doc.setFontSize(9)
  doc.text(`Formation : ${isBlank ? '________________________' : (session?.courses?.title || '')}`, 20, y)
  doc.text(`Date : ${isBlank ? '___/___/______' : formatDate(session?.start_date)}`, 130, y)
  y += 6
  doc.text(`Client : ${isBlank ? '________________________' : (session?.clients?.name || '')}`, 20, y)
  y += 6
  doc.text(`Formateur : ${isBlank ? '________________________' : ''}`, 20, y)
  y += 10
  
  doc.setFont('helvetica', 'bold')
  doc.text('Évaluez chaque critère :', 20, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('1 = Insuffisant   2 = Passable   3 = Satisfaisant   4 = Bien   5 = Très Satisfaisant', 20, y)
  y += 10
  
  const criteres = ['Motivation du groupe', 'Niveau des stagiaires', 'Conditions matérielles', 'Organisation', 'Documentation fournie', 'Appréciation globale']
  
  const colW = 15
  const labelW = pw - 40 - colW * 5
  
  doc.setFillColor(240, 240, 240)
  doc.rect(20, y, labelW, 8, 'F')
  for (let i = 1; i <= 5; i++) doc.rect(20 + labelW + (i - 1) * colW, y, colW, 8, 'F')
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('Critère', 22, y + 5.5)
  for (let i = 1; i <= 5; i++) doc.text(String(i), 20 + labelW + (i - 1) * colW + colW / 2, y + 5.5, { align: 'center' })
  y += 8
  
  doc.setFont('helvetica', 'normal')
  criteres.forEach(c => {
    doc.rect(20, y, labelW, 8)
    for (let i = 1; i <= 5; i++) {
      doc.rect(20 + labelW + (i - 1) * colW, y, colW, 8)
      drawCircle(doc, 20 + labelW + (i - 1) * colW + colW / 2 - 1.5, y + 5.5, 1.5, false)
    }
    doc.text(c, 22, y + 5.5)
    y += 8
  })
  
  y += 8
  doc.setFont('helvetica', 'bold')
  doc.text('Commentaires :', 20, y)
  y += 5
  doc.rect(20, y, 170, 40)
  y += 48
  
  doc.setFont('helvetica', 'normal')
  doc.text(`Date : ${isBlank ? '___/___/______' : formatDate(new Date())}`, 20, y)
  doc.text('Signature :', 130, y)
  
  addFooter(doc, DOC_CODES.evaluationFormateur)
  return doc
}

// ============================================================
// TEST DE POSITIONNEMENT - AVEC CERCLES GRAPHIQUES
// ============================================================
function generatePositionnement(session, questions = [], isBlank = false, trainee = null, isCorrige = false) {
  const doc = new jsPDF({ compress: true })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const course = session?.courses || {}
  const ref = session?.reference || ''
  
  let y = addHeader(doc, isBlank ? '' : ref)
  
  // Titre avec mention CORRIGÉ si applicable
  if (isCorrige) {
    doc.setFillColor(255, 0, 0)
    doc.rect(0, y - 5, pw, 12, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('CORRIGÉ FORMATEUR - NE PAS IMPRIMER NI DIFFUSER', pw / 2, y + 2, { align: 'center' })
    doc.setTextColor(0, 0, 0)
    y += 12
  }
  
  y = addTitle(doc, 'TEST DE POSITIONNEMENT', y)
  
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(course.title || '', pw / 2, y, { align: 'center' })
  y += 10
  
  // Informations stagiaire
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  if (trainee && !isBlank) {
    doc.text(`Nom : ${trainee.last_name?.toUpperCase() || ''}`, 20, y)
    doc.text(`Prénom : ${trainee.first_name || ''}`, 110, y)
    y += 6
    doc.text(`Date : ${formatDate(session?.start_date || new Date())}`, 20, y)
    doc.text(`Entreprise : ${session?.clients?.name || ''}`, 110, y)
  } else {
    doc.text('Nom : ________________________________________', 20, y)
    doc.text('Prénom : ________________________________', 110, y)
    y += 6
    doc.text('Date : ___/___/______', 20, y)
    doc.text('Entreprise : ________________________________', 110, y)
  }
  y += 12
  
  // Consigne
  doc.setFontSize(8)
  doc.setFont('helvetica', 'italic')
  doc.text('Ce questionnaire permet d\'évaluer vos connaissances avant la formation. Cochez la réponse qui vous semble correcte.', 20, y)
  y += 10
  
  let pageNum = 1
  
  if (questions.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text('Aucune question configurée pour cette formation.', 20, y)
  } else {
    // Trier par position
    const sortedQuestions = [...questions].sort((a, b) => (a.position || 0) - (b.position || 0))
    
    sortedQuestions.forEach((q, idx) => {
      // Parser les options si nécessaire
      let options = q.options
      if (typeof options === 'string') {
        try { options = JSON.parse(options) } catch { options = [] }
      }
      options = options || []
      
      // Calculer la hauteur nécessaire pour cette question
      const qText = `${idx + 1}. ${q.question_text || q.question || ''}`
      const qLines = doc.splitTextToSize(qText, 170)
      const isQCM = q.question_type === 'single_choice' || q.question_type === 'qcm'
      const optionLines = isQCM ? options.length : 0
      const neededHeight = (qLines.length * 5) + (isQCM ? (optionLines * 7 + 5) : 25) + 10
      
      // Vérifier si on doit changer de page
      if (y + neededHeight > ph - 25) {
        addFooter(doc, DOC_CODES.positionnement, pageNum)
        doc.addPage()
        pageNum++
        y = 20
      }
      
      // Question
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      qLines.forEach(l => { doc.text(l, 20, y); y += 5 })
      y += 4
      
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      
      if (isQCM && options.length > 0) {
        // QCM avec cases à cocher
        options.forEach((opt, optIdx) => {
          const isCorrect = q.correct_index === optIdx
          
          // Dessiner la case à cocher (carré)
          doc.rect(25, y - 3, 4, 4)
          
          if (isCorrige && isCorrect) {
            // Version corrigé : cocher la bonne réponse
            doc.setFont('helvetica', 'bold')
            doc.line(25, y - 3, 29, y + 1) // Diagonale
            doc.line(25, y + 1, 29, y - 3) // Diagonale croisée (X)
          }
          
          // Texte de l'option
          const optText = isCorrige && isCorrect ? `${opt} ✓` : opt
          doc.text(optText, 32, y)
          
          if (isCorrige && isCorrect) {
            doc.setFont('helvetica', 'normal')
          }
          
          y += 7
        })
      } else {
        // Question ouverte - zone de réponse
        doc.setDrawColor(180, 180, 180)
        doc.rect(25, y, 165, 18)
        doc.setDrawColor(0, 0, 0)
        
        // Afficher les critères sur le corrigé
        if (isCorrige && q.scoring_rubric) {
          doc.setFontSize(8)
          doc.setFont('helvetica', 'italic')
          doc.setTextColor(100, 100, 100)
          const rubricLines = doc.splitTextToSize(`Attendu : ${q.scoring_rubric}`, 160)
          let ry = y + 3
          rubricLines.forEach(l => { doc.text(l, 27, ry); ry += 4 })
          doc.setTextColor(0, 0, 0)
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(9)
        }
        
        y += 22
      }
      
      y += 5
    })
  }
  
  addFooter(doc, DOC_CODES.positionnement, pageNum)
  
  // Gestion recto-verso : s'assurer que le PDF a un nombre pair de pages
  const totalPages = doc.internal.getNumberOfPages()
  if (totalPages % 2 !== 0) {
    doc.addPage()
    // Page intentionnellement vide pour impression recto-verso
    doc.setFontSize(8)
    doc.setTextColor(200, 200, 200)
    doc.text('(Page intentionnellement vide)', pw / 2, ph / 2, { align: 'center' })
    doc.setTextColor(0, 0, 0)
  }
  
  return doc
}

// ============================================================
// AUTRES DOCUMENTS (inchangés mais avec lieu Intra)
// ============================================================
function generateProgramme(session, trainer = null) {
  const doc = new jsPDF({ compress: true })
  const course = session?.courses || {}
  const ref = session?.reference || ''
  let y = addHeader(doc, ref)
  y = addTitle(doc, 'PROGRAMME DE FORMATION', y)
  
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text(course.title || '', 20, y)
  y += 10
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Durée : ${course.duration_hours || course.duration || '7'} heures`, 20, y); y += 6
  
  // Public - avec gestion texte long
  const publicProgText = `Public : ${course.target_audience || 'Tout public'}`
  const publicProgLines = doc.splitTextToSize(publicProgText, 170)
  publicProgLines.forEach((line, i) => { doc.text(line, 20, y + (i * 5)) })
  y += publicProgLines.length * 5 + 1
  
  // Prérequis - avec gestion texte long
  const prerequisProgText = `Prérequis : ${course.prerequisites || 'Aucun'}`
  const prerequisProgLines = doc.splitTextToSize(prerequisProgText, 170)
  prerequisProgLines.forEach((line, i) => { doc.text(line, 20, y + (i * 5)) })
  y += prerequisProgLines.length * 5 + 4
  
  doc.setFont('helvetica', 'bold')
  doc.text('Objectifs :', 20, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  const objLines = doc.splitTextToSize(course.objectives || '', 170)
  objLines.forEach(l => { doc.text(l, 25, y); y += 5 })
  y += 5
  
  doc.setFont('helvetica', 'bold')
  doc.text('Contenu :', 20, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  const contLines = doc.splitTextToSize(course.content || '', 170)
  contLines.forEach(l => { doc.text(l, 25, y); y += 5 })
  y += 5
  
  doc.setFont('helvetica', 'bold')
  doc.text('Méthodes pédagogiques :', 20, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.text(course.methods || 'Apports théoriques, exercices pratiques, mises en situation.', 25, y, { maxWidth: 165 })
  y += 10
  
  doc.setFont('helvetica', 'bold')
  doc.text('Évaluation :', 20, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.text('Évaluation formative continue. QCM et/ou mise en situation pratique.', 25, y)
  
  addFooter(doc, DOC_CODES.programme)
  return doc
}

function generateReglement() {
  const doc = new jsPDF({ compress: true })
  let y = addHeader(doc)
  y = addTitle(doc, 'RÈGLEMENT INTÉRIEUR', y)
  doc.setFontSize(9)
  const sections = [
    { title: 'Article 1 - Objet et champ d\'application', text: 'Le présent règlement est établi conformément aux articles L.6352-3 et L.6352-4 du Code du travail. Il s\'applique à tous les stagiaires participant aux formations dispensées par Access Formation.' },
    { title: 'Article 2 - Discipline', text: 'Les stagiaires doivent respecter les horaires, les consignes de sécurité et les règles de fonctionnement de l\'établissement.' },
    { title: 'Article 3 - Sanctions', text: 'Tout manquement aux règles pourra faire l\'objet d\'une sanction pouvant aller jusqu\'à l\'exclusion.' },
    { title: 'Article 4 - Représentation des stagiaires', text: 'Pour les formations de plus de 500 heures, un délégué des stagiaires sera élu.' },
    { title: 'Article 5 - Hygiène et sécurité', text: 'Les stagiaires doivent respecter les consignes d\'hygiène et de sécurité, notamment l\'interdiction de fumer.' },
  ]
  sections.forEach(s => {
    doc.setFont('helvetica', 'bold')
    doc.text(s.title, 20, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(s.text, 170)
    lines.forEach(l => { doc.text(l, 20, y); y += 4 })
    y += 5
  })
  addFooter(doc, DOC_CODES.reglement)
  return doc
}

function generateLivret(session = null) {
  const doc = new jsPDF({ compress: true })
  let y = addHeader(doc, session?.reference)
  y = addTitle(doc, "LIVRET D'ACCUEIL DU STAGIAIRE", y)
  doc.setFontSize(10)
  doc.text('Bienvenue chez Access Formation !', 20, y)
  y += 10
  const sections = [
    { title: 'Qui sommes-nous ?', text: `${ORG.nameFull} est un organisme de formation spécialisé dans la sécurité au travail.` },
    { title: 'Vos interlocuteurs', text: `Responsable : ${ORG.dirigeant}\nContact : ${ORG.phone} - ${ORG.email}` },
    { title: 'Déroulement de la formation', text: 'Horaires habituels : 9h00-12h30 / 13h30-17h00\nPauses : 10h30 et 15h30' },
    { title: 'Règles de vie', text: '- Ponctualité\n- Téléphones en silencieux\n- Respect des autres participants' },
    { title: 'En cas de problème', text: `Contactez-nous : ${ORG.phone}` },
  ]
  sections.forEach(s => {
    doc.setFont('helvetica', 'bold')
    doc.text(s.title, 20, y)
    y += 6
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(s.text, 170)
    lines.forEach(l => { doc.text(l, 25, y); y += 5 })
    y += 5
  })
  addFooter(doc, DOC_CODES.livret)
  return doc
}

function generateAnalyseBesoin(session = null, isBlank = false) {
  const doc = new jsPDF({ compress: true })
  const pw = doc.internal.pageSize.getWidth()
  
  let y = addHeader(doc, isBlank ? '' : session?.reference)
  
  // Rectangle N° Session pour documents vierges
  if (isBlank) {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.text('N° Session : __________', pw - 55, 10)
  }
  
  y = addTitle(doc, 'ANALYSE DU BESOIN DE FORMATION', y)
  
  // Plus d'espace après le titre pour documents vierges
  if (isBlank) {
    y += 3
  }
  
  doc.setFontSize(9)
  doc.text(`Entreprise : ${isBlank ? '________________________' : (session?.clients?.name || '')}`, 20, y)
  doc.text(`Date : ${isBlank ? '___/___/______' : formatDate(new Date())}`, 130, y)
  y += 10
  const sections = ['1. CONTEXTE ET ENJEUX', '2. OBJECTIFS ATTENDUS', '3. PUBLIC CONCERNÉ', '4. CONTRAINTES ET MOYENS']
  sections.forEach(s => {
    doc.setFont('helvetica', 'bold')
    doc.text(s, 20, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.rect(20, y, 170, 22)
    y += 28
  })
  doc.text('Signature entreprise :', 20, y)
  doc.rect(20, y + 3, 60, 18)
  doc.text('Signature Access Formation :', 110, y)
  doc.rect(110, y + 3, 60, 18)
  addFooter(doc, DOC_CODES.analyseBesoin)
  return doc
}

// ============================================================
// FICHE DE RENSEIGNEMENTS STAGIAIRE
// ============================================================
function generateFicheRenseignements(session, trainee = null, isBlank = false, infoSheet = null) {
  const doc = new jsPDF({ compress: true })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const course = session?.courses || {}
  const ref = session?.reference || 'VIERGE'
  
  let y = 15
  
  // En-tête
  addHeader(doc)
  
  // Rectangle N° Session pour documents vierges
  if (isBlank) {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.text('N° Session : __________', pw - 55, 10)
  }
  
  y = 42
  
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('FICHE DE RENSEIGNEMENTS STAGIAIRE', pw / 2, y, { align: 'center' })
  y += 6
  
  // Sous-titre formation
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  if (isBlank) {
    doc.text('Formation : _________________________________________________', pw / 2, y, { align: 'center' })
  } else {
    doc.text(`Formation : ${course.title || ''}`, pw / 2, y, { align: 'center' })
  }
  y += 8
  
  // Section 1 : Informations personnelles
  doc.setFillColor(240, 240, 240)
  doc.rect(15, y, pw - 30, 6, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('INFORMATIONS PERSONNELLES', 17, y + 4)
  y += 12 // Espace augmenté (était 9)
  
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  
  const lineHeight = 8
  const firstLinesHeight = 10 // Plus d'espace pour les 2 premières lignes
  const labelWidth = 45
  const fieldStart = 65
  const fieldWidth = pw - fieldStart - 20
  
  // Nom / Prénom sur même ligne
  doc.text('Nom :', 17, y)
  doc.line(fieldStart - 25, y, fieldStart + 30, y)
  doc.text('Prénom :', fieldStart + 40, y)
  doc.line(fieldStart + 60, y, pw - 17, y)
  if (!isBlank && (trainee || infoSheet)) {
    const lastName = String(infoSheet?.last_name || trainee?.last_name || '')
    const firstName = String(infoSheet?.first_name || trainee?.first_name || '')
    doc.text(lastName.toUpperCase(), fieldStart - 23, y - 1)
    doc.text(firstName, fieldStart + 62, y - 1)
  }
  y += firstLinesHeight // Espace agrandi
  
  // Genre / CSP* sur même ligne
  doc.text('Genre :', 17, y)
  doc.line(fieldStart - 25, y, fieldStart + 30, y)
  doc.text('CSP* :', fieldStart + 40, y) // Astérisque ajouté
  doc.line(fieldStart + 60, y, pw - 17, y)
  if (!isBlank && (trainee || infoSheet)) {
    const gender = String(infoSheet?.gender || trainee?.gender || '')
    const csp = String(infoSheet?.csp || trainee?.csp || '')
    const genderMap = { 'male': 'Homme', 'female': 'Femme', 'non_binary': 'Non-binaire' }
    doc.text(genderMap[gender] || '', fieldStart - 23, y - 1)
    doc.text(csp, fieldStart + 62, y - 1)
  }
  y += firstLinesHeight // Espace agrandi
  
  // Date de naissance / Téléphone sur même ligne (espace normal)
  doc.text('Date naissance :', 17, y)
  if (!isBlank && trainee?.birth_date) {
    const birthDate = new Date(trainee.birth_date)
    doc.text(format(birthDate, 'dd/MM/yyyy'), fieldStart - 15, y)
  } else {
    doc.text('__ / __ / ____', fieldStart - 15, y)
  }
  doc.text('Téléphone :', fieldStart + 40, y)
  doc.line(fieldStart + 60, y, pw - 17, y)
  if (!isBlank && (infoSheet?.phone || trainee?.phone)) {
    doc.text(String(infoSheet?.phone || trainee?.phone || ''), fieldStart + 62, y - 1)
  }
  y += lineHeight
  
  // Email
  doc.text('Email :', 17, y)
  doc.line(fieldStart - 25, y, pw - 17, y)
  if (!isBlank && (infoSheet?.email || trainee?.email)) {
    doc.text(String(infoSheet?.email || trainee?.email || ''), fieldStart - 23, y - 1)
  }
  y += lineHeight
  
  // N° Sécurité sociale — jamais imprimé (INRS) : seule la mention figure ici.
  // Le numéro reste dans Campus, pour le Passeport Prévention.
  doc.text('N° Sécu. Sociale :', 17, y)
  doc.setFontSize(8)
  if (isBlank) {
    drawCheckbox(doc, fieldStart - 15, y - 3, 3.5, false)
    doc.text('Communiqué via le portail stagiaire', fieldStart - 10, y)
    drawCheckbox(doc, fieldStart + 50, y - 3, 3.5, false)
    doc.text('Je refuse de le communiquer', fieldStart + 55, y)
  } else if (trainee?.refused_ssn || infoSheet?.ssn_refused) {
    doc.text('Refus du stagiaire', fieldStart - 15, y)
  } else if (trainee?.social_security_number || infoSheet?.ssn) {
    doc.text('Renseigné par le stagiaire', fieldStart - 15, y)
  } else {
    doc.text('Non renseigné', fieldStart - 15, y)
  }

  doc.setFontSize(8)
  y += lineHeight + 3
  
  // Section 2 : Informations professionnelles
  doc.setFillColor(240, 240, 240)
  doc.rect(15, y, pw - 30, 6, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('INFORMATIONS PROFESSIONNELLES', 17, y + 4)
  y += 12 // Espace augmenté (était 9)
  
  doc.setFont('helvetica', 'normal')
  
  // Poste exercé / Depuis quand
  doc.text('Poste exercé :', 17, y)
  doc.line(fieldStart - 15, y, fieldStart + 50, y)
  if (!isBlank && infoSheet?.job_title) {
    doc.text(String(infoSheet.job_title || ''), fieldStart - 13, y - 1)
  }
  doc.text('Depuis :', fieldStart + 55, y)
  doc.line(fieldStart + 70, y, pw - 17, y)
  if (!isBlank && infoSheet?.job_since) {
    doc.text(String(infoSheet.job_since || ''), fieldStart + 72, y - 1)
  }
  y += lineHeight
  
  // Adresse entreprise
  doc.text('Adresse entreprise :', 17, y)
  const clientAddress = session?.clients?.address || session?.clients?.name
  if (!isBlank && clientAddress) {
    // Afficher l'adresse du client (entreprise où travaille le stagiaire)
    const addressLines = doc.splitTextToSize(String(clientAddress || ''), pw - fieldStart - 4)
    doc.text(addressLines, fieldStart - 13, y + 1)
    y += Math.max(14, addressLines.length * 4 + 6) // Adapter hauteur au nombre de lignes
  } else {
    // Sinon dessiner le rectangle vide
    doc.rect(fieldStart - 15, y - 3, pw - fieldStart, 12)
    y += 14
  }
  
  // Dernière formation / Diplôme
  doc.text('Dernière formation (année) :', 17, y)
  doc.line(fieldStart + 15, y, fieldStart + 40, y)
  if (!isBlank && infoSheet?.last_training_year) {
    doc.text(String(infoSheet.last_training_year || ''), fieldStart + 17, y - 1)
  }
  doc.text('Plus haut diplôme :', fieldStart + 45, y)
  doc.line(fieldStart + 75, y, pw - 17, y)
  if (!isBlank && infoSheet?.highest_diploma) {
    doc.text(String(infoSheet.highest_diploma || ''), fieldStart + 77, y - 1)
  }
  y += lineHeight + 3
  
  // Niveau de connaissances
  doc.text('Niveau de connaissance dans le domaine :', 17, y)
  y += 5
  const niveaux = ['Aucune', 'Faible', 'Moyen', 'Bon', 'Expert']
  let xNiv = 25
  doc.setFontSize(7)
  niveaux.forEach((niv, idx) => {
    // knowledge_level est stocké comme 1-5 dans la DB
    const isChecked = !isBlank && infoSheet?.knowledge_level === (idx + 1)
    doc.rect(xNiv, y - 1, 3, 3)
    if (isChecked) {
      doc.text('X', xNiv + 0.5, y + 1.5)
    }
    doc.text(niv, xNiv + 5, y + 1.5)
    xNiv += 32
  })
  doc.setFontSize(8)
  y += 10
  
  // Section 3 : Besoins et attentes
  doc.setFillColor(240, 240, 240)
  doc.rect(15, y, pw - 30, 6, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('VOS BESOINS ET ATTENTES', 17, y + 4)
  y += 12 // Espace augmenté (était 9)
  
  doc.setFont('helvetica', 'normal')
  doc.text('Quels sont vos besoins spécifiques et vos attentes concernant cette formation ?', 17, y)
  y += 4
  
  // Zone de texte libre - hauteur ajustée pour ne pas déborder
  const textBoxHeight = Math.min(35, ph - y - 45) // Laisser espace pour signature + footer
  doc.rect(17, y, pw - 34, textBoxHeight)
  
  if (!isBlank && infoSheet?.training_expectations && String(infoSheet.training_expectations).trim() !== '') {
    // Afficher le contenu si présent
    const expectationLines = doc.splitTextToSize(String(infoSheet.training_expectations || ''), pw - 38)
    doc.text(expectationLines, 19, y + 3)
  } else if (!isBlank) {
    // Afficher une barre diagonale fine si vide
    doc.setDrawColor(180, 180, 180) // Gris clair
    doc.setLineWidth(0.3) // Ligne fine
    // Tracer une diagonale du bas gauche au haut droit
    doc.line(17, y + textBoxHeight, 17 + pw - 34, y)
    // Réinitialiser
    doc.setDrawColor(0, 0, 0) // Noir
    doc.setLineWidth(0.2) // Épaisseur normale
  }
  
  y += textBoxHeight + 5
  
  // Consentement RGPD
  doc.setFontSize(6)
  doc.text('J\'accepte que mes données soient traitées par Access Formation dans le cadre de cette formation (RGPD).', 17, y)
  doc.rect(pw - 30, y - 2, 3, 3)
  const rgpdChecked = !isBlank && infoSheet?.rgpd_consent === true
  if (rgpdChecked) {
    doc.text('X', pw - 29.5, y)
  }
  doc.text('J\'accepte', pw - 25, y)
  y += 8
  
  // Date et signature
  doc.setFontSize(8)
  const signDate = session?.start_date ? new Date(session.start_date) : new Date()
  doc.text(`Date : ${isBlank ? '__ / __ / ____' : formatDate(signDate)}`, 17, y)
  doc.text('Signature :', pw / 2 + 20, y)
  
  // Rectangle pour la signature (vide - signature papier)
  doc.rect(pw / 2 + 40, y - 3, 45, 12)
  
  y += 15
  
  // Note explicative CSP (déplacée ici, au-dessus du footer)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(100, 100, 100)
  doc.text('* CSP : Catégorie Socio-Professionnelle', 17, y)
  doc.text('Exemples : Employé, Cadre, Ouvrier, Artisan, Demandeur d\'emploi, Étudiant', 17, y + 4)
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  
  addFooter(doc, 'AF-FICHE')
  return doc
}

// ============================================================
// EXPORT
// ============================================================
export async function downloadDocument(docType, session, options = {}) {
  const { trainees = [], trainee = null, trainer = null, isBlank = false, questions = [], costs = [], attendanceData = null } = options
  const ref = session?.reference || 'VIERGE'
  let doc, filename
  
  switch (docType) {
    case 'convention': doc = generateConvention(session, trainees, trainer, costs); filename = `Convention_${ref}.pdf`; break
    case 'certificat': doc = generateCertificat(session, trainee, trainer); filename = `Certificat_${ref}_${trainee?.last_name || ''}.pdf`; break
    case 'emargement': doc = generateEmargement(session, trainees, trainer, isBlank, attendanceData); filename = isBlank ? 'Emargement_Vierge.pdf' : `Emargement_${ref}.pdf`; break
    case 'convocation': {
      doc = new jsPDF({ compress: true })
      let qrCodeDataURL = null
      if (session?.attendance_token) {
        try {
          const portalURL = `https://app.accessformation.pro/#/portail/${session.attendance_token}`
          qrCodeDataURL = await QRCode.toDataURL(portalURL, { width: 150, margin: 1 })
        } catch (err) { console.error('Erreur QR convocation individuelle:', err) }
      }
      generateConvocationContent(doc, session, trainee, trainer, qrCodeDataURL)
      filename = `Convocation_${ref}_${trainee?.last_name || ''}_${trainee?.first_name || ''}.pdf`
      break
    }
    case 'attestation': doc = generateAttestation(session, trainee, trainer); filename = `Attestation_${ref}_${trainee?.last_name || ''}.pdf`; break
    case 'programme': doc = generateProgramme(session, trainer); filename = `Programme_${ref}.pdf`; break
    case 'evaluation': doc = generateEvaluation(session, trainee, isBlank); filename = isBlank ? 'Evaluation_Vierge.pdf' : `Evaluation_${ref}.pdf`; break
    case 'evaluationFroid': doc = generateEvaluationFroid(session, trainee, isBlank); filename = isBlank ? 'EvaluationFroid_Vierge.pdf' : `EvaluationFroid_${ref}.pdf`; break
    case 'reglement': doc = generateReglement(); filename = 'Reglement_Interieur.pdf'; break
    case 'livret': doc = generateLivret(session); filename = `Livret_Accueil_${ref}.pdf`; break
    case 'analyseBesoin': doc = generateAnalyseBesoin(session, isBlank); filename = isBlank ? 'Analyse_Besoin_Vierge.pdf' : `Analyse_Besoin_${ref}.pdf`; break
    case 'evaluationFormateur': doc = generateEvaluationFormateur(session, isBlank); filename = isBlank ? 'Evaluation_Formateur_Vierge.pdf' : `Evaluation_Formateur_${ref}.pdf`; break
    case 'positionnement': doc = generatePositionnement(session, questions, isBlank, trainee, false); filename = isBlank ? 'Test_Positionnement_Vierge.pdf' : `Test_Positionnement_${ref}_${trainee?.last_name || ''}.pdf`; break
    case 'positionnementCorrige': doc = generatePositionnement(session, questions, false, null, true); filename = `CORRIGE_Test_Positionnement_${ref}.pdf`; break
    case 'testPositionnementRempli': doc = generateTestPositionnementRempli(session, trainee, options.testData); filename = `Test_Positionnement_${ref}_${trainee?.last_name || ''}.pdf`; break
    case 'ficheRenseignements': doc = generateFicheRenseignements(session, trainee, isBlank, options.infoSheet || null); filename = isBlank ? 'Fiche_Renseignements_Vierge.pdf' : `Fiche_Renseignements_${ref}_${trainee?.last_name || ''}.pdf`; break
    default: console.error('Type inconnu:', docType); return
  }
  if (doc) doc.save(filename)
}

// Fonction pour générer un PDF multi-pages avec tous les stagiaires (recto-verso compatible)
export async function downloadAllDocuments(docType, session, trainees, options = {}) {
  if (!trainees || trainees.length === 0) return
  
  const ref = session?.reference || 'VIERGE'
  const { trainer = null, questions = [], evaluationsData = {} } = options
  
  // Générer le QR code de la session UNE SEULE FOIS (pour convocations)
  let qrCodeDataURL = null
  if (docType === 'convocation' && session?.attendance_token) {
    const portalURL = `https://app.accessformation.pro/#/portail/${session.attendance_token}`
    try {
      qrCodeDataURL = await QRCode.toDataURL(portalURL, {
        width: 150,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      })
    } catch (err) {
      console.error('Erreur génération QR code convocation:', err)
    }
  }
  
  // Créer un seul PDF pour tous les stagiaires
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true })
  const ph = doc.internal.pageSize.getHeight()
  const pw = doc.internal.pageSize.getWidth()
  
  trainees.forEach((trainee, idx) => {
    // Pour le positionnement, on génère des PDFs séparés puis on les merge
    // Pour assurer le recto-verso, chaque stagiaire doit commencer sur une page impaire
    if (idx > 0) {
      // Vérifier si on est sur une page paire (pour le recto-verso)
      const currentPage = doc.internal.getNumberOfPages()
      if (docType === 'positionnement' && currentPage % 2 !== 0) {
        // Ajouter une page vide pour que le prochain stagiaire commence sur une page impaire
        doc.addPage()
        doc.setFontSize(8)
        doc.setTextColor(200, 200, 200)
        doc.text('(Page intentionnellement vide)', pw / 2, ph / 2, { align: 'center' })
        doc.setTextColor(0, 0, 0)
      }
      doc.addPage()
    }
    
    // Générer le contenu selon le type de document
    switch (docType) {
      case 'certificat': generateCertificatContent(doc, session, trainee, trainer); break
      case 'convocation': generateConvocationContent(doc, session, trainee, trainer, qrCodeDataURL); break
      case 'attestation': generateAttestationContent(doc, session, trainee, trainer); break
      case 'evaluation': generateEvaluationContent(doc, session, trainee, evaluationsData[trainee.id] || null); break
      case 'evaluationFroid': generateEvaluationFroidContent(doc, session, trainee); break
      case 'positionnement': generatePositionnementContent(doc, session, questions, trainee); break
      default: return
    }
  })
  
  // Pour le positionnement, s'assurer que le PDF total a un nombre pair de pages
  if (docType === 'positionnement') {
    const totalPages = doc.internal.getNumberOfPages()
    if (totalPages % 2 !== 0) {
      doc.addPage()
      doc.setFontSize(8)
      doc.setTextColor(200, 200, 200)
      doc.text('(Page intentionnellement vide)', pw / 2, ph / 2, { align: 'center' })
      doc.setTextColor(0, 0, 0)
    }
  }
  
  // Nom du fichier selon le type
  const docNames = {
    certificat: 'Certificats',
    convocation: 'Convocations', 
    attestation: 'Attestations',
    evaluation: 'Evaluations',
    evaluationFroid: 'Evaluations_Froid',
    positionnement: 'Tests_Positionnement'
  }
  
  doc.save(`${docNames[docType] || 'Documents'}_${ref}_Tous.pdf`)
}

// Même chose que downloadDocument mais retourne { base64, filename } au lieu de télécharger
export async function generatePDF(docType, session, options = {}) {
  const { trainees = [], trainee = null, trainer = null, isBlank = false, questions = [], costs = [], attendanceData = null } = options
  const ref = session?.reference || 'VIERGE'
  let doc, filename
  
  switch (docType) {
    case 'convention': doc = generateConvention(session, trainees, trainer, costs); filename = `Convention_${ref}.pdf`; break
    case 'certificat': doc = generateCertificat(session, trainee, trainer); filename = `Certificat_${ref}_${trainee?.last_name || ''}.pdf`; break
    case 'emargement': doc = generateEmargement(session, trainees, trainer, isBlank, attendanceData); filename = isBlank ? 'Emargement_Vierge.pdf' : `Emargement_${ref}.pdf`; break
    case 'convocation': {
      doc = new jsPDF({ compress: true })
      let qrCodeDataURL = null
      if (session?.attendance_token) {
        try {
          const portalURL = `https://app.accessformation.pro/#/portail/${session.attendance_token}`
          qrCodeDataURL = await QRCode.toDataURL(portalURL, { width: 150, margin: 1 })
        } catch (err) { console.error('Erreur QR convocation individuelle:', err) }
      }
      generateConvocationContent(doc, session, trainee, trainer, qrCodeDataURL)
      filename = `Convocation_${ref}_${trainee?.last_name || ''}_${trainee?.first_name || ''}.pdf`
      break
    }
    case 'attestation': doc = generateAttestation(session, trainee, trainer); filename = `Attestation_${ref}_${trainee?.last_name || ''}.pdf`; break
    case 'programme': doc = generateProgramme(session, trainer); filename = `Programme_${ref}.pdf`; break
    case 'evaluation': doc = generateEvaluation(session, trainee, isBlank); filename = isBlank ? 'Evaluation_Vierge.pdf' : `Evaluation_${ref}.pdf`; break
    case 'evaluationFroid': doc = generateEvaluationFroid(session, trainee, isBlank); filename = isBlank ? 'EvaluationFroid_Vierge.pdf' : `EvaluationFroid_${ref}.pdf`; break
    case 'evaluationFormateur': doc = generateEvaluationFormateur(session, isBlank); filename = isBlank ? 'Evaluation_Formateur_Vierge.pdf' : `Evaluation_Formateur_${ref}.pdf`; break
    case 'ficheRenseignements': doc = generateFicheRenseignements(session, trainee, isBlank, options.infoSheet || null); filename = isBlank ? 'Fiche_Renseignements_Vierge.pdf' : `Fiche_Renseignements_${ref}_${trainee?.last_name || ''}.pdf`; break
    case 'analyseBesoin': doc = generateAnalyseBesoin(session, isBlank); filename = isBlank ? 'Analyse_Besoin_Vierge.pdf' : `Analyse_Besoin_${ref}.pdf`; break
    case 'positionnement': doc = generatePositionnement(session, questions, isBlank, trainee, false); filename = isBlank ? 'Test_Positionnement_Vierge.pdf' : `Test_Positionnement_${ref}_${trainee?.last_name || ''}.pdf`; break
    case 'testPositionnementRempli': doc = generateTestPositionnementRempli(session, trainee, options.testData); filename = `Test_Positionnement_${ref}_${trainee?.last_name || ''}.pdf`; break
    default: console.error('Type inconnu:', docType); return null
  }
  if (!doc) return null
  const base64 = doc.output('datauristring').split(',')[1]
  return { base64, filename, size: base64.length }
}

// Même chose que downloadAllDocuments mais retourne { base64, filename } au lieu de télécharger
export async function generateAllPDF(docType, session, trainees, options = {}) {
  if (!trainees || trainees.length === 0) return null
  
  const ref = session?.reference || 'VIERGE'
  const { trainer = null, questions = [], evaluationsData = {} } = options
  
  let qrCodeDataURL = null
  if (docType === 'convocation' && session?.attendance_token) {
    const portalURL = `https://app.accessformation.pro/#/portail/${session.attendance_token}`
    try {
      qrCodeDataURL = await QRCode.toDataURL(portalURL, {
        width: 150,
        margin: 1,
        color: { dark: '#000000', light: '#FFFFFF' }
      })
    } catch (err) {
      console.error('Erreur génération QR code:', err)
    }
  }
  
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true })
  const ph = doc.internal.pageSize.getHeight()
  const pw = doc.internal.pageSize.getWidth()
  
  trainees.forEach((trainee, idx) => {
    if (idx > 0) {
      const currentPage = doc.internal.getNumberOfPages()
      if (docType === 'positionnement' && currentPage % 2 !== 0) {
        doc.addPage()
        doc.setFontSize(8)
        doc.setTextColor(200, 200, 200)
        doc.text('(Page intentionnellement vide)', pw / 2, ph / 2, { align: 'center' })
        doc.setTextColor(0, 0, 0)
      }
      doc.addPage()
    }
    
    switch (docType) {
      case 'certificat': generateCertificatContent(doc, session, trainee, trainer); break
      case 'convocation': generateConvocationContent(doc, session, trainee, trainer, qrCodeDataURL); break
      case 'attestation': generateAttestationContent(doc, session, trainee, trainer); break
      case 'evaluation': generateEvaluationContent(doc, session, trainee, evaluationsData[trainee.id] || null); break
      case 'evaluationFroid': generateEvaluationFroidContent(doc, session, trainee); break
      default: return
    }
  })
  
  const docNames = {
    certificat: 'Certificats',
    convocation: 'Convocations', 
    attestation: 'Attestations',
    evaluation: 'Evaluations',
    evaluationFroid: 'Evaluations_Froid',
  }
  
  const filename = `${docNames[docType] || 'Documents'}_${ref}_Tous.pdf`
  const base64 = doc.output('datauristring').split(',')[1]
  return { base64, filename, size: base64.length }
}

// ============================================================
// CONTENT GENERATORS FOR MULTI-PAGE PDFs
// ============================================================

function generateCertificatContent(doc, session, trainee, trainer) {
  const course = session?.courses || {}
  const client = session?.clients || {}
  const pw = doc.internal.pageSize.getWidth()
  const ref = session?.reference || ''
  
  let y = addHeader(doc, ref)
  y = addTitle(doc, 'CERTIFICAT DE RÉALISATION', y)
  
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  const introLines2 = doc.splitTextToSize(`Je soussigné, ${ORG.dirigeant}, représentant légal du dispensateur de l'action concourant au développement des compétences ${ORG.name}, ${ORG.address}`, 170)
  doc.text(introLines2, 20, y)
  y += introLines2.length * 5 + 4
  
  doc.setFont('helvetica', 'bold')
  doc.text('Atteste que :', 20, y)
  y += 8
  
  doc.setFontSize(12)
  doc.text(`${trainee?.first_name || ''} ${trainee?.last_name?.toUpperCase() || ''}`, pw / 2, y, { align: 'center' })
  y += 8
  
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  if (client?.name) {
    const salarie = trainee?.gender === 'female' ? 'Salariée' : 'Salarié'
    const salarieText = trainee?.gender === 'non_binary' ? `Salarié·e de l'entreprise : ${client.name}` : `${salarie} de l'entreprise : ${client.name}`
    doc.text(salarieText, 20, y)
    y += 10
  }
  
  doc.setFont('helvetica', 'bold')
  doc.text("A suivi l'action :", 20, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.text(`${course.title || ''}`, pw / 2, y, { align: 'center' })
  y += 12
  
  doc.setFont('helvetica', 'bold')
  doc.text("Nature de l'action concourant au développement des compétences :", 20, y)
  y += 8
  
  doc.setFont('helvetica', 'normal')
  drawCheckbox(doc, 25, y, 3, true)
  doc.text('  Action de formation', 30, y)
  y += 6
  doc.setTextColor(150, 150, 150)
  drawCheckbox(doc, 25, y, 3, false)
  doc.text('  Bilan de compétences', 30, y)
  y += 6
  drawCheckbox(doc, 25, y, 3, false)
  doc.text('  Action de VAE', 30, y)
  y += 6
  drawCheckbox(doc, 25, y, 3, false)
  doc.text('  Action de formation par apprentissage', 30, y)
  y += 10
  doc.setTextColor(0, 0, 0)
  
  doc.text(`Qui s'est déroulée du ${formatDate(session?.start_date)} au ${formatDate(session?.end_date)}`, 20, y)
  y += 6
  doc.text(`Pour une durée de ${course.duration_hours || course.duration || '7'} heures.`, 20, y)
  y += 12
  
  doc.setFontSize(8)
  doc.text("Sans préjudice des délais imposés par les règles fiscales, comptables ou commerciales, je m'engage à conserver l'ensemble des pièces justificatives pendant une durée de 3 ans à compter de la fin de l'année du dernier paiement.", 20, y, { maxWidth: 170 })
  y += 14
  
  // Résultat basé sur trainee.result si disponible
  const isAcquis = trainee?.result === 'acquired'
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Résultat obtenu :', 20, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  drawCheckbox(doc, 25, y, 3, isAcquis)
  doc.text('  Acquis', 30, y)
  drawCheckbox(doc, 70, y, 3, !isAcquis && trainee?.result === 'not_acquired')
  doc.text('  Non acquis', 75, y)
  y += 12
  
  doc.text(`Fait à : Concarneau`, 20, y); y += 6
  doc.text(`Le : ${formatDate(session?.end_date || new Date())}`, 20, y); y += 10
  
  doc.text('Cachet et signature du responsable du dispensateur de formation :', 20, y); y += 5
  try { doc.addImage(ORG.stamp_base64, 'JPEG', 20, y, 50, 18) } catch {}
  const sigLines2 = doc.splitTextToSize(`${ORG.dirigeant}, Dirigeant ${ORG.name}`, pw - 75 - 15)
  doc.text(sigLines2, 75, y + 8)
  
  addFooter(doc, DOC_CODES.certificat)
}

function generateConvocationContent(doc, session, trainee, trainer, qrCodeDataURL = null) {
  const pw = doc.internal.pageSize.getWidth()
  const course = session?.courses || {}
  const client = session?.clients || {}
  const ref = session?.reference || ''
  const lieu = getLocation(session)
  
  let y = addHeader(doc, ref)
  y = addTitle(doc, 'CONVOCATION À LA FORMATION', y)
  
  // Civilité selon le genre
  const civilite = trainee?.gender === 'female' ? 'Madame' : (trainee?.gender === 'non_binary' ? '' : 'Monsieur')
  const fullName = civilite ? `${civilite} ${trainee?.first_name || ''} ${trainee?.last_name?.toUpperCase() || ''}` : `${trainee?.first_name || ''} ${trainee?.last_name?.toUpperCase() || ''}`
  
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text(fullName, pw / 2, y, { align: 'center' })
  y += 10
  
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('Merci de vous présenter à la session de formation selon les informations suivantes :', 20, y)
  y += 10
  
  doc.setFont('helvetica', 'bold')
  doc.text(`Intitulé de la formation : ${course.title || ''}`, 20, y); y += 6
  doc.setFont('helvetica', 'normal')
  if (course.objectives) {
    const objLines = doc.splitTextToSize(`Objectif(s) : ${course.objectives}`, 170)
    objLines.forEach(l => { doc.text(l, 20, y); y += 5 })
  }
  y += 3
  
  doc.setFont('helvetica', 'bold')
  doc.text(`Date(s) de formation : ${formatDate(session?.start_date)} au ${formatDate(session?.end_date)}`, 20, y); y += 6
  doc.text(`Horaires : ${session?.start_time || ''} - ${session?.end_time || ''}`, 20, y); y += 6
  doc.setFont('helvetica', 'normal')
  doc.text(`Durée totale : ${course.duration_hours || course.duration || '7'} heures`, 20, y); y += 8
  
  doc.setFont('helvetica', 'bold')
  doc.text(`Lieu de formation : ${lieu}`, 20, y); y += 6
  doc.setFont('helvetica', 'normal')
  doc.text(`Formateur : ${trainer ? `${trainer.first_name} ${trainer.last_name}` : ORG.dirigeant}`, 20, y); y += 10
  
  // Documents requis
  doc.setFont('helvetica', 'bold')
  doc.text('Nous vous demandons de venir avec :', 20, y); y += 6
  doc.setFont('helvetica', 'normal')
  doc.text('• Votre pièce d\'identité', 25, y); y += 5
  doc.text('• Votre numéro de sécurité sociale', 25, y); y += 8
  
  if (course.material) {
    doc.text(`Merci de vous munir d'une tenue adaptée et du matériel indiqué par le formateur, le cas échéant : ${course.material}`, 20, y, { maxWidth: 170 }); y += 10
  } else {
    doc.text("Merci de vous munir d'une tenue adaptée et du matériel indiqué par le formateur, le cas échéant.", 20, y, { maxWidth: 170 }); y += 8
  }
  
  doc.text(`Accessibilité : en cas de besoins spécifiques (mobilité, auditif, visuel...), merci de nous en informer à ${ORG.email} au moins 72 heures avant la formation.`, 20, y, { maxWidth: 170 }); y += 12
  
  // Mention portail stagiaire avec QR Code
  doc.setFont('helvetica', 'bold')
  doc.text('Portail stagiaire :', 20, y); y += 5
  doc.setFont('helvetica', 'normal')
  doc.text('Scannez le QR Code ci-dessous pour acceder au portail stagiaire et completer votre fiche de renseignement et test de positionnement AVANT le jour de la formation.', 20, y, { maxWidth: 170 }); y += 10
  
  doc.text(`Contact Access Formation : Pour toute question, contactez-nous au ${ORG.phone} ou par mail à ${ORG.email}`, 20, y, { maxWidth: 170 }); y += 8
  
  const convContact2 = getSessionContact(session)
  if (convContact2.name) {
    doc.text(`Contact de votre entreprise : ${convContact2.name}${convContact2.role ? ' - ' + convContact2.role : ''}`, 20, y, { maxWidth: 170 }); y += 10
  } else if (client.contact_name) {
    doc.text(`Contact de votre entreprise : ${client.contact_name}${client.contact_function ? ' - ' + client.contact_function : ''}`, 20, y, { maxWidth: 170 }); y += 10
  }
  
  doc.text('Nous vous remercions pour votre ponctualite et votre participation active.', 20, y); y += 15
  
  // Signature à gauche
  doc.setFont('helvetica', 'normal')
  doc.text(`Fait a ${ORG.city}, le ${new Date().toLocaleDateString('fr-FR')}`, 20, y); y += 5
  doc.text(`${ORG.dirigeant}`, 20, y + 5)
  doc.text(`Dirigeant ${ORG.name}`, 20, y + 10)
  
  // QR Code à droite (remplace logo + tampon)
  if (qrCodeDataURL) {
    const qrSize = 30 // 30x30mm
    const qrX = pw - 20 - qrSize // Aligné à droite avec marge 20
    
    try {
      doc.addImage(qrCodeDataURL, 'PNG', qrX, y, qrSize, qrSize)
    } catch (err) {
      console.error('Erreur ajout QR code convocation au PDF:', err)
    }
    
    // Texte sous le QR
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.text('Scannez pour acceder', qrX + qrSize/2, y + qrSize + 3, { align: 'center' })
    doc.text('au portail stagiaire', qrX + qrSize/2, y + qrSize + 6, { align: 'center' })
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    if (trainee?.access_code) {
      doc.text(`Code : ${trainee.access_code}`, qrX + qrSize/2, y + qrSize + 11, { align: 'center' })
    }
  }
  
  addFooter(doc, DOC_CODES.convocation)
}

function generateAttestationContent(doc, session, trainee, trainer) {
  const course = session?.courses || {}
  const client = session?.clients || {}
  const pw = doc.internal.pageSize.getWidth()
  const ref = session?.reference || ''
  const lieu = getLocation(session)
  
  let y = addHeader(doc, ref)
  y = addTitle(doc, 'ATTESTATION DE PRÉSENCE', y)
  
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Je soussigné, ${ORG.dirigeant}, représentant l'organisme de formation ${ORG.name}, atteste que :`, 20, y, { maxWidth: 170 })
  y += 12
  
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(`${trainee?.first_name || ''} ${trainee?.last_name?.toUpperCase() || ''}`, pw / 2, y, { align: 'center' })
  y += 8
  
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Entreprise : ${client.name || ''}`, 20, y); y += 8
  doc.text(`A participé à la formation intitulée : ${course.title || ''}`, 20, y); y += 8
  doc.text(`Dates : du ${formatDate(session?.start_date)} au ${formatDate(session?.end_date)}`, 20, y); y += 8
  doc.text(`Durée totale : ${course.duration_hours || course.duration || '7'} heures`, 20, y); y += 8
  doc.text(`Lieu : ${lieu}`, 20, y); y += 8
  doc.text(`Cette formation a été animée par : ${trainer ? `${trainer.first_name} ${trainer.last_name}` : ORG.dirigeant}`, 20, y); y += 8
  doc.text(`Horaires suivis : ${session?.start_time || ''} - ${session?.end_time || ''}`, 20, y); y += 8
  doc.text(`Nombre total d'heures de présence : ${course.duration_hours || course.duration || '7'}`, 20, y); y += 12
  
  doc.text('Fait pour servir et valoir ce que de droit.', 20, y); y += 10
  doc.text(`Fait à ${ORG.city}, le ${formatDate(session?.end_date || new Date())}`, 20, y); y += 10
  
  doc.text(`Pour ${ORG.name}`, 20, y); y += 5
  try { doc.addImage(ORG.stamp_base64, 'PNG', 155, y - 5, 30, 30) } catch {}
  doc.text(ORG.dirigeant, 20, y + 10)
  
  addFooter(doc, DOC_CODES.attestation)
}

function generateEvaluationContent(doc, session, trainee, evalData = null) {
  const pw = doc.internal.pageSize.getWidth()
  const ref = session?.reference || ''
  const course = session?.courses || {}
  
  let y = addHeader(doc, ref)
  y = addTitle(doc, 'ÉVALUATION À CHAUD', y)
  
  doc.setFontSize(9)
  doc.text(`Formation : ${course?.title || ''}`, 20, y)
  doc.text(`Date : ${formatDate(session?.start_date)}`, 130, y)
  y += 6
  if (trainee) {
    doc.text(`Stagiaire : ${trainee.first_name || ''} ${trainee.last_name?.toUpperCase() || ''}`, 20, y)
  }
  y += 8
  
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('Échelle de notation :', 20, y)
  y += 4
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('1 = Mauvais   2 = Passable   3 = Moyen   4 = Satisfaisant   5 = Très Satisfaisant   N/C = Non concerné', 20, y)
  y += 6
  
  const colW = 10
  const ncW = 12
  const labelW = pw - 40 - colW * 5 - ncW
  
  const drawSection = (title, questions) => {
    doc.setFillColor(230, 230, 230)
    doc.rect(20, y, pw - 40, 6, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text(title, 22, y + 4)
    y += 6
    
    doc.setFillColor(245, 245, 245)
    doc.rect(20, y, labelW, 5, 'F')
    for (let i = 1; i <= 5; i++) {
      doc.rect(20 + labelW + (i - 1) * colW, y, colW, 5, 'F')
    }
    doc.rect(20 + labelW + 5 * colW, y, ncW, 5, 'F')
    
    doc.setFontSize(6)
    doc.setFont('helvetica', 'bold')
    for (let i = 1; i <= 5; i++) {
      doc.text(String(i), 20 + labelW + (i - 1) * colW + colW / 2, y + 3.5, { align: 'center' })
    }
    doc.text('N/C', 20 + labelW + 5 * colW + ncW / 2, y + 3.5, { align: 'center' })
    y += 5
    
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    questions.forEach(q => {
      const response = evalData ? evalData[q.field] : null
      doc.rect(20, y, labelW, 6)
      for (let i = 1; i <= 5; i++) {
        doc.rect(20 + labelW + (i - 1) * colW, y, colW, 6)
        drawCircle(doc, 20 + labelW + (i - 1) * colW + colW / 2, y + 3, 1.2, response === i)
      }
      doc.rect(20 + labelW + 5 * colW, y, ncW, 6)
      drawCircle(doc, 20 + labelW + 5 * colW + ncW / 2, y + 3, 1.2, response === 0 || response === 'nc')
      doc.text(q.label, 22, y + 4)
      y += 6
    })
    y += 2
  }
  
  drawSection('1. ORGANISATION DE LA FORMATION', [
    { label: 'Communication des documents avant la formation', field: 'q_org_documents' },
    { label: 'Accueil sur le lieu de la formation', field: 'q_org_accueil' },
    { label: 'Qualité des locaux (salles, signalétique)', field: 'q_org_locaux' },
    { label: 'Adéquation des moyens matériels', field: 'q_org_materiel' },
  ])
  
  drawSection('2. LE CONTENU DE LA FORMATION', [
    { label: 'Organisation et déroulement', field: 'q_contenu_organisation' },
    { label: 'Qualité des supports pédagogiques', field: 'q_contenu_supports' },
    { label: 'Durée de la formation', field: 'q_contenu_duree' },
    { label: 'Respect du programme de formation', field: 'q_contenu_programme' },
  ])
  
  drawSection('3. L\'INTERVENTION DE L\'ANIMATEUR', [
    { label: 'La pédagogie du formateur', field: 'q_formateur_pedagogie' },
    { label: 'L\'expertise du formateur (maîtrise du sujet)', field: 'q_formateur_expertise' },
    { label: 'Progression de la formation (rythme)', field: 'q_formateur_progression' },
    { label: 'Adéquation des moyens mis à disposition', field: 'q_formateur_moyens' },
  ])
  
  drawSection('4. PERCEPTION GLOBALE', [
    { label: 'Adéquation formation / métier ou secteur', field: 'q_global_adequation' },
    { label: 'Amélioration de vos connaissances', field: 'q_global_competences' },
  ])
  
  // Recommandation
  y += 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('Recommanderiez-vous cette formation ?', 20, y)
  doc.setFont('helvetica', 'normal')
  const recommend = evalData ? evalData.would_recommend : null
  drawCircle(doc, 100, y - 1, 1.5, recommend === true || recommend === 1 || recommend === 'yes')
  doc.text('  Oui', 103, y)
  drawCircle(doc, 125, y - 1, 1.5, recommend === false || recommend === 0 || recommend === 'no')
  doc.text('  Non', 128, y)
  y += 8
  
  // Commentaires
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('5. COMMENTAIRES', 20, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text('Commentaire général (remarques, suggestions) :', 20, y)
  y += 3
  doc.rect(20, y, pw - 40, 18)
  if (evalData?.comment_general) {
    doc.setFontSize(6.5)
    const lines = doc.splitTextToSize(String(evalData.comment_general), pw - 44)
    doc.text(lines, 22, y + 3)
  }
  y += 21
  
  doc.text('Projet de formation (besoins futurs) :', 20, y)
  y += 3
  doc.rect(20, y, pw - 40, 15)
  if (evalData?.comment_projet) {
    doc.setFontSize(6.5)
    const lines = doc.splitTextToSize(String(evalData.comment_projet), pw - 44)
    doc.text(lines, 22, y + 3)
  }
  y += 18
  
  doc.setFontSize(8)
  doc.text('Signature :', 130, y)
  
  addFooter(doc, DOC_CODES.evaluation)
}


function generateEvaluationFroidContent(doc, session, trainee) {
  const course = session?.courses || {}
  const ref = session?.reference || ''
  
  let y = addHeader(doc, ref)
  y = addTitle(doc, 'ÉVALUATION À FROID', y)
  
  doc.setFontSize(9)
  doc.text(`Formation : ${course.title || ''}`, 20, y)
  y += 5
  doc.text(`Date de la formation : du ${formatDate(session?.start_date)} au ${formatDate(session?.end_date)}`, 20, y)
  y += 5
  if (trainee) { doc.text(`Stagiaire : ${trainee.first_name || ''} ${trainee.last_name?.toUpperCase() || ''}`, 20, y); y += 5 }
  y += 4
  
  // Objectifs de la formation
  const objectives = (course?.objectives || '').split('\n').map(o => o.trim()).filter(o => o.length > 0)
  if (objectives.length > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('Objectifs de la formation :', 20, y)
    y += 4
    doc.setFont('helvetica', 'normal')
    objectives.forEach((obj, idx) => {
      // Utiliser splitTextToSize pour gérer les retours à la ligne automatiques
      const maxWidth = 168 // 210mm - 20mm marge gauche - 22mm marge droite
      const lines = doc.splitTextToSize(`• ${obj}`, maxWidth)
      lines.forEach((line, lineIdx) => {
        // La première ligne a la puce, les suivantes sont indentées
        const xPos = lineIdx === 0 ? 22 : 26
        doc.text(line.replace('• ', lineIdx === 0 ? '• ' : ''), xPos, y)
        y += 3.5
      })
    })
    y += 4
  }
  
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.text('Cette évaluation est à compléter 1 à 3 mois après la formation.', 20, y)
  y += 8
  
  const questions = [
    'Avez-vous pu mettre en pratique les compétences acquises ?',
    'Les connaissances acquises sont-elles toujours présentes ?',
    'La formation a-t-elle eu un impact positif sur votre travail ?',
    'Les objectifs de la formation ont-ils été atteints ?',
  ]
  
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('Veuillez répondre aux questions suivantes :', 20, y); y += 7
  
  questions.forEach((q, idx) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`${idx + 1}. ${q}`, 20, y); y += 5
    drawCircle(doc, 25, y, 1.5, false)
    doc.text(' Oui', 29, y)
    drawCircle(doc, 55, y, 1.5, false)
    doc.text(' Non', 59, y)
    y += 9
  })
  
  y += 4
  doc.setFont('helvetica', 'bold')
  doc.text('Recommanderiez-vous cette formation ?', 20, y); y += 5
  doc.setFont('helvetica', 'normal')
  drawCircle(doc, 30, y, 1.5, false); doc.text('  Oui', 35, y)
  drawCircle(doc, 70, y, 1.5, false); doc.text('  Non', 75, y)
  y += 8
  
  doc.setFont('helvetica', 'bold')
  doc.text('Commentaires :', 20, y); y += 4
  doc.rect(20, y, 170, 30); y += 35
  
  doc.setFont('helvetica', 'normal')
  doc.text(`Date : ${formatDate(new Date())}`, 20, y)
  doc.text('Signature :', 120, y)
  
  addFooter(doc, DOC_CODES.evaluationFroid)
}

function generatePositionnementContent(doc, session, questions, trainee) {
  const course = session?.courses || {}
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  
  let y = addHeader(doc, session?.reference)
  y = addTitle(doc, 'TEST DE POSITIONNEMENT', y)
  
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(course.title || '', pw / 2, y, { align: 'center' })
  y += 10
  
  // Informations stagiaire
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  if (trainee) {
    doc.text(`Nom : ${trainee.last_name?.toUpperCase() || ''}`, 20, y)
    doc.text(`Prénom : ${trainee.first_name || ''}`, 110, y)
    y += 6
    doc.text(`Date : ${formatDate(session?.start_date || new Date())}`, 20, y)
    doc.text(`Entreprise : ${session?.clients?.name || ''}`, 110, y)
  } else {
    doc.text('Nom : ________________________________________', 20, y)
    doc.text('Prénom : ________________________________', 110, y)
    y += 6
    doc.text('Date : ___/___/______', 20, y)
    doc.text('Entreprise : ________________________________', 110, y)
  }
  y += 12
  
  // Consigne
  doc.setFontSize(8)
  doc.setFont('helvetica', 'italic')
  doc.text('Ce questionnaire permet d\'évaluer vos connaissances avant la formation. Cochez la réponse qui vous semble correcte.', 20, y)
  y += 10
  
  let pageNum = 1
  const startPage = doc.internal.getNumberOfPages()
  
  if (!questions || questions.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text('Aucune question configurée pour cette formation.', 20, y)
  } else {
    // Trier par position
    const sortedQuestions = [...questions].sort((a, b) => (a.position || 0) - (b.position || 0))
    
    sortedQuestions.forEach((q, idx) => {
      // Parser les options si nécessaire
      let options = q.options
      if (typeof options === 'string') {
        try { options = JSON.parse(options) } catch { options = [] }
      }
      options = options || []
      
      // Calculer la hauteur nécessaire
      const qText = `${idx + 1}. ${q.question_text || q.question || ''}`
      const qLines = doc.splitTextToSize(qText, 170)
      const isQCM = q.question_type === 'single_choice' || q.question_type === 'qcm'
      const optionLines = isQCM ? options.length : 0
      const neededHeight = (qLines.length * 5) + (isQCM ? (optionLines * 7 + 5) : 25) + 10
      
      // Vérifier si on doit changer de page
      if (y + neededHeight > ph - 25) {
        addFooter(doc, DOC_CODES.positionnement, pageNum)
        doc.addPage()
        pageNum++
        y = 20
      }
      
      // Question
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      qLines.forEach(l => { doc.text(l, 20, y); y += 5 })
      y += 4
      
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      
      if (isQCM && options.length > 0) {
        // QCM avec cases à cocher
        options.forEach((opt) => {
          doc.rect(25, y - 3, 4, 4)
          doc.text(opt, 32, y)
          y += 7
        })
      } else {
        // Question ouverte
        doc.setDrawColor(180, 180, 180)
        doc.rect(25, y, 165, 18)
        doc.setDrawColor(0, 0, 0)
        y += 22
      }
      
      y += 5
    })
  }
  
  addFooter(doc, DOC_CODES.positionnement, pageNum)
  
  // Gestion recto-verso : s'assurer que ce stagiaire occupe un nombre pair de pages
  const endPage = doc.internal.getNumberOfPages()
  const pagesUsed = endPage - startPage + 1
  if (pagesUsed % 2 !== 0) {
    doc.addPage()
    doc.setFontSize(8)
    doc.setTextColor(200, 200, 200)
    doc.text('(Page intentionnellement vide)', pw / 2, ph / 2, { align: 'center' })
    doc.setTextColor(0, 0, 0)
  }
}

// ============================================
// NOUVEAU : Test de positionnement rempli
// ============================================

function generateTestPositionnementRempli(session, trainee, testData) {
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const margins = { left: 15, right: 15, top: 15, bottom: 15 }
  let y = margins.top
  
  // En-tête
  y = addHeader(doc, session?.reference || "SANS-REF")
  y += 5
  
  // Titre
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(67, 56, 202)
  doc.text('TEST DE POSITIONNEMENT', pw / 2, y, { align: 'center' })
  y += 10
  
  // Infos stagiaire
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(0, 0, 0)
  doc.text(`Stagiaire : ${trainee.first_name} ${trainee.last_name?.toUpperCase()}`, margins.left, y)
  y += 6
  
  if (testData.completed_at) {
    doc.setFontSize(9)
    doc.setTextColor(100, 100, 100)
    doc.text(`Complete le : ${format(new Date(testData.completed_at), 'dd/MM/yyyy a HH:mm', { locale: fr })}`, margins.left, y)
    y += 10
  }
  
  // Ligne de séparation
  doc.setDrawColor(200, 200, 200)
  doc.line(margins.left, y, pw - margins.right, y)
  y += 8
  
  // ============================================
  // SYNTHÈSE INTELLIGENTE
  // ============================================
  const answers = testData.answers || []
  const criticalQuestions = answers.filter(a => a.critical && a.question_type === 'single_choice')
  const correctCritical = criticalQuestions.filter(a => a.is_correct).length
  const totalCritical = criticalQuestions.length
  const failedCritical = criticalQuestions.filter(a => a.is_correct === false)
  const dontKnow = answers.filter(a => a.selected_option_index === -1)
  
  const percentage = totalCritical > 0 ? Math.round((correctCritical / totalCritical) * 100) : 0
  const colorBg = percentage >= 80 ? [220, 252, 231] : percentage >= 50 ? [254, 249, 195] : [254, 226, 226]
  const colorText = percentage >= 80 ? [22, 163, 74] : percentage >= 50 ? [202, 138, 4] : [220, 38, 38]
  
  // Cadre synthèse (bordure au lieu de fond foncé)
  doc.setDrawColor(colorText[0], colorText[1], colorText[2])
  doc.setLineWidth(0.5)
  doc.setFillColor(colorBg[0], colorBg[1], colorBg[2])
  doc.roundedRect(margins.left, y, pw - margins.left - margins.right, 45, 3, 3, 'FD')
  doc.setLineWidth(0.2)
  
  y += 8
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(colorText[0], colorText[1], colorText[2])
  doc.text('SYNTHESE', margins.left + 5, y)
  y += 8
  
  // Score
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(0, 0, 0)
  doc.text('Questions critiques :', margins.left + 5, y)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(colorText[0], colorText[1], colorText[2])
  doc.text(`${correctCritical}/${totalCritical}`, margins.left + 50, y)
  doc.setFontSize(10)
  doc.text(`(${percentage}%)`, margins.left + 70, y)
  y += 10
  
  // Points de vigilance
  if (failedCritical.length > 0 || dontKnow.length > 0) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(234, 88, 12)
    doc.text('Points de vigilance :', margins.left + 5, y)
    y += 5
    
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    
    failedCritical.forEach((q) => {
      if (y > ph - 30) {
        doc.addPage()
        y = margins.top
        y = addHeader(doc, session?.reference || "SANS-REF")
        y += 5
      }
      
      const options = typeof q.options === 'string' ? JSON.parse(q.options) : q.options
      doc.setTextColor(220, 38, 38)
      doc.text('X', margins.left + 7, y)
      doc.setTextColor(0, 0, 0)
      const questionLines = doc.splitTextToSize(q.question_text, pw - margins.left - margins.right - 15)
      doc.text(questionLines, margins.left + 12, y)
      y += questionLines.length * 4
      
      doc.setTextColor(220, 38, 38)
      doc.text(`  Reponse donnee : ${options[q.selected_option_index]}`, margins.left + 12, y)
      y += 4
      doc.setTextColor(22, 163, 74)
      doc.text(`  Bonne reponse : ${options[q.correct_index]}`, margins.left + 12, y)
      y += 5
    })
    
    dontKnow.forEach((q) => {
      if (y > ph - 30) {
        doc.addPage()
        y = margins.top
        y = addHeader(doc, session?.reference || "SANS-REF")
        y += 5
      }
      
      doc.setTextColor(100, 100, 100)
      doc.text('?', margins.left + 7, y)
      const questionLines = doc.splitTextToSize(q.question_text, pw - margins.left - margins.right - 15)
      doc.text(questionLines, margins.left + 12, y)
      y += questionLines.length * 4
      doc.setTextColor(100, 100, 100)
      doc.setFont('helvetica', 'italic')
      doc.text('  "Je ne sais pas"', margins.left + 12, y)
      doc.setFont('helvetica', 'normal')
      y += 5
    })
  }
  
  // Points forts
  if (correctCritical > 0) {
    if (y > ph - 30) {
      doc.addPage()
      y = margins.top
      y = addHeader(doc, session?.reference || "SANS-REF")
      y += 5
    }
    
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(22, 163, 74)
    doc.text('Points forts :', margins.left + 5, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(0, 0, 0)
    doc.text(`${correctCritical} question${correctCritical > 1 ? 's critiques maitrisees' : ' critique maitrisee'}`, margins.left + 12, y)
    y += 8
  } else {
    y += 3
  }
  
  y += 5
  
  // ============================================
  // QUESTIONS / RÉPONSES DÉTAILLÉES
  // ============================================
  
  if (y > ph - 40) {
    doc.addPage()
    y = margins.top
    y = addHeader(doc, session?.reference || "SANS-REF")
    y += 5
  }
  
  doc.setDrawColor(200, 200, 200)
  doc.line(margins.left, y, pw - margins.right, y)
  y += 8
  
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text('QUESTIONS / REPONSES', margins.left, y)
  y += 8
  
  answers.forEach((answer, idx) => {
    // Vérifier espace disponible
    if (y > ph - 50) {
      doc.addPage()
      y = margins.top
      y = addHeader(doc, session?.reference || "SANS-REF")
      y += 5
    }
    
    // Numéro + Question
    doc.setFillColor(67, 56, 202)
    doc.circle(margins.left + 3, y - 1, 3, 'F')
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(255, 255, 255)
    doc.text((idx + 1).toString(), margins.left + 3, y + 1, { align: 'center' })
    
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(0, 0, 0)
    const questionLines = doc.splitTextToSize(answer.question_text, pw - margins.left - margins.right - 10)
    doc.text(questionLines, margins.left + 8, y)
    y += questionLines.length * 4 + 2
    
    // Badge question critique
    if (answer.critical) {
      doc.setFillColor(254, 215, 170)
      doc.roundedRect(margins.left + 8, y - 3, 30, 5, 1, 1, 'F')
      doc.setFontSize(7)
      doc.setTextColor(234, 88, 12)
      doc.text('Question critique', margins.left + 10, y)
      y += 6
    }
    
    // QCM
    if (answer.question_type === 'single_choice') {
      const options = typeof answer.options === 'string' ? JSON.parse(answer.options) : (answer.options || [])
      
      options.forEach((opt, optIdx) => {
        if (y > ph - 25) {
          doc.addPage()
          y = margins.top
          y = addHeader(doc, session?.reference || "SANS-REF")
          y += 5
        }
        
        const isSelected = answer.selected_option_index === optIdx
        const isCorrect = answer.correct_index === optIdx
        
        doc.setFontSize(8)
        doc.setFont('helvetica', 'normal')
        
        // Couleur selon statut
        if (isSelected && answer.is_correct) {
          doc.setFillColor(220, 252, 231)
          doc.setTextColor(22, 163, 74)
          doc.setFont('helvetica', 'bold')
        } else if (isSelected && !answer.is_correct) {
          doc.setFillColor(254, 226, 226)
          doc.setTextColor(220, 38, 38)
          doc.setFont('helvetica', 'bold')
        } else if (isCorrect) {
          doc.setFillColor(240, 253, 244)
          doc.setDrawColor(34, 197, 94)
          doc.setTextColor(22, 163, 74)
        } else {
          doc.setFillColor(249, 250, 251)
          doc.setTextColor(75, 85, 99)
        }
        
        const prefix = isSelected ? '> ' : (isCorrect && !isSelected ? '(CORRECT) ' : '')
        const optionText = `${prefix}${opt}`
        const optLines = doc.splitTextToSize(optionText, pw - margins.left - margins.right - 20)
        const boxHeight = optLines.length * 4 + 2
        
        if (isCorrect && !isSelected) {
          doc.setLineWidth(0.3)
          doc.roundedRect(margins.left + 10, y - 3, pw - margins.left - margins.right - 10, boxHeight, 1, 1, 'FD')
          doc.setLineWidth(0.2)
        } else {
          doc.roundedRect(margins.left + 10, y - 3, pw - margins.left - margins.right - 10, boxHeight, 1, 1, 'F')
        }
        
        doc.text(optLines, margins.left + 12, y)
        y += boxHeight + 1
        doc.setFont('helvetica', 'normal')
      })
      
      // "Je ne sais pas"
      if (answer.selected_option_index === -1) {
        doc.setFillColor(229, 229, 229)
        doc.roundedRect(margins.left + 10, y - 3, pw - margins.left - margins.right - 10, 6, 1, 1, 'F')
        doc.setFontSize(8)
        doc.setFont('helvetica', 'italic')
        doc.setTextColor(100, 100, 100)
        doc.text('> Je ne sais pas', margins.left + 12, y)
        doc.setFont('helvetica', 'normal')
        y += 7
      }
    }
    
    // Question ouverte
    if (answer.question_type === 'open') {
      doc.setFillColor(250, 250, 250)
      const textAnswer = answer.text_answer || 'Non repondu'
      const answerLines = doc.splitTextToSize(textAnswer, pw - margins.left - margins.right - 20)
      const boxHeight = Math.max(answerLines.length * 4 + 4, 10)
      
      doc.roundedRect(margins.left + 10, y - 2, pw - margins.left - margins.right - 10, boxHeight, 1, 1, 'F')
      doc.setFontSize(8)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(answer.text_answer ? 0 : 150, 0, 0)
      if (!answer.text_answer) doc.setFont('helvetica', 'italic')
      doc.text(answerLines, margins.left + 12, y + 2)
      y += boxHeight + 1
    }
    
    y += 5
  })
  
  // Footer
  addFooter(doc, `Test de positionnement - ${trainee.first_name} ${trainee.last_name}`)
  
  return doc
}
