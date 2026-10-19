// Programme de formation sur une page (modèle des programmes audités : colonne d'identité à gauche, chiffres clés,
// objectifs, contenu, évaluation, validation, tarif à droite). Toutes les valeurs viennent de la fiche formation
// (courses) et de l'identité de l'organisme (ORG, construit par buildORG) : rien d'un organisme en dur.
// Les tailles de texte se réduisent jusqu'à tenir sur une page. Quand le contenu est court, la place libre est répartie
// entre les rubriques et les lignes (dans chaque colonne), plutôt que de laisser un grand blanc en bas de page.
// Indicateur 1 de Qualiopi : public, prérequis, objectifs, durée, modalités et délais d'accès, tarif, contacts,
// méthodes mobilisées, modalités d'évaluation, accessibilité aux personnes en situation de handicap.

import jsPDF from 'jspdf'
import { setF, drawLogoFitted } from '../../../core/pdf/layout'

const A4 = { w: 210, h: 297 }
const SIDE_W = 64
const M = 10

export const DELAI_ACCES_DEFAUT = 'En moyenne sous 15 jours'
export const TARIF_DEFAUT = 'Tarif sur devis : nous contacter'

// Tailles essayées, de la plus grande à la plus petite ; écart maximal ajouté par unité (mm)
const TAILLES = [1.2, 1.16, 1.12, 1.06, 1, 0.95, 0.9, 0.85, 0.8, 0.76, 0.72]
const ECART_MAX_S = 5
const ECART_MAX_M = 7

const strip = (s) => String(s || '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\r/g, '').trim()

const lignes = (s) => strip(s).split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim())

// Contenu : « - » puce, « -- » ou retrait + « - » sous-puce, autre ligne = intertitre
export function lireContenu(texte) {
  return lignes(texte).map((l) => {
    if (/^\s*(--|◦|\s{2,}[-•*])\s*/.test(l)) return { niveau: 2, texte: l.replace(/^\s*(--|◦|[-•*])\s*/, '').trim() }
    if (/^\s*[-•*]\s*/.test(l)) return { niveau: 1, texte: l.replace(/^\s*[-•*]\s*/, '').trim() }
    return { niveau: 0, texte: l.trim() }
  })
}

export function heuresTexte(course) {
  const h = Number(course?.duration_hours || course?.duration || 0)
  if (!h) return ''
  const txt = `${String(h).replace('.', ',')} heure${h > 1 ? 's' : ''}`
  const j = Number(course?.duration_days || 0)
  return j > 1 ? `${txt} (${j} jours)` : txt
}

export function effectifTexte(course) {
  const a = Number(course?.min_participants || 0)
  const b = Number(course?.max_participants || 0)
  if (a && b) return `De ${a} à ${b} personnes`
  if (b) return `${b} personnes maximum`
  if (a) return `${a} personnes minimum`
  return ''
}

export function referenceProgramme(course) {
  return course?.program_ref || (course?.code ? `PROG-${course.code}` : 'PROG')
}

const dateFr = (d) => {
  if (!d) return ''
  const [y, m, j] = String(d).slice(0, 10).split('-')
  return j && m && y ? `${j}/${m}/${y}` : ''
}

// ── Dessin ─────────────────────────────────────────────────────────────────────────────────────────

function icone(doc, kind, cx, cy, r, color, fond) {
  doc.setFillColor(...fond); doc.circle(cx, cy, r, 'F')
  doc.setDrawColor(...color); doc.setFillColor(...color); doc.setLineWidth(0.45)
  if (kind === 'groupe') {
    doc.circle(cx - r * 0.32, cy - r * 0.25, r * 0.2, 'F'); doc.circle(cx + r * 0.32, cy - r * 0.25, r * 0.2, 'F')
    doc.ellipse(cx - r * 0.32, cy + r * 0.32, r * 0.3, r * 0.2, 'F'); doc.ellipse(cx + r * 0.32, cy + r * 0.32, r * 0.3, r * 0.2, 'F')
  } else if (kind === 'horloge') {
    doc.circle(cx, cy, r * 0.58, 'S'); doc.line(cx, cy, cx, cy - r * 0.38); doc.line(cx, cy, cx + r * 0.28, cy + r * 0.12)
  } else {
    doc.circle(cx, cy, r * 0.55, 'S')
    doc.triangle(cx + r * 0.42, cy - r * 0.42, cx + r * 0.72, cy - r * 0.05, cx + r * 0.2, cy - r * 0.02, 'F')
  }
}

/**
 * Construit le programme. `contexte` : { referentPedagogique, pictogramme (image PNG en data URL), reference }.
 * `cible` : document jsPDF existant (catalogue) ; le programme est dessiné sur sa page courante.
 * Retourne le document jsPDF.
 */
export function buildProgrammePDF(course, ORG, contexte = {}, cible = null) {
  const t = ORG?.theme || { primary: [28, 32, 36], accent: [200, 16, 46], highlight: [217, 166, 46], text: [22, 24, 29], muted: [107, 114, 128], line: [228, 231, 235], surface: [244, 245, 247] }
  const c = course || {}
  const blanc = [255, 255, 255]
  const doux = [214, 219, 226]

  // Colonne d'identité
  const handi = [
    ORG?.referent_handicap_nom ? `Référent : ${ORG.referent_handicap_nom}` : null,
    ORG?.referent_handicap_phone || ORG?.phone || null,
    ORG?.referent_handicap_email || ORG?.email || null,
  ].filter(Boolean)
  const cote = [
    ['Public concerné', strip(c.target_audience) || 'Tout public'],
    ['Prérequis', strip(c.prerequisites) || 'Aucun prérequis'],
    ['Modalités', strip(c.modalities) || 'En présentiel'],
    ['Moyens pédagogiques', strip(c.methods || c.pedagogical_methods || c.teaching_methods) || 'Apports théoriques et mises en situation pratiques'],
    ['À prévoir par le stagiaire', strip(c.material) || null],
    ['Formateur', strip(c.trainer_profile) || null],
    ['Délai d\'accès', strip(c.access_delay) || DELAI_ACCES_DEFAUT],
    ['Accessibilité PSH', ['Formation accessible aux personnes en situation de handicap.', ...handi, 'Adaptations possibles (supports, rythme, matériel). Contactez-nous avant l\'inscription.'].join('\n')],
  ].filter((r) => r[1])

  // Colonne principale
  const objectifs = lignes(c.objectives).map((l) => l.replace(/^\s*[-•*]\s*/, ''))
  const contenu = lireContenu(c.program || c.content)
  const validite = strip(c.validity_text)
  const chiffres = [
    ['groupe', 'Nombre d\'apprenants', effectifTexte(c)],
    ['horloge', 'Durée de la formation', heuresTexte(c)],
    ['cycle', c.validity_kind === 'validite' ? 'Durée de validité' : 'Recyclage conseillé', validite],
  ].filter((r) => r[2])
  const validation = [strip(c.deliverables) || 'À l\'issue de la formation, une attestation de fin de formation est remise au stagiaire.',
    'Le stagiaire signe la feuille d\'émargement à chaque demi-journée.']
  const evaluation = strip(c.evaluation_methods) || 'Évaluation des acquis par le formateur au cours de la formation. Questionnaire de satisfaction en fin de formation.'
  const tarif = strip(c.price_mention) || TARIF_DEFAUT
  const refProg = referenceProgramme(c)
  const pied = [
    `${(ORG?.nameFull || ORG?.name || '').toUpperCase()}${ORG?.address ? ` – Siège : ${ORG.address}` : ''}`,
    ORG?.exploitationFull ? `Site d'exploitation : ${ORG.exploitationFull}` : null,
    [ORG?.phone ? `Tél : ${ORG.phone}` : null, ORG?.email ? `Mail : ${ORG.email}` : null].filter(Boolean).join(' – '),
    [ORG?.siret ? `SIRET : ${ORG.siret}` : null, ORG?.ndaFull ? `NDA : ${ORG.ndaFull}` : null].filter(Boolean).join(' – '),
  ].filter(Boolean)

  // eS, eM : espace ajouté (mm) par unité d'écart, colonne de gauche et colonne principale
  const rendre = (k, dessiner, eS = 0, eM = 0) => {
    const doc = dessiner || new jsPDF({ compress: true })
    const fs = (n) => n * k
    const lh = (n) => n * k * 0.42 // hauteur de ligne en mm pour une taille en points
    const dw = !!dessiner
    let debordement = false
    let poidsS = 0
    let poidsM = 0
    const ecS = (base, poids) => { poidsS += poids; return base + eS * poids }
    const ecM = (base, poids) => { poidsM += poids; return base + eM * poids }

    // ── colonne gauche ──
    if (dw) { doc.setFillColor(...t.primary); doc.rect(0, 0, SIDE_W, A4.h, 'F') }
    let ys = 12
    if (ORG?.logo_base64) {
      if (dw) { try { drawLogoFitted(doc, ORG.logo_base64, M - 2, ys, SIDE_W - 2 * M + 4, 20) } catch { /* logo illisible */ } }
      ys += 24
    } else {
      setF(doc, 'bold'); doc.setFontSize(fs(14))
      const nom = doc.splitTextToSize((ORG?.name || '').toUpperCase(), SIDE_W - 2 * M + 2)
      if (dw) { doc.setTextColor(...blanc); doc.text(nom, SIDE_W / 2, ys + 4, { align: 'center' }) }
      ys += nom.length * lh(14) + 6
    }
    if (contexte.pictogramme) {
      const d = 22 * Math.max(k, 0.8)
      if (dw) { try { doc.addImage(contexte.pictogramme, 'PNG', SIDE_W / 2 - d / 2, ys, d, d) } catch { /* image illisible */ } }
      ys += ecS(d + 6, 1)
    }
    for (const [label, valeur] of cote) {
      setF(doc, 'bold'); doc.setFontSize(fs(8.5))
      if (dw) { doc.setTextColor(...t.highlight); doc.text(label.toUpperCase(), SIDE_W / 2, ys, { align: 'center' }) }
      ys += lh(8.5) + ecS(1.2, 0.3)
      setF(doc, 'normal'); doc.setFontSize(fs(7.8))
      for (const par of valeur.split('\n')) {
        const l = doc.splitTextToSize(par, SIDE_W - 2 * M + 2)
        if (dw) { doc.setTextColor(...doux); doc.text(l, SIDE_W / 2, ys, { align: 'center' }) }
        ys += l.length * lh(7.8) + 1
      }
      ys += ecS(3.2, 1)
    }
    const versionTxt = [refProg, c.program_version ? `v${c.program_version}` : null, c.program_updated_on ? `MàJ ${dateFr(c.program_updated_on)}` : null].filter(Boolean).join(' · ')
    if (dw) { setF(doc, 'normal'); doc.setFontSize(6.5); doc.setTextColor(...doux); doc.text(versionTxt, M - 4, A4.h - 7) }
    if (ys > A4.h - 12) debordement = true
    const resteS = A4.h - 14 - ys

    // ── colonne principale ──
    const X = SIDE_W + 8
    const W = A4.w - X - M
    const cx = X + W / 2
    let y = 13
    setF(doc, 'bold'); doc.setFontSize(fs(9))
    if (dw) { doc.setTextColor(...t.accent); doc.text('PROGRAMME DE FORMATION', cx, y, { align: 'center' }) }
    y += lh(9) + ecM(2.5, 0.3)
    setF(doc, 'bold'); doc.setFontSize(fs(17))
    const titre = doc.splitTextToSize((c.title || '').toUpperCase(), W)
    if (dw) { doc.setTextColor(...t.primary); doc.text(titre, cx, y + 2, { align: 'center' }) }
    y += titre.length * lh(17) + 3
    if (contexte.reference) {
      setF(doc, 'normal'); doc.setFontSize(fs(7.5))
      if (dw) { doc.setTextColor(...t.muted); doc.text(contexte.reference, cx, y, { align: 'center' }) }
      y += lh(7.5) + 1
    }
    y += ecM(0, 0.6)

    // chiffres clés
    if (chiffres.length) {
      const bw = W / chiffres.length
      const r = 4.6 * Math.max(k, 0.8)
      let nl = 1
      chiffres.forEach(([ic, label, val], i) => {
        const bx = X + i * bw + bw / 2
        if (dw) icone(doc, ic, bx, y + r + 1, r, t.accent, [253, 240, 226])
        setF(doc, 'bold'); doc.setFontSize(fs(7.2))
        if (dw) { doc.setTextColor(...t.primary); doc.text(label, bx, y + 2 * r + 5.5, { align: 'center' }) }
        setF(doc, 'normal'); doc.setFontSize(fs(8.2))
        const lv = doc.splitTextToSize(val, bw - 4)
        nl = Math.max(nl, lv.length)
        if (dw) { doc.setTextColor(...t.text); doc.text(lv, bx, y + 2 * r + 9.5, { align: 'center' }) }
      })
      y += 2 * r + 9.5 + (nl - 1) * lh(8.2) + 1.5
      if (dw) { doc.setDrawColor(...t.line); doc.setLineWidth(0.3); doc.line(X, y, X + W, y) }
      y += ecM(5, 1)
    }

    const titreSection = (txt) => {
      setF(doc, 'bold'); doc.setFontSize(fs(9.5))
      if (dw) { doc.setTextColor(...t.accent); doc.text(txt.toUpperCase(), cx, y + 2, { align: 'center' }) }
      y += lh(9.5) + ecM(3, 0.4)
    }
    const paragraphe = (txt, { taille = 8.6, centre = true, gras = false, couleur = t.text } = {}) => {
      setF(doc, gras ? 'bold' : 'normal'); doc.setFontSize(fs(taille))
      const l = doc.splitTextToSize(txt, W - 4)
      if (dw) { doc.setTextColor(...couleur); doc.text(l, centre ? cx : X + 2, y, centre ? { align: 'center' } : undefined) }
      y += l.length * lh(taille) + ecM(1.2, 0.25)
    }

    // objectifs
    if (objectifs.length) {
      titreSection('Objectifs de la formation')
      objectifs.forEach((o) => paragraphe(o, { taille: 9 }))
      y += ecM(2.5, 1)
    }

    // contenu (cadre)
    if (contenu.length) {
      titreSection('Contenu de la formation')
      const y0 = y
      const tailleC = 8.2
      const ecC = (base, poids, compter) => { if (compter) poidsM += poids; return base + eM * poids }
      const bloc = (d) => {
        let yy = y0 + ecC(4, 0.4, !d)
        for (const it of contenu) {
          if (it.niveau === 0) {
            setF(doc, 'bold'); doc.setFontSize(fs(8.6))
            const l = doc.splitTextToSize(it.texte, W - 8)
            yy += ecC(1, 0.5, !d)
            if (d) { doc.setTextColor(...t.primary); doc.text(l, X + 4, yy) }
            yy += l.length * lh(8.6) + ecC(1, 0.15, !d)
          } else {
            const ind = it.niveau === 1 ? 7 : 12
            setF(doc, 'normal'); doc.setFontSize(fs(tailleC))
            const l = doc.splitTextToSize(it.texte, W - ind - 5)
            if (d) {
              doc.setTextColor(...t.text); doc.text(l, X + ind, yy)
              doc.setFillColor(...(it.niveau === 1 ? t.accent : t.muted))
              if (it.niveau === 1) doc.circle(X + ind - 2.6, yy - 1.05, 0.65, 'F')
              else { doc.setDrawColor(...t.muted); doc.setLineWidth(0.25); doc.circle(X + ind - 2.6, yy - 1.05, 0.6, 'S') }
            }
            yy += l.length * lh(tailleC) + ecC(0.8, 0.22, !d)
          }
        }
        return yy + ecC(2, 0.4, !d)
      }
      const yFin = bloc(false)
      if (dw) {
        doc.setFillColor(...t.surface); doc.setDrawColor(...t.line); doc.setLineWidth(0.3)
        doc.roundedRect(X, y0, W, yFin - y0, 1.5, 1.5, 'FD')
        bloc(true)
      }
      y = yFin + ecM(4, 1)
    }

    titreSection('Évaluation de la formation')
    paragraphe(evaluation)
    y += ecM(2, 1)
    titreSection('Validation de la formation')
    paragraphe(validation[0])
    paragraphe(validation[1], { taille: 8, gras: true })
    y += ecM(2, 1)
    titreSection('Tarif de la formation')
    paragraphe(tarif)
    if (contexte.referentPedagogique) {
      y += 1
      paragraphe(`Référent pédagogique : ${contexte.referentPedagogique}`, { taille: 7.8, couleur: t.muted })
    }

    // pied (cadre identité)
    setF(doc, 'normal'); doc.setFontSize(7.2)
    const hPied = pied.length * 3.4 + 4
    const yPied = A4.h - 8 - hPied
    if (dw) {
      doc.setDrawColor(...t.line); doc.setLineWidth(0.3); doc.roundedRect(X + 8, yPied, W - 16, hPied, 1, 1, 'S')
      pied.forEach((l, i) => {
        setF(doc, i === 0 ? 'bold' : 'normal'); doc.setTextColor(...(i === 0 ? t.primary : t.text))
        doc.text(doc.splitTextToSize(l, W - 20), cx, yPied + 5 + i * 3.4, { align: 'center' })
      })
    }
    if (y > yPied - 2) debordement = true
    return { doc, debordement, poidsS, poidsM, resteS, resteM: yPied - 5 - y }
  }

  // Taille la plus grande qui tient sur une page
  let k = 1
  let mesure = null
  for (const essai of TAILLES) {
    k = essai
    mesure = rendre(essai, null)
    if (!mesure.debordement) break
  }
  // Place libre répartie entre les écarts de chaque colonne, plafonnée pour garder des blocs lisibles
  const eS = mesure.debordement || !mesure.poidsS ? 0 : Math.max(0, Math.min(ECART_MAX_S, mesure.resteS / mesure.poidsS))
  const eM = mesure.debordement || !mesure.poidsM ? 0 : Math.max(0, Math.min(ECART_MAX_M, mesure.resteM / mesure.poidsM))
  const doc = cible || new jsPDF({ compress: true })
  rendre(k, doc, eS, eM)
  return doc
}

/**
 * Catalogue : page de garde (organisme, liste des formations avec durée, référence et version) puis un programme
 * par page. `contextePour(course)` renvoie le contexte de chaque programme (référent, pictogramme).
 */
export function buildCataloguePDF(courses, ORG, contextePour = () => ({})) {
  const t = ORG?.theme || { primary: [28, 32, 36], accent: [200, 16, 46], highlight: [217, 166, 46], text: [22, 24, 29], muted: [107, 114, 128], line: [228, 231, 235] }
  const doc = new jsPDF({ compress: true })
  const liste = [...(courses || [])].sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'fr'))
  doc.setFillColor(...t.primary); doc.rect(0, 0, A4.w, 70, 'F')
  if (ORG?.logo_base64) { try { drawLogoFitted(doc, ORG.logo_base64, 15, 14, 60, 24) } catch { /* logo illisible */ } }
  setF(doc, 'bold'); doc.setFontSize(26); doc.setTextColor(255, 255, 255)
  doc.text('Catalogue des formations', 15, 52)
  setF(doc, 'normal'); doc.setFontSize(11); doc.setTextColor(...t.highlight)
  doc.text(ORG?.nameFull || ORG?.name || '', 15, 61)
  let y = 86
  setF(doc, 'bold'); doc.setFontSize(9); doc.setTextColor(...t.muted)
  doc.text('FORMATION', 15, y); doc.text('DURÉE', 140, y); doc.text('RÉFÉRENCE', 165, y)
  y += 3; doc.setDrawColor(...t.line); doc.setLineWidth(0.3); doc.line(15, y, 195, y); y += 6
  for (const c of liste) {
    if (y > 262) { doc.addPage(); y = 20 }
    setF(doc, 'bold'); doc.setFontSize(10.5); doc.setTextColor(...t.primary)
    const titre = doc.splitTextToSize(c.title || '', 118)
    doc.text(titre, 15, y)
    setF(doc, 'normal'); doc.setFontSize(9); doc.setTextColor(...t.text)
    doc.text(heuresTexte(c) || '', 140, y)
    doc.setTextColor(...t.muted)
    doc.text([referenceProgramme(c), c.program_version ? `v${c.program_version}` : null].filter(Boolean).join(' · '), 165, y)
    y += titre.length * 4.6 + 3
  }
  const pied = [ORG?.nameFull || ORG?.name, ORG?.address ? `Siège : ${ORG.address}` : null, ORG?.exploitationFull ? `Site d'exploitation : ${ORG.exploitationFull}` : null,
    [ORG?.phone, ORG?.email].filter(Boolean).join(' – '), ORG?.siret ? `SIRET : ${ORG.siret}` : null, ORG?.ndaFull ? `NDA : ${ORG.ndaFull}` : null].filter(Boolean)
  setF(doc, 'normal'); doc.setFontSize(8); doc.setTextColor(...t.muted)
  pied.forEach((l, i) => doc.text(l, A4.w / 2, A4.h - 30 + i * 4, { align: 'center' }))
  for (const c of liste) {
    doc.addPage()
    buildProgrammePDF(c, ORG, contextePour(c), doc)
  }
  return doc
}

// ── Versions du programme ──────────────────────────────────────────────────────────────────────────

// Champs qui changent le programme : une modification de l'un d'eux crée une nouvelle version datée
export const CHAMPS_PROGRAMME = [
  'title', 'objectives', 'program', 'prerequisites', 'target_audience', 'duration_hours', 'methods', 'material',
  'evaluation_methods', 'min_participants', 'max_participants', 'access_delay', 'validity_kind', 'validity_text',
  'deliverables', 'trainer_profile', 'price_mention', 'modalities',
]

const norm = (v) => (v === null || v === undefined ? '' : String(v).trim())

export function programmeModifie(avant, apres) {
  if (!avant) return true
  return CHAMPS_PROGRAMME.some((k) => k in apres && norm(avant[k]) !== norm(apres[k]))
}

// 1.0 → 1.1 → … → 1.9 → 1.10 ; aucune version → 1.0
export function versionSuivante(version) {
  const m = /^(\d+)\.(\d+)$/.exec(norm(version))
  if (!m) return '1.0'
  return `${m[1]}.${Number(m[2]) + 1}`
}
