// Titres délivrés par l'employeur (0387, décisions de H du 19/10) :
//   - titre d'habilitation électrique (norme NF C18-510 : symboles, domaine de tension, ouvrages, validité, signatures
//     de l'employeur et du titulaire) ;
//   - autorisation de conduite (article R4323-56 du code du travail et arrêté du 2 décembre 1998 : délivrée par
//     l'employeur sur la base de l'aptitude médicale, du contrôle des connaissances et du savoir-faire, et de la
//     connaissance des lieux et des instructions).
// Depuis le 01/10/2025, l'aptitude médicale prend la forme d'une attestation de non contre-indication valable 5 ans
// (articles R4323-56 et R4544-10). Le document est hors formation : ni NDA ni mention Qualiopi (orgHorsFormation).

import jsPDF from 'jspdf'
import { startDocument, drawImageFitted } from '../../../core/pdf/layout'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { orgHorsFormation } from '../../../core/org/orgUtils'

const frDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '')

/**
 * @param {object} p
 * @param {'habilitation_electrique'|'autorisation_conduite'} p.kind
 * @param {object} p.person      fiche du personnel (first_name, last_name, birth_date)
 * @param {string} p.jobTitle    fonction
 * @param {object} p.qual        titre (symbols, scope, label, obtained_on, expires_on, issuer)
 * @param {object|null} p.nci    attestation de non contre-indication (visit_on, next_due_on)
 * @param {object} p.signer      { nom, titre, image }
 * @param {string|null} p.employeeSignature image de la signature du salarié (null : à signer sur papier)
 * @param {string} p.deliveredOn date de délivrance (AAAA-MM-JJ)
 * @param {boolean} p.lieuxConnus connaissance des lieux et des instructions (conduite)
 * @returns {Promise<Blob>}
 */
export async function genererTitrePDF(p) {
  const ORG = orgHorsFormation(await loadPdfOrg(true))
  const doc = new jsPDF({ compress: true })
  const elec = p.kind === 'habilitation_electrique'
  const titre = elec ? "Titre d'habilitation électrique" : 'Autorisation de conduite'
  const f = startDocument(doc, ORG, {
    code: elec ? 'HAB' : 'AUT', docLabel: titre, title: titre,
    subtitle: elec ? 'Délivré par l\'employeur selon la norme NF C18-510' : 'Délivrée par l\'employeur (article R4323-56 du code du travail)',
  })
  const nom = `${p.person?.first_name || ''} ${(p.person?.last_name || '').toUpperCase()}`.trim()

  f.section('Titulaire')
  f.fields([{ label: 'Nom et prénom', value: nom, w: 2 }, { label: 'Fonction', value: p.jobTitle || '', w: 2 }])
  f.fields([{ label: 'Employeur', value: ORG.nameFull || ORG.name, w: 3 }, { label: 'Délivré le', value: frDate(p.deliveredOn) }, { label: "Valable jusqu'au", value: frDate(p.qual?.expires_on) || 'à préciser' }])

  if (elec) {
    f.section('Habilitation')
    f.fields([{ label: 'Symboles', value: (p.qual?.symbols || []).join(', ') || p.qual?.label || '', w: 2 }, { label: 'Domaine de tension', value: p.domaine || 'Basse tension (BT)', w: 1 }])
    f.para(`Ouvrages et domaine d'intervention : ${p.qual?.scope || 'à préciser'}`)
    f.para(`Formation suivie : ${[p.qual?.issuer, p.qual?.obtained_on && `le ${frDate(p.qual.obtained_on)}`].filter(Boolean).join(', ') || 'à préciser'}.`)
    f.note("Le titulaire doit être porteur de ce titre pendant ses interventions. Il ne peut exécuter que les opérations correspondant à ses symboles et dans les limites indiquées. L'habilitation est révisée en cas de changement de fonction, d'interruption prolongée, de restriction médicale ou de manquement aux règles de sécurité.")
  } else {
    f.section('Conduite autorisée')
    f.fields([{ label: 'Catégories', value: (p.qual?.symbols || []).join(', ') || p.qual?.label || '', w: 2 }])
    f.para(`Engins et lieux : ${p.qual?.scope || 'à préciser'}`)
    f.section("L'employeur s'est assuré de")
    f.checks([
      { label: `l'aptitude médicale : attestation de non contre-indication${p.nci ? ` du ${frDate(p.nci.visit_on)}, valable jusqu'au ${frDate(p.nci.next_due_on)}` : ' (à joindre)'}`, checked: !!p.nci },
      { label: `le contrôle des connaissances et du savoir-faire : ${[p.qual?.issuer, p.qual?.obtained_on && `le ${frDate(p.qual.obtained_on)}`].filter(Boolean).join(', ') || 'à préciser'}`, checked: !!(p.qual?.obtained_on || p.qual?.issuer) },
      { label: 'la connaissance des lieux et des instructions à respecter sur les sites d\'utilisation', checked: !!p.lieuxConnus },
    ])
  }

  if (elec) {
    f.section('Aptitude médicale')
    f.para(p.nci
      ? `Attestation de non contre-indication du ${frDate(p.nci.visit_on)}, valable jusqu'au ${frDate(p.nci.next_due_on)}.`
      : 'Attestation de non contre-indication à joindre (article R4544-10 du code du travail).')
  }

  // Signatures côte à côte
  f.ensure(48)
  f.space(4)
  const w = (f.W - 8) / 2
  const y0 = f.y
  const cadre = (x, label, nomS, qualite, image) => {
    doc.setDrawColor(...ORG.theme.line); doc.setLineWidth(0.3); doc.rect(x, y0, w, 40)
    doc.setFontSize(7); doc.setTextColor(...ORG.theme.muted); doc.text(label.toUpperCase(), x + 3, y0 + 5)
    doc.setFontSize(9); doc.setTextColor(...ORG.theme.text); doc.text(nomS || '', x + 3, y0 + 10)
    if (qualite) { doc.setFontSize(8); doc.text(qualite, x + 3, y0 + 14) }
    if (image) { try { drawImageFitted(doc, image, x + 3, y0 + 16, w - 6, 22) } catch { /* image illisible */ } }
  }
  cadre(f.M, "L'employeur", p.signer?.nom, p.signer?.titre, p.signer?.image)
  cadre(f.M + w + 8, 'Le titulaire', nom, 'Lu et approuvé', p.employeeSignature)
  f.y = y0 + 44
  f.note(`Fait à ${ORG.city || ''}, le ${frDate(p.deliveredOn)}.`)
  f.finish()
  return doc.output('blob')
}
