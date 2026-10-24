// Dossier de relecture en PDF (24/10, demande de H : un PDF par type de prestation, et un PDF mixte quand une
// prestation combine plusieurs métiers). Chaque PDF commence par une page pour l'expert (avocat, juriste,
// expert-comptable…) : ce qu'on attend de lui, les points à valider, les passages à compléter, les questions
// tranchées ; puis les documents avec la mise en page remise aux clients, dans la variante demandée (professionnels
// ou particuliers). Le texte relu est celui en cours de circuit, sinon le brouillon, sinon le modèle.
import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { PDFDocument } from 'pdf-lib'
import { supabase } from '../../../core/supabase'
import { startDocument } from '../../../core/pdf/layout'
import { DOCS_PAR_METIER, libelleMetier } from '../../commercial/lib/metierDevis'
import { isRich, fromTemplate, visibleSections, bracketGaps, pourDestinataire, frDate, fillText, encadresAValider } from './model'
import { buildRichDocPDF } from './richDocPDF'

/** Prestations proposées dans le dossier (le dépannage reprend les conditions de maintenance) */
export const PRESTATIONS = ['formation', 'maintenance', 'vente', 'installation']

const strip = (s) => String(s ?? '').replace(/\*\*([^*]+)\*\*/g, '$1')
const RE_A_VALIDER = /^À valider\b/i

/** Documents d'une prestation ou d'un ensemble de métiers (mixte), sans doublon, dans l'ordre des métiers */
export function documentsDe(metiers = []) {
  const vus = new Set()
  const out = []
  metiers.forEach((m) => (DOCS_PAR_METIER[m] || []).forEach((d) => { if (!vus.has(d.doc)) { vus.add(d.doc); out.push({ ...d, metier: m }) } }))
  return out
}

/** Un document a-t-il une variante pour les particuliers ? */
export const aVarianteParticuliers = (content) => (content?.sections || []).some((s) => s.cond === 'particuliers')

/** Points à valider d'un document (encadrés « À valider… »), avec l'article qui les porte, dans la variante visible */
export function pointsAValider(content, ctx = null) {
  const out = []
  visibleSections(content || { sections: [] }).forEach((s) => (s.blocks || []).forEach((b) => {
    if (b.t === 'note' && RE_A_VALIDER.test(String(b.text || '').trim())) {
      out.push({ article: s.title || '', texte: strip(fillText(String(b.text).replace(/^À valider( par l'(avocat|expert))?\s*:\s*/i, ''), ctx)) })
    }
  }))
  return out
}

export { encadresAValider }

/** Nom de fichier lisible et sûr */
export const nomFichier = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 +()-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90)

/** Liste des PDF du dossier : une entrée par prestation et par variante, plus les mixtes demandés */
export function planDossier({ prestations = [], particuliers = false, mixtes = [] } = {}, aParticuliers = () => true) {
  const plan = []
  prestations.forEach((m) => {
    plan.push({ titre: libelleMetier(m), metiers: [m], audience: 'pro' })
    if (particuliers && documentsDe([m]).some((d) => aParticuliers(d.doc))) plan.push({ titre: `${libelleMetier(m)} (particuliers)`, metiers: [m], audience: 'particulier' })
  })
  mixtes.filter((x) => (x || []).length >= 2).forEach((ms) => {
    const titre = `Mixte : ${ms.map(libelleMetier).join(' + ')}`
    plan.push({ titre, metiers: ms, audience: 'pro' })
    if (particuliers && documentsDe(ms).some((d) => aParticuliers(d.doc))) plan.push({ titre: `${titre} (particuliers)`, metiers: ms, audience: 'particulier' })
  })
  return plan
}

/** Texte à relire de chaque document : circuit ouvert, sinon brouillon enregistré, sinon modèle */
export async function contenusARelire(docIds, templates) {
  const [{ data: qd }, { data: rv }] = await Promise.all([
    supabase.from('quality_documents').select('doc_id, content').in('doc_id', docIds),
    supabase.from('doc_reviews').select('doc_id, content, status, round, expert_label').in('doc_id', docIds).in('status', ['relecture', 'arbitrage', 'expert']),
  ])
  const out = {}
  docIds.forEach((id) => {
    const tpl = templates[id]
    if (!tpl) return
    const enregistre = (qd || []).find((x) => x.doc_id === id)?.content
    const circuit = (rv || []).find((x) => x.doc_id === id)
    const base = isRich(enregistre) ? enregistre : fromTemplate(tpl)
    out[id] = circuit
      ? { content: { ...base, sections: circuit.content.sections, options: { ...(base.options || {}), ...(circuit.content.options || {}) }, status: 'brouillon' }, source: `relecture en cours (tour ${circuit.round})`, circuit }
      : { content: { ...base, status: base.status === 'valide' ? 'valide' : 'brouillon' }, source: base.status === 'valide' ? `version ${base.version} en vigueur` : isRich(enregistre) ? 'brouillon enregistré' : 'modèle de l\'outil' }
  })
  return out
}

/** Page pour le relecteur, en tête de chaque PDF */
function pageDeGarde(ORG, { titre, audience, docs, relecteur, consigne, echeance, ctx, questions = [] }) {
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, {
    docLabel: 'Dossier de relecture', code: 'RELECTURE', title: titre,
    subtitle: [audience === 'particulier' ? 'Version remise aux clients particuliers' : 'Version remise aux clients professionnels', `préparé le ${frDate(new Date().toISOString())}`].join('  ·  '),
  })
  f.section('Ce que nous vous demandons')
  f.para(`${relecteur ? `À l'attention de ${relecteur}. ` : ''}Merci de relire les documents ci-dessous, tels qu'ils seront remis à nos clients avec chaque devis de cette prestation. Indiquez-nous les corrections à apporter (directement dans le fichier Word fourni avec ce dossier, en modifications suivies, ou en commentaire), en priorité sur les points listés ci-après.${echeance ? ` Réponse souhaitée avant le ${frDate(echeance)}.` : ''}`)
  if (consigne) f.callout('Précision', consigne)
  f.section('Documents de cette prestation')
  f.table(['Document', 'Texte relu'], docs.map((d) => [d.label, d.source]), { columnStyles: { 1: { cellWidth: 60 } } })
  const points = docs.flatMap((d) => pointsAValider(audience === 'particulier' ? pourDestinataire(d.content, 'particulier') : pourDestinataire(d.content, 'pro'), ctx).map((p) => [d.label, p.article, p.texte]))
  f.section('Points à valider')
  if (points.length) f.table(['Document', 'Article', 'Point'], points, { columnStyles: { 0: { cellWidth: 38 }, 1: { cellWidth: 36 } }, styles: { fontSize: 8, valign: 'top' } })
  else f.para('Aucun point signalé : relecture générale.')
  const trous = docs.flatMap((d) => [...new Set(bracketGaps(d.content).map((g) => g.gap))].map((g) => [d.label, g]))
  if (trous.length) {
    f.section('Passages encore à compléter par l\'entreprise')
    f.table(['Document', 'Passage'], trous, { columnStyles: { 0: { cellWidth: 60 } } })
  }
  if (questions.length) {
    f.section('Choix faits par l\'entreprise')
    f.table(['Question', 'Réponse retenue'], questions.map((q) => [q.text, q.choice || 'en cours']), { columnStyles: { 1: { cellWidth: 50 } } })
  }
  f.space(2)
  f.note('Les passages marqués « À valider » dans les documents sont des projets de clauses, rédigés pour être vérifiés. Ils ne sont pas remis aux clients tant qu\'ils ne sont pas validés.')
  f.finish()
  return doc.output('arraybuffer')
}

async function fusionner(buffers) {
  const out = await PDFDocument.create()
  for (const b of buffers) {
    const src = await PDFDocument.load(b, { ignoreEncryption: true })
    const pages = await out.copyPages(src, src.getPageIndices())
    pages.forEach((p) => out.addPage(p))
  }
  return out.save()
}

/**
 * Fabrique le dossier : [{ nom, bytes }] (un PDF par entrée du plan, page pour le relecteur en tête).
 * opts : { plan, templates, ORG, ctx, codeDe(tplCode), relecteur, consigne, echeance, avecWord }
 */
export async function fabriquerDossier({ plan, templates, ORG, ctx, codeDe = (c) => c, relecteur = '', consigne = '', echeance = '', avecWord = true }) {
  const ids = [...new Set(plan.flatMap((e) => documentsDe(e.metiers).map((d) => d.doc)))].filter((id) => templates[id])
  const contenus = await contenusARelire(ids, templates)
  const circuitIds = Object.values(contenus).map((c) => c.circuit).filter(Boolean)
  let questions = []
  if (circuitIds.length) {
    const { data } = await supabase.from('doc_review_items').select('text, choice, status, review_id, doc_reviews!inner(doc_id)').eq('kind', 'question').in('doc_reviews.doc_id', ids)
    questions = data || []
  }
  const fichiers = []
  for (const [i, e] of plan.entries()) {
    const docs = documentsDe(e.metiers).filter((d) => contenus[d.doc]).map((d) => ({ ...d, ...contenus[d.doc] }))
    if (!docs.length) continue
    const parts = [pageDeGarde(ORG, { titre: e.titre, audience: e.audience, docs, relecteur, consigne, echeance, ctx, questions: questions.filter((q) => docs.some((d) => d.doc === q.doc_reviews?.doc_id)) })]
    for (const d of docs) {
      const tpl = templates[d.doc]
      const r = buildRichDocPDF(ORG, { tpl, code: codeDe(tpl.code), content: pourDestinataire(d.content, e.audience), ctx, history: [] })
      parts.push(r.doc.output('arraybuffer'))
    }
    fichiers.push({ nom: `${String(i + 1).padStart(2, '0')} ${nomFichier(e.titre)}.pdf`, bytes: await fusionner(parts) })
  }
  // Fichiers Word des documents, pour les corrections en modifications suivies (réimportées dans le circuit)
  if (avecWord) {
    const { exportDocx } = await import('./docxRichDoc')
    for (const id of ids) {
      const tpl = templates[id]
      const blob = await exportDocx({ tpl, content: contenus[id].content, code: codeDe(tpl.code) })
      fichiers.push({ nom: `Word/${nomFichier(tpl.name)}.docx`, bytes: new Uint8Array(await blob.arrayBuffer()) })
    }
  }
  return fichiers
}
