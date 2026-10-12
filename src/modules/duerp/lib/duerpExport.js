// src/lib/duerpExport.js
// Export DUERP - PDF & Excel Premium
// Export DUERP v5.1 : formations catalogue + texte agrandi + formation dans plan d'action
//
// CORRECTIFS v5.1 :
// - Filigrane diagonal corrige (centré, 2 lignes, plus visible)
// - Disclaimer couverture agrandi (7.5pt bold rouge)
// - Bandeau rouge agrandi (9mm, 7pt bold)
// - Catalogue formations : matchKeys affinés (R489/R485 ne matchent plus 'conduite')
// - Plan d'action : matchFormation explicite + normalisation accents
// - Fix "Gnull" quand gravite est null
// - Normalisation accents dans isFormationRelevant et matchFormation

import { orgName, orgCity, orgContactLine, currentUserName, docCode, orgDocPrefix } from '../../../core/org/currentOrg'
const ORGN = () => orgName() || "l'organisme"
import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { startDocument, numberPages, setF, PAGE_MARGIN, drawDocTitle } from '../../../core/pdf/layout'
import * as XLSX from 'xlsx-js-style'
// Logo de l'organisme : fourni par l'appelant via setDuerpLogo(org.logo_base64)
let LOGO_BASE64 = null
export function setDuerpLogo(base64) { LOGO_BASE64 = base64 || null }
import { getInrsRisksForSector, FORMATIONS_SECURITE } from './duerpInrsData'

// ═══════════════════════════════════════════
// CONSTANTES & HELPERS
// ═══════════════════════════════════════════
const C = {
  teal: [34, 85, 96], tealDark: [20, 60, 70], amber: [233, 180, 76],
  red: [185, 28, 28], orange: [194, 65, 12], yellow: [161, 98, 7], green: [22, 101, 52],
  gray: [107, 114, 128], grayLight: [156, 163, 175], grayBg: [243, 244, 246],
  white: [255, 255, 255], black: [30, 30, 30],
}
const HEX = {
  teal: '225560', tealLight: '2A6B7A', amber: 'E9B44C', darkBlue: '1A3C4D',
  white: 'FFFFFF', black: '1E1E1E', gray: '6B7280', grayBg: 'F3F4F6', grayLight: 'E5E7EB',
}
const LVL = {
  critique: { label: 'Critique', bg: [254, 226, 226], text: [153, 27, 27], hex: 'FEE2E2', hexTxt: '991B1B' },
  eleve:    { label: 'Eleve',    bg: [255, 237, 213], text: [154, 52, 18], hex: 'FFEDD5', hexTxt: '9A3412' },
  moyen:    { label: 'Moyen',    bg: [254, 249, 195], text: [113, 63, 18], hex: 'FEF9C3', hexTxt: '713F12' },
  faible:   { label: 'Faible',   bg: [220, 252, 231], text: [22, 101, 52], hex: 'DCFCE7', hexTxt: '166534' },
}
const riskLevel = (s) => s >= 13 ? LVL.critique : s >= 9 ? LVL.eleve : s >= 5 ? LVL.moyen : LVL.faible
const riskScore = (r) => Math.round((r.frequence || 0) * (r.gravite || 0) * (r.maitrise || 1))

const FREQ = { 1: 'Occasionnel', 2: 'Frequent', 3: 'Tres frequent', 4: 'Permanent' }
const GRAV = { 1: 'Minime', 2: 'Significatif', 3: 'Grave', 4: 'Tres grave' }
const MAIT = { 0.5: 'Bonne', 0.75: 'Partielle', 1: 'Insuffisante' }
const PRIO = { critique: 'CRITIQUE', haute: 'Haute', moyenne: 'Moyenne', basse: 'Basse' }
const STAT = { a_faire: 'A faire', en_cours: 'En cours', fait: 'Fait', annule: 'Annule' }
const TYPE_A = { prevention: 'Prevention', protection: 'Protection', formation: 'Formation', organisationnelle: 'Organisation', technique: 'Technique' }

const fmtDate = (d) => { if (!d) return '--'; try { return new Date(d).toLocaleDateString('fr-FR') } catch { return String(d) } }

// ── FILIGRANE ──
const WATERMARK_TEXT = "DOCUMENT D'APPUI - SANS VALEUR JURIDIQUE"
const BANNER_TEXT = () => "Document d'appui a la redaction - Sans valeur juridique - L'employeur reste seul responsable de son DUERP (Art. L.4121-1) - " + ORGN() + " decline toute responsabilite"

const DISCLAIMER_SHORT = () => "Document d'appui a la redaction elabore avec l'assistance de " + ORGN() + ". Ce document n'a PAS de valeur juridique et ne se substitue pas au DUERP officiel de l'employeur. L'employeur reste seul responsable de la redaction, de l'exhaustivite, de l'exactitude de l'evaluation des risques et de la mise en oeuvre des actions de prevention (Art. L.4121-1 et suivants du Code du travail). " + ORGN() + " decline toute responsabilite en cas d'oubli ou de risques non evalues."

const DISCLAIMER_FULL = () => [
  'AVERTISSEMENT IMPORTANT -- LIMITES DE RESPONSABILITE', '',
  "Le present document est un APPUI A LA REDACTION du Document Unique d'Evaluation des Risques Professionnels (DUERP). Il a ete elabore avec l'assistance de " + ORGN() + " dans le cadre d'une prestation d'accompagnement et de conseil.", '',
  "CE DOCUMENT N'A PAS DE VALEUR JURIDIQUE et ne constitue en aucun cas le DUERP officiel de l'entreprise. Il ne peut etre presente comme tel lors d'un controle de l'inspection du travail.", '',
  "" + ORGN() + " intervient en tant que prestataire d'aide a la redaction et a la structuration du DUERP. Cette prestation ne se substitue en aucun cas a l'obligation legale de l'employeur.", '',
  'Conformement aux articles L.4121-1 a L.4121-5 et R.4121-1 a R.4121-4 du Code du travail :',
  "  - L'employeur est seul responsable de la transcription et de la mise a jour du DUERP",
  "  - L'employeur est seul responsable de l'exhaustivite et de l'exactitude de l'evaluation des risques",
  "  - L'employeur est seul responsable de la mise en oeuvre des actions de prevention",
  "  - L'employeur est seul garant de la consultation des representants du personnel (CSE le cas echeant)", '',
  "" + ORGN() + " ne saurait etre tenue responsable d'eventuelles omissions, inexactitudes, insuffisances ou risques non evalues dans le present document.", '',
  "Ce document constitue un outil d'aide a la decision et ne remplace pas l'expertise d'un IPRP.",
]

// ── CATALOGUE DES FORMATIONS DE L'ORGANISME ──
const CATALOGUE_FORMATIONS = [
  { code: 'SST-FI', label: 'Sauveteur Secouriste du Travail (SST initial)', ref: 'PROG-FI SST', duree: '14h (2 jours)', validite: '2 ans', reglementation: 'Art. R4224-15', matchKeys: ['*'], description: 'Au moins un SST par atelier ou chantier' },
  { code: 'MAC-SST', label: 'MAC SST (maintien et actualisation des compétences)', ref: 'PROG-MAC SST', duree: '7h (1 jour)', validite: '2 ans', reglementation: 'Art. R4224-15', matchKeys: ['*'], description: 'Recyclage obligatoire tous les 2 ans' },
  { code: 'IGPS', label: 'Initiation aux gestes de premiers secours', ref: 'PROG-IGPS', duree: '4h', validite: '1 an', reglementation: 'Art. R4224-15', matchKeys: ['*'], description: 'Sensibilisation premiers secours' },
  { code: 'G&P', label: 'Gestes et postures', ref: 'PROG-G&P', duree: '4h', validite: '1 an', reglementation: 'Art. R4541-8', matchKeys: ['tms', 'manutention', 'physique', 'posture', 'ergonomie', 'port_charge', 'port de charge', 'contrainte', 'fauteuil roulant', 'lourde'], description: 'Réduction des TMS, postures adaptées' },
  { code: 'EXT', label: 'Manipulation des extincteurs', ref: 'PROG-EXT', duree: '2h', validite: '1 an', reglementation: 'Art. R4227-39', matchKeys: ['incendie', 'feu', 'depart de feu', 'combustible', 'inflammab', 'extincteur'], description: 'Réagir face à un départ de feu' },
  { code: 'EPI', label: 'Équipier de première intervention (EPI)', ref: 'PROG-EPI', duree: '4h', validite: '1 an', reglementation: 'Art. R4227-39', matchKeys: ['incendie', 'feu', 'depart de feu', 'evacuation', 'combustible', 'inflammab'], description: 'Extinction et évacuation coordonnée' },
  { code: 'R489', label: 'Formation interne R489 cat. 1B, 3 et 5 (chariots)', ref: 'PROG-R489', duree: '7h par catégorie', validite: '5 ans', reglementation: 'Art. R4323-55', matchKeys: ['chariot', 'cariste', 'gerbage', 'degerbage', 'fourche', 'palette', 'gerbeur_chariot', 'transpalette_electrique', 'r489'], description: 'Autorisation de conduite chariots' },
  { code: 'R485', label: 'Formation interne R485 cat. 1 et 2 (gerbeurs)', ref: 'PROG-R485', duree: '7h', validite: '5 ans', reglementation: 'Art. R4323-55', matchKeys: ['gerbeur', 'gerbage', 'degerbage', 'palette', 'transpalette', 'r485'], description: 'Autorisation de conduite gerbeurs' },
  { code: 'ELEC', label: 'Habilitation électrique B0-H0-H0V', ref: 'PROG-FI B0H0V', duree: '7h (1 jour)', validite: '3 ans', reglementation: 'NF C18-510', matchKeys: ['electrique', 'electrocution', 'electrisation', 'multiprise', 'armoire electrique', 'habilitation'], description: 'Opérations non électriques en zone à risque' },
]

// Helper : normalise accents
function normTxt(s) { return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() }

// Helper : determine si une formation est pertinente pour les risques detectes
function isFormationRelevant(formation, risks, categories) {
  if (formation.matchKeys.includes('*')) return true
  const allCodes = risks.map(r => normTxt(r.category_code))
  const allDangers = risks.map(r => normTxt(r.danger))
  const allSituations = risks.map(r => normTxt(r.situation))
  const allCatNames = (categories || []).map(c => normTxt(c.name))
  const allText = [...allCodes, ...allDangers, ...allSituations, ...allCatNames].join(' ')
  return formation.matchKeys.some(k => allText.includes(k))
}

// ── Accompagnateur : l'utilisateur qui génère le document ──
function getAccompagnateurName(userEmail) {
  const me = currentUserName()
  if (me) return me
  return ORGN()
}

// ═══════════════════════════════════════════════════════════
// PDF : mise en page commune des documents (core/pdf/layout.js)
// ═══════════════════════════════════════════════════════════
const LVL_FR = { critique: 'Critique', eleve: 'Élevé', moyen: 'Moyen', faible: 'Faible' }
const lvlKey = (s) => s >= 13 ? 'critique' : s >= 9 ? 'eleve' : s >= 5 ? 'moyen' : 'faible'
const FREQ_FR = { 1: 'Occasionnel', 2: 'Fréquent', 3: 'Très fréquent', 4: 'Permanent' }
const PRIO_FR = { critique: 'Critique', haute: 'Haute', moyenne: 'Moyenne', basse: 'Basse' }
const PRIO_LVL = { critique: 'critique', haute: 'eleve', moyenne: 'moyen', basse: 'faible' }
const STAT_FR = { a_faire: 'À faire', en_cours: 'En cours', fait: 'Fait', annule: 'Annulé' }
const TYPE_FR = { prevention: 'Prévention', protection: 'Protection', formation: 'Formation', organisationnelle: 'Organisation', technique: 'Technique' }
const DISCLAIMER_PDF = (orgN) => [
  `Le présent document est un appui à la rédaction du Document unique d'évaluation des risques professionnels (DUERP). Il a été élaboré avec l'assistance de ${orgN} dans le cadre d'une prestation d'accompagnement et de conseil.`,
  "Il n'a pas de valeur juridique et ne constitue pas le DUERP officiel de l'entreprise. Il ne peut être présenté comme tel lors d'un contrôle de l'inspection du travail.",
  "Conformément aux articles L.4121-1 à L.4121-5 et R.4121-1 à R.4121-4 du Code du travail, l'employeur est seul responsable de la transcription et de la mise à jour du DUERP, de l'exhaustivité et de l'exactitude de l'évaluation des risques, de la mise en œuvre des actions de prévention et de la consultation des représentants du personnel (CSE le cas échéant).".replace('œ', 'oe'),
  `${orgN} ne saurait être tenu responsable d'éventuelles omissions, inexactitudes, insuffisances ou risques non évalués. Ce document est un outil d'aide à la décision et ne remplace pas l'expertise d'un IPRP.`,
]

export async function generateDuerpPDF({ project, units, risks, actions, categories, userEmail }) {
  const ORG = await loadPdfOrg(true)
  const orgN = ORG.name || ORGN()
  const t = ORG.theme
  const doc = new jsPDF({ compress: true })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const BOTTOM = ph - 26
  const TBL = { margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, top: 24, bottom: 28 } }
  const accompName = getAccompagnateurName(userEmail)
  const eff = parseInt(project.effectif) || 0
  const scored = risks.map(r => ({ ...r, _score: riskScore(r) }))
  const evaluated = risks.filter(r => r.frequence && r.gravite).length
  const nonEvaluated = risks.length - evaluated
  const highCount = scored.filter(r => r._score >= 9).length
  const doneActions = actions.filter(a => a.statut === 'fait').length
  const orphanRisks = scored.filter(r => !r.unit_id)
  const bigTitle = (label) => { f.y = drawDocTitle(doc, ORG, label, null, f.y, { size: 14 }) + 1 }
  const colorLevel = (data, col, keyOf) => {
    if (data.section !== 'body' || data.column.index !== col) return
    const k = keyOf(data)
    if (k && LVL[k]) { data.cell.styles.fillColor = LVL[k].bg; data.cell.styles.textColor = LVL[k].text; data.cell.styles.fontStyle = 'bold' }
  }

  const f = startDocument(doc, ORG, {
    ref: project.reference || null,
    docLabel: 'Document unique',
    code: 'DUERP',
    title: "Document unique d'évaluation des risques professionnels",
    subtitle: "Document d'appui à la rédaction, sans valeur juridique",
    bottom: BOTTOM,
  })

  // ── Couverture ──
  const addr = project.address ? `${project.address}${project.postal_code && !project.address.includes(project.postal_code) ? ', ' + [project.postal_code, project.city].filter(Boolean).join(' ') : ''}` : ''
  f.cards([
    { label: 'Entreprise', lines: [project.company_name || '', addr, project.siret ? `SIRET ${project.siret}` : '', project.naf_code ? `NAF ${project.naf_code} ${project.naf_label || ''}` : '', project.effectif ? `Effectif : ${project.effectif} salarié(s)` : ''].filter(Boolean) },
    { label: 'Accompagnement', lines: [accompName, ORG.name || '', `Élaboré le ${fmtDate(project.date_elaboration)}`, project.date_visite ? `Visite le ${fmtDate(project.date_visite)}` : '', project.version ? `Version ${project.version}` : ''].filter(Boolean) },
  ])
  // Chiffres clés
  const tiles = [[risks.length, 'risques identifiés'], [evaluated, 'risques évalués'], [highCount, 'élevés ou critiques'], [actions.length, 'actions de prévention']]
  const tw = (f.W - 3 * 4) / 4
  f.ensure(22)
  tiles.forEach(([n, l], i) => {
    const x = f.M + i * (tw + 4)
    doc.setFillColor(...t.surface); doc.rect(x, f.y, tw, 18, 'F')
    setF(doc, 'bold'); doc.setFontSize(16); doc.setTextColor(...(i === 2 && n > 0 ? LVL.critique.text : t.primary))
    doc.text(String(n), x + tw / 2, f.y + 9, { align: 'center' })
    setF(doc, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...t.muted)
    doc.text(l, x + tw / 2, f.y + 14.5, { align: 'center' })
  })
  doc.setTextColor(...t.text)
  f.y += 25

  f.section('Sommaire')
  f.kv([
    ['1. Synthèse', "Unités de travail, principaux risques, actions prioritaires, formations, obligations"],
    ['2. Méthode', 'Cotation fréquence × gravité × maîtrise et matrice'],
    ['3. Inventaire', `${units.length} unité(s) de travail, ${risks.length} risque(s) identifié(s)`],
    ["4. Plan d'action", `${actions.length} action(s) dont ${doneActions} réalisée(s)`],
    ['5. Mentions', 'Rappels réglementaires, avertissement et signatures'],
  ], { labelW: 34 })
  f.space(3)
  f.callout('Comment lire ce document', "Pour une vision d'ensemble, la section 1 suffit. Les sections 2 à 4 détaillent la cotation, l'inventaire complet et le plan d'action. La section 5 rappelle les obligations et porte les signatures.", { tone: 'muted' })
  f.callout("Document d'appui à la rédaction", `Document élaboré avec l'assistance de ${orgN}. Il n'a pas de valeur juridique et ne se substitue pas au DUERP officiel de l'employeur, seul responsable de la rédaction, de l'exhaustivité et de l'exactitude de l'évaluation des risques, ainsi que de la mise en oeuvre des actions de prévention (art. L.4121-1 et suivants du Code du travail).`, { tone: 'highlight' })

  // ── 1. Synthèse ──
  f.newPage()
  bigTitle('1. Synthèse pour le dirigeant')
  f.para("Ce document est un appui à la rédaction de votre DUERP. Il recense les risques identifiés lors de la visite et propose les actions à mettre en place.")
  if (project.notes && project.notes.trim()) f.callout('Observations terrain', project.notes.trim(), { tone: 'muted' })

  f.section(`Unités de travail (${units.length})`)
  const unitRows = units.map(u => {
    const ur = scored.filter(r => r.unit_id === u.id)
    const ms = Math.max(0, ...ur.map(r => r._score))
    return [u.name || '', u.effectif ? `${u.effectif}` : '-', String(ur.length), String(ur.filter(r => r._score >= 9).length), ms > 0 ? LVL_FR[lvlKey(ms)] : 'Non évalué']
  })
  if (orphanRisks.length) unitRows.push(['Risques non rattachés à une unité', '-', String(orphanRisks.length), String(orphanRisks.filter(r => r._score >= 9).length), 'À rattacher'])
  if (unitRows.length) {
    const keys = unitRows.map(r => Object.keys(LVL_FR).find(k => LVL_FR[k] === r[4]))
    f.table(['Unité de travail', 'Effectif', 'Risques', 'Élevés ou critiques', 'Niveau maximal'], unitRows, { ...TBL,
      columnStyles: { 1: { cellWidth: 18, halign: 'center' }, 2: { cellWidth: 18, halign: 'center' }, 3: { cellWidth: 30, halign: 'center' }, 4: { cellWidth: 30, halign: 'center' } },
      didParseCell: (d) => colorLevel(d, 4, (x) => keys[x.row.index]) })
  }

  const seen = new Set()
  const topRisks = scored.filter(r => {
    if (!r._score || r._score <= 0) return false
    const key = `${r.danger}__${r.unit_id || ''}`
    if (seen.has(key)) return false
    seen.add(key); return true
  }).sort((a, b) => b._score - a._score).slice(0, 10)
  f.section('Principaux risques identifiés')
  if (!topRisks.length) f.note('Aucun risque évalué.')
  else {
    f.note(`Sur ${risks.length} risque(s), dont ${nonEvaluated} non évalué(s), voici les ${topRisks.length} plus importants.`, { after: 2 })
    f.table(['#', 'Danger et situation', 'Unité', 'Cotation', 'Score', 'Niveau'], topRisks.map((r, i) => [
      String(i + 1),
      [r.danger || '', r.situation || ''].filter(Boolean).join('\n'),
      units.find(u => u.id === r.unit_id)?.name || 'Non rattaché',
      `F${r.frequence || '?'} × G${r.gravite || '?'} × M${r.maitrise || '?'}`.replace(/×/g, 'x'),
      String(r._score),
      LVL_FR[lvlKey(r._score)],
    ]), { ...TBL,
      columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 2: { cellWidth: 34 }, 3: { cellWidth: 26, halign: 'center' }, 4: { cellWidth: 14, halign: 'center', fontStyle: 'bold' }, 5: { cellWidth: 20, halign: 'center' } },
      didParseCell: (d) => colorLevel(d, 5, (x) => lvlKey(topRisks[x.row.index]._score)) })
  }

  const sortedAct = [...actions].sort((a, b) => { const p = { critique: 0, haute: 1, moyenne: 2, basse: 3 }; return (p[a.priorite] ?? 9) - (p[b.priorite] ?? 9) })
  const topAct = sortedAct.slice(0, 12)
  f.section('Actions prioritaires')
  if (!topAct.length) f.note('Aucune action définie.')
  else {
    f.note(`${actions.length} action(s), dont ${doneActions} réalisée(s).`, { after: 2 })
    f.table(['Priorité', 'Action', 'Responsable', 'Échéance', 'Statut'], topAct.map(a => [PRIO_FR[a.priorite] || '-', a.action || '', a.responsable || '-', a.echeance ? fmtDate(a.echeance) : '-', STAT_FR[a.statut] || '-']), { ...TBL,
      columnStyles: { 0: { cellWidth: 20, halign: 'center' }, 2: { cellWidth: 32 }, 3: { cellWidth: 22, halign: 'center' }, 4: { cellWidth: 20, halign: 'center' } },
      didParseCell: (d) => colorLevel(d, 0, (x) => PRIO_LVL[topAct[x.row.index].priorite]) })
  }

  f.section(`Formations recommandées par ${orgN}`)
  f.note('Les formations marquées « Recommandée » correspondent directement aux risques relevés dans ce document.', { after: 2 })
  const formRows = CATALOGUE_FORMATIONS.map(fo => [isFormationRelevant(fo, risks, categories) ? 'Recommandée' : '', fo.label, fo.duree, fo.validite, fo.reglementation, fo.description])
  f.table(['', 'Formation', 'Durée', 'Validité', 'Référence', 'Objet'], formRows, { ...TBL,
    styles: { font: 'helvetica', fontSize: 7.8, textColor: t.text, lineColor: t.line, lineWidth: 0.2, cellPadding: 2, overflow: 'linebreak', valign: 'middle' },
    columnStyles: { 0: { cellWidth: 22, halign: 'center', fontSize: 7 }, 1: { cellWidth: 52, fontStyle: 'bold' }, 2: { cellWidth: 22 }, 3: { cellWidth: 15, halign: 'center' }, 4: { cellWidth: 24 } },
    didParseCell: (d) => colorLevel(d, 0, (x) => formRows[x.row.index][0] ? 'faible' : null) })
  const contact = orgContactLine()
  if (contact) f.callout('Pour un devis personnalisé', contact.split(' | ').join('   ·   '))

  f.section('Vos obligations')
  f.kv([
    ['Mise à jour', eff >= 11 ? 'Entreprise de 11 salariés et plus : mise à jour annuelle obligatoire, et à chaque changement significatif.' : 'Entreprise de moins de 11 salariés : mise à jour à chaque changement significatif ; annuelle recommandée.'],
    ['Conservation', 'Le DUERP et ses versions successives, datées, sont conservés 40 ans.'],
    [eff >= 50 ? 'PAPRIPACT' : 'Actions', eff >= 50 ? 'Programme annuel de prévention des risques obligatoire.' : 'Les actions de prévention sont consignées dans le DUERP.'],
    ['Diffusion', `À disposition des salariés, du médecin du travail, de l'inspection du travail et de la CARSAT.${eff >= 11 ? ' Consultation du CSE obligatoire.' : ''}`],
    ['Femmes et hommes', 'Loi du 2 août 2021 : évaluation différenciée selon le sexe.'],
  ], { labelW: 36 })
  f.space(3)
  const nds = fmtDate(project.date_prochaine_maj) !== '--' ? fmtDate(project.date_prochaine_maj) : (eff >= 11 ? `avant le ${fmtDate(new Date(new Date().setFullYear(new Date().getFullYear() + 1)))}` : 'lors du prochain changement significatif')
  f.section('Prochaines étapes')
  f.bullets(['Prendre connaissance de cette synthèse.', 'Vérifier que les risques correspondent à la réalité du terrain et compléter si nécessaire.', 'Mettre en œuvre les actions prioritaires en premier, puis planifier les suivantes.'.replace('œ', 'oe'), `Prochaine mise à jour recommandée : ${nds}.`])

  // ── 2. Méthode ──
  f.newPage()
  bigTitle('2. Méthode de cotation')
  f.callout('Risque résiduel', 'Fréquence (1 à 4) x Gravité (1 à 4) x Coefficient de maîtrise (0,5 à 1). Critique à partir de 13, élevé de 9 à 12, moyen de 5 à 8, faible en dessous.')
  const small = { ...TBL, columnStyles: { 0: { cellWidth: 16, halign: 'center', fontStyle: 'bold' }, 1: { cellWidth: 40 } } }
  f.table(['Niveau', 'Fréquence', 'Description'], [['1', 'Occasionnel', 'Quelques fois par mois'], ['2', 'Fréquent', 'Plusieurs fois par jour'], ['3', 'Très fréquent', 'Plusieurs fois par heure'], ['4', 'Permanent', 'Exposition continue']], small)
  f.table(['Niveau', 'Gravité', 'Description'], [['1', 'Minime', 'Premiers soins'], ['2', 'Significatif', 'Sans arrêt de travail'], ['3', 'Grave', 'Avec arrêt, maladie professionnelle'], ['4', 'Très grave', 'Incapacité permanente, décès']], small)
  f.table(['Coef.', 'Maîtrise', 'Description'], [['0,5', 'Bonne', 'Mesures en place et efficaces'], ['0,75', 'Partielle', 'Mesures partielles'], ['1', 'Insuffisante', 'Aucune mesure']], small)
  f.section('Matrice fréquence x gravité (nombre de risques entre parenthèses)')
  const mBody = []
  for (let fq = 4; fq >= 1; fq--) {
    const row = [`${fq} ${FREQ_FR[fq]}`]
    for (let g = 1; g <= 4; g++) { const cnt = risks.filter(r => r.frequence === fq && r.gravite === g).length; row.push(cnt > 0 ? `${fq * g}  (${cnt})` : `${fq * g}`) }
    mBody.push(row)
  }
  f.table(['F \\ G', '1 Minime', '2 Significatif', '3 Grave', '4 Très grave'], mBody, { ...TBL,
    columnStyles: { 0: { cellWidth: 40, fontStyle: 'bold' }, 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' } },
    didParseCell: (d) => { if (d.section === 'body' && d.column.index > 0) { const k = lvlKey((4 - d.row.index) * d.column.index); d.cell.styles.fillColor = LVL[k].bg; d.cell.styles.textColor = LVL[k].text; d.cell.styles.fontStyle = 'bold' } } })

  // ── 3. Inventaire ──
  f.newPage()
  bigTitle('3. Inventaire des risques par unité de travail')
  const riskRow = (r) => {
    const cat = categories.find(c => c.code === r.category_code)
    const sc = riskScore(r)
    return [cat?.label || r.category_code || '-', r.danger || '-', r.situation || '-', (r.frequence && r.gravite) ? `F${r.frequence} G${r.gravite}` : '-', r.maitrise != null ? `x${String(r.maitrise).replace('.', ',')}` : '-', sc > 0 ? String(sc) : '-', sc > 0 ? LVL_FR[lvlKey(sc)] : 'Non évalué', r.prevention_existante || '-']
  }
  const riskTable = (list) => {
    const rows = list.map(riskRow)
    f.table(['Catégorie', 'Danger', 'Situation', 'F x G', 'M', 'Score', 'Niveau', 'Prévention existante'], rows, { ...TBL,
      styles: { font: 'helvetica', fontSize: 7.6, textColor: t.text, lineColor: t.line, lineWidth: 0.2, cellPadding: 1.8, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: t.primary, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7, cellPadding: 2 },
      columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 26 }, 2: { cellWidth: 36 }, 3: { cellWidth: 13, halign: 'center' }, 4: { cellWidth: 10, halign: 'center' }, 5: { cellWidth: 11, halign: 'center', fontStyle: 'bold' }, 6: { cellWidth: 17, halign: 'center' } },
      didParseCell: (d) => colorLevel(d, 6, (x) => { const sc = riskScore(list[x.row.index]); return sc > 0 ? lvlKey(sc) : null }) })
  }
  units.forEach(u => {
    const ur = risks.filter(r => r.unit_id === u.id)
    f.ensure(30)
    f.section(`${u.code ? String(u.code).toUpperCase() + ' · ' : ''}${u.name || ''}${u.effectif ? ` · ${u.effectif} pers.` : ''}`)
    if (!ur.length) { f.note('Aucun risque.', { after: 4 }); return }
    riskTable(ur)
  })
  if (orphanRisks.length) {
    f.ensure(30)
    f.section(`Risques non rattachés à une unité (${orphanRisks.length})`)
    riskTable(orphanRisks)
  }

  // ── 4. Plan d'action ──
  f.newPage()
  bigTitle("4. Plan d'action de prévention")
  if (!actions.length) f.note('Aucune action définie.')
  else {
    const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const matchFormation = (action) => {
      if (action.type_action !== 'formation') return ''
      const txt = norm(action.action || '')
      if (txt.includes('gestes et postures') || txt.includes('geste et posture') || txt.includes('transfert')) return docCode('PROG-G&P')
      if (txt.includes('extincteur') || txt.includes('incendie') || txt.includes('evacuation')) return docCode('PROG-EXT')
      if (txt.includes('epi') && txt.includes('quipier')) return docCode('PROG-EPI')
      if (txt.includes('habilitation') && txt.includes('lectr')) return docCode('PROG-FI B0H0V')
      if (txt.includes('chariot') || txt.includes('cariste') || txt.includes('r489')) return docCode('PROG-R489')
      if (txt.includes('gerbeur') || txt.includes('r485')) return docCode('PROG-R485')
      if (txt.includes('sst') || txt.includes('secouris')) return docCode('PROG-FI SST')
      if (txt.includes('premiers secours')) return docCode('PROG-IGPS')
      if (txt.includes('ergonomie') || txt.includes('posture') || txt.includes('poste de travail')) return docCode('PROG-G&P')
      if (txt.includes('electrique') || txt.includes('risque electrique')) return docCode('PROG-FI B0H0V')
      return ''
    }
    f.table(['Priorité', 'Action', 'Type', 'Responsable', 'Échéance', 'Statut', 'Formation', 'Risque lié'], sortedAct.map(a => {
      const r = risks.find(x => x.id === a.risk_id)
      return [PRIO_FR[a.priorite] || '-', a.action || '-', TYPE_FR[a.type_action] || a.type_action || '-', a.responsable || '-', a.echeance ? fmtDate(a.echeance) : '-', STAT_FR[a.statut] || '-', matchFormation(a), r?.danger || '-']
    }), { ...TBL,
      styles: { font: 'helvetica', fontSize: 7.6, textColor: t.text, lineColor: t.line, lineWidth: 0.2, cellPadding: 1.8, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: t.primary, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7, cellPadding: 2 },
      columnStyles: { 0: { cellWidth: 17, halign: 'center' }, 1: { cellWidth: 44 }, 2: { cellWidth: 20 }, 3: { cellWidth: 22 }, 4: { cellWidth: 17, halign: 'center' }, 5: { cellWidth: 15, halign: 'center' }, 6: { cellWidth: 20, halign: 'center', textColor: t.accent, fontStyle: 'bold' } },
      didParseCell: (d) => {
        colorLevel(d, 0, (x) => PRIO_LVL[sortedAct[x.row.index].priorite])
        colorLevel(d, 5, (x) => sortedAct[x.row.index].statut === 'fait' ? 'faible' : null)
      } })
  }

  // ── 5. Mentions ──
  f.newPage()
  bigTitle('5. Rappels réglementaires et mentions légales')
  f.bullets([
    'Conservation 40 ans (art. L.4121-3-1 V du Code du travail)',
    `Mise à jour : ${eff >= 11 ? 'annuelle obligatoire' : 'à chaque changement significatif'}, et lors de tout aménagement important`,
    'Consultation du CSE, le cas échéant',
    'Évaluation différenciée selon le sexe (art. L.4121-3)',
    eff >= 50 ? 'PAPRIPACT obligatoire' : 'Liste des actions de prévention intégrée au DUERP',
    'Transmission au service de prévention et de santé au travail à chaque mise à jour',
    'Mise à disposition des salariés, anciens salariés, inspection du travail et CARSAT',
  ])
  f.space(2)
  f.callout('Avertissement', DISCLAIMER_PDF(orgN).join('\n\n'), { tone: 'highlight' })
  f.signatures([
    { label: "L'employeur", name: project.contact_name || '', hint: 'Date et signature' },
    { label: "L'accompagnateur", name: accompName, hint: 'Date et signature' },
  ], { height: 34 })

  f.finish()

  // Filigrane discret et rappel de responsabilité sur chaque page
  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    try {
      doc.saveGraphicsState()
      doc.setGState(new doc.GState({ opacity: 0.06 }))
      setF(doc, 'bold'); doc.setTextColor(...t.primary)
      doc.setFontSize(40); doc.text("DOCUMENT D'APPUI", pw * 0.2, ph * 0.6, { angle: 45 })
      doc.setFontSize(28); doc.text('SANS VALEUR JURIDIQUE', pw * 0.22, ph * 0.67, { angle: 45 })
      doc.restoreGraphicsState()
    } catch { /* filigrane facultatif */ }
    setF(doc, 'normal'); doc.setFontSize(6.5); doc.setTextColor(...LVL.critique.text)
    doc.text(`Document d'appui à la rédaction, sans valeur juridique. L'employeur reste seul responsable de son DUERP (art. L.4121-1 du Code du travail).`, PAGE_MARGIN, ph - 19.5)
  }
  numberPages(doc, ORG)

  const fname = `DUERP_${(project.company_name || 'export').replace(/[^a-zA-Z0-9]/g, '_')}_${project.reference || ''}.pdf`
  doc.save(fname); return fname
}

// ═══════════════════════════════════════════════════════════
// EXCEL PREMIUM - 9 ONGLETS (xlsx-js-style)
// ═══════════════════════════════════════════════════════════

// ── Style helpers ──
const BDR = { top: { style: 'thin', color: { rgb: 'CCCCCC' } }, bottom: { style: 'thin', color: { rgb: 'CCCCCC' } }, left: { style: 'thin', color: { rgb: 'CCCCCC' } }, right: { style: 'thin', color: { rgb: 'CCCCCC' } } }
const sHdr = (color = HEX.teal, sz = 11) => ({ font: { bold: true, sz, color: { rgb: color === HEX.amber ? HEX.black : HEX.white } }, fill: { fgColor: { rgb: color } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: BDR })
const sNorm = { font: { sz: 10 }, alignment: { vertical: 'center', wrapText: true }, border: BDR }
const sBold = { font: { bold: true, sz: 10 }, alignment: { vertical: 'center', wrapText: true }, border: BDR }
const sCenter = { font: { sz: 10 }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: BDR }
const sLabel = { font: { bold: true, sz: 11, color: { rgb: HEX.teal } }, alignment: { vertical: 'center' } }
const sVal = { font: { sz: 11 }, alignment: { vertical: 'center' } }
const sRisk = (score) => { const l = riskLevel(score); return { font: { bold: true, sz: 10, color: { rgb: l.hexTxt } }, fill: { fgColor: { rgb: l.hex } }, alignment: { horizontal: 'center', vertical: 'center' }, border: BDR } }
const sPrio = (prio) => { const m = { critique: LVL.critique, haute: LVL.eleve, moyenne: LVL.moyen, basse: LVL.faible }; const l = m[prio] || LVL.moyen; return { font: { bold: true, sz: 10, color: { rgb: l.hexTxt } }, fill: { fgColor: { rgb: l.hex } }, alignment: { horizontal: 'center', vertical: 'center' }, border: BDR } }

function applyStyles(ws, styleMap) {
  for (const [ref, style] of Object.entries(styleMap)) {
    if (!ws[ref]) ws[ref] = { v: '', t: 's' }
    ws[ref].s = style
  }
}

function styleRange(ws, r1, c1, r2, c2, style) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const ref = XLSX.utils.encode_cell({ r, c })
      if (!ws[ref]) ws[ref] = { v: '', t: 's' }
      ws[ref].s = style
    }
  }
}

function setCell(ws, r, c, val, style) {
  const ref = XLSX.utils.encode_cell({ r, c })
  ws[ref] = { v: val, t: typeof val === 'number' ? 'n' : 's' }
  if (style) ws[ref].s = style
  if (!ws['!ref']) ws['!ref'] = `A1:${ref}`
  else {
    const range = XLSX.utils.decode_range(ws['!ref'])
    if (r > range.e.r) range.e.r = r
    if (c > range.e.c) range.e.c = c
    ws['!ref'] = XLSX.utils.encode_range(range)
  }
}

export function generateDuerpExcel({ project, units, risks, actions, categories, userEmail }) {
  const accompName = getAccompagnateurName(userEmail)
  const wb = XLSX.utils.book_new()
  const eff = parseInt(project.effectif) || 0
  const scored = risks.map(r => ({ ...r, _score: riskScore(r) }))
  const doneAct = actions.filter(a => a.statut === 'fait').length
  const sortedActX = [...actions].sort((a, b) => { const p = { critique: 0, haute: 1, moyenne: 2, basse: 3 }; return (p[a.priorite] ?? 9) - (p[b.priorite] ?? 9) })

  const sectorKey = project.sector_template || project.secteur || ''

  // ═══ 1. PRESENTATION ═══
  const ws1 = XLSX.utils.aoa_to_sheet([])
  ws1['!ref'] = 'A1:F20'
  ws1['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } }, { s: { r: 3, c: 0 }, e: { r: 3, c: 5 } }, { s: { r: 15, c: 0 }, e: { r: 15, c: 5 } }]
  ws1['!cols'] = [{ wch: 16 }, { wch: 30 }, { wch: 5 }, { wch: 16 }, { wch: 30 }, { wch: 5 }]
  ws1['!rows'] = [{ hpt: 50 }, { hpt: 20 }, {}, { hpt: 40 }]

  setCell(ws1, 0, 0, ORGN().toUpperCase(), { font: { bold: true, sz: 26, color: { rgb: HEX.amber } }, fill: { fgColor: { rgb: HEX.teal } }, alignment: { horizontal: 'center', vertical: 'center' } })
  styleRange(ws1, 0, 0, 0, 5, { fill: { fgColor: { rgb: HEX.teal } } })
  setCell(ws1, 1, 0, 'Organisme de formation professionnelle' + (orgCity() ? ' -- ' + orgCity() : ''), { font: { sz: 10, color: { rgb: HEX.white }, italic: true }, fill: { fgColor: { rgb: HEX.teal } }, alignment: { horizontal: 'center' } })
  styleRange(ws1, 1, 0, 1, 5, { fill: { fgColor: { rgb: HEX.teal } } })
  setCell(ws1, 3, 0, "DOCUMENT UNIQUE D'EVALUATION DES RISQUES PROFESSIONNELS", { font: { bold: true, sz: 18, color: { rgb: HEX.teal } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } })

  const info = [
    ['Entreprise :', project.company_name || '', '', 'Reference :', project.reference || ''],
    ['SIRET :', project.siret || '', '', 'Code NAF :', `${project.naf_code || ''} ${project.naf_label || ''}`],
    ['Adresse :', `${project.address || ''}${project.postal_code && !(project.address || '').includes(project.postal_code) ? ', ' + [project.postal_code, project.city].filter(Boolean).join(' ') : ''}`, '', '', ''],
    ['Effectif :', `${project.effectif || ''} salarie(s)`, '', 'Contact :', project.contact_name || ''],
    ['Accompagnateur :', accompName, '', 'Date :', fmtDate(project.date_elaboration)],
  ]
  info.forEach((row, i) => {
    row.forEach((val, j) => {
      if (val) setCell(ws1, 5 + i, j, val, j === 0 || j === 3 ? sLabel : sVal)
    })
  })

  const stats = [
    [risks.length, 'Risques identifies'],
    [scored.filter(r => r._score > 0).length, 'Evalues'],
    [scored.filter(r => r._score >= 9).length, 'Critiques/Eleves'],
    [actions.length, 'Actions'],
  ]
  stats.forEach((st, i) => {
    setCell(ws1, 12, i, st[0], { font: { bold: true, sz: 18, color: { rgb: HEX.teal } }, fill: { fgColor: { rgb: HEX.grayBg } }, alignment: { horizontal: 'center', vertical: 'center' }, border: BDR })
    setCell(ws1, 13, i, st[1], { font: { sz: 8, color: { rgb: HEX.gray } }, fill: { fgColor: { rgb: HEX.grayBg } }, alignment: { horizontal: 'center' }, border: BDR })
  })
  ws1['!rows'][12] = { hpt: 35 }

  setCell(ws1, 15, 0, DISCLAIMER_SHORT(), { font: { sz: 7, color: { rgb: HEX.gray }, italic: true }, alignment: { wrapText: true } })

  XLSX.utils.book_append_sheet(wb, ws1, 'Presentation')

  // ═══ 2. UNITES ═══
  const unitRows = [['Unites de travail', 'Nombre de salaries', 'Metiers concernes', 'Nombre de Femmes', "Nombre d'Hommes"]]
  units.forEach(u => unitRows.push([u.name, u.effectif || '', u.metiers || '', '', '']))
  unitRows.push([])
  unitRows.push(['Total', `=SUM(B2:B${units.length + 1})`, '', '', ''])

  const ws2 = XLSX.utils.aoa_to_sheet(unitRows)
  ws2['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 45 }, { wch: 18 }, { wch: 18 }]
  ws2['!merges'] = []
  ws2['!views'] = [{ state: 'frozen', ySplit: 1, xSplit: 0 }]

  for (let c = 0; c < 5; c++) { const ref = XLSX.utils.encode_cell({ r: 0, c }); if (ws2[ref]) ws2[ref].s = sHdr() }
  for (let r = 1; r <= units.length; r++) {
    const refA = XLSX.utils.encode_cell({ r, c: 0 }); if (ws2[refA]) ws2[refA].s = sBold
    for (let c = 1; c < 5; c++) { const ref = XLSX.utils.encode_cell({ r, c }); if (ws2[ref]) ws2[ref].s = c === 2 ? sNorm : sCenter }
  }
  const tR = units.length + 2
  const refTA = XLSX.utils.encode_cell({ r: tR, c: 0 }); if (ws2[refTA]) ws2[refTA].s = { font: { bold: true, sz: 11, color: { rgb: HEX.teal } }, border: { bottom: { style: 'medium', color: { rgb: HEX.teal } } } }
  const refTB = XLSX.utils.encode_cell({ r: tR, c: 1 }); if (ws2[refTB]) ws2[refTB].s = { font: { bold: true, sz: 11, color: { rgb: HEX.teal } }, alignment: { horizontal: 'center' }, border: { bottom: { style: 'medium', color: { rgb: HEX.teal } } } }

  XLSX.utils.book_append_sheet(wb, ws2, 'Unites')

  // ═══ 3. ACTUALISATION ═══
  const actRows = [
    ['ELABORATION & ACTUALISATION DU DUERP'],
    [`Date d'elaboration initiale : ${fmtDate(project.date_elaboration)}`],
    ['Reglementation : MAJ annuelle >= 11 sal. + changement significatif'],
    [], [],
    ['Date de mise a jour', 'Noms participants', 'Postes', 'Changements'],
    [fmtDate(project.date_elaboration), `${project.contact_name || ''}, ${accompName}`, 'Gerant, Accompagnateur', 'Elaboration initiale'],
  ]
  for (let i = 0; i < 10; i++) actRows.push(['', '', '', ''])
  const ws3 = XLSX.utils.aoa_to_sheet(actRows)
  ws3['!cols'] = [{ wch: 20 }, { wch: 35 }, { wch: 25 }, { wch: 40 }]
  ws3['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }]
  ws3['A1'].s = { font: { bold: true, sz: 16, color: { rgb: HEX.teal } } }
  ws3['A2'].s = { font: { bold: true, sz: 12 } }
  ws3['A3'].s = { font: { sz: 10, color: { rgb: HEX.teal } } }
  for (let c = 0; c < 4; c++) { const ref = XLSX.utils.encode_cell({ r: 5, c }); if (ws3[ref]) ws3[ref].s = sHdr() }
  for (let r = 6; r < actRows.length; r++) { for (let c = 0; c < 4; c++) { const ref = XLSX.utils.encode_cell({ r, c }); if (ws3[ref]) ws3[ref].s = r === 6 ? sNorm : { border: BDR } } }
  XLSX.utils.book_append_sheet(wb, ws3, 'Actualisation')

  // ═══ 4. EVRP EXPLICATION ═══
  const explRows = [
    ['EVALUATION DES RISQUES PROFESSIONNELS (EXPLICATION)'],
    ['Unite', 'ANALYSE DES DANGERS', '', '', 'EVALUATION DES RISQUES', '', '', '', '', "PLAN D'ACTION", '', '', '', '', ''],
    ['Unite de travail', 'Phase de travail', 'Situation dangereuse', 'Risque / Danger', 'Frequence (1-4)', 'Gravite (1-4)', 'Prevention existante', 'Maitrise (0.5-1)', 'Score residuel', 'Action a mettre en oeuvre', 'Priorite', 'Echeance', 'Cout', 'Responsable', 'Date realisation'],
    ['Regroupement postes', 'Tache de travail', 'Situation identifiee', 'Type de risque', '1=occasionnel 4=permanent', '1=benin 4=tres grave', 'Moyens actuels', '0.5=bonne 1=insuffisante', 'Calcul auto F x G x M', 'Actions prevues', 'Priorite action', 'Delai', 'Budget', 'Personne chargee', 'Date effective'],
  ]
  const ws4 = XLSX.utils.aoa_to_sheet(explRows)
  ws4['!cols'] = [18, 18, 30, 25, 10, 10, 30, 10, 10, 30, 12, 14, 10, 18, 14].map(w => ({ wch: w }))
  ws4['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 14 } },
    { s: { r: 1, c: 1 }, e: { r: 1, c: 3 } },
    { s: { r: 1, c: 4 }, e: { r: 1, c: 8 } },
    { s: { r: 1, c: 9 }, e: { r: 1, c: 14 } },
  ]
  ws4['!rows'] = [{}, {}, { hpt: 40 }, { hpt: 50 }]
  ws4['A1'].s = { font: { bold: true, sz: 18, color: { rgb: HEX.teal } } }
  ;[0].forEach(c => { const ref = XLSX.utils.encode_cell({ r: 1, c }); if (ws4[ref]) ws4[ref].s = sHdr() })
  ;[1, 2, 3].forEach(c => { const ref = XLSX.utils.encode_cell({ r: 1, c }); if (ws4[ref]) ws4[ref].s = sHdr() })
  ;[4, 5, 6, 7, 8].forEach(c => { const ref = XLSX.utils.encode_cell({ r: 1, c }); if (ws4[ref]) ws4[ref].s = sHdr(HEX.darkBlue) })
  ;[9, 10, 11, 12, 13, 14].forEach(c => { const ref = XLSX.utils.encode_cell({ r: 1, c }); if (ws4[ref]) ws4[ref].s = sHdr(HEX.amber) })
  for (let c = 0; c < 15; c++) {
    const ref = XLSX.utils.encode_cell({ r: 2, c })
    if (ws4[ref]) ws4[ref].s = c < 4 ? sHdr() : c < 9 ? sHdr(HEX.darkBlue) : sHdr(HEX.amber)
  }
  for (let c = 0; c < 15; c++) {
    const ref = XLSX.utils.encode_cell({ r: 3, c })
    if (ws4[ref]) ws4[ref].s = { font: { sz: 9, color: { rgb: HEX.darkBlue }, italic: true }, alignment: { wrapText: true, vertical: 'top' }, border: BDR }
  }
  XLSX.utils.book_append_sheet(wb, ws4, 'EVRP Explication')

  // ═══ 5. EVRP (GRILLE PRINCIPALE) ═══
  const evrpRows = [
    ['EVALUATION DES RISQUES PROFESSIONNELS'],
    ['', 'ANALYSE DES DANGERS', '', '', 'EVALUATION DES RISQUES', '', '', '', '', "PLAN D'ACTION", '', '', '', '', ''],
    ['Unite de travail', 'Phase de travail', 'Situation dangereuse', 'Risque / Danger', 'Frequence', 'Gravite', 'Prevention existante', 'Maitrise', 'Score', 'Action a mettre en oeuvre', 'Priorite', 'Echeance', 'Cout', 'Responsable', 'Date realisation'],
  ]

  let curUnit = null
  risks.forEach(r => {
    const unit = units.find(u => u.id === r.unit_id)
    const uName = unit?.name || 'Sans unite'
    const showUnit = uName !== curUnit; curUnit = uName
    const cat = categories.find(c => c.code === r.category_code)
    const score = riskScore(r)
    const act = actions.find(a => a.risk_id === r.id)
    evrpRows.push([
      showUnit ? uName : '',
      cat?.label || r.category_code || '',
      r.situation || '',
      r.danger || '',
      r.frequence || '',
      r.gravite || '',
      r.prevention_existante || '',
      r.maitrise != null ? r.maitrise : '',
      score || '',
      act?.action || '',
      act ? (PRIO[act.priorite] || '') : '',
      act ? fmtDate(act.echeance) : '',
      act?.cout_estime || '',
      act?.responsable || '',
      act ? fmtDate(act.date_realisation) : '',
    ])
  })

  const ws5 = XLSX.utils.aoa_to_sheet(evrpRows)
  ws5['!cols'] = [18, 18, 30, 25, 10, 10, 30, 10, 10, 30, 12, 14, 10, 18, 14].map(w => ({ wch: w }))
  ws5['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 14 } },
    { s: { r: 1, c: 1 }, e: { r: 1, c: 3 } },
    { s: { r: 1, c: 4 }, e: { r: 1, c: 8 } },
    { s: { r: 1, c: 9 }, e: { r: 1, c: 14 } },
  ]
  ws5['!rows'] = [{ hpt: 40 }, {}, { hpt: 40 }]
  ws5['!views'] = [{ state: 'frozen', ySplit: 3, xSplit: 0 }]
  const lastDataRow = 2 + risks.length
  ws5['!autofilter'] = { ref: `A3:O${lastDataRow + 1}` }

  styleRange(ws5, 0, 0, 0, 14, { font: { bold: true, sz: 18, color: { rgb: HEX.white } }, fill: { fgColor: { rgb: HEX.teal } }, alignment: { horizontal: 'center', vertical: 'center' } })
  ;[0].forEach(c => { const ref = XLSX.utils.encode_cell({ r: 1, c }); if (ws5[ref]) ws5[ref].s = sHdr() })
  ;[1, 2, 3].forEach(c => { const ref = XLSX.utils.encode_cell({ r: 1, c }); if (ws5[ref]) ws5[ref].s = sHdr() })
  ;[4, 5, 6, 7, 8].forEach(c => { const ref = XLSX.utils.encode_cell({ r: 1, c }); if (ws5[ref]) ws5[ref].s = sHdr(HEX.darkBlue) })
  ;[9, 10, 11, 12, 13, 14].forEach(c => { const ref = XLSX.utils.encode_cell({ r: 1, c }); if (ws5[ref]) ws5[ref].s = sHdr(HEX.amber) })
  for (let c = 0; c < 15; c++) {
    const ref = XLSX.utils.encode_cell({ r: 2, c })
    if (ws5[ref]) ws5[ref].s = c < 4 ? sHdr() : c < 9 ? sHdr(HEX.darkBlue) : sHdr(HEX.amber)
  }
  risks.forEach((r, i) => {
    const row = 3 + i
    const score = riskScore(r)
    const act = actions.find(a => a.risk_id === r.id)
    const refA = XLSX.utils.encode_cell({ r: row, c: 0 })
    if (ws5[refA] && ws5[refA].v) ws5[refA].s = sBold
    else if (ws5[refA]) ws5[refA].s = sNorm
    ;[1, 2, 6].forEach(c => { const ref = XLSX.utils.encode_cell({ r: row, c }); if (ws5[ref]) ws5[ref].s = sNorm })
    const refD = XLSX.utils.encode_cell({ r: row, c: 3 }); if (ws5[refD]) ws5[refD].s = sBold
    ;[4, 5, 7].forEach(c => { const ref = XLSX.utils.encode_cell({ r: row, c }); if (ws5[ref]) ws5[ref].s = sCenter })
    if (score > 0) {
      const refS = XLSX.utils.encode_cell({ r: row, c: 8 }); if (ws5[refS]) ws5[refS].s = sRisk(score)
    }
    const refAc = XLSX.utils.encode_cell({ r: row, c: 9 }); if (ws5[refAc]) ws5[refAc].s = sNorm
    if (act?.priorite) {
      const refP = XLSX.utils.encode_cell({ r: row, c: 10 }); if (ws5[refP]) ws5[refP].s = sPrio(act.priorite)
    }
    ;[11, 12, 14].forEach(c => { const ref = XLSX.utils.encode_cell({ r: row, c }); if (ws5[ref]) ws5[ref].s = sCenter })
    const refR = XLSX.utils.encode_cell({ r: row, c: 13 }); if (ws5[refR]) ws5[refR].s = sNorm
  })

  XLSX.utils.book_append_sheet(wb, ws5, 'EVRP')

  // ═══ 6. PLAN D'ACTION ═══
  const paRows = [['FORMATIONS SECURITE']]
  paRows.push(['Type de formation', 'Date de realisation', 'Reglementation', 'Periodicite / Recyclage'])
  FORMATIONS_SECURITE.forEach(f => paRows.push([f.formation, '', f.reglementation, f.periodicite]))
  paRows.push([]); paRows.push([])
  const actTitleRow = paRows.length
  paRows.push(["PLAN D'ACTION", '', '', '', '', ''])
  paRows.push(['Mesure de prevention', 'Priorite', 'Echeance', 'Cout', 'Responsable', 'Date realisation'])
  sortedActX.forEach(a => paRows.push([a.action || '', PRIO[a.priorite] || '', fmtDate(a.echeance), a.cout_estime || '', a.responsable || '', fmtDate(a.date_realisation)]))

  const ws6 = XLSX.utils.aoa_to_sheet(paRows)
  ws6['!cols'] = [{ wch: 45 }, { wch: 18 }, { wch: 20 }, { wch: 14 }, { wch: 22 }, { wch: 18 }]
  ws6['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    { s: { r: actTitleRow, c: 0 }, e: { r: actTitleRow, c: 5 } },
  ]
  styleRange(ws6, 0, 0, 0, 3, { font: { bold: true, sz: 16, color: { rgb: HEX.white } }, fill: { fgColor: { rgb: HEX.teal } }, alignment: { horizontal: 'left', vertical: 'center' } })
  for (let c = 0; c < 4; c++) { const ref = XLSX.utils.encode_cell({ r: 1, c }); if (ws6[ref]) ws6[ref].s = sHdr(HEX.amber) }
  FORMATIONS_SECURITE.forEach((f, i) => {
    const r = 2 + i
    const refA = XLSX.utils.encode_cell({ r, c: 0 }); if (ws6[refA]) ws6[refA].s = { font: { bold: true, sz: 10, color: { rgb: HEX.teal } }, alignment: { vertical: 'center', wrapText: true }, border: BDR }
    for (let c = 1; c < 4; c++) { const ref = XLSX.utils.encode_cell({ r, c }); if (ws6[ref]) ws6[ref].s = sNorm }
  })
  styleRange(ws6, actTitleRow, 0, actTitleRow, 5, { font: { bold: true, sz: 16, color: { rgb: HEX.white } }, fill: { fgColor: { rgb: HEX.teal } }, alignment: { horizontal: 'left', vertical: 'center' } })
  for (let c = 0; c < 6; c++) { const ref = XLSX.utils.encode_cell({ r: actTitleRow + 1, c }); if (ws6[ref]) ws6[ref].s = sHdr(HEX.amber) }
  sortedActX.forEach((a, i) => {
    const r = actTitleRow + 2 + i
    const refA = XLSX.utils.encode_cell({ r, c: 0 }); if (ws6[refA]) ws6[refA].s = sNorm
    if (a.priorite) { const refP = XLSX.utils.encode_cell({ r, c: 1 }); if (ws6[refP]) ws6[refP].s = sPrio(a.priorite) }
    ;[2, 3, 5].forEach(c => { const ref = XLSX.utils.encode_cell({ r, c }); if (ws6[ref]) ws6[ref].s = sCenter })
    const refR = XLSX.utils.encode_cell({ r, c: 4 }); if (ws6[refR]) ws6[refR].s = sNorm
  })
  XLSX.utils.book_append_sheet(wb, ws6, "Plan d'action")

  // ═══ 7. COTATION ═══
  const cotRows = [
    ['COTATION DES RISQUES PROFESSIONNELS'],
    ["Indice d'exposition (Frequence)"],
    [1, 'Occasionnel', 'Quelques fois par mois'],
    [2, 'Frequent', 'Plusieurs fois par jour'],
    [3, 'Tres frequent', 'Plusieurs fois par heure'],
    [4, 'Permanent', 'Exposition continue'],
    [],
    ['Indice de gravite'],
    [1, 'Minime', 'Premiers soins'],
    [2, 'Significatif', 'Sans arret de travail'],
    [3, 'Grave', 'Avec arret, maladie pro.'],
    [4, 'Tres grave', 'IPP, deces'],
    [],
    ['Indice de maitrise'],
    [0.5, 'Bonne (Efficace)', 'Mesures 100% en place'],
    [0.75, 'Partielle', 'Mesures partielles'],
    [1, 'Insuffisante', 'Aucune mesure'],
    [],
    ['Score = Frequence x Gravite x Maitrise'],
    ['1-4', 'Faible', 'Risque acceptable : surveillance'],
    ['5-8', 'Moyen', 'Risque tolerable sous controle'],
    ['9-12', 'Eleve', 'Action rapide requise'],
    ['13-16', 'Critique', "Mesures d'urgence"],
  ]
  const ws7 = XLSX.utils.aoa_to_sheet(cotRows)
  ws7['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 55 }]
  ws7['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
    { s: { r: 7, c: 0 }, e: { r: 7, c: 2 } },
    { s: { r: 13, c: 0 }, e: { r: 13, c: 2 } },
    { s: { r: 18, c: 0 }, e: { r: 18, c: 2 } },
  ]
  styleRange(ws7, 0, 0, 0, 2, { font: { bold: true, sz: 18, color: { rgb: HEX.white } }, fill: { fgColor: { rgb: HEX.teal } } })
  ;[1, 7, 13, 18].forEach(r => styleRange(ws7, r, 0, r, 2, { font: { bold: true, sz: 10, color: { rgb: HEX.white } }, fill: { fgColor: { rgb: HEX.tealLight } } }))
  const colorMap = { 0: LVL.faible, 1: LVL.moyen, 2: LVL.eleve, 3: LVL.critique }
  ;[2, 3, 4, 5].forEach((r, i) => {
    const l = colorMap[i]
    const refA = XLSX.utils.encode_cell({ r, c: 0 }); if (ws7[refA]) ws7[refA].s = { font: { bold: true, sz: 11 }, fill: { fgColor: { rgb: l.hex } }, alignment: { horizontal: 'center', vertical: 'center' }, border: BDR }
    const refB = XLSX.utils.encode_cell({ r, c: 1 }); if (ws7[refB]) ws7[refB].s = { font: { bold: true, sz: 10 }, fill: { fgColor: { rgb: l.hex } }, alignment: { vertical: 'center' }, border: BDR }
    const refC = XLSX.utils.encode_cell({ r, c: 2 }); if (ws7[refC]) ws7[refC].s = sNorm
  })
  ;[8, 9, 10, 11].forEach((r, i) => {
    const l = colorMap[i]
    const refA = XLSX.utils.encode_cell({ r, c: 0 }); if (ws7[refA]) ws7[refA].s = { font: { bold: true, sz: 11 }, fill: { fgColor: { rgb: l.hex } }, alignment: { horizontal: 'center', vertical: 'center' }, border: BDR }
    const refB = XLSX.utils.encode_cell({ r, c: 1 }); if (ws7[refB]) ws7[refB].s = { font: { bold: true, sz: 10 }, fill: { fgColor: { rgb: l.hex } }, alignment: { vertical: 'center' }, border: BDR }
    const refC = XLSX.utils.encode_cell({ r, c: 2 }); if (ws7[refC]) ws7[refC].s = sNorm
  })
  const maitColors = [LVL.faible, LVL.eleve, LVL.critique]
  ;[14, 15, 16].forEach((r, i) => {
    const l = maitColors[i]
    const refA = XLSX.utils.encode_cell({ r, c: 0 }); if (ws7[refA]) ws7[refA].s = { font: { bold: true, sz: 11 }, fill: { fgColor: { rgb: l.hex } }, alignment: { horizontal: 'center', vertical: 'center' }, border: BDR }
    const refB = XLSX.utils.encode_cell({ r, c: 1 }); if (ws7[refB]) ws7[refB].s = { font: { bold: true, sz: 10 }, fill: { fgColor: { rgb: l.hex } }, alignment: { vertical: 'center' }, border: BDR }
    const refC = XLSX.utils.encode_cell({ r, c: 2 }); if (ws7[refC]) ws7[refC].s = sNorm
  })
  ;[19, 20, 21, 22].forEach((r, i) => {
    const l = colorMap[i]
    const refA = XLSX.utils.encode_cell({ r, c: 0 }); if (ws7[refA]) ws7[refA].s = { font: { bold: true, sz: 11, color: { rgb: l.hexTxt } }, fill: { fgColor: { rgb: l.hex } }, alignment: { horizontal: 'center', vertical: 'center' }, border: BDR }
    const refB = XLSX.utils.encode_cell({ r, c: 1 }); if (ws7[refB]) ws7[refB].s = { font: { bold: true, sz: 10, color: { rgb: l.hexTxt } }, fill: { fgColor: { rgb: l.hex } }, alignment: { vertical: 'center' }, border: BDR }
    const refC = XLSX.utils.encode_cell({ r, c: 2 }); if (ws7[refC]) ws7[refC].s = sNorm
  })
  XLSX.utils.book_append_sheet(wb, ws7, 'Cotation')

  // ═══ 8. RISQUES INRS ═══
  const inrsRisks = getInrsRisksForSector(sectorKey)
  const inrsRows = [
    [`LISTE DES RISQUES PROFESSIONNELS (INRS) - ${inrsRisks.length} risques${sectorKey ? ` (secteur ${sectorKey})` : ''}`],
    ['RISQUES', 'SITUATIONS DANGEREUSES', 'CONSEQUENCES', 'REGLEMENTATION', 'SOURCES INRS'],
  ]
  inrsRisks.forEach(r => inrsRows.push([r.risque, r.situations?.substring(0, 300) || '', r.consequences?.substring(0, 200) || '', r.reglementation?.substring(0, 300) || '', r.source || '']))

  const ws8 = XLSX.utils.aoa_to_sheet(inrsRows)
  ws8['!cols'] = [{ wch: 25 }, { wch: 40 }, { wch: 30 }, { wch: 45 }, { wch: 35 }]
  ws8['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }]
  ws8['!views'] = [{ state: 'frozen', ySplit: 2, xSplit: 0 }]
  ws8['!autofilter'] = { ref: `A2:E${inrsRows.length}` }

  styleRange(ws8, 0, 0, 0, 4, { font: { bold: true, sz: 14, color: { rgb: HEX.white } }, fill: { fgColor: { rgb: HEX.teal } }, alignment: { horizontal: 'left', vertical: 'center' } })
  for (let c = 0; c < 5; c++) { const ref = XLSX.utils.encode_cell({ r: 1, c }); if (ws8[ref]) ws8[ref].s = sHdr(HEX.amber) }
  inrsRisks.forEach((r, i) => {
    const row = 2 + i
    const refA = XLSX.utils.encode_cell({ r: row, c: 0 }); if (ws8[refA]) ws8[refA].s = { font: { bold: true, sz: 10, color: { rgb: HEX.teal } }, alignment: { vertical: 'top', wrapText: true }, border: BDR }
    ;[1, 2, 3].forEach(c => { const ref = XLSX.utils.encode_cell({ r: row, c }); if (ws8[ref]) ws8[ref].s = sNorm })
    const refE = XLSX.utils.encode_cell({ r: row, c: 4 }); if (ws8[refE]) ws8[refE].s = { font: { sz: 8, color: { rgb: '0066CC' }, underline: true }, alignment: { vertical: 'center', wrapText: true }, border: BDR }
  })
  XLSX.utils.book_append_sheet(wb, ws8, 'Risques INRS')

  // ═══ 9. MENTIONS LEGALES ═══
  const legalLines = [
    'MENTIONS LEGALES ET AVERTISSEMENT', '',
    'AVERTISSEMENT IMPORTANT - LIMITES DE RESPONSABILITE', '',
    ...DISCLAIMER_FULL().slice(2), '', '',
    'RAPPELS REGLEMENTAIRES',
    '  - Conservation obligatoire 40 ans (Art. L.4121-3-1 V)',
    `  - Mise a jour : ${eff >= 11 ? 'annuelle obligatoire' : 'changement significatif'}`,
    '  - Consultation CSE obligatoire le cas echeant',
    '  - Evaluation differenciee H/F (Art. L.4121-3)',
    '  - Transmission medecine du travail a chaque MAJ', '', '',
    'SIGNATURES', '',
    `L'employeur : ${project.contact_name || ''}                    L'accompagnateur : ${accompName}`, '',
    'Date et signature :                                  Date et signature :', '', '',
    `Document genere -- ${ORGN()}${orgCity() ? ', ' + orgCity() : ''} -- ${new Date().toLocaleDateString('fr-FR')}`,
  ]
  const legalRows = legalLines.map(l => [l])
  const ws9 = XLSX.utils.aoa_to_sheet(legalRows)
  ws9['!cols'] = [{ wch: 110 }]
  ws9['!rows'] = [{ hpt: 35 }]
  ws9['A1'].s = { font: { bold: true, sz: 16, color: { rgb: HEX.white } }, fill: { fgColor: { rgb: HEX.teal } } }
  legalLines.forEach((l, i) => {
    if (i === 0) return
    const ref = XLSX.utils.encode_cell({ r: i, c: 0 })
    if (!ws9[ref]) return
    if (['AVERTISSEMENT', 'RAPPELS', 'SIGNATURES'].some(k => l.includes(k))) ws9[ref].s = { font: { bold: true, sz: 12, color: { rgb: HEX.teal } } }
    else ws9[ref].s = { font: { sz: 10 } }
  })
  XLSX.utils.book_append_sheet(wb, ws9, 'Mentions legales')

  // ── Save ──
  const fname = `DUERP_${(project.company_name || 'export').replace(/[^a-zA-Z0-9]/g, '_')}_${project.reference || ''}.xlsx`
  XLSX.writeFile(wb, fname)
  return fname
}
