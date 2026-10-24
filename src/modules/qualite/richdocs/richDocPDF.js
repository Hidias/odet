// PDF d'un document qualité au nouveau modèle, sur la mise en page commune (core/pdf/layout.js) :
// cartouche (version, dates, pilote, valideur, motif), sections et blocs, historique des versions.

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { startDocument, numberPages, setF } from '../../../core/pdf/layout'
import { visibleSections, fillText, frDate } from './model'

const strip = (s) => String(s ?? '').replace(/\*\*([^*]+)\*\*/g, '$1')

/** Paragraphe avec passages en gras (**...**), retour à la ligne mot à mot */
function richPara(f, text, { size = 9, x = null, w = null, after = 2.2, firstPrefix = null, prefixW = 0 } = {}) {
  const { doc } = f
  const X = x ?? f.M
  const W = w ?? f.W
  const lh = size * 0.455
  const words = []
  String(text ?? '').split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
    if (!part) return
    const bold = /^\*\*[^*]+\*\*$/.test(part)
    const raw = bold ? part.slice(2, -2) : part
    raw.split(/(\s+)/).forEach((w2) => { if (w2) words.push({ text: w2, bold }) })
  })
  const width = (wd) => { setF(doc, wd.bold ? 'bold' : 'normal'); doc.setFontSize(size); return doc.getTextWidth(wd.text) }
  const lines = []
  let cur = []
  let curW = 0
  const avail = W - prefixW
  words.forEach((wd) => {
    const isSpace = /^\s+$/.test(wd.text)
    if (isSpace && !cur.length) return
    const ww = width(wd)
    if (!isSpace && curW + ww > avail && cur.length) {
      while (cur.length && /^\s+$/.test(cur[cur.length - 1].text)) cur.pop()
      lines.push(cur); cur = []; curW = 0
    }
    if (isSpace && !cur.length) return
    cur.push(wd); curW += ww
  })
  if (cur.length) lines.push(cur)
  f.ensure(Math.min(lines.length, 2) * lh)
  lines.forEach((ln, i) => {
    f.ensure(lh)
    if (i === 0 && firstPrefix) { f.body(size); setF(doc, 'bold'); doc.text(firstPrefix, X, f.y) }
    let xx = X + prefixW
    ln.forEach((wd) => {
      f.body(size); setF(doc, wd.bold ? 'bold' : 'normal')
      doc.text(wd.text, xx, f.y)
      xx += doc.getTextWidth(wd.text)
    })
    f.y += lh
  })
  f.y += after
}

function bulletList(f, items, ctx, { ordered = false, start = 1 } = {}) {
  items.filter((it) => String(it || '').trim()).forEach((it, i) => {
    const prefix = ordered ? `${start + i}.` : null
    if (!ordered) {
      f.ensure(4.2)
      f.doc.setFillColor(...f.t.highlight); f.doc.circle(f.M + 1.5, f.y - 1.1, 0.7, 'F')
    }
    richPara(f, fillText(it, ctx), { x: f.M, prefixW: ordered ? 6 : 5, firstPrefix: prefix, after: 0.8 })
  })
  f.y += 1.5
}

function drawBlock(f, b, ctx) {
  if (b.t === 'p') { richPara(f, fillText(b.text, ctx)); return }
  if (b.t === 'h') { f.y += 1; richPara(f, `**${strip(fillText(b.text, ctx))}**`, { size: 9.5, after: 1.5 }); return }
  if (b.t === 'ul') { bulletList(f, b.items || [], ctx); return }
  if (b.t === 'ol') { bulletList(f, b.items || [], ctx, { ordered: true, start: b.start || 1 }); return }
  if (b.t === 'check') { f.checks((b.items || []).filter(Boolean).map((it) => ({ label: strip(fillText(it, ctx)) }))); return }
  if (b.t === 'note') { f.callout('À retenir', strip(fillText(b.text, ctx))); return }
  if (b.t === 'quote') { f.callout(null, (b.paras || []).filter(Boolean).map((p) => strip(fillText(p, ctx))).join('\n\n'), { tone: 'muted' }); return }
  if (b.t === 'table') {
    const head = (b.head || []).map((h) => strip(fillText(h, ctx)))
    const rows = (b.rows || []).map((r) => head.map((_, j) => {
      const raw = fillText(r[j] ?? '', ctx)
      const allBold = /^\*\*[^*]+\*\*$/.test(raw.trim())
      return allBold ? { content: strip(raw), styles: { fontStyle: 'bold' } } : strip(raw)
    }))
    const n = head.length
    const columnStyles = n >= 3 ? { 0: { cellWidth: n >= 5 ? 26 : 38 } } : { 0: { cellWidth: 52, fontStyle: 'bold' } }
    f.table(head, rows, { columnStyles, styles: { fontSize: 8, valign: 'top' } })
  }
}

/** Écrit les sections d'un document (contenu au nouveau modèle) dans un flux de layout.js déjà ouvert */
export function writeRichDoc(f, content, ctx, { titles = true, numeroter = false } = {}) {
  // numeroter : articles numérotés à la suite parmi les sections visibles (variante professionnels ou particuliers
  // d'une condition générale, sans trou de numéro)
  visibleSections(content).forEach((s, i) => {
    if (s.title && titles) f.section(numeroter ? `Article ${i + 1}. ${s.title}` : s.title)
    s.blocks.forEach((b) => drawBlock(f, b, ctx))
  })
}

/**
 * @param {object} ORG identité (loadPdfOrg)
 * @param {object} p { tpl (code, name, indicators, pilote), code (avec initiales), content, ctx, history: versions validées }
 */
export function buildRichDocPDF(ORG, { tpl, code, content, ctx, history = [] }) {
  const doc = new jsPDF({ compress: true })
  const validated = content.status === 'valide'
  const version = validated ? content.version : (content.version || 0) + 1
  const ind = (tpl.indicators || []).length
    ? `Référentiel national qualité, indicateur${tpl.indicators.length > 1 ? 's' : ''} ${tpl.indicators.join(', ')}`
    : null
  const f = startDocument(doc, ORG, {
    ref: `${code}-V${version}`,
    docLabel: tpl.family === 'commerce' ? 'Conditions commerciales' : 'Système qualité',
    code: `${tpl.code}-V${version}`,
    title: tpl.name.replace(/^[PD]\d\d /, ''),
    subtitle: [ind, content.options?.audience === 'particulier' ? 'Version pour les particuliers' : null,
      validated ? null : `Projet, version ${version} non validée`].filter(Boolean).join('  ·  ') || null,
  })
  const last = history[0] || null
  const pilote = tpl.pilote ? tpl.pilote.replace(/^le |^la /, '') : 'Direction'
  const cell = (k) => ({ content: k, styles: { fontStyle: 'bold', fillColor: ORG.theme.surface, textColor: ORG.theme.muted } })
  f.table(null, [
    [cell('Code'), code, cell('Version'), validated ? `${version}` : `${version} (projet)`],
    [cell("Date d'application"), validated ? frDate(content.validated_at) : 'Non validée', cell('Prochaine revue'), validated ? frDate(content.next_review) : '-'],
    [cell('Pilote'), pilote.charAt(0).toUpperCase() + pilote.slice(1), cell('Validé par'), validated && last ? `${last.validated_by_name || ''}, le ${frDate(last.validated_at)}` : '-'],
    [cell('Modification'), { content: validated && last ? (last.motif || '-') : (content.motif || 'Projet en cours'), colSpan: 3 }],
  ], { styles: { fontSize: 8, valign: 'top' }, columnStyles: { 0: { cellWidth: 32 }, 2: { cellWidth: 30 } }, alternateRowStyles: {} })

  writeRichDoc(f, content, ctx, { numeroter: !!tpl.numeroter })

  if (history.length) {
    f.section('Historique des versions')
    f.table(['Version', 'Date', 'Validée par', 'Motif'], history.map((h) => [String(h.version), frDate(h.validated_at), h.validated_by_name || '', h.motif || '']), {
      columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 24 }, 2: { cellWidth: 40 } },
    })
  }
  f.space(2)
  f.note("Document maîtrisé : seule la version en vigueur dans l'outil de gestion fait foi. Une copie imprimée n'est valable que le jour de son impression.")
  f.finish()
  numberPages(doc, ORG)
  const safe = String(tpl.name).replace(/^[PD]\d\d /, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 50)
  return { doc, filename: `${code}-V${version}_${safe}.pdf` }
}
