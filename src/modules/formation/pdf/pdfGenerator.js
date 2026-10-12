import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { format, eachDayOfInterval, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'
import QRCode from 'qrcode'
import { buildORG, publicBaseUrl, prepareOrgForPDF, formatSiret } from '../../../core/org/orgUtils'
import {
  PAGE_MARGIN, drawHeaderBand, drawRunningHeader, drawFooter, numberPages, drawDocTitle, drawSectionTitle,
  drawPartyCard, drawKeyValues, drawCheckmark, drawImageFitted, formatMoney, formatHour,
} from '../../../core/pdf/layout'

import { APP_VERSION } from '../../../core/version'
import { computePresenceHours, formatHours } from '../lib/presence'
// Codes documentaires : préfixe propre à l'organisme (ORG.doc_prefix) + code du type de document
const DOC_CODES = {
  convention: 'CONV', convocation: 'CONVOC', attestation: 'ATTP',
  certificat: 'CERT', emargement: 'EMARG', programme: 'PROG',
  evaluation: 'EVAL', evaluationFroid: 'EVALF', reglement: 'RI',
  livret: 'LIVRET', analyseBesoin: 'BESOIN', evaluationFormateur: 'EVFORM',
  positionnement: 'POS',
}

// Masque le NSS pour impression : garde sexe + année + mois (5 premiers chiffres), masque le reste
// Ex: 1 89 10 75 056 433 67 → 1 89 10 ** *** *** **
// Le n° de sécurité sociale n'est plus imprimé sur aucun document (INRS).

// État courant de l'organisation pour les PDFs.
// Initialisé avec les valeurs par défaut (cf. orgUtils.js).
// Mis à jour par setOrganization() depuis les composants React qui détiennent organization_settings.
let ORG = buildORG(null)
const T = () => ORG.theme || buildORG(null).theme

// Dessine le logo dans une boîte en conservant ses proportions (boîte max 50 x 16 mm)
function drawLogoFitted(doc, logoBase64, x = 15, y = 9, maxW = 50, maxH = 16) {
  const format = logoBase64.includes('image/png') ? 'PNG' : 'JPEG'
  let w = maxW, h = maxH
  try {
    const props = doc.getImageProperties(logoBase64)
    if (props?.width && props?.height) {
      const ratio = props.width / props.height
      if (maxW / ratio <= maxH) { w = maxW; h = maxW / ratio } else { h = maxH; w = maxH * ratio }
    }
  } catch { /* proportions inconnues : boîte par défaut */ }
  doc.addImage(logoBase64, format, x, y + (maxH - h) / 2, w, h)
}

/**
 * Met à jour les infos organisation utilisées par tous les générateurs PDF du fichier.
 * À appeler depuis les composants React avant la génération (typiquement dans un useEffect
 * qui dépend de organization du store).
 *
 * @param {object|null} orgSettings - ligne de la table organization_settings
 */
export function setOrganization(orgSettings) {
  if (!orgSettings) return
  ORG = buildORG(orgSettings)
  // Le logo est stocké en URL : on le précharge en base64 pour jsPDF
  if (!ORG.logo_base64 && ORG.logo_url) {
    prepareOrgForPDF(orgSettings).then((o) => { if (o) ORG = buildORG(o) }).catch(() => {})
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
const formatDateLong = (d) => d ? format(new Date(d), 'EEEE d MMMM yyyy', { locale: fr }) : ''

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
  if (logoBase64) {
    try {
      drawLogoFitted(doc, logoBase64)
    } catch (e) {
      console.warn('Erreur chargement logo:', e)
      // Fallback: rectangle bleu + texte
      doc.setFillColor(...T().primary)
      doc.rect(15, 10, 50, 12, 'F')
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(255, 255, 255)
      doc.text((org.name || '').toUpperCase().slice(0, 22), 20, 18)
      doc.setTextColor(0, 0, 0)
    }
  } else {
    // Rectangle bleu + texte par défaut
    doc.setFillColor(...T().primary)
    doc.rect(15, 10, 50, 12, 'F')
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(255, 255, 255)
    doc.text((org.name || '').toUpperCase().slice(0, 22), 20, 18)
    doc.setTextColor(0, 0, 0)
  }
  
  // Infos société (depuis ORG global) - décalées à droite du logo
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(0, 0, 0)
  doc.text((org.nameFull || org.name || '').toUpperCase(), 70, 12)
  doc.text(org.address || '', 70, 17)
  doc.text([org.phone ? `Tél : ${org.phone}` : '', org.email ? `Email : ${org.email}` : ''].filter(Boolean).join(' - '), 70, 22)
  doc.text([org.siret ? `SIRET : ${org.siret}` : '', org.nda ? `NDA : ${org.nda}` : ''].filter(Boolean).join(' - '), 70, 27)
  
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
  doc.setFillColor(...T().primary)
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
  doc.text([ORG.name, ORG.addressFull].filter(Boolean).join(' - '), pw / 2, ph - 17, { align: 'center' })
  if (ORG.ndaFull) doc.text(`NDA : ${ORG.ndaFull}`, pw / 2, ph - 13, { align: 'center' })
  doc.text([ORG.siret ? `SIRET : ${ORG.siret}` : '', ORG.naf ? `NAF : ${ORG.naf}` : '', ORG.tva ? `TVA : ${ORG.tva}` : ''].filter(Boolean).join(' - '), pw / 2, ph - 9, { align: 'center' })
  doc.setFontSize(6)
  doc.setTextColor(180)
  doc.text(`${ORG.doc_prefix ? ORG.doc_prefix + '-' : ''}${docCode}-${APP_VERSION}`, pw - 15, ph - 5, { align: 'right' })
  if (pageNum) doc.text(`Page ${pageNum}`, 15, ph - 5)
  doc.setTextColor(0)
}

// ============================================================
// HELPER - Obtenir le lieu (Intra = adresse client)
// ============================================================
function getLocation(session) {
  // Lieu complet : nom du site, rue, code postal et ville
  const join = (...parts) => parts.filter(Boolean).join(', ')
  if (session?.location_address || session?.location_city) {
    return join(session.location_name, session.location_address, [session.location_postal_code, session.location_city].filter(Boolean).join(' '))
  }
  if (session?.is_intra && session?.clients?.address) {
    const c = session.clients
    return join(c.name, c.address, [c.postal_code, c.city].filter(Boolean).join(' '))
  }
  return session?.location_name || session?.location || ''
}

// ============================================================
// CONVENTION DE FORMATION
// Mise en page : core/pdf/layout.js. Références légales : L6353-1 et D6353-1 (convention),
// L6354-1 (inexécution). Aucune donnée d'organisme en dur : tout vient de ORG.
// ============================================================
function generateConvention(session, trainees = [], trainer = null, costs = []) {
  const doc = new jsPDF({ compress: true })
  const pw = doc.internal.pageSize.getWidth()
  const M = PAGE_MARGIN
  const W = pw - M * 2
  const t = T()
  const client = session?.clients || {}
  const course = session?.courses || {}
  const ref = session?.reference || ''
  const lieu = getLocation(session)
  const signatory = getSessionSignatory(session)
  const CODE = DOC_CODES.convention
  const docLabel = 'Convention de formation'

  let y = drawHeaderBand(doc, ORG, { ref, docLabel })
  y = drawDocTitle(doc, ORG, 'Convention de formation professionnelle', 'Articles L6353-1 et D6353-1 du Code du travail', y)

  // ── Les parties, côte à côte ──
  const gap = 6
  const colW = (W - gap) / 2
  const ofLines = [
    ORG.nameFull || ORG.name,
    ORG.address,
    `SIRET ${ORG.siret}`,
    `NDA ${ORG.nda}`,
    `Représenté par ${ORG.dirigeant}${ORG.dirigeant_title ? ', ' + ORG.dirigeant_title : ''}`,
  ]
  const clientAddr = [client.address, [client.postal_code, client.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const benefLines = [
    client.name || '',
    clientAddr,
    client.siret ? `SIRET ${formatSiret(client.siret)}` : 'SIRET non renseigné',
    `Représenté par ${signatory.name || ''}${signatory.role ? ', ' + signatory.role : ''}`,
  ]
  while (benefLines.length < ofLines.length) benefLines.push('')
  const y1 = drawPartyCard(doc, ORG, M, y, colW, "L'organisme de formation", ofLines, "ci-après « l'Organisme de formation »")
  const y2 = drawPartyCard(doc, ORG, M + colW + gap, y, colW, 'Le bénéficiaire', benefLines, 'ci-après « le Bénéficiaire »')
  y = Math.max(y1, y2) + 10

  // ── Synthèse de l'action ──
  y = drawSectionTitle(doc, ORG, "L'action de formation", y)
  const nbDays = parseInt(course.duration_days, 10) || 1
  const hours = parseFloat(course.duration_hours || course.duration || 7)
  const dureeTxt = `${hours.toLocaleString('fr-FR')} heures${nbDays > 1 ? ` sur ${nbDays} jours` : ''}`
  const datesTxt = session?.start_date === session?.end_date
    ? `Le ${formatDateLong(session?.start_date)}`
    : `Du ${formatDateLong(session?.start_date)} au ${formatDateLong(session?.end_date)}`
  const fundingLabels = { opco: 'OPCO', cpf: 'CPF (Compte personnel de formation)', faf: "FAF (Fonds d'assurance formation)", region: 'Région', france_travail: 'France Travail', ptp: 'PTP (Projet de transition professionnelle)', fne: 'FNE (Fonds national de l\'emploi)', direct: 'Financement direct', other: 'Autre' }
  const rows = [
    ['Intitulé', course.title || ''],
    ["Type d'action", 'Action de formation'],
    ['Dates', `${datesTxt}, de ${formatHour(session?.start_time)} à ${formatHour(session?.end_time)}`],
    ['Durée', dureeTxt],
    ['Lieu', lieu || 'À définir'],
    ['Effectif', `${trainees.length} participant${trainees.length > 1 ? 's' : ''}`],
    ['Public', course.target_audience || 'Tout public'],
    ['Prérequis', course.prerequisites || 'Aucun'],
    ['Formateur', trainer ? `${trainer.first_name} ${trainer.last_name}` : ORG.dirigeant],
  ]
  if (session?.funding_type && session.funding_type !== 'none') {
    rows.push(['Financement', `${fundingLabels[session.funding_type] || session.funding_type}${session.funding_details ? ` (${session.funding_details})` : ''}`])
  }
  y = drawKeyValues(doc, ORG, M, y, W, rows)
  y += 8

  // ── Coûts ──
  const coutFormationHT = parseFloat(session?.total_price || course.price_ht || course.price_per_day || 0)
  let totalCostsSupp = 0
  const costDetails = []
  ;(costs || []).forEach(c => {
    const amount = parseFloat(c.amount || 0)
    const total = c.per_trainee ? amount * trainees.length : amount
    totalCostsSupp += total
    costDetails.push({ label: c.label, amount, per_trainee: c.per_trainee, total })
  })
  const coutTotalHT = coutFormationHT + totalCostsSupp

  const kv = [['Coût de la formation', `${formatMoney(coutFormationHT)} HT`]]
  const isInter = session?.inter_group_id && session?.inter_total_price
  if (isInter) {
    // Seule la quote-part de ce bénéficiaire est mentionnée (session inter-entreprises)
    const nb = trainees.length || 1
    kv.push([`Soit ${nb} participant${nb > 1 ? 's' : ''} × ${formatMoney(coutFormationHT / nb)} (session inter-entreprises)`, ''])
  }
  if (costDetails.length) {
    costDetails.forEach(c => kv.push([c.label, c.per_trainee ? `${formatMoney(c.amount)} × ${trainees.length} = ${formatMoney(c.total)} HT` : `${formatMoney(c.total)} HT`]))
    kv.push(['Coût total', `${formatMoney(coutTotalHT)} HT`])
  }
  const tvaNote = ORG.tva_applicable === false ? 'Organisme non assujetti à la TVA.' : 'TVA en sus au taux en vigueur.'
  const bankNote = ORG.iban ? ` (IBAN ${ORG.iban}${ORG.bic ? `, BIC ${ORG.bic}` : ''})` : ''
  const art3 = [
    { kv },
    { p: `${tvaNote} Règlement par virement bancaire à réception de facture${bankNote}. Aucun acompte n'est demandé avant la formation.` },
    { p: "En cas d'inexécution totale ou partielle de la prestation, l'Organisme de formation rembourse au Bénéficiaire les sommes indûment perçues (article L6354-1 du Code du travail)." },
  ]

  const objectifs = (course.objectives || '').split('\n').map(s => s.trim()).filter(Boolean)
  const articles = [
    { title: 'Objet, durée et effectif', blocks: [
      { p: `Le Bénéficiaire confie à l'Organisme de formation la réalisation de l'action « ${course.title || ''} », d'une durée de ${dureeTxt}, ${datesTxt.charAt(0).toLowerCase() + datesTxt.slice(1)}, pour ${trainees.length} participant${trainees.length > 1 ? 's' : ''}.` },
      ...(objectifs.length ? [{ p: "À l'issue de la formation, les participants seront capables de :" }, { list: objectifs }] : []),
      ...(trainees.length ? [{ p: 'Participants désignés par le Bénéficiaire :' }, { list: trainees.map(tr => `${(tr.last_name || '').toUpperCase()} ${tr.first_name || ''}`), cols: 2 }] : []),
    ] },
    { title: 'Engagements des parties', blocks: [{ p: "Le Bénéficiaire s'engage à assurer la présence des participants inscrits et à fournir les moyens nécessaires à la réalisation de la formation (salle, matériel, conditions d'accueil). L'Organisme de formation s'engage à mettre en oeuvre les moyens pédagogiques, techniques et d'encadrement nécessaires pour atteindre les objectifs visés." }] },
    { title: 'Dispositions financières', blocks: art3 },
    { title: 'Moyens et modalités pédagogiques', blocks: [
      { p: "La formation est dispensée selon une approche active et participative, combinant apports théoriques, mises en situation pratiques et évaluations formatives continues. Les supports pédagogiques sont adaptés aux objectifs de la formation et au public accueilli." },
      { p: "La présence des participants est attestée par un émargement dématérialisé par QR code individuel, ou sur support papier en cas d'indisponibilité du réseau. Un émargement est réalisé par demi-journée, signé par chaque participant et contresigné par le formateur." },
    ] },
    { title: "Modalités de suivi et d'évaluation", blocks: [
      { p: "Un positionnement préalable est réalisé en amont de la formation afin d'adapter le déroulé pédagogique au niveau et aux besoins de chaque participant. Tout au long de la formation, des évaluations formatives mesurent la progression des acquis. En fin de parcours, une évaluation sommative est conduite selon le référentiel applicable." },
      { p: "Un certificat de réalisation mentionnant le niveau d'atteinte des objectifs est remis à l'issue de la formation." },
    ] },
    { title: 'Documents délivrés', blocks: [{ p: "À l'issue de la formation, l'Organisme de formation délivre une attestation de présence, un certificat de réalisation (acquis / non acquis) et, le cas échéant, l'attestation ou le certificat propre au module suivi." }] },
    { title: 'Annulation et report', blocks: [{ p: ORG.conditions_annulation || "En cas de désistement du Bénéficiaire moins de 14 jours avant le début de la formation, une indemnité forfaitaire de 50 % du coût total est facturée ; moins de 7 jours avant, cette indemnité est portée à 75 %. En cas d'annulation par l'Organisme de formation moins de 7 jours avant, une nouvelle date est proposée sans frais." }] },
    { title: 'Accessibilité', blocks: [{ p: `${ORG.name} s'engage à favoriser l'accès à ses formations aux personnes en situation de handicap. Toute demande d'adaptation est à signaler en amont${ORG.referent_handicap_email ? ` au référent handicap (${ORG.referent_handicap_email})` : ` à ${ORG.email}`} afin de mettre en place les mesures nécessaires.` }] },
    { title: 'Protection des données', blocks: [{ p: "Les données personnelles collectées sont utilisées exclusivement pour la gestion administrative et pédagogique des formations. Elles sont conservées 5 ans et accessibles sur demande, conformément au RGPD." }] },
    { title: 'Litiges', blocks: [{ p: `En cas de différend, les parties recherchent une solution amiable. À défaut, le litige est porté devant ${ORG.tribunal_competent ? `le ${ORG.tribunal_competent}` : 'le tribunal compétent'}.` }] },
  ]

  // ── Articles : pagination ligne par ligne, sans ligne orpheline ──
  const bodyW = W - 12
  const LINE = 4.1
  const BOTTOM = 275
  const sigBlockH = 44
  const measureBlock = (b) => {
    if (b.p) return doc.splitTextToSize(b.p, bodyW).length * LINE + 2
    if (b.list) return b.cols === 2 ? Math.ceil(b.list.length / 2) * LINE + 2 : b.list.reduce((a, it) => a + doc.splitTextToSize(it, bodyW - 6).length * LINE, 0) + 2
    if (b.kv) return b.kv.length * 5.5 + 3
    return 0
  }
  const ensure = (h) => {
    if (y + h > BOTTOM) {
      drawFooter(doc, ORG, CODE)
      doc.addPage()
      y = drawRunningHeader(doc, ORG, { ref, docLabel })
    }
  }
  const body = () => { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...t.text) }
  const bullet = (x) => { doc.setFillColor(...t.highlight); doc.circle(x, y - 1.1, 0.7, 'F') }

  articles.forEach((art, i) => {
    body()
    // Titre + au moins deux lignes sur la même page ; le dernier article reste avec les signatures
    const isLast = i === articles.length - 1
    const fullH = 10 + art.blocks.reduce((a, b) => a + measureBlock(b), 0)
    ensure(isLast ? fullH + sigBlockH : 10 + LINE * 2 + 2)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
    doc.setTextColor(...t.accent); doc.text(`${i + 1}.`, M, y)
    doc.setTextColor(...t.primary); doc.text(art.title, M + 7, y)
    y += 6.5
    art.blocks.forEach(b => {
      body()
      if (b.p) {
        const lines = doc.splitTextToSize(b.p, bodyW)
        lines.forEach((l, li) => {
          if (li === 0) ensure(LINE * Math.min(2, lines.length)); else if (li === lines.length - 2) ensure(LINE * 2); else ensure(LINE)
          body(); doc.text(l, M + 7, y); y += LINE
        })
        y += 2
      } else if (b.list && b.cols === 2) {
        const half = Math.ceil(b.list.length / 2)
        const colW2 = bodyW / 2
        for (let r = 0; r < half; r++) {
          ensure(LINE)
          body()
          const a = b.list[r], c = b.list[r + half]
          bullet(M + 8.5); doc.text(a, M + 11, y)
          if (c) { bullet(M + 8.5 + colW2); doc.text(c, M + 11 + colW2, y) }
          y += LINE
        }
        y += 2
      } else if (b.list) {
        b.list.forEach(it => {
          const ls = doc.splitTextToSize(it, bodyW - 6)
          ensure(LINE * ls.length)
          body(); bullet(M + 8.5)
          ls.forEach(l => { doc.text(l, M + 11, y); y += LINE })
        })
        y += 2
      } else if (b.kv) {
        ensure(b.kv.length * 5.5 + 3)
        b.kv.forEach(([k, v], idx) => {
          const last = idx === b.kv.length - 1 && b.kv.length > 1
          doc.setFont('helvetica', last ? 'bold' : 'normal'); doc.setFontSize(9); doc.setTextColor(...t.text)
          doc.text(k, M + 7, y)
          if (v) doc.text(v, M + W, y, { align: 'right' })
          doc.setDrawColor(...t.line); doc.setLineWidth(0.25); doc.line(M + 7, y + 1.6, M + W, y + 1.6)
          y += 5.5
        })
        y += 1.5
      }
    })
    y += 2
  })

  // ── Signatures ──
  ensure(sigBlockH)
  y += 2
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...t.text)
  doc.text(`Fait en deux exemplaires à ${ORG.lieu_signature || ORG.city}, le ${formatDate(new Date())}.`, M, y)
  y += 7
  const boxH = 34
  const sigCol = (x, label, l1, l2) => {
    doc.setDrawColor(...t.line); doc.setLineWidth(0.3)
    doc.rect(x, y, colW, boxH)
    doc.setFillColor(...t.surface); doc.rect(x, y, colW, 11, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...t.accent)
    doc.text(label.toUpperCase(), x + 4, y + 4.5, { charSpace: 0.4 })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...t.text)
    doc.text(`${l1 || ''}${l2 ? ', ' + l2 : ''}`, x + 4, y + 8.8)
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(...t.muted)
    doc.text('Signature et cachet', x + 4, y + boxH - 3)
    doc.setTextColor(...t.text)
  }
  sigCol(M, "Pour l'organisme de formation", ORG.dirigeant, ORG.dirigeant_title || 'Dirigeant')
  sigCol(M + colW + gap, 'Pour le bénéficiaire', signatory.name || client.name || '', signatory.role)
  if (ORG.stamp_base64) drawImageFitted(doc, ORG.stamp_base64, M + 6, y + 12, 44, 19, 'JPEG')
  if (ORG.dirigeant_signature_base64) drawImageFitted(doc, ORG.dirigeant_signature_base64, M + 52, y + 13, 34, 17)
  y += boxH

  drawFooter(doc, ORG, CODE)
  numberPages(doc, ORG)
  return doc
}

// ============================================================
// CONVOCATION (document seul, sans QR code). Contenu : generateConvocationContent.
// ============================================================
function generateConvocation(session, trainee, trainer = null) {
  const doc = new jsPDF({ compress: true })
  generateConvocationContent(doc, session, trainee, trainer, null)
  return doc
}

// ============================================================
// FEUILLE D'ÉMARGEMENT (paysage)
// Sources de présence : attendances (ancien format), attendance_halfdays, signatures par un tiers,
// absents, signature enregistrée du formateur. Mise en page : core/pdf/layout.js.
// ============================================================
function generateEmargement(session, trainees = [], trainer = null, isBlank = false, attendanceData = null) {
  const doc = new jsPDF({ orientation: 'landscape', compress: true })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const M = PAGE_MARGIN
  const W = pw - M * 2
  const t = T()
  const course = session?.courses || {}
  const ref = session?.reference || ''
  const lieu = isBlank ? '' : getLocation(session)
  const CODE = DOC_CODES.emargement
  const docLabel = "Feuille d'émargement"

  const signatures = attendanceData?.signatures || []   // table "attendances" (ancien format)
  const halfdays = attendanceData?.halfdays || []       // table "attendance_halfdays"
  const proxies = attendanceData?.proxies || []         // signatures recueillies par un tiers
  const absents = attendanceData?.absents || []         // ids des stagiaires notés absents
  const trainerSignatureBase64 = attendanceData?.trainerSignatureBase64

  const getSignature = (traineeId, dateStr, period) => {
    const target = period === 'morning' ? 'am' : 'pm'
    return signatures.find(s => s.trainee_id === traineeId && s.date === dateStr && (s.period === target || s.period === 'full'))
  }
  const getHalfday = (traineeId, dateStr, period) => {
    const hd = halfdays.find(h => h.trainee_id === traineeId && String(h.date).substring(0, 10) === dateStr)
    if (!hd) return null
    return (period === 'morning' ? hd.morning : hd.afternoon) ? hd : null
  }
  const getProxy = (traineeId, dateStr, period) =>
    proxies.find(p => p.trainee_id === traineeId && String(p.date).substring(0, 10) === dateStr && p.period === period)

  // ── Jours et colonnes ──
  let days = []
  if (!isBlank && session?.start_date && session?.end_date) {
    try { days = eachDayOfInterval({ start: parseISO(session.start_date), end: parseISO(session.end_date) }) } catch { /* dates invalides : un seul jour */ }
  }
  const displayDays = isBlank ? [1, 2, 3] : (days.length > 0 ? days : [new Date()])
  const isHalfDay = session?.day_type === 'half'
  const halfDayPeriod = isHalfDay && session?.start_time ? (parseInt(session.start_time.split(':')[0], 10) >= 12 ? 'afternoon' : 'morning') : 'morning'
  const colsPerDay = isHalfDay ? 1 : 2
  const nCols = displayDays.length * colsPerDay
  const dayColW = Math.min(60, (W - 80) / nCols)
  const nameColW = W - dayColW * nCols
  const tableW = nameColW + dayColW * nCols
  const startX = M

  const ROWS_PER_PAGE = 12
  const rowsAll = isBlank
    ? [...trainees, ...Array(Math.max(0, 10 - trainees.length)).fill({})]
    : (trainees.length > 0 ? trainees : [{}])
  const pages = []
  for (let i = 0; i < rowsAll.length; i += ROWS_PER_PAGE) pages.push(rowsAll.slice(i, i + ROWS_PER_PAGE))
  const totalPages = pages.length

  // Hauteur de ligne : identique sur toutes les pages, adaptée au nombre de participants
  const hasAnySignatureImage = !isBlank && (
    signatures.some(s => s.signature_data || s.signature) ||
    halfdays.some(hd => hd.signature_morning || hd.signature_afternoon) ||
    proxies.length > 0
  )
  const HEADER_H = 66
  const FOOTER_H = 34
  const available = ph - HEADER_H - FOOTER_H
  const nRows = Math.min(rowsAll.length, ROWS_PER_PAGE) + 1 // + ligne formateur
  const rowH = isBlank ? 10 : Math.min(hasAnySignatureImage ? 22 : 18, Math.max(9, Math.floor(available / nRows)))

  const trainerName = trainer ? `${trainer.first_name} ${trainer.last_name}` : ORG.dirigeant
  const trainerNameUpper = trainer ? `${(trainer.last_name || '').toUpperCase()} ${trainer.first_name || ''}` : ORG.dirigeant

  const drawPageHeader = (pageNum) => {
    let y = drawHeaderBand(doc, ORG, { ref: isBlank ? null : ref, docLabel: totalPages > 1 ? `page ${pageNum} / ${totalPages}` : '' })
    y -= 1
    // Titre et formateur à gauche, informations de session à droite
    doc.setFillColor(...t.accent); doc.rect(M, y - 6, 1.6, 8, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...t.primary)
    doc.text("Feuille d'émargement", M + 5, y)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...t.text)
    doc.text(`Formateur : ${isBlank ? '' : trainerName}`, M + 5, y + 7)
    if (isBlank) { doc.setDrawColor(...t.line); doc.setLineWidth(0.25); doc.line(M + 25, y + 7.5, M + 70, y + 7.5) }

    const infoX1 = M + 78, infoX2 = M + 178
    const info = (x, yy, k, v) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...t.muted)
      doc.text(k.toUpperCase(), x, yy, { charSpace: 0.3 })
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...t.text)
      const maxW = (x === infoX1 ? infoX2 - infoX1 : pw - M - infoX2) - 4
      const lines = isBlank ? [''] : doc.splitTextToSize(v || '', maxW).slice(0, 2)
      if (lines.length > 1) doc.setFontSize(7.5)
      lines.forEach((l, i) => doc.text(l, x, yy + 4 + i * 3.4))
      return lines.length
      if (isBlank) { doc.setDrawColor(...t.line); doc.setLineWidth(0.25); doc.line(x, yy + 4.5, x + maxW, yy + 4.5) }
    }
    const datesTxt = session?.start_date === session?.end_date
      ? formatDateLong(session?.start_date)
      : `${formatDate(session?.start_date)} au ${formatDate(session?.end_date)}`
    const titleLines = info(infoX1, y - 5, 'Formation', course.title)
    info(infoX2, y - 5, 'Entreprise', session?.clients?.name)
    const row2 = titleLines > 1 ? 3.5 : 0   // titre sur deux lignes : la seconde rangée descend d'autant
    info(infoX1, y + 5 + row2, 'Dates et horaires', `${datesTxt}, ${formatHour(session?.start_time)} à ${formatHour(session?.end_time)}`)
    info(infoX2, y + 5 + row2, 'Lieu', lieu)
    y += 15 + row2

    // En-tête du tableau : fond principal, dates en couleur de détail
    doc.setFillColor(...t.primary); doc.rect(startX, y, tableW, 12, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255)
    doc.text('PARTICIPANT', startX + 3, y + 7.5, { charSpace: 0.4 })
    let x = startX + nameColW
    displayDays.forEach((day, idx) => {
      const dateStr = isBlank ? `Jour ${idx + 1}` : format(day, 'EEE d MMM', { locale: fr })
      doc.setTextColor(...t.highlight); doc.setFontSize(8)
      if (isHalfDay) {
        doc.text(dateStr, x + dayColW / 2, y + 4.5, { align: 'center' })
        doc.setTextColor(255, 255, 255); doc.setFontSize(7)
        doc.text(halfDayPeriod === 'afternoon' ? 'Après-midi' : 'Matin', x + dayColW / 2, y + 9.5, { align: 'center' })
        x += dayColW
      } else {
        doc.text(dateStr, x + dayColW, y + 4.5, { align: 'center' })
        doc.setTextColor(255, 255, 255); doc.setFontSize(7)
        doc.text('Matin', x + dayColW / 2, y + 9.5, { align: 'center' })
        doc.text('Après-midi', x + dayColW + dayColW / 2, y + 9.5, { align: 'center' })
        doc.setDrawColor(80, 84, 90); doc.setLineWidth(0.2); doc.line(x + dayColW, y + 6.5, x + dayColW, y + 12)
        x += dayColW * 2
      }
      doc.setDrawColor(...t.highlight); doc.setLineWidth(0.4); doc.line(x, y, x, y + 12)
    })
    doc.setTextColor(...t.text)
    return y + 12
  }

  // ── Pages ──
  let proxyNumber = 0
  const proxyNotes = []

  pages.forEach((rows, pageIdx) => {
    if (pageIdx > 0) doc.addPage()
    let y = drawPageHeader(pageIdx + 1)
    doc.setDrawColor(...t.line); doc.setLineWidth(0.25)

    rows.forEach((tr, ri) => {
      const isAbsent = tr.id && absents.includes(tr.id)
      if (ri % 2 === 1) { doc.setFillColor(...t.surface); doc.rect(startX, y, tableW, rowH, 'F') }
      doc.rect(startX, y, nameColW, rowH)
      if (tr.first_name) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...t.text)
        const fullName = `${(tr.last_name || '').toUpperCase()} ${tr.first_name || ''}`
        doc.text(doc.splitTextToSize(fullName, nameColW - 6)[0] || fullName, startX + 3, y + rowH / 2 + 1)
      }

      let xx = startX + nameColW
      displayDays.forEach((day) => {
        const dateStr = isBlank ? null : format(day, 'yyyy-MM-dd')

        const drawCell = (cellX, period) => {
          doc.rect(cellX, y, dayColW, rowH)
          if (isBlank || !tr.id || !dateStr) return

          if (isAbsent) {
            doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...t.muted)
            doc.text('ABSENT', cellX + dayColW / 2, y + rowH / 2 + 1, { align: 'center' })
            doc.setTextColor(...t.text)
            return
          }

          const proxy = getProxy(tr.id, dateStr, period)
          const sig = getSignature(tr.id, dateStr, period)
          const hd = getHalfday(tr.id, dateStr, period)
          if (!proxy && !sig && !hd) return   // case vide

          const pad = 1
          const boxW = dayColW - pad * 2
          const boxH = rowH - pad * 2

          // 1) Signature recueillie par un tiers : image + renvoi vers l'annexe
          if (proxy) {
            const drawn = drawImageFitted(doc, proxy.proxy_signature, cellX + pad, y + pad, boxW - 3, boxH)
            if (!drawn) drawCheckmark(doc, ORG, cellX + (dayColW - 4.5) / 2, y + (rowH - 4.5) / 2, 4.5, t.accent)
            let note = proxyNotes.find(n =>
              n.trainee_id === proxy.trainee_id && n.date === String(proxy.date).substring(0, 10) && n.period === proxy.period)
            if (!note) {
              proxyNumber += 1
              note = { ...proxy, num: proxyNumber, trainee: tr, date: String(proxy.date).substring(0, 10) }
              proxyNotes.push(note)
            }
            doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(...t.accent)
            doc.text(`(${note.num})`, cellX + dayColW - 1.5, y + rowH - 1.5, { align: 'right' })
            doc.setTextColor(...t.text)
            return
          }

          // 2) Signature du participant
          const imageToUse = (sig && (sig.signature_data || sig.signature))
            || (hd && (period === 'morning' ? hd.signature_morning : hd.signature_afternoon))
          if (drawImageFitted(doc, imageToUse, cellX + pad, y + pad, boxW, boxH)) return

          // 3) Présence validée par le formateur, sans signature
          drawCheckmark(doc, ORG, cellX + (dayColW - 4.5) / 2, y + (rowH - 4.5) / 2, 4.5, t.accent)
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

    // ── Ligne formateur, toujours présente : signature enregistrée sur chaque demi-journée tenue, sinon case à signer ──
    doc.setFillColor(252, 247, 236); doc.rect(startX, y, tableW, rowH, 'F')
    doc.setDrawColor(...t.highlight); doc.setLineWidth(0.5); doc.line(startX, y, startX + tableW, y)
    doc.setDrawColor(...t.line); doc.setLineWidth(0.25)
    doc.rect(startX, y, nameColW, rowH)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...t.primary)
    doc.text(`FORMATEUR${isBlank ? '' : `   ${trainerNameUpper}`}`, startX + 3, y + rowH / 2 + 1)
    doc.setTextColor(...t.text)
    let xt = startX + nameColW
    displayDays.forEach((day) => {
      const dateStr = isBlank ? null : format(day, 'yyyy-MM-dd')
      const drawTrainerCell = (cellX, period) => {
        doc.rect(cellX, y, dayColW, rowH)
        if (isBlank || !trainerSignatureBase64 || !dateStr) return
        const tenue = trainees.some(tr => tr.id && !absents.includes(tr.id) && (
          getProxy(tr.id, dateStr, period) || getSignature(tr.id, dateStr, period) || getHalfday(tr.id, dateStr, period)
        ))
        if (tenue) drawImageFitted(doc, trainerSignatureBase64, cellX + 1, y + 1, dayColW - 2, rowH - 2)
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
    y += rowH + 5

    // ── Légende ──
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...t.muted)
    if (!isBlank) {
      doc.setFillColor(...t.accent); doc.roundedRect(M, y - 2.6, 3, 3, 0.6, 0.6, 'F')
      doc.text('Présence validée par le formateur, sans signature', M + 5, y)
      doc.text('ABSENT : participant absent sur la demi-journée      (n) : signature recueillie par un tiers, voir annexe', M + 75, y)
      doc.text('Chaque participant signe à chaque demi-journée. Le formateur contresigne la feuille.', pw - M, y, { align: 'right' })
    } else {
      doc.text('Chaque participant signe à chaque demi-journée. Le formateur contresigne la feuille.', M, y)
    }
    doc.setTextColor(...t.text)

    drawFooter(doc, ORG, CODE, totalPages > 1 ? pageIdx + 1 : null, totalPages > 1 ? totalPages : null)
  })

  // ── Annexe : signatures recueillies par un tiers ──
  if (proxyNotes.length > 0) {
    doc.addPage()
    let y = drawHeaderBand(doc, ORG, { ref, docLabel: `${docLabel}   annexe` })
    y = drawDocTitle(doc, ORG, 'Signatures recueillies par un tiers',
      `${course.title || ''}, ${formatDate(session?.start_date)} au ${formatDate(session?.end_date)}, ${session?.clients?.name || ''}`, y)

    proxyNotes.forEach(n => {
      if (y > ph - 60) { doc.addPage(); y = drawRunningHeader(doc, ORG, { ref, docLabel }) }
      const blockH = 36
      doc.setFillColor(...t.surface); doc.rect(M, y, W, blockH, 'F')
      doc.setFillColor(...t.accent); doc.rect(M, y, 1.2, blockH, 'F')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...t.text)
      doc.text(`(${n.num})  ${(n.trainee?.last_name || '').toUpperCase()} ${n.trainee?.first_name || ''}`, M + 5, y + 7)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
      doc.text(`Demi-journée : ${formatDate(n.date)}, ${n.period === 'morning' ? 'matin' : 'après-midi'}`, M + 5, y + 13)
      doc.text(`Motif : ${n.reason || ''}`, M + 5, y + 18)
      doc.text(`Signataire : ${n.proxy_first_name || ''} ${(n.proxy_last_name || '').toUpperCase()}${n.proxy_role ? ', ' + n.proxy_role : ''}`, M + 5, y + 23)
      doc.setFontSize(7); doc.setTextColor(...t.muted)
      const sigW = 58
      const sigX1 = pw - M - sigW * 2 - 8
      const sigX2 = pw - M - sigW - 3
      doc.text("Le participant n'étant pas en mesure de signer, la signature a été recueillie par la personne ci-dessus, en présence du formateur.", M + 5, y + 29, { maxWidth: sigX1 - M - 12 })
      doc.setTextColor(...t.text)

      doc.setFontSize(6.5); doc.setTextColor(...t.muted)
      doc.text('SIGNATURE DU TIERS', sigX1, y + 6, { charSpace: 0.3 })
      doc.text('CONTRESIGNATURE DU FORMATEUR', sigX2, y + 6, { charSpace: 0.3 })
      doc.setDrawColor(...t.line); doc.setLineWidth(0.25)
      doc.rect(sigX1, y + 8, sigW, 24)
      doc.rect(sigX2, y + 8, sigW, 24)
      drawImageFitted(doc, n.proxy_signature, sigX1 + 1, y + 9, sigW - 2, 22)
      drawImageFitted(doc, n.trainer_signature, sigX2 + 1, y + 9, sigW - 2, 22)
      doc.setTextColor(...t.text)
      y += blockH + 5
    })

    drawFooter(doc, ORG, CODE)
  }

  return doc
}

// ============================================================
// ATTESTATION DE PRÉSENCE (document seul). Contenu : generateAttestationContent.
// ============================================================
function generateAttestation(session, trainee, trainer = null) {
  const doc = new jsPDF({ compress: true })
  generateAttestationContent(doc, session, trainee, trainer)
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
        const objTitleLines = doc.splitTextToSize(` ${obj.text}`, 160)
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
  doc.text(`Fait à : ${ORG.lieu_signature || ''}`, 20, y); y += 6
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
          const optText = isCorrige && isCorrect ? `${opt} ` : opt
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
  if (ORG.reglement_interieur && ORG.reglement_interieur.trim()) {
    // Texte saisi dans Paramètres : paragraphes séparés par une ligne vide, titres = lignes courtes sans point
    const ph = doc.internal.pageSize.getHeight()
    ORG.reglement_interieur.trim().split(/\n{2,}/).forEach((para) => {
      const isTitle = para.length < 80 && !para.includes('\n') && !/[.:;]$/.test(para.trim())
      doc.setFont('helvetica', isTitle ? 'bold' : 'normal')
      const lines = doc.splitTextToSize(para.trim(), 170)
      if (y + lines.length * 4 > ph - 30) { addFooter(doc, DOC_CODES.reglement); doc.addPage(); y = addHeader(doc) }
      lines.forEach((l) => { doc.text(l, 20, y); y += 4 })
      y += isTitle ? 1 : 5
    })
    addFooter(doc, DOC_CODES.reglement)
    return doc
  }
  const sections = [
    { title: 'Article 1 - Objet et champ d\'application', text: 'Le présent règlement est établi conformément aux articles L.6352-3 et L.6352-4 du Code du travail. Il s\'applique à tous les stagiaires participant aux formations dispensées par ' + (ORG.name || 'l\'organisme') + '.' },
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
  doc.text(`Bienvenue chez ${ORG.name} !`, 20, y)
  y += 10
  if (ORG.livret_accueil && ORG.livret_accueil.trim()) {
    const ph = doc.internal.pageSize.getHeight()
    ORG.livret_accueil.trim().split(/\n{2,}/).forEach((para) => {
      const isTitle = para.length < 80 && !para.includes('\n') && !/[.:;]$/.test(para.trim())
      doc.setFont('helvetica', isTitle ? 'bold' : 'normal')
      const lines = doc.splitTextToSize(para.trim(), 170)
      if (y + lines.length * 4.5 > ph - 30) { addFooter(doc, DOC_CODES.livret); doc.addPage(); y = addHeader(doc, session?.reference) }
      lines.forEach((l) => { doc.text(l, 20, y); y += 4.5 })
      y += isTitle ? 1 : 5
    })
    addFooter(doc, DOC_CODES.livret)
    return doc
  }
  const sections = [
    { title: 'Qui sommes-nous ?', text: `${ORG.nameFull || ORG.name}.` },
    { title: 'Vos interlocuteurs', text: `Responsable : ${ORG.dirigeant}\nContact : ${ORG.phone} - ${ORG.email}` },
    { title: 'Déroulement de la formation', text: session?.start_time && session?.end_time ? `Horaires : ${String(session.start_time).slice(0, 5)} - ${String(session.end_time).slice(0, 5)} (pauses en milieu de matinée et d'après-midi)` : 'Les horaires sont indiqués sur votre convocation.' },
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
  doc.text(`Signature ${ORG.name} :`, 110, y)
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
  
  // N° Sécurité sociale - jamais imprimé (INRS) : seule la mention figure ici.
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
  doc.text(`J'accepte que mes données soient traitées par ${ORG.name} dans le cadre de cette formation (RGPD).`, 17, y)
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
          const portalURL = `${publicBaseUrl()}/#/portail/${session.attendance_token}`
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
    const portalURL = `${publicBaseUrl()}/#/portail/${session.attendance_token}`
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
          const portalURL = `${publicBaseUrl()}/#/portail/${session.attendance_token}`
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
    const portalURL = `${publicBaseUrl()}/#/portail/${session.attendance_token}`
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
  
  doc.text(`Fait à : ${ORG.lieu_signature || ''}`, 20, y); y += 6
  doc.text(`Le : ${formatDate(session?.end_date || new Date())}`, 20, y); y += 10
  
  doc.text('Cachet et signature du responsable du dispensateur de formation :', 20, y); y += 5
  try { doc.addImage(ORG.stamp_base64, 'JPEG', 20, y, 50, 18) } catch {}
  const sigLines2 = doc.splitTextToSize(`${ORG.dirigeant}, Dirigeant ${ORG.name}`, pw - 75 - 15)
  doc.text(sigLines2, 75, y + 8)
  
  addFooter(doc, DOC_CODES.certificat)
}

// ============================================================
// CONVOCATION ET ATTESTATION DE PRÉSENCE
// Mise en page : core/pdf/layout.js (comme la convention et l'émargement).
// Une page par stagiaire ; ces fonctions dessinent sur un document existant (envoi groupé).
// Aucune donnée d'organisme en dur : tout vient de ORG.
// ============================================================

// Texte des dates : « Le vendredi 16 octobre 2026 » ou « Du ... au ... »
function sessionDatesText(session) {
  const s = session?.start_date, e = session?.end_date
  if (!s) return ''
  if (!e || s === e) return `Le ${formatDateLong(s)}`
  return `Du ${formatDateLong(s)} au ${formatDateLong(e)}`
}

function courseHoursText(course) {
  const hours = parseFloat(course?.duration_hours || course?.duration || 7)
  const nbDays = parseInt(course?.duration_days, 10) || 1
  return `${hours.toLocaleString('fr-FR')} heures${nbDays > 1 ? ` sur ${nbDays} jours` : ''}`
}

function trainerName(trainer) {
  return trainer ? `${trainer.first_name || ''} ${trainer.last_name || ''}`.trim() : ORG.dirigeant
}

// Aide de mise en page pour les documents d'une page avec débordement éventuel
function pageFlow(doc, { ref, docLabel, code, startY }) {
  const t = T()
  const M = PAGE_MARGIN
  const W = doc.internal.pageSize.getWidth() - M * 2
  const BOTTOM = 278
  const LINE = 4.1
  const f = { y: startY, M, W, LINE, t }
  f.body = (size = 9) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...t.text) }
  f.ensure = (h) => {
    if (f.y + h > BOTTOM) {
      drawFooter(doc, ORG, code)
      doc.addPage()
      f.y = drawRunningHeader(doc, ORG, { ref, docLabel })
    }
  }
  f.para = (text, { x = M, w = W, size = 9, after = 2.5, style = 'normal', color = null } = {}) => {
    f.body(size)
    const lines = doc.splitTextToSize(text, w)
    f.ensure(lines.length * LINE)
    f.body(size); doc.setFont('helvetica', style); if (color) doc.setTextColor(...color)
    lines.forEach(l => { doc.text(l, x, f.y); f.y += LINE })
    f.y += after
    doc.setTextColor(...t.text)
  }
  f.bullets = (items, { x = M, w = W } = {}) => {
    items.forEach(it => {
      f.body(9)
      const lines = doc.splitTextToSize(it, w - 5)
      f.ensure(lines.length * LINE)
      f.body(9)
      doc.setFillColor(...t.highlight); doc.circle(x + 1.5, f.y - 1.1, 0.7, 'F')
      lines.forEach(l => { doc.text(l, x + 5, f.y); f.y += LINE })
    })
    f.y += 2
  }
  f.section = (label) => { f.ensure(8 + LINE * 2); f.y = drawSectionTitle(doc, ORG, label, f.y) }
  f.kv = (rows) => {
    // Hauteur estimée pour ne pas couper le tableau au milieu d'une ligne
    rows.forEach(r => {
      const h = Math.max(1, doc.splitTextToSize(String(r[1] ?? ''), W - 34).length) * 4 + 2.6
      f.ensure(h)
      f.y = drawKeyValues(doc, ORG, M, f.y, W, [r]) - 1
    })
    f.y += 1
  }
  return f
}

function generateConvocationContent(doc, session, trainee, trainer, qrCodeDataURL = null) {
  const course = session?.courses || {}
  const client = session?.clients || {}
  const ref = session?.reference || ''
  const lieu = getLocation(session)
  const CODE = DOC_CODES.convocation
  const docLabel = 'Convocation'
  const M = PAGE_MARGIN
  const W = doc.internal.pageSize.getWidth() - M * 2

  let y = drawHeaderBand(doc, ORG, { ref, docLabel })
  y = drawDocTitle(doc, ORG, 'Convocation à la formation', sessionDatesText(session), y)
  const f = pageFlow(doc, { ref, docLabel, code: CODE, startY: y })
  const t = f.t

  // ── Destinataire et contacts ──
  const civilite = trainee?.gender === 'female' ? 'Madame' : (trainee?.gender === 'male' ? 'Monsieur' : '')
  const fullName = [civilite, trainee?.first_name, (trainee?.last_name || '').toUpperCase()].filter(Boolean).join(' ')
  const gap = 6
  const colW = (W - gap) / 2
  const contact = getSessionContact(session)
  const stagLines = [fullName, trainee?.job_title || '', client.name || ''].filter(Boolean)
  const contactLines = [
    ORG.name,
    [ORG.phone, ORG.email].filter(Boolean).join('   '),
    contact.name ? `Entreprise : ${contact.name}${contact.role ? ', ' + contact.role : ''}` : '',
  ].filter(Boolean)
  while (stagLines.length < contactLines.length) stagLines.push('')
  while (contactLines.length < stagLines.length) contactLines.push('')
  const y1 = drawPartyCard(doc, ORG, M, f.y, colW, 'Stagiaire convoqué', stagLines)
  const y2 = drawPartyCard(doc, ORG, M + colW + gap, f.y, colW, 'Vos contacts', contactLines)
  f.y = Math.max(y1, y2) + 7

  f.para('Merci de vous présenter à la session de formation selon les informations suivantes. Pour toute question, vos contacts sont indiqués ci-dessus.', { after: 2 })

  // ── La formation ──
  f.section('La formation')
  const horaires = session?.start_time ? `De ${formatHour(session.start_time)} à ${formatHour(session?.end_time)}` : ''
  f.kv([
    ['Intitulé', course.title || ''],
    ['Dates', sessionDatesText(session)],
    ['Horaires', horaires],
    ['Durée', courseHoursText(course)],
    ['Lieu', lieu || 'Communiqué ultérieurement'],
    ['Formateur', trainerName(trainer)],
  ])
  const objectifs = (course.objectives || '').split('\n').map(s => s.trim()).filter(Boolean)
  if (objectifs.length) {
    f.y += 3
    f.ensure(5 + f.LINE * 2)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...t.muted)
    doc.text('OBJECTIFS', M, f.y, { charSpace: 0.2 })
    f.y += 4.5
    f.bullets(objectifs)
  }

  // ── À prévoir ──
  f.section('À prévoir')
  f.bullets([
    "Votre pièce d'identité",
    'Votre numéro de sécurité sociale',
    "Une tenue adaptée et le matériel indiqué par le formateur, le cas échéant",
    ...(course.material ? [`Matériel : ${course.material}`] : []),
  ])

  // ── Portail stagiaire (QR code) ──
  const qrSize = 28
  const portalTxt = "Avant la formation, scannez le QR code pour accéder au portail stagiaire et compléter votre fiche de renseignements et votre test de positionnement. Le jour de la formation, votre présence est enregistrée par demi-journée depuis ce même portail (ou sur feuille papier en cas d'indisponibilité du réseau)."
  const textW = qrCodeDataURL ? W - qrSize - 14 : W - 8
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  const pLines = doc.splitTextToSize(portalTxt, textW)
  const boxH = Math.max(qrCodeDataURL ? qrSize + 11 : 0, 12 + pLines.length * 4.2 + 3)
  f.ensure(boxH + 2)
  const by = f.y
  doc.setFillColor(...t.surface); doc.rect(M, by, W, boxH, 'F')
  doc.setFillColor(...t.accent); doc.rect(M, by, 1.2, boxH, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...t.accent)
  doc.text('PORTAIL STAGIAIRE ET ÉMARGEMENT', M + 4, by + 5.5, { charSpace: 0.4 })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...t.text)
  pLines.forEach((l, i) => doc.text(l, M + 4, by + 11.5 + i * 4.2))
  if (qrCodeDataURL) {
    const qx = M + W - qrSize - 5
    const qy = by + 4
    doc.setFillColor(255, 255, 255); doc.rect(qx - 1.5, qy - 1.5, qrSize + 3, qrSize + 3, 'F')
    try { doc.addImage(qrCodeDataURL, 'PNG', qx, qy, qrSize, qrSize) } catch (err) { console.error('QR code non inséré :', err) }
    doc.setFontSize(7); doc.setTextColor(...t.muted)
    if (trainee?.access_code) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...t.text)
      doc.text(`Code : ${trainee.access_code}`, qx + qrSize / 2, qy + qrSize + 5, { align: 'center' })
    } else {
      doc.text('Scannez avec votre téléphone', qx + qrSize / 2, qy + qrSize + 5, { align: 'center' })
    }
    doc.setTextColor(...t.text)
  }
  f.y = by + boxH + 6

  // ── Accessibilité, contact, ponctualité ──
  const handi = ORG.referent_handicap_email ? `au référent handicap (${ORG.referent_handicap_email})` : `à ${ORG.email}`
  f.para(`Accessibilité : en cas de besoins spécifiques (mobilité, audition, vision ou autre), merci de nous en informer ${handi} au moins 72 heures avant la formation.`)
  f.ensure(f.LINE + 12) // la formule de fin reste avec la signature
  f.para('Nous vous remercions pour votre ponctualité et votre participation active.', { after: 4 })

  // ── Signature : lieu et date à gauche, signataire à droite ──
  f.ensure(8)
  f.body(9)
  doc.text(`Fait à ${ORG.lieu_signature || ORG.city}, le ${formatDate(new Date())}.`, M, f.y)
  const rx = M + W
  if (ORG.dirigeant_signature_base64) drawImageFitted(doc, ORG.dirigeant_signature_base64, rx - 75, f.y - 6, 28, 12)
  doc.setFont('helvetica', 'bold'); doc.text(ORG.dirigeant || '', rx, f.y, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setTextColor(...t.muted)
  doc.text([ORG.dirigeant_title, ORG.name].filter(Boolean).join(', '), rx, f.y + 4.5, { align: 'right' })
  doc.setTextColor(...t.text)

  drawFooter(doc, ORG, CODE)
}

// Champs de présence éventuellement portés directement par l'objet stagiaire
function pickPresence(t) {
  const out = {}
  ;['early_departure', 'departure_date', 'departure_time', 'arrival_date', 'arrival_time', 'presence_hours'].forEach(k => {
    if (t && t[k] !== undefined && t[k] !== null) out[k] = t[k]
  })
  return out
}

function generateAttestationContent(doc, session, trainee, trainer) {
  const course = session?.courses || {}
  const client = session?.clients || {}
  const ref = session?.reference || ''
  const lieu = getLocation(session)
  const CODE = DOC_CODES.attestation
  const docLabel = 'Attestation de présence'
  const M = PAGE_MARGIN
  const W = doc.internal.pageSize.getWidth() - M * 2

  let y = drawHeaderBand(doc, ORG, { ref, docLabel })
  y = drawDocTitle(doc, ORG, 'Attestation de présence', null, y)
  const f = pageFlow(doc, { ref, docLabel, code: CODE, startY: y + 2 })
  const t = f.t

  f.para(`Je soussigné, ${ORG.dirigeant}${ORG.dirigeant_title ? ', ' + ORG.dirigeant_title : ''}, représentant l'organisme de formation ${ORG.nameFull || ORG.name}${ORG.ndaFull ? (/^\d/.test(ORG.ndaFull) ? ` (déclaration d'activité n° ${ORG.ndaFull})` : ` (numéro de déclaration d'activité ${ORG.ndaFull})`) : ''}, atteste que :`, { size: 10, after: 5 })

  const fullName = `${trainee?.first_name || ''} ${(trainee?.last_name || '').toUpperCase()}`.trim()
  const lines = [fullName, client.name ? `Entreprise : ${client.name}` : ''].filter(Boolean)
  f.y = drawPartyCard(doc, ORG, M, f.y, W, 'Stagiaire', lines) + 8

  f.para("a participé à l'action de formation suivante :", { size: 10, after: 3 })
  const horaires = session?.start_time ? `De ${formatHour(session.start_time)} à ${formatHour(session?.end_time)}` : ''
  // Présence : du début à la fin, sauf arrivée tardive ou départ anticipé notés sur la session
  const st = { ...((session?.session_trainees || []).find(x => x.trainee_id === trainee?.id) || {}), ...pickPresence(trainee) }
  const calc = computePresenceHours(session, course, st)
  const hours = st.presence_hours != null && (st.early_departure || st.arrival_time) ? Number(st.presence_hours) : calc.hours
  const notes = []
  if (st.arrival_time && st.arrival_date) notes.push(`arrivée le ${formatDate(st.arrival_date)} à ${formatHour(st.arrival_time)}`)
  if (st.early_departure && st.departure_date) notes.push(`départ le ${formatDate(st.departure_date)}${st.departure_time ? ` à ${formatHour(st.departure_time)}` : ''}`)
  f.kv([
    ['Intitulé', course.title || ''],
    ['Dates', sessionDatesText(session)],
    ['Horaires', horaires],
    ['Durée totale', courseHoursText(course)],
    ['Lieu', lieu],
    ['Formateur', trainerName(trainer)],
    ['Présence', `${formatHours(hours)}${notes.length ? ` (${notes.join(', ')})` : ''}`],
  ])
  f.y += 6
  f.para('Fait pour servir et valoir ce que de droit.', { size: 10, after: 6 })

  // ── Signature ──
  const colW = (W - 6) / 2
  const boxH = 38
  f.ensure(boxH + 10)
  f.body(9)
  doc.text(`Fait à ${ORG.lieu_signature || ORG.city}, le ${formatDate(session?.end_date || new Date())}.`, M, f.y)
  f.y += 6
  const by = f.y
  doc.setDrawColor(...t.line); doc.setLineWidth(0.3); doc.rect(M, by, colW, boxH)
  doc.setFillColor(...t.surface); doc.rect(M, by, colW, 11, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...t.accent)
  doc.text("POUR L'ORGANISME DE FORMATION", M + 4, by + 4.5, { charSpace: 0.4 })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...t.text)
  doc.text(`${ORG.dirigeant || ''}${ORG.dirigeant_title ? ', ' + ORG.dirigeant_title : ''}`, M + 4, by + 8.8)
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(...t.muted)
  doc.text('Signature et cachet', M + 4, by + boxH - 3)
  if (ORG.stamp_base64) drawImageFitted(doc, ORG.stamp_base64, M + 6, by + 13, 44, 19, 'JPEG')
  if (ORG.dirigeant_signature_base64) drawImageFitted(doc, ORG.dirigeant_signature_base64, M + 52, by + 14, 30, 17)
  doc.setTextColor(...t.text)

  drawFooter(doc, ORG, CODE)
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
