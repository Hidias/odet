import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { format, eachDayOfInterval, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'
import QRCode from 'qrcode'
import { lienEspaceClient, dessinerEncadreEnLigne, hauteurEncadreEnLigne } from '../../../core/portail/lienEspace'
import { chargerRegimeTva, regimeTva } from '../../../core/billing/regimeTva'
import { mot, leMot } from '../../../core/genre'
import { buildORG, publicBaseUrl, prepareOrgForPDF, formatSiret, ligneNda, phraseNda } from '../../../core/org/orgUtils'
import {
  PAGE_MARGIN, drawHeaderBand, drawRunningHeader, drawFooter, numberPages, drawDocTitle, drawSectionTitle,
  drawPartyCard, drawKeyValues, drawCheckmark, drawImageFitted, formatMoney, formatHour,
  startDocument,
} from '../../../core/pdf/layout'

import { APP_VERSION } from '../../../core/version'
import { loadPublishedDoc, versionLabel, cgvCancellationText } from '../../qualite/richdocs/published'
import { writeRichDoc } from '../../qualite/richdocs/richDocPDF'
import { loadTemplateContext, buildTemplateContext, fillTemplate } from '../../../core/org/templateContext'
import { formatHours, heuresDuDocument } from '../lib/presence'
import { libelleAcquis } from '../lib/finFormation'
import { ajouterPagePreuve } from '../../../core/signature/preuve'
import { marquerZoneSignature } from '../../../core/signature/zone'
import { buildProgrammePDF, buildCataloguePDF } from './programmePDF'
import { pictogrammePNG } from './pictogrammes'
// Codes documentaires : préfixe propre à l'organisme (ORG.doc_prefix) + code du type de document
const DOC_CODES = {
  convention: 'CONV', convocation: 'CONVOC', attestation: 'ATTP',
  certificat: 'CERT', emargement: 'EMARG', programme: 'PROG',
  evaluation: 'EVAL', evaluationFroid: 'EVALF', reglement: 'RI',
  livret: 'LIVRET', analyseBesoin: 'BESOIN', evaluationFormateur: 'EVFORM',
  positionnement: 'POS', fin_formation: 'AFF',
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

// Textes remis aux stagiaires et aux clients (règlement intérieur, livret d'accueil, annulation des CGV) :
// une seule source, Documents qualité (version validée, sinon brouillon, sinon modèle). Chargés avant
// chaque génération par ensureQualityTexts().
let QT = null
async function ensureQualityTexts() {
  try {
    const [reglement, livret, cgv, ctxLoaded] = await Promise.all([
      loadPublishedDoc('reglement'), loadPublishedDoc('livret-court'), loadPublishedDoc('cgv'),
      loadTemplateContext().catch(() => null),
    ])
    // Portail (sans accès aux paramètres) : identité prise dans ORG
    let ctx = ctxLoaded
    if (!ctx?.org?.nom) {
      ctx = buildTemplateContext({ org: { name: ORG.name, legal_name: ORG.legal_name || ORG.name, address: ORG.street || ORG.address, postal_code: ORG.postal_code, city: ORG.city, phone: ORG.phone, email: ORG.email, siret: ORG.siret, nda: ORG.nda, nda_region: ORG.nda_region, dirigeant_name: ORG.dirigeant, dirigeant_title: ORG.dirigeant_title, dirigeant_gender: ORG.dirigeant_gender, lieu_signature: ORG.lieu_signature, tribunal_competent: ORG.tribunal_competent } })
    }
    QT = { reglement, livret, cgv, ctx }
  } catch (err) { console.warn('Documents qualité indisponibles :', err.message) }
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


// Dessine un carré vide (pour les choix multiples)


// Alias pour compatibilité


// ============================================================
// HEADER AVEC LOGO
// ============================================================






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
// particulier (lot 2, 0044) : { group, client } pour le contrat de formation d'un particulier qui paie lui-même
// (session inter) : mentions des articles L6353-4 à L6353-7 du Code du travail [OFFICIEL, consultés le 14/10/2026],
// rétractation de 10 jours, aucune somme avant la fin du délai puis 30 % au plus, solde échelonné.
function generateConvention(session, trainees = [], trainer = null, costs = [], particulier = null, enLigne = null) {
  const doc = new jsPDF({ compress: true })
  const pw = doc.internal.pageSize.getWidth()
  const M = PAGE_MARGIN
  const W = pw - M * 2
  const t = T()
  const P = particulier && particulier.client ? particulier : null
  const client = P ? P.client : (session?.clients || {})
  const course = session?.courses || {}
  const ref = session?.reference || ''
  const lieu = getLocation(session)
  const signatory = P ? { name: client.name, role: '' } : getSessionSignatory(session)
  const CODE = DOC_CODES.convention
  const docLabel = P ? 'Contrat de formation' : 'Convention de formation'

  let y = drawHeaderBand(doc, ORG, { ref, docLabel })
  y = P
    ? drawDocTitle(doc, ORG, 'Contrat de formation professionnelle', 'Articles L6353-3 à L6353-7 du Code du travail', y)
    : drawDocTitle(doc, ORG, 'Convention de formation professionnelle', 'Articles L6353-1 et D6353-1 du Code du travail', y)

  // ── Les parties, côte à côte ──
  const gap = 6
  const colW = (W - gap) / 2
  const ofLines = [
    ORG.nameFull || ORG.name,
    ORG.address,
    `SIRET ${ORG.siret}`,
    ligneNda(ORG),
    `Représenté par ${ORG.dirigeant}${ORG.dirigeant_title ? ', ' + ORG.dirigeant_title : ''}`,
  ]
  const clientAddr = [client.address, [client.postal_code, client.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const benefLines = P ? [
    client.name || '',
    clientAddr,
    [client.email || client.contact_email, client.phone || client.contact_phone].filter(Boolean).join(' · '),
    'Personne physique, à titre individuel et à ses frais',
  ] : [
    client.name || '',
    clientAddr,
    client.siret ? `SIRET ${formatSiret(client.siret)}` : 'SIRET non renseigné',
    `Représenté par ${signatory.name || ''}${signatory.role ? ', ' + signatory.role : ''}`,
  ]
  while (benefLines.length < ofLines.length) benefLines.push('')
  const y1 = drawPartyCard(doc, ORG, M, y, colW, "L'organisme de formation", ofLines, "ci-après « l'Organisme de formation »")
  const y2 = P
    ? drawPartyCard(doc, ORG, M + colW + gap, y, colW, 'Le stagiaire', benefLines, 'ci-après « le Stagiaire »')
    : drawPartyCard(doc, ORG, M + colW + gap, y, colW, 'Le bénéficiaire', benefLines, 'ci-après « le Bénéficiaire »')
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
    [mot('formateur', trainer ? trainer.gender : ORG.dirigeant_gender, { majuscule: true }), trainer ? `${trainer.first_name} ${trainer.last_name}${P && (trainer.qualifications || trainer.certifications) ? ` (${trainer.qualifications || trainer.certifications})` : ''}` : ORG.dirigeant],
  ]
  if (P) rows.push(['Évaluation', course.evaluation_methods || 'Évaluation des acquis en fin de formation'])
  if (session?.funding_type && session.funding_type !== 'none') {
    rows.push(['Financement', `${fundingLabels[session.funding_type] || session.funding_type}${session.funding_details ? ` (${session.funding_details})` : ''}`])
  }
  y = drawKeyValues(doc, ORG, M, y, W, rows)
  y += 8

  // ── Coûts ──
  const coutFormationHT = P && parseFloat(P.group?.price_total)
    ? parseFloat(P.group.price_total)
    : P && parseFloat(P.group?.price_per_person) ? parseFloat(P.group.price_per_person) * Math.max(1, trainees.length)
      : parseFloat(session?.total_price || course.price_ht || course.price_per_day || 0)
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
  // Régime de TVA de l'organisme (réglages, 0363) : franchise, exonération de la formation, sinon TVA en sus
  const R = regimeTva()
  const tvaNote = ORG.tva_applicable === false ? (R.mentions.franchise || 'Organisme non assujetti à la TVA.')
    : R.exoFormation ? (R.mentions.exoneration || 'Formation exonérée de TVA.') : 'TVA en sus au taux en vigueur.'
  const bankNote = ORG.iban ? ` (IBAN ${ORG.iban}${ORG.bic ? `, BIC ${ORG.bic}` : ''})` : ''
  const art3 = P ? [
    { kv },
    { p: `${tvaNote} Aucune somme ne peut être exigée du Stagiaire avant l'expiration du délai de rétractation. À son expiration, il ne peut être payé plus de 30 % du prix convenu ; le solde est payé au fur et à mesure du déroulement de la formation (article L6353-6 du Code du travail). Règlement par virement bancaire${bankNote}.` },
    { p: "Si, par suite de force majeure dûment reconnue, le Stagiaire est empêché de suivre la formation, il peut rompre le contrat : seules les prestations effectivement dispensées sont dues, au prorata temporis de leur valeur prévue au contrat (article L6353-7 du Code du travail). En cas d'inexécution totale ou partielle du fait de l'Organisme de formation, celui-ci rembourse les sommes indûment perçues (article L6354-1)." },
  ] : [
    { kv },
    { p: `${tvaNote} Règlement par virement bancaire à réception de facture${bankNote}. Aucun acompte n'est demandé avant la formation.` },
    { p: "En cas d'inexécution totale ou partielle de la prestation, l'Organisme de formation rembourse au Bénéficiaire les sommes indûment perçues (article L6354-1 du Code du travail)." },
  ]

  const objectifs = (course.objectives || '').split('\n').map(s => s.trim()).filter(Boolean)
  // Contenu de l'action (article D6353-1 : intitulé, objectifs et contenu), repris de la fiche formation ; le programme
  // détaillé est remis avec la convention ou le contrat
  const contenu = String(course.content || course.program || '').split('\n').map(s => s.replace(/^[-•*\s]+/, '').trim()).filter(Boolean).slice(0, 20)
  const blocsContenu = contenu.length ? [{ p: 'Contenu de la formation :' }, { list: contenu }] : []
  // Numéro de déclaration d'activité, sous la forme demandée sur les conventions et contrats : « Enregistré sous le
  // numéro … auprès du préfet de la région … » (la mention « en cours » figure dans les parties tant qu'il n'est pas attribué)
  const numeroOfficiel = ligneNda(ORG) && !/en cours/.test(ligneNda(ORG))
    ? [{ p: `L'Organisme de formation est enregistré sous le numéro ${ORG.ndaFull || ORG.nda}. Cet enregistrement ne vaut pas agrément de l'État.` }] : []
  // Session inter : réserve de maintien de l'organisme (0419, saisie une fois dans les paramètres)
  const maintien = session?.session_type === 'inter' && ORG.mention_maintien
    ? [{ title: 'Maintien de la session', blocks: [{ p: ORG.mention_maintien }] }] : []
  const articles = P ? [
    { title: 'Objet, nature, durée et effectif', blocks: [
      { p: `Le Stagiaire s'inscrit à l'action de formation « ${course.title || ''} » (action de formation au sens de l'article L6313-1 du Code du travail), d'une durée de ${dureeTxt}, ${datesTxt.charAt(0).toLowerCase() + datesTxt.slice(1)}, organisée en session inter-entreprises.` },
      ...(objectifs.length ? [{ p: "À l'issue de la formation, le Stagiaire sera capable de :" }, { list: objectifs }] : []),
      ...blocsContenu,
      { p: `Prérequis : ${course.prerequisites || 'aucun'}. Le programme détaillé est remis avec le présent contrat et en fait partie.` },
      ...numeroOfficiel,
    ] },
    ...maintien,
    { title: 'Délai de rétractation', blocks: [{ p: "À compter de la signature du présent contrat, le Stagiaire dispose d'un délai de dix jours pour se rétracter, par lettre recommandée avec avis de réception adressée à l'Organisme de formation. Dans ce cas, aucune somme ne peut être exigée du Stagiaire (article L6353-5 du Code du travail)." }] },
    { title: 'Engagements des parties', blocks: [{ p: "Le Stagiaire s'engage à suivre la formation avec assiduité et à signer les feuilles d'émargement. L'Organisme de formation s'engage à mettre en oeuvre les moyens pédagogiques, techniques et d'encadrement nécessaires pour atteindre les objectifs visés et à délivrer les documents de fin de formation." }] },
    { title: 'Dispositions financières', blocks: art3 },
    { title: 'Moyens, modalités pédagogiques et intervenants', blocks: [
      { p: course.methods || course.teaching_methods || course.pedagogical_methods || "La formation est dispensée selon une approche active et participative, combinant apports théoriques, mises en situation pratiques et évaluations formatives continues." },
      ...(course.trainer_equipment ? [{ p: `Moyens techniques : ${course.trainer_equipment}` }] : []),
      ...(course.material ? [{ p: `À prévoir par le Stagiaire : ${course.material}` }] : []),
      { p: `Intervenant : ${trainer ? `${trainer.first_name} ${trainer.last_name}${trainer.qualifications || trainer.certifications ? `, ${trainer.qualifications || trainer.certifications}` : ''}` : (ORG.dirigeant || "formateur de l'Organisme")}.` },
    ] },
    { title: "Modalités d'évaluation et documents délivrés", blocks: [
      { p: course.evaluation_methods || "Les acquis sont évalués en fin de formation selon le référentiel applicable." },
      { p: "À l'issue de la formation, l'Organisme de formation remet une attestation de fin de formation et un certificat de réalisation." },
    ] },
    { title: 'Accessibilité', blocks: [{ p: `${ORG.name} s'engage à favoriser l'accès à ses formations aux personnes en situation de handicap. Toute demande d'adaptation est à signaler en amont${ORG.referent_handicap_email ? ` au référent handicap (${ORG.referent_handicap_email})` : ` à ${ORG.email}`}.` }] },
    { title: 'Protection des données', blocks: [{ p: "Les données personnelles du Stagiaire sont utilisées exclusivement pour la gestion administrative et pédagogique de la formation, conservées 5 ans et accessibles sur demande, conformément au RGPD." }] },
    { title: 'Litiges', blocks: [{ p: `En cas de différend, les parties recherchent une solution amiable ; le Stagiaire peut recourir gratuitement à un médiateur de la consommation. À défaut, le litige est porté devant ${ORG.tribunal_competent ? `le ${ORG.tribunal_competent}` : 'le tribunal compétent'}.` }] },
  ] : [
    { title: 'Objet, durée et effectif', blocks: [
      { p: `Le Bénéficiaire confie à l'Organisme de formation la réalisation de l'action « ${course.title || ''} », d'une durée de ${dureeTxt}, ${datesTxt.charAt(0).toLowerCase() + datesTxt.slice(1)}, pour ${trainees.length} participant${trainees.length > 1 ? 's' : ''}.` },
      ...(objectifs.length ? [{ p: "À l'issue de la formation, les participants seront capables de :" }, { list: objectifs }] : []),
      ...blocsContenu,
      { p: 'Le programme détaillé est remis avec la présente convention et en fait partie.' },
      ...(trainees.length ? [{ p: 'Participants désignés par le Bénéficiaire :' }, { list: trainees.map(tr => `${(tr.last_name || '').toUpperCase()} ${tr.first_name || ''}`), cols: 2 }] : []),
      ...numeroOfficiel,
    ] },
    { title: 'Engagements des parties', blocks: [{ p: "Le Bénéficiaire s'engage à assurer la présence des participants inscrits et à fournir les moyens nécessaires à la réalisation de la formation (salle, matériel, conditions d'accueil). L'Organisme de formation s'engage à mettre en oeuvre les moyens pédagogiques, techniques et d'encadrement nécessaires pour atteindre les objectifs visés." }] },
    { title: 'Dispositions financières', blocks: art3 },
    { title: 'Moyens et modalités pédagogiques', blocks: [
      // Moyens de la formation choisie (fiche formation), sinon la description générale ; intervenant nommé
      { p: course.methods || course.teaching_methods || course.pedagogical_methods || "La formation est dispensée selon une approche active et participative, combinant apports théoriques, mises en situation pratiques et évaluations formatives continues. Les supports pédagogiques sont adaptés aux objectifs de la formation et au public accueilli." },
      ...(course.trainer_equipment ? [{ p: `Moyens techniques : ${course.trainer_equipment}` }] : []),
      ...(course.material ? [{ p: `À prévoir par les participants : ${course.material}` }] : []),
      { p: `Intervenant : ${trainer ? `${trainer.first_name} ${trainer.last_name}${trainer.qualifications || trainer.certifications ? `, ${trainer.qualifications || trainer.certifications}` : ''}` : (ORG.dirigeant || "formateur de l'Organisme")}.` },
      { p: "La présence des participants est attestée par un émargement dématérialisé par QR code individuel, ou sur support papier en cas d'indisponibilité du réseau. Un émargement est réalisé par demi-journée, signé par chaque participant et contresigné par le formateur." },
    ] },
    { title: "Modalités de suivi et d'évaluation", blocks: [
      { p: "Un positionnement préalable est réalisé en amont de la formation afin d'adapter le déroulé pédagogique au niveau et aux besoins de chaque participant. Tout au long de la formation, des évaluations formatives mesurent la progression des acquis. En fin de parcours, une évaluation sommative est conduite selon le référentiel applicable." },
      { p: "Un certificat de réalisation mentionnant le niveau d'atteinte des objectifs est remis à l'issue de la formation." },
    ] },
    { title: 'Documents délivrés', blocks: [{ p: "À l'issue de la formation, l'Organisme de formation délivre une attestation de présence, un certificat de réalisation (acquis / non acquis) et, le cas échéant, l'attestation ou le certificat propre au module suivi." }] },
    ...maintien,
    { title: 'Annulation et report', blocks: [{ p: (QT?.cgv && cgvCancellationText(QT.cgv.content) ? `Conformément aux articles 8 et 9 des conditions générales de vente. ${fillTemplate(cgvCancellationText(QT.cgv.content), QT.ctx)}` : "En cas d'annulation ou de report, les conditions générales de vente de l'Organisme de formation s'appliquent.") }] },
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
  // Convention signée en ligne (0402) : datée du jour de la signature du client
  const sigC = session?.signature_client || null
  doc.text(`Fait en deux exemplaires à ${ORG.lieu_signature || ORG.city}, le ${formatDate(sigC?.signed_at || new Date())}.`, M, y)
  y += 7
  const boxH = 34
  const sigCol = (x, label, l1, l2, hint = 'Signature et cachet') => {
    doc.setDrawColor(...t.line); doc.setLineWidth(0.3)
    doc.rect(x, y, colW, boxH)
    doc.setFillColor(...t.surface); doc.rect(x, y, colW, 11, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...t.accent)
    doc.text(label.toUpperCase(), x + 4, y + 4.5, { charSpace: 0.4 })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...t.text)
    doc.text(`${l1 || ''}${l2 ? ', ' + l2 : ''}`, x + 4, y + 8.8)
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(...t.muted)
    doc.text(hint, x + 4, y + boxH - 3)
    doc.setTextColor(...t.text)
  }
  sigCol(M, "Pour l'organisme de formation", ORG.dirigeant, ORG.dirigeant_title || mot('dirigeant', ORG.dirigeant_gender, { majuscule: true }))
  sigCol(M + colW + gap, P ? 'Le stagiaire' : 'Pour le bénéficiaire', sigC?.signer_name || signatory.name || client.name || '', sigC ? sigC.signer_role : signatory.role,
    sigC ? `Signé en ligne le ${new Date(sigC.signed_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}, preuve en dernière page` : 'Signature et cachet')
  if (ORG.stamp_base64) drawImageFitted(doc, ORG.stamp_base64, M + 6, y + 12, 44, 19, 'JPEG')
  if (ORG.dirigeant_signature_base64) drawImageFitted(doc, ORG.dirigeant_signature_base64, M + 52, y + 13, 34, 17)
  if (sigC?.signature_data) {
    const x2 = M + colW + gap
    drawImageFitted(doc, sigC.signature_data, x2 + 4, y + 12, colW - 8, boxH - 19)
  } else if (!sigC) {
    // Cadre réservé au client : la signature en ligne y sera reportée (zone.js)
    marquerZoneSignature(doc, { x: M + colW + gap, y: y + 11, w: colW, h: boxH - 11 })
  }
  y += boxH

  // Signer en ligne (pas sur une convention déjà signée) : adresse de l'espace client, QR code et code d'accès
  if (enLigne && !sigC) {
    const hE = hauteurEncadreEnLigne(doc, W, enLigne)
    y += 6
    ensure(hE)
    dessinerEncadreEnLigne(doc, t, M, y, W, enLigne)
    y += hE
  }

  drawFooter(doc, ORG, CODE)
  if (sigC) ajouterPagePreuve(doc, ORG, sigC, { titre: 'Convention de formation', reference: ref, code: CODE })
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
  // Signature du formateur par demi-journée (0453) : elle prime ; sinon l'image enregistrée sur chaque demi-journée tenue
  const trainerHalfdays = attendanceData?.trainerHalfdays || []
  const trainerIdPdf = attendanceData?.trainerId || null
  const getTrainerHalfday = (dateStr, period) => {
    const liste = trainerHalfdays.filter(h => String(h.date).substring(0, 10) === dateStr && h.period === period && h.signature)
    return (trainerIdPdf && liste.find(h => h.trainer_id === trainerIdPdf)) || liste[0] || null
  }

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
  // Accords de la feuille (S19) : genre du formateur, à défaut celui du signataire qui anime
  const genreFormateur = trainer ? trainer.gender : ORG.dirigeant_gender
  const trainerNameUpper = trainer ? `${(trainer.last_name || '').toUpperCase()} ${trainer.first_name || ''}` : ORG.dirigeant

  const drawPageHeader = (pageNum) => {
    let y = drawHeaderBand(doc, ORG, { ref: isBlank ? null : ref, docLabel: totalPages > 1 ? `page ${pageNum} / ${totalPages}` : '' })
    y -= 1
    // Titre et formateur à gauche, informations de session à droite
    doc.setFillColor(...t.accent); doc.rect(M, y - 6, 1.6, 8, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...t.primary)
    doc.text("Feuille d'émargement", M + 5, y)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...t.text)
    doc.text(`${isBlank ? 'Formateur' : mot('formateur', genreFormateur, { majuscule: true })} : ${isBlank ? '' : trainerName}`, M + 5, y + 7)
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
        if (isBlank || !dateStr) return
        const propre = getTrainerHalfday(dateStr, period)
        if (propre) { drawImageFitted(doc, propre.signature, cellX + 1, y + 1, dayColW - 2, rowH - 2); return }
        if (!trainerSignatureBase64) return
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
      doc.text(`Présence validée par ${leMot('formateur', genreFormateur)}, sans signature`, M + 5, y)
      doc.text('ABSENT : participant absent sur la demi-journée      (n) : signature recueillie par un tiers, voir annexe', M + 75, y)
      doc.text(`Chaque participant signe à chaque demi-journée. ${leMot('formateur', genreFormateur, { majuscule: true })} contresigne la feuille.`, pw - M, y, { align: 'right' })
    } else {
      doc.text(`Chaque participant signe à chaque demi-journée. ${leMot('formateur', genreFormateur, { majuscule: true })} contresigne la feuille.`, M, y)
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


// ============================================================
// ÉVALUATION À CHAUD - AVEC CERCLES GRAPHIQUES (9 critères qualité)
// ============================================================


// ============================================================
// ÉVALUATION À FROID - AVEC CERCLES GRAPHIQUES
// ============================================================


// ============================================================
// ÉVALUATION FORMATEUR - AVEC CERCLES GRAPHIQUES
// ============================================================


// ============================================================
// TEST DE POSITIONNEMENT - AVEC CERCLES GRAPHIQUES
// ============================================================


// ============================================================
// AUTRES DOCUMENTS (inchangés mais avec lieu Intra)
// ============================================================








// ============================================================
// FICHE DE RENSEIGNEMENTS STAGIAIRE
// ============================================================


// ============================================================
// DOCUMENTS DE SESSION SUR LA MISE EN PAGE COMMUNE (core/pdf/layout.js)
// Certificat, évaluations, positionnement, programme, règlement, livret, analyse du besoin,
// fiche de renseignements. Même bandeau, mêmes titres, mêmes blocs que la convention.
// ============================================================

const OK_COLOR = [21, 128, 61]
const KO_COLOR = [185, 28, 28]

function fullNameOf(trainee) {
  return `${trainee?.first_name || ''} ${(trainee?.last_name || '').toUpperCase()}`.trim()
}

function salarieLabel(trainee) {
  if (trainee?.gender === 'non_binary') return 'Salarié·e de'
  return trainee?.gender === 'female' ? 'Salariée de' : 'Salarié de'
}

function objectivesOf(course) {
  return (course?.objectives || '').split('\n').map(s => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean)
}

// Ligne d'identification commune aux formulaires (vierges ou remplis)
function identityFields(f, session, trainee, isBlank, { withClient = false, withTrainee = true, compact = false } = {}) {
  const course = session?.courses || {}
  if (compact) {
    f.fields([
      { label: 'Formation', value: isBlank ? '' : course.title, w: 2.2 },
      { label: 'Date', value: isBlank ? '' : formatDate(session?.start_date), w: 0.6 },
      { label: 'Stagiaire', value: isBlank ? '' : fullNameOf(trainee), w: 1.1 },
      ...(isBlank ? [{ label: 'N° de session', value: '', w: 0.7 }] : []),
    ])
    return
  }
  f.fields([
    { label: 'Formation', value: isBlank ? '' : course.title, w: 2.2 },
    { label: 'Date', value: isBlank ? '' : formatDate(session?.start_date), w: 0.8 },
    ...(isBlank ? [{ label: 'N° de session', value: '', w: 0.8 }] : []),
  ])
  const second = []
  if (withTrainee) second.push({ label: 'Stagiaire', value: isBlank ? '' : fullNameOf(trainee), w: 1.5 })
  if (withClient) second.push({ label: 'Entreprise', value: isBlank ? '' : (session?.clients?.name || ''), w: 1.5 })
  if (second.length) f.fields(second)
}

// ── Certificat de réalisation ──
function generateCertificat(session, trainee, trainer = null) {
  const doc = new jsPDF({ compress: true })
  generateCertificatContent(doc, session, trainee, trainer)
  return doc
}

function generateCertificatContent(doc, session, trainee, trainer, { defaultAcquired = false } = {}) {
  const course = session?.courses || {}
  const client = session?.clients || {}
  const ref = session?.reference || ''
  const f = startDocument(doc, ORG, { ref, docLabel: 'Certificat de réalisation', code: DOC_CODES.certificat, title: 'Certificat de réalisation' })
  const result = trainee?.result || (defaultAcquired ? 'acquired' : null)
  const isAcquired = result === 'acquired'
  const isNotAcquired = result === 'not_acquired'

  const nda = phraseNda(ORG) ? `, ${phraseNda(ORG)}` : ''
  f.para(`Je ${mot('soussigne', ORG.dirigeant_gender)}, ${ORG.dirigeant}${ORG.dirigeant_title ? ', ' + ORG.dirigeant_title : ''}, représentant légal du dispensateur de l'action concourant au développement des compétences ${ORG.nameFull || ORG.name}${nda}, atteste que :`, { size: 10, after: 4 })

  f.cards([{ label: 'Bénéficiaire', lines: [fullNameOf(trainee), client.name ? `${salarieLabel(trainee)} l'entreprise ${client.name}` : ''].filter(Boolean) }])

  f.para("a suivi l'action de formation suivante :", { size: 10, after: 3 })
  f.kv([
    ['Intitulé', course.title || ''],
    ['Dates', session?.start_date === session?.end_date || !session?.end_date ? `Le ${formatDate(session?.start_date)}` : `Du ${formatDate(session?.start_date)} au ${formatDate(session?.end_date)}`],
    ['Durée', courseHoursText(course)],
    // Durée réellement suivie (D6353-4), quand l'écran l'a établie à partir de l'émargement (0398)
    ...(trainee?.heures_realisees != null ? [['Durée suivie', formatHours(trainee.heures_realisees)]] : []),
    ['Lieu', getLocation(session) || ''],
    ['Formateur', trainerName(trainer)],
  ])
  f.space(3)

  // Une seule page : nature de l'action sur deux colonnes
  f.label("Nature de l'action concourant au développement des compétences")
  f.checks([
    { label: 'Action de formation', checked: true },
    { label: 'Bilan de compétences', muted: true },
    { label: "Action de validation des acquis de l'expérience", muted: true },
    { label: 'Action de formation par apprentissage', muted: true },
  ], { columns: 2 })

  f.label("Résultat de l'action de formation")
  f.checks([
    { label: 'Acquis : les objectifs de la formation ont été atteints', checked: isAcquired, color: isAcquired ? OK_COLOR : null },
    { label: "Non acquis : les objectifs de la formation n'ont pas été atteints", checked: isNotAcquired, color: isNotAcquired ? KO_COLOR : null },
  ])

  if (isNotAcquired) {
    // Un objectif commenté n'apparaît qu'une fois, avec son action corrective (une seule page)
    const withComments = (trainee?.failed_objectives_with_comments || []).filter(o => o.comment && String(o.comment).trim())
    const commentes = new Set(withComments.map(o => o.text))
    const failed = (trainee?.failed_objectives || []).filter(o => !commentes.has(o))
    if (failed.length) { f.label('Objectifs non validés'); f.bullets(failed) }
    if (withComments.length) {
      f.label('Objectifs non validés et actions correctives préconisées')
      withComments.forEach(o => { f.para(o.text, { style: 'bold', after: 0.5 }); f.para(o.comment, { x: f.M + 4, w: f.W - 4, color: f.t.muted, after: 2 }) })
    }
    if (trainee?.remediation_proposal) f.callout('Proposition pour valider la formation', trainee.remediation_proposal)
  }

  f.note("Sans préjudice des délais imposés par les règles fiscales, comptables ou commerciales, je m'engage à conserver l'ensemble des pièces justificatives ayant permis d'établir le présent certificat pendant une durée de 3 ans à compter de la fin de l'année du dernier paiement. En cas de cofinancement des fonds européens, la durée de conservation est étendue conformément aux obligations conventionnelles spécifiques.", { after: 3 })

  // Document émis (0399) : une version corrigée est datée du jour et annule la précédente
  if (trainee?.document_emis?.remplace) f.note(mentionRemplace('certificat', trainee.document_emis), { after: 2 })
  // « Fait à » à gauche du cadre de signature (demi-largeur à droite) : une ligne de gagnée
  f.ensure(26 + 4)
  f.body(9)
  doc.text(`Fait à ${ORG.lieu_signature || ORG.city || ''}, le ${formatDate(trainee?.document_emis?.issued_on || session?.end_date || new Date())}.`, f.M, f.y + 5)
  f.signatures([{ label: 'Le dispensateur de formation', name: `${ORG.dirigeant || ''}${ORG.dirigeant_title ? ', ' + ORG.dirigeant_title : ''}`, hint: 'Cachet et signature', stamp: ORG.stamp_base64, image: ORG.dirigeant_signature_base64 }], { height: 26 })
  f.finish()
}

// ── Attestation de fin de formation (S12-1a, 0476) ──
// Remise au stagiaire : objectifs, nature et durée de l'action, résultat de l'évaluation des acquis objectif par
// objectif. Distincte du certificat de réalisation. Aucune référence légale imprimée (ancien alinéa de L6353-1
// abrogé au 01/01/2019, vérifié sur Légifrance le 29/10/2026).
function generateFinFormation(session, trainee, trainer = null) {
  const doc = new jsPDF({ compress: true })
  generateFinFormationContent(doc, session, trainee, trainer)
  return doc
}

function generateFinFormationContent(doc, session, trainee, trainer) {
  const course = session?.courses || {}
  const client = session?.clients || {}
  const ref = session?.reference || ''
  const f = startDocument(doc, ORG, { ref, docLabel: 'Attestation de fin de formation', code: DOC_CODES.fin_formation, title: 'Attestation de fin de formation' })
  const result = trainee?.result || null
  const isAcquired = result === 'acquired'
  const isNotAcquired = result === 'not_acquired'

  const nda = phraseNda(ORG) ? `, ${phraseNda(ORG)}` : ''
  f.para(`Je ${mot('soussigne', ORG.dirigeant_gender)}, ${ORG.dirigeant}${ORG.dirigeant_title ? ', ' + ORG.dirigeant_title : ''}, représentant légal de l'organisme de formation ${ORG.nameFull || ORG.name}${nda}, atteste que :`, { size: 10, after: 4 })

  f.cards([{ label: 'Stagiaire', lines: [fullNameOf(trainee), client.name ? `${salarieLabel(trainee)} l'entreprise ${client.name}` : ''].filter(Boolean) }])

  f.para("a suivi l'action de formation suivante :", { size: 10, after: 3 })
  f.kv([
    ['Intitulé', course.title || ''],
    ['Nature', 'Action de formation'],
    ['Dates', session?.start_date === session?.end_date || !session?.end_date ? `Le ${formatDate(session?.start_date)}` : `Du ${formatDate(session?.start_date)} au ${formatDate(session?.end_date)}`],
    ['Durée prévue', courseHoursText(course)],
    ...(trainee?.heures_realisees != null ? [['Durée suivie', formatHours(trainee.heures_realisees)]] : []),
    ['Lieu', session?.is_remote ? 'À distance' : (getLocation(session) || '')],
    ['Formateur', trainerName(trainer)],
  ])
  f.space(3)

  f.label("Objectifs et résultat de l'évaluation des acquis")
  const fontOfDoc = (d) => d.__odetFont || 'helvetica'
  const objectifs = trainee?.objectifs_resultats || []
  f.table(['Objectif', 'Résultat'], objectifs.map((o) => [o.texte, libelleAcquis(o.acquis)]), {
    // Resserré pour tenir sur une page avec une dizaine d'objectifs et le cadre de signature
    styles: { fontSize: objectifs.length > 6 ? 7.8 : 8.5, cellPadding: objectifs.length > 6 ? 1.2 : 2, overflow: 'linebreak', valign: 'middle', textColor: ORG.theme.text, lineColor: ORG.theme.line, lineWidth: 0.2, font: fontOfDoc(doc) },
    columnStyles: { 1: { cellWidth: 30, halign: 'center' } },
    didParseCell: (d) => {
      if (d.section !== 'body' || d.column.index !== 1) return
      const o = objectifs[d.row.index]
      if (o?.acquis === true) d.cell.styles.textColor = OK_COLOR
      if (o?.acquis === false) d.cell.styles.textColor = KO_COLOR
    },
  })

  f.label('Résultat global')
  f.checks([
    { label: 'Acquis : les objectifs de la formation ont été atteints', checked: isAcquired, color: isAcquired ? OK_COLOR : null },
    { label: "Non acquis : les objectifs de la formation n'ont pas été tous atteints", checked: isNotAcquired, color: isNotAcquired ? KO_COLOR : null },
  ])

  if (trainee?.document_emis?.remplace) f.note(mentionRemplace('fin_formation', trainee.document_emis), { after: 2 })
  f.ensure(26 + 4)
  f.body(9)
  doc.text(`Fait à ${ORG.lieu_signature || ORG.city || ''}, le ${formatDate(trainee?.document_emis?.issued_on || session?.end_date || new Date())}.`, f.M, f.y + 5)
  f.signatures([{ label: "L'organisme de formation", name: `${ORG.dirigeant || ''}${ORG.dirigeant_title ? ', ' + ORG.dirigeant_title : ''}`, hint: 'Cachet et signature', stamp: ORG.stamp_base64, image: ORG.dirigeant_signature_base64 }], { height: 26 })
  f.finish()
}

// ── Évaluation à chaud ──
const EVAL_CHAUD_SECTIONS = [
  { title: '1. Organisation de la formation', rows: [
    ['Communication des documents avant la formation', 'q_org_documents'],
    ['Accueil sur le lieu de la formation', 'q_org_accueil'],
    ['Qualité des locaux (salles, signalétique)', 'q_org_locaux'],
    ['Adéquation des moyens matériels', 'q_org_materiel'],
  ] },
  { title: '2. Contenu de la formation', rows: [
    ['Organisation et déroulement', 'q_contenu_organisation'],
    ['Qualité des supports pédagogiques', 'q_contenu_supports'],
    ['Durée de la formation', 'q_contenu_duree'],
    ['Respect du programme de formation', 'q_contenu_programme'],
  ] },
  { title: '3. Intervention du formateur', rows: [
    ['Pédagogie du formateur', 'q_formateur_pedagogie'],
    ['Expertise du formateur (maîtrise du sujet)', 'q_formateur_expertise'],
    ['Progression de la formation (rythme)', 'q_formateur_progression'],
    ['Adéquation des moyens mis à disposition', 'q_formateur_moyens'],
  ] },
  { title: '4. Perception globale', rows: [
    ['Adéquation formation / métier ou secteur', 'q_global_adequation'],
    ['Amélioration de vos connaissances', 'q_global_competences'],
  ] },
]

function generateEvaluation(session, trainee = null, isBlank = false) {
  const doc = new jsPDF({ compress: true })
  generateEvaluationContent(doc, isBlank ? null : session, isBlank ? null : trainee, null, { isBlank })
  return doc
}

function generateEvaluationContent(doc, session, trainee, evalData = null, { isBlank = false } = {}) {
  const ref = isBlank ? null : (session?.reference || '')
  const f = startDocument(doc, ORG, { ref, docLabel: 'Évaluation à chaud', code: DOC_CODES.evaluation, title: 'Évaluation à chaud', subtitle: 'Votre avis sur la formation que vous venez de suivre' })
  identityFields(f, session, trainee, isBlank, { compact: true })
  f.note('Cochez une case par ligne : 1 = mauvais, 2 = passable, 3 = moyen, 4 = satisfaisant, 5 = très satisfaisant, N/C = non concerné.', { after: 2 })
  const value = (field) => {
    if (!evalData) return null
    const v = evalData[field]
    return v === 'nc' ? 'nc' : v
  }
  f.ratingGrid(EVAL_CHAUD_SECTIONS.map(s => ({ title: s.title, rows: s.rows.map(([label, field]) => ({ label, value: value(field) })) })), { rowH: 5.5, gap: 2.5 })
  const rec = evalData ? evalData.would_recommend : null
  f.y += 2
  f.choiceLine('Recommanderiez-vous cette formation ?', [
    { label: 'Oui', checked: rec === true || rec === 1 || rec === 'yes' },
    { label: 'Non', checked: rec === false || rec === 0 || rec === 'no' },
  ])
  f.box('Commentaire général (remarques, suggestions)', { height: 15, text: evalData?.comment_general || null })
  f.box('Projet de formation (besoins futurs)', { height: 12, text: evalData?.comment_projet || null })
  f.signatures([{ label: 'Le stagiaire', name: isBlank ? '' : fullNameOf(trainee), hint: 'Date et signature' }], { height: 17 })
  f.finish()
}

// ── Évaluation à froid ──
const EVAL_FROID_QUESTIONS = [
  ['Avez-vous pu mettre en pratique les compétences acquises ?', 'skills_applied'],
  ['Les connaissances acquises sont-elles toujours présentes ?', 'knowledge_retained'],
  ['La formation a-t-elle eu un impact positif sur votre travail ?', 'job_impact'],
  ['Les objectifs de la formation ont-ils été atteints ?', 'objectives_met'],
]

function generateEvaluationFroid(session, trainee = null, isBlank = false) {
  const doc = new jsPDF({ compress: true })
  generateEvaluationFroidContent(doc, isBlank ? null : session, isBlank ? null : trainee, { isBlank })
  return doc
}

function generateEvaluationFroidContent(doc, session, trainee, { isBlank = false } = {}) {
  const course = session?.courses || {}
  const ref = isBlank ? null : (session?.reference || '')
  const f = startDocument(doc, ORG, { ref, docLabel: 'Évaluation à froid', code: DOC_CODES.evaluationFroid, title: 'Évaluation à froid', subtitle: 'À compléter 1 à 3 mois après la formation' })
  identityFields(f, session, trainee, isBlank, { compact: true })
  const objectifs = isBlank ? [] : objectivesOf(course)
  if (objectifs.length) { f.label('Rappel des objectifs de la formation'); f.bullets(objectifs) }
  f.section('Vos réponses')
  EVAL_FROID_QUESTIONS.forEach(([q], i) => {
    f.ensure(14)
    f.body(9); doc.setFont('helvetica', 'bold')
    doc.splitTextToSize(`${i + 1}. ${q}`, f.W).forEach(l => { doc.text(l, f.M, f.y); f.y += f.LINE })
    f.y += 1.5
    f.checks([{ label: 'Oui' }, { label: 'En partie' }, { label: 'Non' }], { inline: true, colW: 28 })
  })
  f.y += 1
  f.choiceLine('Recommanderiez-vous cette formation ?', [{ label: 'Oui' }, { label: 'Non' }])
  f.box('Exemples concrets, difficultés rencontrées, nouveaux besoins', { height: 30, lined: true })
  f.signatures([{ label: 'Le stagiaire', name: isBlank ? '' : fullNameOf(trainee), hint: 'Date et signature' }], { height: 22 })
  f.finish()
}

// ── Évaluation de la session par le formateur ──
function generateEvaluationFormateur(session = null, isBlank = false) {
  const doc = new jsPDF({ compress: true })
  const ref = isBlank ? null : (session?.reference || '')
  const f = startDocument(doc, ORG, { ref, docLabel: 'Évaluation formateur', code: DOC_CODES.evaluationFormateur, title: 'Évaluation de la session par le formateur' })
  identityFields(f, isBlank ? null : session, null, isBlank, { withClient: true, withTrainee: false })
  f.fields([{ label: 'Formateur', value: '', w: 1 }])
  f.note('1 = insuffisant, 2 = passable, 3 = satisfaisant, 4 = bien, 5 = très satisfaisant.', { after: 3 })
  f.ratingGrid([{ title: 'Critères', rows: ['Motivation du groupe', 'Niveau des stagiaires', 'Conditions matérielles', 'Organisation', 'Documentation fournie', 'Appréciation globale'].map(label => ({ label, value: null })) }], { nc: false, colW: 13, rowH: 8 })
  f.box('Points positifs', { height: 22, lined: true })
  f.box('Difficultés rencontrées et recommandations', { height: 26, lined: true })
  f.signatures([{ label: 'Le formateur', hint: 'Date et signature' }], { height: 22 })
  f.finish()
  return doc
}

// ── Test de positionnement (vierge, nominatif ou corrigé) ──
function questionOptions(q) {
  let options = q.options
  if (typeof options === 'string') { try { options = JSON.parse(options) } catch { options = [] } }
  return Array.isArray(options) ? options : []
}

function drawPositionnementQuestions(f, questions, { isCorrige = false } = {}) {
  const doc = f.doc
  if (!questions || !questions.length) { f.para('Aucune question configurée pour cette formation.', { color: f.t.muted }); return }
  const sorted = [...questions].sort((a, b) => (a.position || 0) - (b.position || 0))
  sorted.forEach((q, idx) => {
    const options = questionOptions(q)
    const isQCM = ['single_choice', 'qcm'].includes(q.question_type || q.type) && options.length > 0
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
    const qLines = doc.splitTextToSize(`${idx + 1}. ${q.question_text || q.question || ''}`, f.W)
    f.ensure(qLines.length * 4.4 + (isQCM ? Math.min(options.length, 4) * 5.6 : 24))
    f.body(9.5); doc.setFont('helvetica', 'bold')
    qLines.forEach(l => { doc.text(l, f.M, f.y); f.y += 4.4 })
    f.y += 1.5
    if (isQCM) {
      f.checks(options.map((opt, i) => {
        const correct = isCorrige && (q.correct_index === i)
        return { label: String(opt), checked: correct, color: correct ? OK_COLOR : null }
      }))
    } else {
      f.box(null, { height: 18, text: isCorrige && q.scoring_rubric ? `Attendu : ${q.scoring_rubric}` : null })
    }
    f.y += 1
  })
}

function blankPageForDuplex(doc, startPage) {
  const used = doc.getNumberOfPages() - startPage + 1
  if (used % 2 !== 0) {
    doc.addPage()
    const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight()
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(...ORG.theme.muted)
    doc.text('Page laissée blanche pour l\'impression recto verso', pw / 2, ph / 2, { align: 'center' })
    doc.setTextColor(...ORG.theme.text)
  }
}

function generatePositionnement(session, questions = [], isBlank = false, trainee = null, isCorrige = false) {
  const doc = new jsPDF({ compress: true })
  writePositionnement(doc, session, questions, { isBlank, trainee, isCorrige })
  blankPageForDuplex(doc, 1)
  return doc
}

function generatePositionnementContent(doc, session, questions, trainee) {
  const start = doc.getNumberOfPages()
  writePositionnement(doc, session, questions, { isBlank: !trainee, trainee })
  blankPageForDuplex(doc, start)
}

function writePositionnement(doc, session, questions, { isBlank = false, trainee = null, isCorrige = false } = {}) {
  const course = session?.courses || {}
  const ref = isBlank ? null : (session?.reference || '')
  const f = startDocument(doc, ORG, { ref, docLabel: isCorrige ? 'Corrigé formateur' : 'Test de positionnement', code: DOC_CODES.positionnement, title: 'Test de positionnement', subtitle: course.title || null })
  if (isCorrige) f.callout('Corrigé formateur', 'Document réservé au formateur. Ne pas remettre aux stagiaires.', { tone: 'accent' })
  f.fields([
    { label: 'Nom', value: isBlank ? '' : (trainee?.last_name || '').toUpperCase(), w: 1 },
    { label: 'Prénom', value: isBlank ? '' : trainee?.first_name, w: 1 },
  ])
  f.fields([
    { label: 'Date', value: isBlank ? '' : formatDate(session?.start_date || new Date()), w: 0.7 },
    { label: 'Entreprise', value: isBlank ? '' : (session?.clients?.name || ''), w: 1.3 },
  ])
  if (!isCorrige) f.note("Ce questionnaire permet d'évaluer vos connaissances avant la formation. Cochez la réponse qui vous semble correcte. Il n'y a pas de note éliminatoire.", { after: 3 })
  drawPositionnementQuestions(f, questions, { isCorrige })
  f.finish()
}

// ── Test de positionnement rempli en ligne ──
function generateTestPositionnementRempli(session, trainee, testData) {
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true })
  const ref = session?.reference || ''
  const f = startDocument(doc, ORG, { ref, docLabel: 'Test de positionnement', code: DOC_CODES.positionnement, title: 'Test de positionnement', subtitle: session?.courses?.title || null })
  const t = f.t
  const answers = testData?.answers || []
  const critical = answers.filter(a => a.critical && a.question_type === 'single_choice')
  const okCritical = critical.filter(a => a.is_correct).length
  const failed = critical.filter(a => a.is_correct === false)
  const dontKnow = answers.filter(a => a.selected_option_index === -1)
  const pct = critical.length ? Math.round(okCritical / critical.length * 100) : 0

  f.cards([
    { label: 'Stagiaire', lines: [fullNameOf(trainee), session?.clients?.name || ''].filter(Boolean) },
    { label: 'Résultat', lines: [critical.length ? `${okCritical} / ${critical.length} questions essentielles (${pct} %)` : 'Aucune question essentielle', testData?.completed_at ? `Complété le ${format(new Date(testData.completed_at), "dd/MM/yyyy 'à' HH'h'mm", { locale: fr })}` : ''].filter(Boolean) },
  ])

  if (failed.length || dontKnow.length) {
    f.section('Points de vigilance')
    failed.forEach(q => {
      const options = questionOptions(q)
      f.para(q.question_text || '', { style: 'bold', after: 0.5 })
      f.para(`Réponse donnée : ${options[q.selected_option_index] ?? ''}`, { x: f.M + 4, w: f.W - 4, color: KO_COLOR, after: 0.5 })
      f.para(`Bonne réponse : ${options[q.correct_index] ?? ''}`, { x: f.M + 4, w: f.W - 4, color: OK_COLOR, after: 2.5 })
    })
    dontKnow.forEach(q => {
      f.para(q.question_text || '', { style: 'bold', after: 0.5 })
      f.para('Réponse : je ne sais pas', { x: f.M + 4, w: f.W - 4, color: t.muted, style: 'italic', after: 2.5 })
    })
  }

  f.section('Questions et réponses')
  answers.forEach((a, idx) => {
    f.ensure(14)
    f.para(`${idx + 1}. ${a.question_text || ''}${a.critical ? '  (question essentielle)' : ''}`, { style: 'bold', after: 1.5 })
    if (a.question_type === 'single_choice') {
      const options = questionOptions(a)
      f.checks(options.map((opt, i) => {
        const selected = a.selected_option_index === i
        const correct = a.correct_index === i
        const suffix = correct && !selected ? '  (bonne réponse)' : ''
        return { label: `${opt}${suffix}`, checked: selected, color: selected ? (a.is_correct ? OK_COLOR : KO_COLOR) : (correct ? OK_COLOR : null) }
      }))
      if (a.selected_option_index === -1) f.para('Réponse : je ne sais pas', { x: f.M + 7, color: t.muted, style: 'italic' })
    } else {
      f.box(null, { height: 10, text: a.text_answer || 'Non répondu' })
    }
  })
  f.finish()
  return doc
}

// ── Programme de formation : une page, modèle des programmes audités (programmePDF.js) ──
// La fiche formation porte toutes les informations ; le référent pédagogique vient des rôles qualité.
function contexteProgramme(course) {
  return {
    referentPedagogique: QT?.ctx?.role?.validation_programmes?.nom || null,
    pictogramme: course?.pictogram ? pictogrammePNG(course.pictogram, ORG.theme?.accent) : null,
  }
}
function generateProgramme(session) {
  const course = session?.courses || {}
  return buildProgrammePDF(course, ORG, contexteProgramme(course))
}

/** Catalogue des formations : page de garde puis un programme par page ; téléchargé (« Catalogue_formations.pdf »). */
export async function downloadCatalogue(courses) {
  await ensureQualityTexts()
  const doc = buildCataloguePDF(courses, ORG, contexteProgramme)
  doc.save('Catalogue_formations.pdf')
  return true
}

// ── Règlement intérieur et livret d'accueil (textes des Paramètres) ──
function generateReglement() {
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, { docLabel: 'Règlement intérieur', code: DOC_CODES.reglement, title: 'Règlement intérieur', subtitle: ['Applicable aux stagiaires', versionLabel(QT?.reglement)].filter(Boolean).join(' · ') })
  if (QT?.reglement?.content) {
    writeRichDoc(f, QT.reglement.content, QT.ctx)
  } else {
    const nom = ORG.name || "l'organisme"
    ;[
      ["Article 1 - Objet et champ d'application", `Le présent règlement est établi conformément aux articles L.6352-3, L.6352-4 et R.6352-1 à R.6352-15 du Code du travail. Il s'applique à tous les stagiaires participant aux formations dispensées par ${nom}, pour la durée de la formation suivie.`],
      ['Article 2 - Hygiène et sécurité', "Chaque stagiaire respecte les consignes d'hygiène et de sécurité en vigueur sur le lieu de formation, notamment l'interdiction de fumer et d'introduire des boissons alcoolisées. Tout accident ou incident est signalé sans délai au formateur."],
      ['Article 3 - Discipline', "Les stagiaires respectent les horaires, émargent chaque demi-journée et adoptent un comportement respectueux envers le formateur et les autres participants. Le matériel mis à disposition est utilisé conformément à son objet."],
      ['Article 4 - Sanctions', "Tout manquement au présent règlement peut faire l'objet d'une sanction (avertissement, exclusion temporaire ou définitive), dans le respect de la procédure prévue aux articles R.6352-4 à R.6352-8 du Code du travail."],
      ['Article 5 - Représentation des stagiaires', "Pour les formations d'une durée supérieure à 500 heures, un délégué titulaire et un délégué suppléant sont élus."],
      ['Article 6 - Publicité', 'Le présent règlement est remis à chaque stagiaire avant le début de la formation.'],
    ].forEach(([titre, texte]) => { f.section(titre); f.para(texte, { after: 3 }) })
  }
  f.finish()
  return doc
}

function generateLivret(session = null) {
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, { ref: session?.reference || null, docLabel: "Livret d'accueil", code: DOC_CODES.livret, title: "Livret d'accueil du stagiaire", subtitle: [`Bienvenue chez ${ORG.name || ''}`, versionLabel(QT?.livret)].filter(Boolean).join(' · ') })
  if (QT?.livret?.content) {
    writeRichDoc(f, QT.livret.content, QT.ctx)
  } else {
    f.section('Qui sommes-nous ?')
    f.para(`${ORG.name || ORG.legal_name}, ${ORG.adressePrincipale || ORG.addressFull || ''}.`)
    f.section('Vos interlocuteurs')
    f.kv([
      ['Responsable', [ORG.dirigeant, ORG.dirigeant_title].filter(Boolean).join(', ')],
      ['Contact', [ORG.phone, ORG.email].filter(Boolean).join('   ')],
      ['Référent handicap', ORG.referent_handicap_nom || null],
    ])
    f.section('Déroulement de la formation')
    f.para(session?.start_time && session?.end_time ? `Horaires : de ${formatHour(session.start_time)} à ${formatHour(session.end_time)}, avec des pauses en milieu de matinée et d'après-midi.` : 'Les horaires sont indiqués sur votre convocation.')
    f.section('Règles de vie')
    f.bullets(['Ponctualité et émargement à chaque demi-journée', 'Téléphones en silencieux pendant les séquences', 'Respect des autres participants et des consignes de sécurité'])
    f.section('En cas de difficulté')
    f.para(`Parlez-en à votre formateur ou contactez-nous : ${[ORG.phone, ORG.email].filter(Boolean).join(', ')}.`)
  }
  f.finish()
  return doc
}

// ── Analyse du besoin (formulaire court) ──
function generateAnalyseBesoin(session = null, isBlank = false) {
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, { ref: isBlank ? null : session?.reference, docLabel: 'Analyse du besoin', code: DOC_CODES.analyseBesoin, title: 'Analyse du besoin de formation' })
  f.fields([
    { label: 'Entreprise', value: isBlank ? '' : (session?.clients?.name || ''), w: 2 },
    { label: 'Date', value: isBlank ? '' : formatDate(new Date()), w: 0.8 },
  ])
  f.fields([
    { label: 'Interlocuteur', value: isBlank ? '' : (getSessionContact(session).name || ''), w: 1.4 },
    { label: 'Formation envisagée', value: isBlank ? '' : (session?.courses?.title || ''), w: 2 },
  ])
  ;['Contexte et enjeux', 'Objectifs attendus', 'Public concerné (nombre, postes, niveau)', 'Contraintes et moyens (lieu, dates, matériel, handicap)'].forEach(label => f.box(label, { height: 26, lined: true }))
  f.signatures([
    { label: "Pour l'entreprise", hint: 'Nom, date et signature' },
    { label: `Pour ${ORG.name || "l'organisme"}`, name: ORG.dirigeant || '', hint: 'Date et signature' },
  ], { height: 28 })
  f.finish()
  return doc
}

// ── Fiche de renseignements stagiaire ──
function generateFicheRenseignements(session, trainee = null, isBlank = false, infoSheet = null) {
  const doc = new jsPDF({ compress: true })
  const course = session?.courses || {}
  const f = startDocument(doc, ORG, { ref: isBlank ? null : session?.reference, docLabel: 'Fiche de renseignements', code: 'FICHE', title: 'Fiche de renseignements stagiaire', subtitle: isBlank ? null : (course.title || null) })
  const v = (val) => (isBlank ? '' : (val ?? ''))
  const genderMap = { male: 'Homme', female: 'Femme', non_binary: 'Non binaire' }
  if (isBlank) f.fields([{ label: 'Formation', value: '', w: 2.2 }, { label: 'N° de session', value: '', w: 0.8 }])

  f.section('Informations personnelles')
  f.fields([
    { label: 'Nom', value: v(String(infoSheet?.last_name || trainee?.last_name || '').toUpperCase()) },
    { label: 'Prénom', value: v(infoSheet?.first_name || trainee?.first_name) },
  ])
  f.fields([
    { label: 'Genre', value: v(genderMap[infoSheet?.gender || trainee?.gender] || ''), w: 0.7 },
    { label: 'Date de naissance', value: v(trainee?.birth_date ? format(new Date(trainee.birth_date), 'dd/MM/yyyy') : ''), w: 0.8 },
    { label: 'Catégorie socioprofessionnelle', value: v(infoSheet?.csp || trainee?.csp), w: 1.5 },
  ])
  f.fields([
    { label: 'Téléphone', value: v(infoSheet?.phone || trainee?.phone), w: 0.8 },
    { label: 'Email', value: v(infoSheet?.email || trainee?.email), w: 1.6 },
  ])
  f.label('Numéro de sécurité sociale (jamais imprimé)')
  if (isBlank) {
    f.checks([{ label: 'Communiqué via le portail stagiaire' }, { label: 'Je refuse de le communiquer' }], { inline: true, colW: 70 })
  } else {
    const st = (trainee?.refused_ssn || infoSheet?.ssn_refused) ? 'Refus du stagiaire' : ((trainee?.ssn_present || infoSheet?.ssn_present || trainee?.social_security_number || infoSheet?.ssn) ? 'Renseigné par le stagiaire' : 'Non renseigné')
    f.para(st, { after: 3 })
  }

  f.section('Informations professionnelles')
  f.fields([
    { label: 'Poste occupé', value: v(infoSheet?.job_title || trainee?.job_title), w: 1.6 },
    { label: 'Depuis', value: v(infoSheet?.job_since), w: 0.6 },
  ])
  const client = session?.clients || {}
  f.fields([
    { label: 'Entreprise', value: v(client.name), w: 1.2 },
    { label: 'Adresse', value: v([client.address, [client.postal_code, client.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')), w: 1.8 },
  ])
  f.fields([
    { label: 'Dernière formation suivie (année)', value: v(infoSheet?.last_training_year), w: 1 },
    { label: 'Plus haut diplôme obtenu', value: v(infoSheet?.highest_diploma), w: 1.4 },
  ])
  f.label('Niveau de connaissance dans le domaine')
  f.checks(['Aucune', 'Faible', 'Moyen', 'Bon', 'Expert'].map((label, i) => ({ label, checked: !isBlank && infoSheet?.knowledge_level === i + 1 })), { inline: true, colW: 30 })

  f.section('Vos besoins et attentes')
  f.box('Besoins spécifiques et attentes concernant cette formation', { height: 26, lined: isBlank, text: !isBlank && infoSheet?.training_expectations ? String(infoSheet.training_expectations) : null })
  f.checks([{ label: `J'accepte que mes données soient traitées par ${ORG.name || "l'organisme"} pour l'organisation et le suivi de cette formation (RGPD).`, checked: !isBlank && infoSheet?.rgpd_consent === true }])
  f.signatures([{ label: 'Le stagiaire', name: isBlank ? '' : fullNameOf(trainee), hint: `Date${isBlank ? '' : ' : ' + formatDate(session?.start_date || new Date())} et signature` }], { height: 22 })
  f.note('Catégorie socioprofessionnelle : par exemple employé, ouvrier, technicien, cadre, artisan, demandeur d\'emploi, étudiant.')
  f.finish()
  return doc
}

// Encadré « Signer en ligne » d'une convention ou d'un contrat : accès à l'espace du client (entreprise de la session
// ou particulier du groupe), sauf document déjà signé ou options.enLigne === false
async function enLigneDe(session, options = {}) {
  if (options.enLigne === false || session?.signature_client || options.isBlank) return null
  return lienEspaceClient(options.particulier?.client?.id || session?.client_id || session?.clients?.id)
}

// ============================================================
// EXPORT
// ============================================================
export async function downloadDocument(docType, session, options = {}) {
  if (['convention', 'contratParticulier', 'reglement', 'livret', 'programme'].includes(docType)) await ensureQualityTexts()
  if (['convention', 'contratParticulier'].includes(docType)) await chargerRegimeTva()
  const { trainees = [], trainee = null, trainer = null, isBlank = false, questions = [], costs = [], attendanceData = null } = options
  const ref = session?.reference || 'VIERGE'
  let doc, filename
  
  switch (docType) {
    case 'convention': doc = generateConvention(session, trainees, trainer, costs, null, await enLigneDe(session, options)); filename = `Convention_${ref}.pdf`; break
    case 'contratParticulier': doc = generateConvention(session, trainees, trainer, costs, options.particulier || null, await enLigneDe(session, options)); filename = `Contrat_${ref}_${(options.particulier?.client?.name || '').replace(/\s+/g, '_')}.pdf`; break
    case 'certificat': doc = generateCertificat(session, trainee, trainer); filename = `Certificat_${ref}_${trainee?.last_name || ''}.pdf`; break
    case 'fin_formation': doc = generateFinFormation(session, trainee, trainer); filename = `Attestation_fin_${ref}_${trainee?.last_name || ''}.pdf`; break
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
    case 'programme': doc = generateProgramme(session); filename = `Programme_${session?.courses?.code || ref}.pdf`; break
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
      case 'fin_formation': generateFinFormationContent(doc, session, trainee, trainer); break
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
    fin_formation: 'Attestations_fin_formation',
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
  if (['convention', 'contratParticulier', 'reglement', 'livret', 'programme'].includes(docType)) await ensureQualityTexts()
  if (['convention', 'contratParticulier'].includes(docType)) await chargerRegimeTva()
  const { trainees = [], trainee = null, trainer = null, isBlank = false, questions = [], costs = [], attendanceData = null } = options
  const ref = session?.reference || 'VIERGE'
  let doc, filename
  
  switch (docType) {
    case 'convention': doc = generateConvention(session, trainees, trainer, costs, null, await enLigneDe(session, options)); filename = `Convention_${ref}.pdf`; break
    case 'contratParticulier': doc = generateConvention(session, trainees, trainer, costs, options.particulier || null, await enLigneDe(session, options)); filename = `Contrat_${ref}_${(options.particulier?.client?.name || '').replace(/\s+/g, '_')}.pdf`; break
    case 'certificat': doc = generateCertificat(session, trainee, trainer); filename = `Certificat_${ref}_${trainee?.last_name || ''}.pdf`; break
    case 'fin_formation': doc = generateFinFormation(session, trainee, trainer); filename = `Attestation_fin_${ref}_${trainee?.last_name || ''}.pdf`; break
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
    case 'programme': doc = generateProgramme(session); filename = `Programme_${session?.courses?.code || ref}.pdf`; break
    case 'evaluation': doc = generateEvaluation(session, trainee, isBlank); filename = isBlank ? 'Evaluation_Vierge.pdf' : `Evaluation_${ref}.pdf`; break
    case 'evaluationFroid': doc = generateEvaluationFroid(session, trainee, isBlank); filename = isBlank ? 'EvaluationFroid_Vierge.pdf' : `EvaluationFroid_${ref}.pdf`; break
    case 'evaluationFormateur': doc = generateEvaluationFormateur(session, isBlank); filename = isBlank ? 'Evaluation_Formateur_Vierge.pdf' : `Evaluation_Formateur_${ref}.pdf`; break
    case 'ficheRenseignements': doc = generateFicheRenseignements(session, trainee, isBlank, options.infoSheet || null); filename = isBlank ? 'Fiche_Renseignements_Vierge.pdf' : `Fiche_Renseignements_${ref}_${trainee?.last_name || ''}.pdf`; break
    case 'analyseBesoin': doc = generateAnalyseBesoin(session, isBlank); filename = isBlank ? 'Analyse_Besoin_Vierge.pdf' : `Analyse_Besoin_${ref}.pdf`; break
    case 'positionnement': doc = generatePositionnement(session, questions, isBlank, trainee, false); filename = isBlank ? 'Test_Positionnement_Vierge.pdf' : `Test_Positionnement_${ref}_${trainee?.last_name || ''}.pdf`; break
    case 'testPositionnementRempli': doc = generateTestPositionnementRempli(session, trainee, options.testData); filename = `Test_Positionnement_${ref}_${trainee?.last_name || ''}.pdf`; break
    case 'positionnementCorrige': doc = generatePositionnement(session, questions, false, null, true); filename = `CORRIGE_Test_Positionnement_${ref}.pdf`; break
    case 'programme': doc = generateProgramme(session); filename = `Programme_${session?.courses?.code || ref}.pdf`; break
    case 'reglement': doc = generateReglement(); filename = 'Reglement_Interieur.pdf'; break
    case 'livret': doc = generateLivret(session); filename = `Livret_Accueil_${ref}.pdf`; break
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
      case 'fin_formation': generateFinFormationContent(doc, session, trainee, trainer); break
      case 'convocation': generateConvocationContent(doc, session, trainee, trainer, qrCodeDataURL); break
      case 'attestation': generateAttestationContent(doc, session, trainee, trainer); break
      case 'evaluation': generateEvaluationContent(doc, session, trainee, evaluationsData[trainee.id] || null); break
      case 'evaluationFroid': generateEvaluationFroidContent(doc, session, trainee); break
      default: return
    }
  })
  
  const docNames = {
    certificat: 'Certificats',
    fin_formation: 'Attestations_fin_formation',
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

// Convocation sur une seule page (22/10, décision de H) : la mise en page normale est essayée d'abord ; si elle
// déborde, une version resserrée (objectifs en une ligne, liste « À prévoir » en une phrase), puis une version courte
// (sans objectifs, déjà au programme). Mesuré sur un document d'essai, puis dessiné dans le vrai document.
function generateConvocationContent(doc, session, trainee, trainer, qrCodeDataURL = null) {
  let niveau = 0
  for (; niveau < 3; niveau++) {
    const essai = new jsPDF({ compress: true })
    dessinerConvocation(essai, session, trainee, trainer, qrCodeDataURL, niveau)
    if (essai.getNumberOfPages() === 1) break
  }
  dessinerConvocation(doc, session, trainee, trainer, qrCodeDataURL, Math.min(niveau, 3))
}

function dessinerConvocation(doc, session, trainee, trainer, qrCodeDataURL = null, niveau = 0) {
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
  // Contact dans l'entreprise mis en avant (nom, fonction, téléphone, e-mail), l'organisme sur une ligne dessous ;
  // sans contact d'entreprise, la carte de droite donne l'organisme comme avant
  const orgLines = [ORG.name, ORG.phone ? `Tél. ${ORG.phone}` : '', ORG.email || ''].filter(Boolean)
  const contactLines = contact.name
    ? [contact.name, contact.role || '', contact.phone ? `Tél. ${contact.phone}` : '', contact.email || ''].filter(Boolean)
    : orgLines
  while (stagLines.length < contactLines.length) stagLines.push('')
  while (contactLines.length < stagLines.length) contactLines.push('')
  const y1 = drawPartyCard(doc, ORG, M, f.y, colW, 'Stagiaire convoqué', stagLines)
  const y2 = drawPartyCard(doc, ORG, M + colW + gap, f.y, colW, contact.name ? 'Votre contact dans l\'entreprise' : 'Votre contact', contactLines)
  f.y = Math.max(y1, y2) + 3
  if (contact.name) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...f.t.muted)
    const ligneOrg = `Organisme de formation : ${[ORG.name, ORG.phone, ORG.email].filter(Boolean).join(' · ')}`
    doc.text(doc.splitTextToSize(ligneOrg, W)[0] || '', M, f.y + 2)
    doc.setTextColor(...f.t.text)
    f.y += 6
  }
  f.y += niveau ? 2 : 4

  if (niveau < 2) f.para('Merci de vous présenter à la session de formation selon les informations suivantes. Pour toute question, votre contact est indiqué ci-dessus.', { after: 2 })

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
  const objectifs = niveau >= 2 ? [] : (course.objectives || '').split('\n').map(s => s.trim()).filter(Boolean)
  if (objectifs.length && niveau === 1) {
    f.y += 3
    f.para(`Objectifs : ${objectifs.map((o) => o.replace(/^[-•·*]\s*/, '').replace(/[.;]\s*$/, '')).join(' ; ')}.`, { size: 8.5, after: 1 })
  } else if (objectifs.length) {
    f.y += 3
    f.ensure(5 + f.LINE * 2)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...t.muted)
    doc.text('OBJECTIFS', M, f.y, { charSpace: 0.2 })
    f.y += 4.5
    f.bullets(objectifs)
  }

  // ── À prévoir ── (espace après le tableau : sans objectifs, le titre chevauchait la ligne « Formateur »)
  if (!objectifs.length) f.y += 5
  f.section('À prévoir')
  const aPrevoir = [
    "Votre pièce d'identité",
    'Votre numéro de sécurité sociale',
    "Une tenue adaptée et le matériel indiqué par le formateur, le cas échéant",
    ...(course.material ? [`Matériel : ${course.material}`] : []),
  ]
  if (niveau) f.para(`${aPrevoir.map((x) => x.replace(/[.;\s]+$/, '')).join(' ; ')}.`, { size: 8.5, after: 1 })
  else f.bullets(aPrevoir)

  // ── Portail stagiaire (QR code) ──
  const qrSize = 28
  const portalTxt = "Avant la formation, scannez le QR code (ou ouvrez le lien ci-dessous) pour accéder au portail stagiaire : complétez votre fiche de renseignements, indiquez vos attentes et faites votre test de positionnement. Le jour de la formation, votre présence est enregistrée par demi-journée depuis ce même portail (ou sur feuille papier en cas d'indisponibilité du réseau)."
  const textW = qrCodeDataURL ? W - qrSize - 14 : W - 8
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  const pLines = doc.splitTextToSize(portalTxt, textW)
  // Lien en clair, cliquable, pour qui lit la convocation sur son téléphone ou son ordinateur
  const portalLien = session?.attendance_token ? `${publicBaseUrl()}/#/portail/${session.attendance_token}` : ''
  const lienLignes = portalLien ? doc.splitTextToSize(portalLien, textW) : []
  const boxH = Math.max(qrCodeDataURL ? qrSize + 11 : 0, 12 + (pLines.length + lienLignes.length) * 4.2 + 3)
  f.ensure(boxH + 2)
  const by = f.y
  doc.setFillColor(...t.surface); doc.rect(M, by, W, boxH, 'F')
  doc.setFillColor(...t.accent); doc.rect(M, by, 1.2, boxH, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...t.accent)
  doc.text('PORTAIL STAGIAIRE ET ÉMARGEMENT', M + 4, by + 5.5, { charSpace: 0.4 })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...t.text)
  pLines.forEach((l, i) => doc.text(l, M + 4, by + 11.5 + i * 4.2))
  if (lienLignes.length) {
    doc.setFontSize(8); doc.setTextColor(...t.accent)
    lienLignes.forEach((l, i) => doc.textWithLink(l, M + 4, by + 11.5 + (pLines.length + i) * 4.2, { url: portalLien }))
    doc.setFontSize(9); doc.setTextColor(...t.text)
  }
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
  f.para(`Accessibilité : en cas de besoins spécifiques (mobilité, audition, vision ou autre), merci de nous en informer ${handi} au moins 72 heures avant la formation.`, niveau ? { size: 8.5 } : {})
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

// « Annule et remplace » d'une version corrigée (0399)
function mentionRemplace(kind, emis) {
  const nom = kind === 'certificat' ? 'le certificat de réalisation' : kind === 'fin_formation' ? "l'attestation de fin de formation" : "l'attestation de présence"
  return `Version ${emis.version} : ce document annule et remplace ${nom} du ${formatDate(emis.remplace.issued_on)} (version ${emis.remplace.version}).`
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

  f.para(`Je soussigné, ${ORG.dirigeant}${ORG.dirigeant_title ? ', ' + ORG.dirigeant_title : ''}, représentant l'organisme de formation ${ORG.nameFull || ORG.name}${phraseNda(ORG) ? ` (${phraseNda(ORG)})` : ''}, atteste que :`, { size: 10, after: 5 })

  const fullName = `${trainee?.first_name || ''} ${(trainee?.last_name || '').toUpperCase()}`.trim()
  const lines = [fullName, client.name ? `Entreprise : ${client.name}` : ''].filter(Boolean)
  f.y = drawPartyCard(doc, ORG, M, f.y, W, 'Stagiaire', lines) + 8

  f.para("a participé à l'action de formation suivante :", { size: 10, after: 3 })
  const horaires = session?.start_time ? `De ${formatHour(session.start_time)} à ${formatHour(session?.end_time)}` : ''
  // Présence : du début à la fin, sauf arrivée tardive ou départ anticipé notés sur la session
  const st = { ...((session?.session_trainees || []).find(x => x.trainee_id === trainee?.id) || {}), ...pickPresence(trainee) }
  // Heures réellement suivies (0398) si l'écran les a établies, sinon heures de présence
  const hours = heuresDuDocument(session, course, st, trainee)
  const notes = []
  if (st.arrival_time && st.arrival_date) notes.push(`arrivée le ${formatDate(st.arrival_date)} à ${formatHour(st.arrival_time)}`)
  if (st.early_departure && st.departure_date) notes.push(`départ le ${formatDate(st.departure_date)}${st.departure_time ? ` à ${formatHour(st.departure_time)}` : ''}`)
  if (trainee?.absences_notees?.length) notes.push(`absent : ${trainee.absences_notees.join(', ')}`)
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
  if (trainee?.document_emis?.remplace) { f.para(mentionRemplace('attestation', trainee.document_emis), { size: 9, after: 3 }); f.body(9) }
  doc.text(`Fait à ${ORG.lieu_signature || ORG.city}, le ${formatDate(trainee?.document_emis?.issued_on || session?.end_date || new Date())}.`, M, f.y)
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








// ============================================
// NOUVEAU : Test de positionnement rempli
// ============================================


