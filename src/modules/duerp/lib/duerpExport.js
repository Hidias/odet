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
  { code: 'SST-FI', label: 'Sauveteur Secouriste du Travail (SST Initial)', ref: 'PROG-FI SST', duree: '14h (2 jours)', validite: '2 ans', reglementation: 'Art. R4224-15', matchKeys: ['*'], description: 'Obligation : au moins 1 SST par atelier' },
  { code: 'MAC-SST', label: 'MAC SST (Maintien & Actualisation)', ref: 'PROG-MAC SST', duree: '7h (1 jour)', validite: '2 ans', reglementation: 'Art. R4224-15', matchKeys: ['*'], description: 'Recyclage obligatoire tous les 2 ans' },
  { code: 'IGPS', label: 'Initiation Gestes de Premiers Secours', ref: 'PROG-IGPS', duree: '4h', validite: '1 an', reglementation: 'Art. R4224-15', matchKeys: ['*'], description: 'Sensibilisation premiers secours' },
  { code: 'G&P', label: 'Gestes et Postures', ref: 'PROG-G&P', duree: '4h', validite: '1 an', reglementation: 'Art. R4541-8', matchKeys: ['tms', 'manutention', 'physique', 'posture', 'ergonomie', 'port_charge', 'port de charge', 'contrainte', 'fauteuil roulant', 'lourde'], description: 'Reduction TMS, postures adaptees' },
  { code: 'EXT', label: 'Manipulation d\'Extincteurs', ref: 'PROG-EXT', duree: '2h', validite: '1 an', reglementation: 'Art. R4227-39', matchKeys: ['incendie', 'feu', 'depart de feu', 'combustible', 'inflammab', 'extincteur'], description: 'Reagir face a un depart de feu' },
  { code: 'EPI', label: 'Equipier de Premiere Intervention (EPI)', ref: 'PROG-EPI', duree: '4h', validite: '1 an', reglementation: 'Art. R4227-39', matchKeys: ['incendie', 'feu', 'depart de feu', 'evacuation', 'combustible', 'inflammab'], description: 'Extinction + evacuation coordonnee' },
  { code: 'R489', label: 'Formation Interne R489 Cat 1B/3/5 (Chariots)', ref: 'PROG-R489', duree: '7h / categorie', validite: '5 ans', reglementation: 'Art. R4323-55', matchKeys: ['chariot', 'cariste', 'gerbage', 'degerbage', 'fourche', 'palette', 'gerbeur_chariot', 'transpalette_electrique', 'r489'], description: 'Autorisation de conduite chariots' },
  { code: 'R485', label: 'Formation Interne R485 Cat 1/2 (Gerbeurs)', ref: 'PROG-R485', duree: '7h', validite: '5 ans', reglementation: 'Art. R4323-55', matchKeys: ['gerbeur', 'gerbage', 'degerbage', 'palette', 'transpalette', 'r485'], description: 'Autorisation de conduite gerbeurs' },
  { code: 'ELEC', label: 'Habilitation Electrique B0-H0-H0V', ref: 'PROG-FI B0H0V', duree: '7h (1 jour)', validite: '3 ans', reglementation: 'NF C18-510', matchKeys: ['electrique', 'electrocution', 'electrisation', 'multiprise', 'armoire electrique', 'habilitation'], description: 'Operations non electriques en zone a risque' },
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
// PDF GENERATION - v5.1 : filigrane + formations + texte agrandi
// ═══════════════════════════════════════════════════════════
export function generateDuerpPDF({ project, units, risks, actions, categories, userEmail }) {
  const doc = new jsPDF()
  const accompName = getAccompagnateurName(userEmail)
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const ml = 14, mr = 14, cw = pw - ml - mr
  const bannerH = 7
  const footerY = ph - 12, safeY = ph - 34 // ← agrandi pour bandeau 9mm + marge
  let pageNum = 0
  const evaluated = risks.filter(r => r.frequence && r.gravite).length
  const scored = risks.map(r => ({ ...r, _score: riskScore(r) }))
  const critiqueCount = scored.filter(r => r._score >= 13).length
  const eleveCount = scored.filter(r => r._score >= 9 && r._score < 13).length
  const doneActions = actions.filter(a => a.statut === 'fait').length
  const eff = parseInt(project.effectif) || 0
  const nonEvaluated = risks.length - evaluated

  // ── FILIGRANE : diagonal + bandeau ──
  const addWatermark = () => {
    // 1) Texte diagonal centré visuellement
    // Sans align:'center' (buggé avec angle dans jsPDF), on décale manuellement le point d'ancrage
    // Pour un texte à 45°, le centre visuel doit être au milieu de la page
    doc.saveGraphicsState()
    doc.setGState(new doc.GState({ opacity: 0.18 }))
    doc.setTextColor(100, 100, 100)
    doc.setFont(undefined, 'bold')
    // Ligne 1 : DOCUMENT D'APPUI (44pt)
    doc.setFontSize(44)
    doc.text("DOCUMENT D'APPUI", pw * 0.18, ph * 0.58, { angle: 45 })
    // Ligne 2 : SANS VALEUR JURIDIQUE (32pt)
    doc.setFontSize(32)
    doc.text("SANS VALEUR JURIDIQUE", pw * 0.18, ph * 0.65, { angle: 45 })
    doc.setFont(undefined, 'normal')
    doc.restoreGraphicsState()

    // 2) Bandeau rouge en bas (au-dessus du footer) - 9mm, 7pt bold
    const bH2 = 9
    const bannerY = footerY - bH2 - 2
    doc.saveGraphicsState()
    doc.setGState(new doc.GState({ opacity: 0.92 }))
    doc.setFillColor(160, 30, 30)
    doc.rect(0, bannerY, pw, bH2, 'F')
    doc.setFontSize(7)
    doc.setTextColor(255, 255, 255)
    doc.setFont(undefined, 'bold')
    doc.text(BANNER_TEXT(), pw / 2, bannerY + 5.5, { align: 'center' })
    doc.setFont(undefined, 'normal')
    doc.restoreGraphicsState()
  }

  const addFooter = () => {
    pageNum++
    doc.setDrawColor(...C.amber); doc.setLineWidth(0.4); doc.line(ml, footerY - 2, pw - mr, footerY - 2)
    doc.setFontSize(7); doc.setTextColor(...C.grayLight)
    doc.text(`DUERP -- ${project.company_name} -- ${project.reference || ''}`, ml, footerY + 2)
    doc.text(`Page ${pageNum}`, pw / 2, footerY + 2, { align: 'center' })
    doc.text(`${new Date().toLocaleDateString('fr-FR')} -- ${ORGN()}`, pw - mr, footerY + 2, { align: 'right' })
  }
  const addHeader = () => {
    if (LOGO_BASE64) { try { doc.addImage(LOGO_BASE64, 'JPEG', ml, 4, 18, 18) } catch (e) {} }
    doc.setFontSize(8); doc.setTextColor(...C.gray)
    doc.text(`DUERP -- ${project.company_name}`, ml + 22, 12)
    doc.text(project.reference || '', ml + 22, 17)
    doc.setDrawColor(...C.teal); doc.setLineWidth(0.3); doc.line(ml, 24, pw - mr, 24)
  }
  const newPage = () => { doc.addPage(); addHeader(); addFooter(); addWatermark(); return 30 }
  const checkY = (y, n = 20) => (y + n > safeY) ? newPage() : y
  const sectionTitle = (y, num, title) => {
    y = checkY(y, 20)
    doc.setFillColor(...C.teal); doc.roundedRect(ml, y - 5, cw, 12, 2, 2, 'F')
    doc.setTextColor(...C.white); doc.setFontSize(13); doc.setFont(undefined, 'bold')
    doc.text(`${num}. ${title}`, ml + 5, y + 3); doc.setFont(undefined, 'normal')
    return y + 14
  }
  const subTitle = (y, title) => {
    y = checkY(y, 16)
    doc.setFillColor(...C.amber); doc.rect(ml, y, cw, 0.8, 'F'); y += 5
    doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.setTextColor(...C.teal)
    doc.text(title, ml + 2, y); doc.setFont(undefined, 'normal'); return y + 7
  }
  const para = (y, text, opts = {}) => {
    const sz = opts.size || 10; doc.setFontSize(sz); doc.setTextColor(...(opts.color || C.black))
    if (opts.bold) doc.setFont(undefined, 'bold')
    else if (opts.italic) doc.setFont(undefined, 'italic')
    else doc.setFont(undefined, 'normal')
    const lines = doc.splitTextToSize(text, opts.maxW || (cw - 4))
    const lh = sz * 0.42
    lines.forEach(l => { if (y > safeY) y = newPage(); doc.text(l, opts.x || (ml + 2), y); y += lh })
    return y + 2
  }
  const autoTablePageHook = () => { addHeader(); addFooter(); addWatermark() }

  // ── COUVERTURE ──
  doc.setFillColor(...C.teal); doc.rect(0, 0, pw, 55, 'F')
  doc.setFillColor(...C.amber); doc.rect(0, 55, pw, 3, 'F')
  if (LOGO_BASE64) { try { doc.addImage(LOGO_BASE64, 'JPEG', pw / 2 - 22, 5, 44, 44) } catch (e) {} }
  let y = 70
  doc.setTextColor(...C.teal); doc.setFontSize(22); doc.setFont(undefined, 'bold')
  doc.text('DOCUMENT UNIQUE', pw / 2, y, { align: 'center' }); y += 9
  doc.setFontSize(12); doc.text("d'Evaluation des Risques Professionnels", pw / 2, y, { align: 'center' })
  y += 4
  // Mention "document d'appui" visible
  doc.setFontSize(9); doc.setTextColor(...C.red)
  doc.text("DOCUMENT D'APPUI A LA REDACTION - SANS VALEUR JURIDIQUE", pw / 2, y + 4, { align: 'center' })
  doc.setTextColor(...C.teal)
  y += 9; doc.setDrawColor(...C.amber); doc.setLineWidth(1); doc.line(pw / 2 - 50, y, pw / 2 + 50, y)
  y += 14; doc.setTextColor(...C.black); doc.setFontSize(22)
  doc.text(project.company_name || '', pw / 2, y, { align: 'center' })
  y += 14; doc.setFontSize(9.5); doc.setFont(undefined, 'normal'); doc.setTextColor(...C.gray)
  const infoLines = [
    `Reference : ${project.reference || ''}`, project.siret ? `SIRET : ${project.siret}` : null,
    project.naf_code ? `Code NAF : ${project.naf_code} -- ${project.naf_label || ''}` : null,
    project.address ? `Adresse : ${project.address}${project.postal_code && !project.address.includes(project.postal_code) ? ', ' + [project.postal_code, project.city].filter(Boolean).join(' ') : ''}` : null,
    project.effectif ? `Effectif : ${project.effectif} salarie(s)` : null,
    `Accompagnateur a la redaction : ${accompName}`,
    `Date d'elaboration : ${fmtDate(project.date_elaboration)}`,
  ].filter(Boolean)
  infoLines.forEach(l => { doc.text(l, pw / 2, y, { align: 'center' }); y += 6 })
  y += 8; doc.setFillColor(...C.grayBg); doc.roundedRect(25, y, pw - 50, 28, 3, 3, 'F')
  const statsData = [
    [`${risks.length}`, 'risques identifies'],
    [`${evaluated}`, 'evalues'],
    [`${critiqueCount + eleveCount}`, 'critiques/eleves'],
    [`${actions.length}`, 'actions prevention'],
  ]
  const sw = (pw - 50) / 4
  statsData.forEach((s, i) => {
    doc.setFontSize(14); doc.setFont(undefined, 'bold'); doc.setTextColor(...C.teal)
    doc.text(s[0], 25 + sw * i + sw / 2, y + 11, { align: 'center' })
    doc.setFontSize(7); doc.setFont(undefined, 'normal'); doc.setTextColor(...C.gray)
    doc.text(s[1], 25 + sw * i + sw / 2, y + 18, { align: 'center' })
  })
  y = ph - 48; doc.setFontSize(7.5); doc.setFont(undefined, 'bold'); doc.setTextColor(...C.red)
  doc.text(doc.splitTextToSize(DISCLAIMER_SHORT(), pw - 36), 18, y)
  doc.setFont(undefined, 'normal')
  addFooter()
  addWatermark()

  // ── SOMMAIRE ──
  y = newPage()
  doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(...C.teal)
  doc.text('SOMMAIRE', pw / 2, y, { align: 'center' }); y += 14
  const tocItems = [
    { num: '1', title: 'Synthese pour le dirigeant', desc: 'Vue d\'ensemble : postes, risques, actions, obligations' },
    { num: '2', title: 'Methodologie de cotation', desc: 'Grille Frequence x Gravite x Maitrise et matrice' },
    { num: '3', title: 'Inventaire des risques par unite', desc: `${units.length} unite(s), ${risks.length} risque(s) identifies` },
    { num: '4', title: 'Plan d\'action de prevention', desc: `${actions.length} action(s) dont ${doneActions} realisee(s)` },
    { num: '5', title: 'Mentions legales et signatures', desc: 'Obligations, avertissement, signatures' },
  ]
  tocItems.forEach((item, i) => {
    doc.setFillColor(...C.teal); doc.circle(ml + 8, y + 2, 5, 'F')
    doc.setTextColor(...C.white); doc.setFontSize(11); doc.setFont(undefined, 'bold')
    doc.text(item.num, ml + 8, y + 4.5, { align: 'center' })
    doc.setTextColor(...C.black); doc.setFontSize(11); doc.text(item.title, ml + 18, y + 3)
    doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(...C.gray)
    doc.text(item.desc, ml + 18, y + 9)
    if (i < tocItems.length - 1) { doc.setDrawColor(...C.grayBg); doc.setLineWidth(0.3); doc.line(ml + 18, y + 14, pw - mr, y + 14) }
    y += 22
  })
  y += 6; doc.setFillColor(240, 248, 255); doc.setDrawColor(...C.teal); doc.setLineWidth(0.5)
  doc.roundedRect(ml, y, cw, 28, 2, 2, 'FD')
  doc.setFontSize(10); doc.setFont(undefined, 'bold'); doc.setTextColor(...C.teal)
  doc.text('Comment lire ce document ?', ml + 5, y + 7)
  doc.setFont(undefined, 'normal'); doc.setFontSize(9); doc.setTextColor(60, 60, 60)
  doc.text('Dirigeant presse : lisez uniquement la section 1 (Synthese) pour une vision complete.', ml + 5, y + 14)
  doc.text('Pour le detail : les sections 2 a 4 contiennent l\'inventaire complet et le plan d\'action.', ml + 5, y + 20)
  doc.text('Reglementaire : la section 5 rappelle vos obligations et contient les zones de signatures.', ml + 5, y + 26)

  // ── SECTION 1 : SYNTHESE ──
  y = newPage(); y = sectionTitle(y, 1, 'SYNTHESE POUR LE DIRIGEANT')
  y = para(y, "Ce document est un appui a la redaction de votre DUERP. Il recense les risques identifies lors de la visite et propose les actions a mettre en place. Cette synthese vous donne une vision claire et actionnable.")

  // Observations terrain du formateur
  if (project.notes && project.notes.trim()) {
    y = checkY(y, 28); y += 2
    doc.setFillColor(240, 248, 255); doc.setDrawColor(...C.teal); doc.setLineWidth(0.4)
    const noteLines = doc.splitTextToSize(project.notes.trim(), cw - 16)
    const noteH = Math.max(18, noteLines.length * 3.8 + 12)
    doc.roundedRect(ml, y, cw, noteH, 2, 2, 'FD')
    doc.setFontSize(8); doc.setFont(undefined, 'bold'); doc.setTextColor(...C.teal)
    doc.text('Observations terrain du formateur :', ml + 4, y + 6)
    doc.setFont(undefined, 'normal'); doc.setTextColor(50, 50, 50); doc.setFontSize(7.5)
    noteLines.forEach((l, i) => { const ly = y + 12 + i * 3.8; if (ly < y + noteH - 2) doc.text(l, ml + 4, ly) })
    y += noteH + 4
  }

  y += 2; y = subTitle(y, 'VOS POSTES ET UNITES DE TRAVAIL')
  y = para(y, `Votre entreprise a ete decoupee en ${units.length} unite(s) de travail :`)
  y += 2
  units.forEach(u => {
    y = checkY(y, 14)
    const ur = scored.filter(r => r.unit_id === u.id), hc = ur.filter(r => r._score >= 9).length
    const ms = Math.max(0, ...ur.map(r => r._score)), lvl = riskLevel(ms || 0)
    doc.setFillColor(...lvl.bg); doc.roundedRect(ml + 2, y - 3.5, cw - 4, 11, 1.5, 1.5, 'F')
    doc.setDrawColor(...lvl.text); doc.setLineWidth(1.5); doc.line(ml + 2, y - 3.5, ml + 2, y + 7.5)
    doc.setFont(undefined, 'bold'); doc.setFontSize(10); doc.setTextColor(...lvl.text)
    doc.text(u.name, ml + 7, y + 3)
    doc.setFont(undefined, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.gray)
    const info = [u.effectif ? `${u.effectif} pers.` : null, `${ur.length} risque(s)`, hc > 0 ? `dont ${hc} eleve(s)/critique(s)` : null].filter(Boolean).join(' -- ')
    doc.text(info, pw - mr - 2, y + 3, { align: 'right' }); y += 14
  })

  // FIX v4 : signaler les risques orphelins (sans unité)
  const orphanRisks = scored.filter(r => !r.unit_id)
  if (orphanRisks.length > 0) {
    y = checkY(y, 14)
    doc.setFillColor(254, 249, 195); doc.roundedRect(ml + 2, y - 3.5, cw - 4, 11, 1.5, 1.5, 'F')
    doc.setDrawColor(161, 98, 7); doc.setLineWidth(1.5); doc.line(ml + 2, y - 3.5, ml + 2, y + 7.5)
    doc.setFont(undefined, 'bold'); doc.setFontSize(10); doc.setTextColor(161, 98, 7)
    doc.text('Risques non rattaches a une unite', ml + 7, y + 3)
    doc.setFont(undefined, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.gray)
    doc.text(`${orphanRisks.length} risque(s) -- a rattacher`, pw - mr - 2, y + 3, { align: 'right' })
    y += 14
  }

  y += 2; y = subTitle(y, 'PRINCIPAUX RISQUES IDENTIFIES')

  // FIX v4 : dédoublonnage par danger+unit_id avant top 10
  const seen = new Set()
  const uniqueScored = scored.filter(r => {
    if (!r._score || r._score <= 0) return false
    const key = `${r.danger}__${r.unit_id || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const topRisks = uniqueScored.sort((a, b) => b._score - a._score).slice(0, 10)

  if (topRisks.length === 0) { y = para(y, 'Aucun risque evalue.', { italic: true, color: C.gray }) }
  else {
    y = para(y, `Sur les ${risks.length} risques (dont ${nonEvaluated} non evalues), voici les ${topRisks.length} plus importants :`)
    y += 2
    topRisks.forEach((r, i) => {
      y = checkY(y, 20); const unit = units.find(u => u.id === r.unit_id), lvl = riskLevel(r._score)
      doc.setFillColor(...lvl.bg); doc.circle(ml + 5, y + 1.5, 3.5, 'F')
      doc.setFontSize(9); doc.setFont(undefined, 'bold'); doc.setTextColor(...lvl.text)
      doc.text(`${i + 1}`, ml + 5, y + 3, { align: 'center' })
      doc.setFontSize(10); doc.text((r.danger || '').substring(0, 70), ml + 12, y + 3)
      doc.setFont(undefined, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.gray)
      doc.text(`${unit?.name || 'Non rattache'} -- Score ${r._score} (${lvl.label}) -- F${r.frequence || '?'}xG${r.gravite || '?'}xM${r.maitrise || '?'}`, ml + 12, y + 8)
      if (r.situation) {
        doc.setTextColor(80, 80, 80); const sl = doc.splitTextToSize(r.situation, cw - 18).slice(0, 2)
        sl.forEach((l, li) => { const ly = y + 12 + li * 3.5; if (ly < safeY) doc.text(l, ml + 12, ly) }); y += sl.length * 3.5
      }
      y += 14
    })
  }
  y = checkY(y, 30); y = subTitle(y, 'CE QUE VOUS DEVEZ FAIRE : ACTIONS PRIORITAIRES')
  const sortedAct = [...actions].sort((a, b) => { const p = { critique: 0, haute: 1, moyenne: 2, basse: 3 }; return (p[a.priorite] ?? 9) - (p[b.priorite] ?? 9) })
  const topAct = sortedAct.slice(0, 12)
  if (topAct.length > 0) {
    y = para(y, `${actions.length} action(s), dont ${doneActions} realisee(s). Prioritaires :`)
    y += 2
    topAct.forEach(a => {
      y = checkY(y, 14)
      const pc = { critique: LVL.critique, haute: LVL.eleve, moyenne: LVL.moyen, basse: LVL.faible }[a.priorite] || LVL.moyen
      doc.setFillColor(...pc.bg); doc.roundedRect(ml + 2, y - 2.5, 18, 7, 1, 1, 'F')
      doc.setFontSize(7); doc.setFont(undefined, 'bold'); doc.setTextColor(...pc.text)
      doc.text((PRIO[a.priorite] || '').substring(0, 8), ml + 11, y + 2, { align: 'center' })
      doc.setFontSize(9.5); doc.setFont(undefined, 'normal'); doc.setTextColor(...C.black)
      const al = doc.splitTextToSize(a.action || '', cw - 28).slice(0, 2); doc.text(al, ml + 23, y + 2)
      doc.setFontSize(8); doc.setTextColor(...C.gray)
      const det = [a.responsable ? `Resp: ${a.responsable}` : null, a.echeance ? `Ech: ${fmtDate(a.echeance)}` : null, STAT[a.statut] ? `[${STAT[a.statut]}]` : null].filter(Boolean).join(' -- ')
      const dy = y + 2 + Math.min(al.length, 2) * 3.5; if (dy < safeY) doc.text(det, ml + 23, dy)
      y += Math.min(al.length, 2) * 3.5 + 10
    })
  } else { y = para(y, 'Aucune action definie.', { italic: true }) }

  // ── v5 : catalogue des formations de l'organisme ──
  y = checkY(y, 40); y = subTitle(y, 'FORMATIONS RECOMMANDEES - ' + ORGN() + '')
  y = para(y, "En lien avec les risques identifies dans votre entreprise, " + ORGN() + " vous propose les formations suivantes. Les formations cochees correspondent directement aux risques detectes dans ce document.")
  y += 2

  const formBody = CATALOGUE_FORMATIONS.map(f => {
    const relevant = isFormationRelevant(f, risks, categories)
    return [relevant ? 'V' : '', f.label, f.duree, f.validite, f.reglementation, f.description]
  })

  doc.autoTable({
    startY: y,
    head: [['', 'Formation', 'Duree', 'Validite', 'Reglementation', 'Details']],
    body: formBody,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak', lineWidth: 0.1 },
    headStyles: { fillColor: C.teal, textColor: C.white, fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center', fontStyle: 'bold' },
      1: { cellWidth: 46, fontStyle: 'bold' },
      2: { cellWidth: 22, halign: 'center' },
      3: { cellWidth: 16, halign: 'center' },
      4: { cellWidth: 28 },
      5: { cellWidth: 46, fontStyle: 'normal' }
    },
    margin: { left: ml, right: mr, bottom: 30 },
    didParseCell: (d) => {
      if (d.section === 'body' && d.column.index === 0 && d.cell.raw === 'V') {
        d.cell.styles.fillColor = LVL.faible.bg
        d.cell.styles.textColor = LVL.faible.text
        d.cell.styles.fontStyle = 'bold'
      }
      if (d.section === 'body' && d.column.index === 0 && d.cell.raw === '') {
        d.cell.styles.textColor = [200, 200, 200]
      }
      // Highlight relevant rows
      if (d.section === 'body' && d.row.index !== undefined) {
        const relevant = formBody[d.row.index]?.[0] === 'V'
        if (relevant && d.column.index === 1) {
          d.cell.styles.textColor = C.teal
        }
      }
    },
    didDrawPage: autoTablePageHook
  })
  y = doc.lastAutoTable.finalY + 4

  // Contact commercial
  y = checkY(y, 18)
  doc.setFillColor(240, 248, 255); doc.setDrawColor(...C.teal); doc.setLineWidth(0.4)
  doc.roundedRect(ml, y, cw, 14, 2, 2, 'FD')
  doc.setFontSize(9); doc.setFont(undefined, 'bold'); doc.setTextColor(...C.teal)
  doc.text('Contactez-nous pour un devis personnalise', ml + 5, y + 6)
  doc.setFont(undefined, 'normal'); doc.setFontSize(8.5); doc.setTextColor(60, 60, 60)
  doc.text(orgContactLine().split(' | ').join('  |  '), ml + 5, y + 11)
  y += 18

  y = checkY(y, 40); y = subTitle(y, 'VOS OBLIGATIONS')
  const oblis = [
    { t: 'Mise a jour', d: eff >= 11 ? 'Entreprise >= 11 sal. : MAJ annuelle obligatoire + changement significatif.' : 'Entreprise < 11 sal. : MAJ lors de changement significatif. Annuelle recommandee.' },
    { t: 'Conservation', d: 'Le DUERP et ses versions doivent etre conserves 40 ans. Chaque version datee.' },
    { t: eff >= 50 ? 'PAPRIPACT' : 'Liste des actions', d: eff >= 50 ? 'Programme Annuel de Prevention obligatoire.' : 'Actions de prevention consignees dans le DUERP.' },
    { t: 'Diffusion', d: `A disposition des salaries, medecin du travail, inspection, CARSAT.${eff >= 11 ? ' CSE obligatoire.' : ''}` },
    { t: 'Evaluation H/F', d: 'Loi du 2 aout 2021 : evaluation differenciee selon le sexe.' },
  ]
  oblis.forEach(o => {
    y = checkY(y, 18); doc.setFont(undefined, 'bold'); doc.setFontSize(10); doc.setTextColor(...C.teal)
    doc.text(`> ${o.t}`, ml + 2, y); y += 5
    doc.setFont(undefined, 'normal'); doc.setTextColor(60, 60, 60); doc.setFontSize(9)
    doc.splitTextToSize(o.d, cw - 8).forEach(l => { if (y > safeY) y = newPage(); doc.text(l, ml + 4, y); y += 4 }); y += 4
  })
  y = checkY(y, 50)
  const nds = fmtDate(project.date_prochaine_maj) !== '--' ? fmtDate(project.date_prochaine_maj) : (eff >= 11 ? `avant le ${fmtDate(new Date(new Date().setFullYear(new Date().getFullYear() + 1)))}` : 'lors du prochain changement significatif')
  const steps = ['1. Prenez connaissance de cette synthese.', '2. Verifiez que tous les risques correspondent a la realite.', '3. Completez si necessaire.', '4. Mettez en oeuvre les actions prioritaires en premier.', '5. Planifiez les autres actions sur les prochains mois.', `6. Prochaine MAJ recommandee : ${nds}.`]
  const bH = steps.length * 5.5 + 16
  doc.setFillColor(240, 248, 255); doc.setDrawColor(...C.teal); doc.setLineWidth(0.5); doc.roundedRect(ml, y, cw, bH, 2, 2, 'FD')
  doc.setFontSize(10); doc.setFont(undefined, 'bold'); doc.setTextColor(...C.teal); doc.text('PROCHAINES ETAPES', ml + 5, y + 8)
  doc.setFont(undefined, 'normal'); doc.setFontSize(9); doc.setTextColor(50, 50, 50)
  steps.forEach((s, i) => doc.text(s, ml + 5, y + 15 + i * 5.5))

  // ── SECTION 2 : METHODOLOGIE ──
  y = newPage(); y = sectionTitle(y, 2, 'METHODOLOGIE DE COTATION')
  y = para(y, 'La cotation repose sur 3 criteres :')
  y = para(y, 'Risque residuel = Frequence x Gravite x Maitrise', { bold: true, size: 10, color: C.teal }); y += 4
  const tblOpts = { theme: 'grid', styles: { fontSize: 9, cellPadding: 2.5 }, headStyles: { fillColor: C.teal, textColor: C.white, fontSize: 9.5 }, columnStyles: { 0: { cellWidth: 15, halign: 'center', fontStyle: 'bold' } }, margin: { left: ml, right: mr, bottom: 30 } }
  doc.autoTable({ startY: y, head: [['Niv.', 'Frequence', 'Description']], body: [['1', 'Occasionnel', 'Quelques fois par mois'], ['2', 'Frequent', 'Plusieurs fois par jour'], ['3', 'Tres frequent', 'Plusieurs fois par heure'], ['4', 'Permanent', 'Exposition continue']], ...tblOpts }); y = doc.lastAutoTable.finalY + 6
  doc.autoTable({ startY: y, head: [['Niv.', 'Gravite', 'Description']], body: [['1', 'Minime', 'Premiers soins'], ['2', 'Significatif', 'Sans arret'], ['3', 'Grave', 'Avec arret, maladie pro.'], ['4', 'Tres grave', 'IPP, deces']], ...tblOpts }); y = doc.lastAutoTable.finalY + 6
  doc.autoTable({ startY: y, head: [['Coef.', 'Maitrise', 'Description']], body: [['x0.5', 'Bonne', 'Mesures 100% en place'], ['x0.75', 'Partielle', 'Mesures partielles'], ['x1', 'Insuffisante', 'Aucune mesure']], ...tblOpts }); y = doc.lastAutoTable.finalY + 10
  y = checkY(y, 40); doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.setTextColor(...C.teal)
  doc.text('Matrice Frequence x Gravite', ml, y); y += 4
  const mBody = []; for (let f = 4; f >= 1; f--) { const row = [`${f} -- ${FREQ[f]}`]; for (let g = 1; g <= 4; g++) { const cnt = risks.filter(r => r.frequence === f && r.gravite === g).length; row.push(cnt > 0 ? `${f * g} (${cnt})` : `${f * g}`) } mBody.push(row) }
  doc.autoTable({ startY: y, head: [['F \\ G', '1 Minime', '2 Significatif', '3 Grave', '4 Tres grave']], body: mBody, theme: 'grid', styles: { fontSize: 9, cellPadding: 3, halign: 'center' }, headStyles: { fillColor: C.teal, textColor: C.white }, columnStyles: { 0: { halign: 'left', fontStyle: 'bold', cellWidth: 35 } }, margin: { left: ml, right: mr, bottom: 30 }, didParseCell: (d) => { if (d.section === 'body' && d.column.index > 0) { const lvl = riskLevel((4 - d.row.index) * d.column.index); d.cell.styles.fillColor = lvl.bg; d.cell.styles.textColor = lvl.text } } })

  // ── SECTION 3 : INVENTAIRE ──
  y = newPage(); y = sectionTitle(y, 3, 'INVENTAIRE DES RISQUES PAR UNITE')

  // Risques par unité
  units.forEach(u => {
    const ur = risks.filter(r => r.unit_id === u.id); y = checkY(y, 30)
    doc.setFillColor(...C.teal); doc.roundedRect(ml, y - 4, cw, 10, 1.5, 1.5, 'F')
    doc.setTextColor(...C.white); doc.setFontSize(9); doc.setFont(undefined, 'bold')
    doc.text(`${(u.code || '').toUpperCase()} -- ${u.name}`, ml + 4, y + 2.5)
    if (u.effectif) { doc.setFont(undefined, 'normal'); doc.setFontSize(8); doc.text(`${u.effectif} pers.`, pw - mr - 4, y + 2.5, { align: 'right' }) }
    y += 10
    if (ur.length === 0) { doc.setFontSize(8); doc.setFont(undefined, 'italic'); doc.setTextColor(...C.gray); doc.text('Aucun risque.', ml + 4, y); y += 8; return }
    const tb = ur.map(r => { const cat = categories.find(c => c.code === r.category_code); const sc = riskScore(r); const lv = sc > 0 ? riskLevel(sc) : null; return [cat?.label || r.category_code || '--', r.danger || '--', r.situation || '--', (r.frequence && r.gravite) ? `F${r.frequence} G${r.gravite}` : '--', r.maitrise != null ? `x${r.maitrise}` : '--', sc > 0 ? `${sc}` : '--', sc > 0 ? lv.label : 'Non eval.', r.prevention_existante || '--'] })
    doc.autoTable({ startY: y, head: [['Cat.', 'Danger', 'Situation', 'FxG', 'M.', 'Score', 'Niveau', 'Prevention']], body: tb, theme: 'grid', styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak', lineWidth: 0.1 }, headStyles: { fillColor: C.amber, textColor: C.black, fontStyle: 'bold', fontSize: 8 }, columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 26 }, 2: { cellWidth: 34 }, 3: { cellWidth: 13, halign: 'center' }, 4: { cellWidth: 9, halign: 'center' }, 5: { cellWidth: 10, halign: 'center', fontStyle: 'bold' }, 6: { cellWidth: 16, halign: 'center' }, 7: { cellWidth: 40 } }, margin: { left: ml, right: mr, bottom: 30 }, didParseCell: (d) => { if (d.section === 'body' && d.column.index === 6) { const k = { Critique: 'critique', Eleve: 'eleve', Moyen: 'moyen', Faible: 'faible' }[d.cell.raw]; if (k) { d.cell.styles.fillColor = LVL[k].bg; d.cell.styles.textColor = LVL[k].text; d.cell.styles.fontStyle = 'bold' } } }, didDrawPage: autoTablePageHook })
    y = doc.lastAutoTable.finalY + 10
  })

  // FIX v4 : Afficher les risques orphelins (unit_id = null)
  if (orphanRisks.length > 0) {
    y = checkY(y, 30)
    doc.setFillColor(161, 98, 7); doc.roundedRect(ml, y - 4, cw, 10, 1.5, 1.5, 'F')
    doc.setTextColor(...C.white); doc.setFontSize(9); doc.setFont(undefined, 'bold')
    doc.text('RISQUES NON RATTACHES A UNE UNITE', ml + 4, y + 2.5)
    doc.setFont(undefined, 'normal'); doc.setFontSize(8)
    doc.text(`${orphanRisks.length} risque(s)`, pw - mr - 4, y + 2.5, { align: 'right' })
    y += 10
    const tbOrphan = orphanRisks.map(r => { const cat = categories.find(c => c.code === r.category_code); const sc = r._score; const lv = sc > 0 ? riskLevel(sc) : null; return [cat?.label || r.category_code || '--', r.danger || '--', r.situation || '--', (r.frequence && r.gravite) ? `F${r.frequence} G${r.gravite}` : '--', r.maitrise != null ? `x${r.maitrise}` : '--', sc > 0 ? `${sc}` : '--', sc > 0 ? lv.label : 'Non eval.', r.prevention_existante || '--'] })
    doc.autoTable({ startY: y, head: [['Cat.', 'Danger', 'Situation', 'FxG', 'M.', 'Score', 'Niveau', 'Prevention']], body: tbOrphan, theme: 'grid', styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak', lineWidth: 0.1 }, headStyles: { fillColor: [161, 98, 7], textColor: C.white, fontStyle: 'bold', fontSize: 8 }, columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 26 }, 2: { cellWidth: 34 }, 3: { cellWidth: 13, halign: 'center' }, 4: { cellWidth: 9, halign: 'center' }, 5: { cellWidth: 10, halign: 'center', fontStyle: 'bold' }, 6: { cellWidth: 16, halign: 'center' }, 7: { cellWidth: 40 } }, margin: { left: ml, right: mr, bottom: 30 }, didParseCell: (d) => { if (d.section === 'body' && d.column.index === 6) { const k = { Critique: 'critique', Eleve: 'eleve', Moyen: 'moyen', Faible: 'faible' }[d.cell.raw]; if (k) { d.cell.styles.fillColor = LVL[k].bg; d.cell.styles.textColor = LVL[k].text; d.cell.styles.fontStyle = 'bold' } } }, didDrawPage: autoTablePageHook })
    y = doc.lastAutoTable.finalY + 10
  }

  // ── SECTION 4 : PLAN D'ACTION ──
  y = newPage(); y = sectionTitle(y, 4, "PLAN D'ACTION DE PREVENTION")
  if (actions.length === 0) { y = para(y, 'Aucune action definie.', { italic: true, color: C.gray }) }
  else {
    // v5 : ajout colonne formation liée
    const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const matchFormation = (action) => {
      if (action.type_action !== 'formation') return ''
      const txt = norm(action.action || '')
      // Explicit matching rules - order matters (most specific first)
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
    const ab = sortedAct.map(a => { const r = risks.find(r => r.id === a.risk_id); return [PRIO[a.priorite] || '--', a.action || '--', TYPE_A[a.type_action] || a.type_action || '--', a.responsable || '--', fmtDate(a.echeance), STAT[a.statut] || '--', matchFormation(a), r?.danger || '--'] })
    doc.autoTable({ startY: y, head: [['Priorite', 'Action', 'Type', 'Resp.', 'Ech.', 'Statut', (orgDocPrefix() ? 'Formation ' + orgDocPrefix() : 'Formation'), 'Risque lie']], body: ab, theme: 'grid', styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak', lineWidth: 0.1 }, headStyles: { fillColor: C.teal, textColor: C.white, fontStyle: 'bold', fontSize: 8 }, columnStyles: { 0: { cellWidth: 18, halign: 'center' }, 1: { cellWidth: 34 }, 2: { cellWidth: 24 }, 3: { cellWidth: 16 }, 4: { cellWidth: 12, halign: 'center' }, 5: { cellWidth: 12, halign: 'center' }, 6: { cellWidth: 20, halign: 'center' }, 7: { cellWidth: 46 } }, margin: { left: ml, right: mr, bottom: 30 }, didParseCell: (d) => { if (d.section === 'body' && d.column.index === 0) { if (d.cell.raw === 'CRITIQUE') { d.cell.styles.fillColor = LVL.critique.bg; d.cell.styles.textColor = LVL.critique.text; d.cell.styles.fontStyle = 'bold' } else if (d.cell.raw === 'Haute') { d.cell.styles.fillColor = LVL.eleve.bg; d.cell.styles.textColor = LVL.eleve.text } } if (d.section === 'body' && d.column.index === 5 && d.cell.raw === 'Fait') { d.cell.styles.fillColor = LVL.faible.bg; d.cell.styles.textColor = LVL.faible.text } if (d.section === 'body' && d.column.index === 6 && d.cell.raw) { d.cell.styles.textColor = C.teal; d.cell.styles.fontStyle = 'bold' } }, didDrawPage: autoTablePageHook })
  }

  // ── SECTION 5 : MENTIONS LEGALES ──
  y = newPage(); y = sectionTitle(y, 5, 'RAPPELS REGLEMENTAIRES ET MENTIONS LEGALES')
  ;['Conservation 40 ans (Art. L.4121-3-1 V)', `MAJ : ${eff >= 11 ? 'annuelle obligatoire' : 'changement significatif'} + amenagement important`, 'Consultation CSE (si applicable)', 'Evaluation H/F (Art. L.4121-3)', eff >= 50 ? 'PAPRIPACT obligatoire' : 'Liste actions integree au DUERP', 'Transmission medecine du travail a chaque MAJ', 'Mise a disposition salaries, anciens salaries, inspecteurs, CARSAT'].forEach(item => { y = checkY(y, 8); doc.setFontSize(9.5); doc.setTextColor(...C.black); doc.text(`  - ${item}`, ml + 2, y); y += 6 })
  y += 6; y = checkY(y, 65)
  const dlL = doc.splitTextToSize(DISCLAIMER_FULL().join('\n'), cw - 12), dlH = dlL.length * 3 + 16
  doc.setFillColor(255, 250, 240); doc.setDrawColor(...C.red); doc.setLineWidth(1.2)
  doc.roundedRect(ml, y, cw, dlH, 2, 2, 'FD')
  doc.setFontSize(10); doc.setFont(undefined, 'bold'); doc.setTextColor(...C.red); doc.text('/!\\ AVERTISSEMENT', ml + 5, y + 8)
  doc.setFontSize(7.5); doc.setFont(undefined, 'normal'); doc.setTextColor(80, 80, 80); doc.text(dlL, ml + 6, y + 14)
  y += dlH + 10; y = checkY(y, 55)
  doc.setFontSize(10); doc.setFont(undefined, 'bold'); doc.setTextColor(...C.teal); doc.text('Signatures', ml, y); y += 8
  const sgW = (cw - 14) / 2
  doc.setDrawColor(...C.teal); doc.setLineWidth(0.5)
  doc.roundedRect(ml, y, sgW, 40, 2, 2, 'D')
  doc.setFontSize(9); doc.setFont(undefined, 'bold'); doc.setTextColor(...C.teal); doc.text("L'employeur", ml + sgW / 2, y + 8, { align: 'center' })
  doc.setFont(undefined, 'normal'); doc.setFontSize(8); doc.setTextColor(...C.black); doc.text(project.contact_name || '(Nom)', ml + sgW / 2, y + 15, { align: 'center' })
  doc.setFontSize(7); doc.setTextColor(...C.grayLight); doc.text('Date et signature', ml + sgW / 2, y + 35, { align: 'center' })
  const s2X = ml + sgW + 14; doc.roundedRect(s2X, y, sgW, 40, 2, 2, 'D')
  doc.setFontSize(9); doc.setFont(undefined, 'bold'); doc.setTextColor(...C.teal); doc.text("L'accompagnateur", s2X + sgW / 2, y + 8, { align: 'center' })
  doc.setFont(undefined, 'normal'); doc.setFontSize(8); doc.setTextColor(...C.black); doc.text(accompName, s2X + sgW / 2, y + 15, { align: 'center' })
  doc.setFontSize(7); doc.setTextColor(...C.grayLight); doc.text('Date et signature', s2X + sgW / 2, y + 35, { align: 'center' })

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
    ...DISCLAIMER_FULL.slice(2), '', '',
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
