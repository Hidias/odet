// ═══════════════════════════════════════════════════════════════
// pdfPasseportPrevention.js - Notice Passeport Prévention
// Deux versions : stagiaire et entreprise
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf'
import { mot } from '../../../core/genre'
import { buildORG, prepareOrgForPDF } from '../../../core/org/orgUtils'

import 'jspdf-autotable'
import { startDocument } from '../../../core/pdf/layout'

// Identité de l'organisme : uniquement depuis organization_settings (aucun repli)
let ORG = buildORG({})

function applyOrgSettings(orgSettings) {
  ORG = { ...(orgSettings || {}), ...buildORG(orgSettings || {}) }
}

const nom = () => ORG.name || "l'organisme de formation"
const qualiopi = () => (ORG.qualiopi_certified ? ', certifié Qualiopi,' : '')
const contact = () => [ORG.phone ? `Téléphone : ${ORG.phone}` : '', ORG.email ? `Email : ${ORG.email}` : '', ORG.website ? `Site : ${String(ORG.website).replace(/^https?:\/\//, '')}` : ''].filter(Boolean).join('   ')

// ═══════════════════════════════════════════════════════════
// VERSION STAGIAIRE
// ═══════════════════════════════════════════════════════════
function generateVersionStagiaire() {
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, { docLabel: 'Passeport de prévention', code: 'PPREV-STAG', title: 'Passeport de prévention', subtitle: 'Guide à destination des stagiaires' })

  f.section("Qu'est-ce que le passeport de prévention ?")
  f.callout(null, "Le passeport de prévention est un outil numérique créé par la loi du 2 août 2021 pour renforcer la prévention en santé au travail. Il recense les formations, attestations et certifications que vous avez obtenues en santé et sécurité au travail tout au long de votre carrière.", { tone: 'highlight' })
  f.label('Il contient')
  f.bullets([
    'Les attestations, certificats et diplômes obtenus dans le cadre de formations en santé et sécurité au travail',
    "Les formations suivies à l'initiative de votre employeur (secourisme, incendie, conduite d'engins, habilitation électrique, gestes et postures...)",
    'Les formations suivies de votre propre initiative',
  ])

  f.section('Qui le gère et qui peut l\'alimenter ?')
  f.para('Le passeport est géré par la Caisse des dépôts, sur la plateforme Mon Compte Formation (moncompteformation.gouv.fr). Il est rattaché à votre compte personnel. Trois acteurs peuvent l\'alimenter :')
  f.bullets([
    'Vous-même : vos formations et certifications',
    "Votre employeur : les formations qu'il a financées pour vous",
    `Votre organisme de formation : ${nom()} peut y inscrire directement les formations suivies chez nous`,
  ])

  f.section('Comment y accéder ?')
  f.bullets([
    'Rendez-vous sur moncompteformation.gouv.fr',
    "Connectez-vous avec votre identité numérique (FranceConnect+) ou créez votre compte",
    'Ouvrez la rubrique « Mon passeport de prévention »',
    'Consultez vos formations et attestations enregistrées, et complétez si nécessaire avec vos justificatifs',
  ])

  f.section('Après votre formation')
  f.bullets([
    `Conservez l'attestation ou le certificat remis par ${nom()}`,
    'Vérifiez que la formation figure bien dans votre passeport',
    "Si elle n'apparaît pas, ajoutez-la en joignant votre attestation",
    "Notez les dates de recyclage (secourisme : 24 mois, habilitation électrique : 3 ans, conduite d'engins : 5 ans)",
  ])

  f.section('Durées de validité usuelles')
  f.table(['Formation', 'Validité', 'Recyclage'], [
    ['Sauveteur secouriste du travail', '24 mois', 'MAC SST (1 jour)'],
    ['Incendie, équipier de première intervention', '12 mois recommandés', 'Recyclage incendie'],
    ["Conduite d'engins (R489, R485)", '5 ans', 'Recyclage conseillé'],
    ['Habilitation électrique', '3 ans recommandés', 'Recyclage habilitation'],
    ['Gestes et postures', 'Sans limite', 'Recommandé tous les 2 ans'],
  ], { columnStyles: { 0: { cellWidth: 80 } } })

  f.callout('Besoin d\'aide ?', `Contactez ${nom()} pour toute question sur le passeport de prévention ou vos attestations. ${contact()}`)
  f.finish()
  return doc
}

// ═══════════════════════════════════════════════════════════
// VERSION ENTREPRISE
// ═══════════════════════════════════════════════════════════
function generateVersionEntreprise() {
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, { docLabel: 'Passeport de prévention', code: 'PPREV-ENT', title: 'Passeport de prévention', subtitle: 'Guide à destination des employeurs' })

  f.callout(null, "Créé par la loi du 2 août 2021 (loi santé au travail), le passeport de prévention recense l'ensemble des formations suivies par chaque salarié en santé et sécurité au travail. En tant qu'employeur, vous participez à son alimentation.", { tone: 'highlight' })

  f.section('Vos obligations en tant qu\'employeur')
  f.bullets([
    'Renseigner les formations santé et sécurité dispensées à vos salariés',
    'Remettre à vos salariés les attestations et certificats de formation',
    "Veiller au recyclage des formations à échéance (secourisme, conduite d'engins, habilitation électrique...)",
    'Conserver les preuves de formation (Code du travail, article L.4141-5)',
  ])

  f.section('Formations concernées')
  f.table(['Formation', 'Durée usuelle', 'Validité', 'Référence'], [
    ['Sauveteur secouriste du travail', '14 h', '24 mois', 'Code du travail R.4224-15'],
    ['MAC SST (recyclage)', '7 h', '24 mois', 'Référentiel INRS'],
    ['Incendie, équipier de première intervention', '4 à 7 h', '12 mois recommandés', 'Code du travail R.4227-39'],
    ["Conduite d'engins (R489, R485)", '7 à 21 h', '5 ans', 'Code du travail R.4323-55'],
    ['Habilitation électrique', '7 h et plus', '3 ans recommandés', 'Norme NF C18-510'],
    ['Gestes et postures', '7 h', 'Sans limite', 'Code du travail R.4541-8'],
  ], { columnStyles: { 0: { cellWidth: 62 } } })

  f.section(`Comment ${nom()} vous accompagne`)
  f.bullets([
    'Remise systématique des attestations et certificats',
    'Traçabilité complète en ligne : émargement, évaluations, documents',
    "Alertes avant l'échéance de validité des certifications",
    'Formations dans vos locaux, adaptées à vos risques',
  ])

  f.section('Lien avec votre document unique (DUERP)')
  f.para("Les formations retenues comme mesures de prévention dans votre document unique doivent être réalisées et tracées : le passeport de prévention en apporte la preuve.")

  f.section('Prochaines étapes recommandées')
  f.bullets([
    'Faire un état des lieux des formations santé et sécurité de vos salariés',
    'Repérer les certifications qui arrivent à échéance dans les 6 prochains mois',
    'Planifier les recyclages nécessaires',
    "Informer vos salariés de l'existence du passeport de prévention",
  ])

  f.callout('Nous contacter', `${nom()}${qualiopi()} vous accompagne dans votre plan de formation. ${contact()}`)
  f.finish()
  return doc
}

// ═══════════════════════════════════════════════════════════
// DÉCHARGE : NIR NON COMMUNIQUÉ (22/10 : générée aux couleurs de l'organisme, plus de fichier à déposer)
// Décret n° 2025-748 du 1er août 2025 : l'organisme collecte le NIR (auprès de l'employeur ou du stagiaire) pour
// déclarer la formation ; sans NIR, il ne peut pas compléter le passeport et la déclaration revient à l'employeur.
// ═══════════════════════════════════════════════════════════
function generateDecharge(d = {}) {
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, { docLabel: 'Passeport de prévention', code: 'PPREV-NIR', title: 'Numéro de sécurité sociale non communiqué', subtitle: 'Passeport de prévention : déclaration du stagiaire' })
  f.fields([{ label: 'Nom et prénom du stagiaire', value: d.stagiaire || '', w: 2 }, { label: 'Date de naissance', value: d.naissance || '', w: 1 }])
  f.fields([{ label: 'Entreprise', value: d.entreprise || '', w: 2 }, { label: 'Poste', value: d.poste || '', w: 1 }])
  f.fields([{ label: 'Formation suivie', value: d.formation || '', w: 2 }, { label: 'Dates', value: d.dates || '', w: 1 }])
  f.section('Déclaration')
  f.para(`Je ${mot('soussigne', d.genre)}, stagiaire ${mot('designe', d.genre)} ci-dessus, ne communique pas mon numéro de sécurité sociale (NIR) à ${nom()} pour la déclaration de cette formation dans mon passeport de prévention.`)
  f.para(`Je suis ${mot('informe', d.genre)} que :`)
  f.bullets([
    `le passeport de prévention recense les formations en santé et sécurité au travail (loi du 2 août 2021, décret n° 2025-748 du 1er août 2025) et que mon numéro de sécurité sociale sert uniquement à y inscrire cette formation ;`,
    `sans ce numéro, ${nom()} ne peut pas déclarer cette formation dans mon passeport de prévention ;`,
    "la déclaration revient alors à mon employeur, et je peux moi-même ajouter cette formation à mon passeport, avec l'attestation remise, depuis moncompteformation.gouv.fr ;",
    `je peux à tout moment revenir sur ce choix en communiquant mon numéro à ${nom()} ou à mon employeur.`,
  ])
  f.space(2)
  // Signée en ligne depuis le portail stagiaire (0436) : signature, date et heure ; l'entreprise en est informée
  const quand = d.signedAt ? new Date(d.signedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }) : ''
  f.signatures(d.signature ? [
    { label: 'Le stagiaire', name: d.stagiaire || '', hint: `Signé en ligne le ${quand}`, image: d.signature },
  ] : [
    { label: 'Le stagiaire', hint: 'Date et signature' },
    { label: "Pour l'entreprise", hint: 'Nom, date et signature' },
  ], { height: 30 })
  f.note(`Document à remettre à ${nom()} au plus tard le jour de la formation. ${contact()}`)
  f.finish()
  return doc
}

// ═══════════════════════════════════════════════════════════
// AUTORISATION : L'EMPLOYEUR TRANSMET LE NIR (0440, 22/10 : le stagiaire ne retrouve pas son numéro)
// Signée dans le portail stagiaire, jointe à l'e-mail envoyé au contact de l'entreprise. Le document signé porte
// l'identifiant de la signature (mots-clés du PDF), contrôlé par le serveur avant l'envoi.
// ═══════════════════════════════════════════════════════════
function generateAutorisation(d = {}) {
  const doc = new jsPDF({ compress: true })
  if (d.signatureId) doc.setProperties({ keywords: `odet-autorisation-nir ${d.signatureId}` })
  const f = startDocument(doc, ORG, { docLabel: 'Passeport de prévention', code: 'PPREV-NIR-A', title: 'Transmission du numéro de sécurité sociale', subtitle: "Passeport de prévention : autorisation du stagiaire à son employeur" })
  f.fields([{ label: 'Nom et prénom du stagiaire', value: d.stagiaire || '', w: 2 }, { label: 'Date de naissance', value: d.naissance || '', w: 1 }])
  f.fields([{ label: 'Entreprise', value: d.entreprise || '', w: 2 }, { label: 'Poste', value: d.poste || '', w: 1 }])
  f.fields([{ label: 'Formation suivie', value: d.formation || '', w: 2 }, { label: 'Dates', value: d.dates || '', w: 1 }])
  f.section('Autorisation')
  f.para(`Je ${mot('soussigne', d.genre)}, stagiaire ${mot('designe', d.genre)} ci-dessus, ne retrouve pas mon numéro de sécurité sociale (NIR). J'autorise mon employeur, ${d.entreprise || 'désigné ci-dessus'}, à le transmettre à ${nom()}.`)
  f.para(`Je suis ${mot('informe', d.genre)} que :`)
  f.bullets([
    `ce numéro sert uniquement à inscrire cette formation dans mon passeport de prévention (loi du 2 août 2021, décret n° 2025-748 du 1er août 2025) ;`,
    `mon employeur le saisit dans son espace sécurisé chez ${nom()} : il est vérifié, rangé à part et n'est jamais transmis par e-mail ;`,
    `je peux retirer cette autorisation à tout moment en prévenant ${nom()} ou mon employeur.`,
  ])
  f.space(2)
  const quand = d.signedAt ? new Date(d.signedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }) : ''
  f.signatures(d.signature ? [
    { label: 'Le stagiaire', name: d.stagiaire || '', hint: `Signé en ligne le ${quand}`, image: d.signature },
  ] : [
    { label: 'Le stagiaire', hint: 'Date et signature' },
  ], { height: 30 })
  f.note(`Signature électronique simple : date, heure, appareil et empreinte du document conservés par ${nom()}. ${contact()}`)
  f.finish()
  return doc
}

// ═══════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════
export function generatePasseportPreventionPDF(version = 'stagiaire', orgSettings = null, donnees = {}) {
  applyOrgSettings(orgSettings)
  if (version === 'decharge') return generateDecharge(donnees)
  if (version === 'autorisation') return generateAutorisation(donnees)
  return version === 'entreprise' ? generateVersionEntreprise() : generateVersionStagiaire()
}

export async function downloadPasseportPrevention(version = 'stagiaire', orgSettings = null) {
  const doc = generatePasseportPreventionPDF(version, (await prepareOrgForPDF(orgSettings)) || orgSettings)
  doc.save(`Notice_Passeport_Prevention_${version === 'entreprise' ? 'Entreprise' : 'Stagiaire'}.pdf`)
}
