// Version publiée d'un document qualité, pour les documents remis aux stagiaires et aux clients
// (règlement intérieur, livret d'accueil, conditions de vente) : une seule source, Documents qualité.
// Ordre : dernière version validée (lisible aussi depuis le portail), sinon le brouillon enregistré,
// sinon le modèle de l'outil.

import { supabase } from '../../../core/supabase'
import { loadTemplates, isRich, fromTemplate, visibleSections, frDate } from './model'

const cache = new Map()
const TTL = 30000

export async function loadPublishedDoc(docId, { force = false } = {}) {
  const hit = cache.get(docId)
  if (hit && !force && Date.now() - hit.at < TTL) return hit.value
  let value = null
  try {
    const { data } = await supabase.rpc('published_quality_doc', { p_doc_id: docId })
    if (data?.content?.sections) value = { content: { model: 'rich', ...data.content }, version: data.version, validated_at: data.validated_at, source: 'valide' }
  } catch { /* portail sans droits : on continue */ }
  if (!value) {
    try {
      const { data } = await supabase.from('quality_documents').select('content').eq('doc_id', docId).maybeSingle()
      if (isRich(data?.content)) value = { content: data.content, version: null, validated_at: null, source: 'brouillon' }
    } catch { /* idem */ }
  }
  if (!value) {
    const tpls = await loadTemplates()
    if (tpls[docId]) value = { content: fromTemplate(tpls[docId]), version: null, validated_at: null, source: 'modele' }
  }
  cache.set(docId, { at: Date.now(), value })
  return value
}

/** Mention de version pour un document remis (vide tant que rien n'est validé) */
export const versionLabel = (pub) => (pub?.version ? `Version ${pub.version} du ${frDate(pub.validated_at)}` : '')

const strip = (s) => String(s ?? '').replace(/\*\*([^*]+)\*\*/g, '$1')

/** Article des CGV sur l'annulation, en texte suivi (repris dans l'article « Annulation et report » des conventions) */
export function cgvCancellationText(content) {
  const secs = visibleSections(content || { sections: [] })
  const pick = (re) => secs.find((s) => re.test(s.title || ''))
  const parts = []
  ;[pick(/^Article 8\b/), pick(/^Article 9\b/)].filter(Boolean).forEach((s) => {
    s.blocks.forEach((b) => {
      if (b.t === 'p') parts.push(strip(b.text))
      if (b.t === 'table') {
        const lc = (x) => { const t = strip(x); return t.charAt(0).toLowerCase() + t.slice(1) }
        parts.push(`${strip(b.head?.[1] || 'Montant dû')} : ${(b.rows || []).map((r) => `${lc(r[0])}, ${lc(r[1])}`).join(' ; ')}.`)
      }
      if (b.t === 'ul' || b.t === 'ol') parts.push((b.items || []).map(strip).join(' ; ') + '.')
    })
  })
  return parts.join(' ')
}

/**
 * PDF d'un document qualité dans sa version publiée (validée, sinon brouillon, sinon modèle),
 * par exemple les conditions générales de vente jointes aux devis.
 * Renvoie { base64, filename, version } ou null si la génération échoue.
 */
export async function publishedDocPDF(docId) {
  try {
    const [{ buildRichDocPDF }, { loadPdfOrg }, { loadTemplateContext }, { docCode }] = await Promise.all([
      import('./richDocPDF'),
      import('../../../core/pdf/pdfOrg'),
      import('../../../core/org/templateContext'),
      import('../../../core/org/currentOrg'),
    ])
    const [pub, tpls, ORG, ctx, hist] = await Promise.all([
      loadPublishedDoc(docId),
      loadTemplates(),
      loadPdfOrg(),
      loadTemplateContext(),
      supabase.from('quality_doc_versions').select('*').eq('doc_id', docId).order('version', { ascending: false }).then((r) => r.data || [], () => []),
    ])
    const tpl = tpls[docId]
    if (!pub || !tpl) return null
    const r = buildRichDocPDF(ORG, { tpl, code: docCode(tpl.code), content: pub.content, ctx, history: hist })
    const dataUri = r.doc.output('datauristring')
    return { base64: dataUri.split(',')[1], filename: r.filename, version: pub.version, source: pub.source }
  } catch (e) {
    console.error('publishedDocPDF', docId, e)
    return null
  }
}
