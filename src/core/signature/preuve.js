// Dossier de preuve d'une signature électronique simple (0402), en dernière page du document signé :
// signataire, date et heure, adresse IP et appareil relevés par le serveur, empreinte SHA-256 du document présenté,
// texte exact accepté, image de la signature. Commun à toutes les prestations (convention, devis, bon d'intervention).

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { startDocument } from '../pdf/layout'
import { reporterSignature } from './zone'

export function appareilLisible(ua) {
  const u = String(ua || '')
  if (!u) return ''
  const os = /iPhone|iPad/.test(u) ? 'iPhone ou iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS X/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : 'autre système'
  const nav = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'navigateur'
  return `${nav}, ${os}`
}

export function ajouterPagePreuve(doc, ORG, sig, { titre, reference, code = 'PREUVE', nouvellePage = true, reportee = false }) {
  if (nouvellePage) doc.addPage()
  const f = startDocument(doc, ORG, { ref: reference, docLabel: 'Dossier de preuve', code, title: 'Dossier de preuve de signature', subtitle: `${titre}${reference ? ` ${reference}` : ''}` })
  const quand = new Date(sig.signed_at)
  f.para("Ce document a été signé électroniquement depuis l'espace client, par signature électronique simple (règlement eIDAS, article 25 ; Code civil, articles 1366 et 1367). Les éléments ci-dessous ont été enregistrés par le serveur au moment de la signature et ne peuvent plus être modifiés.", { size: 8.5 })
  f.section('Signataire')
  f.kv([
    ['Nom', sig.signer_name || ''],
    ['Fonction', sig.signer_role || ''],
    ['Accès', sig.canal === 'compte' ? 'compte personnel de l\'espace entreprise' : 'lien et code personnel de l\'espace entreprise'],
  ])
  f.section('Signature')
  f.kv([
    ['Date et heure', `${quand.toLocaleDateString('fr-FR')} à ${quand.toLocaleTimeString('fr-FR')} (heure de Paris)`],
    ['Adresse IP', sig.ip_address || 'non transmise'],
    ['Appareil', appareilLisible(sig.user_agent) || 'non transmis'],
    ['Empreinte SHA-256', sig.document_hash ? `${sig.document_hash.slice(0, 32)} ${sig.document_hash.slice(32)}` : ''],
    ['Accord donné', sig.consentement || ''],
  ], { labelW: 40 })
  f.space(3)
  f.note(`Empreinte SHA-256 du PDF présenté au signataire avant sa signature : un document dont l'empreinte diffère n'est pas celui qui a été signé.${reportee ? " La signature reportée dans le cadre du signataire a été ajoutée après la signature ; le PDF présenté est conservé tel quel par l'organisme." : ''}`)
  if (sig.signature_data) f.signatures([{ label: 'Signature recueillie', name: sig.signer_name || '', hint: 'Tracée à l\'écran', image: sig.signature_data }], { height: 30 })
  f.finish()
}

/** Le PDF déposé (exactement celui signé) suivi de la page de preuve, en un seul fichier (base64) */
export async function documentAvecPreuve(original, ORG, sig, meta) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const sortie = await PDFDocument.load(original, { updateMetadata: false })
  // Signature reportée dans le cadre « Bon pour accord » du document, quand le générateur l'a noté (zone.js)
  let reportee = false
  try { reportee = await reporterSignature(sortie, sig, { StandardFonts, rgb }) } catch { reportee = false }
  const preuve = new jsPDF({ compress: true })
  ajouterPagePreuve(preuve, ORG, sig, { ...meta, nouvellePage: false, reportee })
  const p = await PDFDocument.load(preuve.output('arraybuffer'))
  const pages = await sortie.copyPages(p, p.getPageIndices())
  pages.forEach((pg) => sortie.addPage(pg))
  return sortie.saveAsBase64()
}
