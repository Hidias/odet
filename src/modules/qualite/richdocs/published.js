// Version publiée d'un document qualité, pour les documents remis aux stagiaires et aux clients
// (règlement intérieur, livret d'accueil, conditions de vente) : une seule source, Documents qualité.
// Ordre : dernière version validée (lisible aussi depuis le portail), sinon le brouillon enregistré,
// sinon le modèle de l'outil.

import { supabase } from '../../../core/supabase'
import { loadTemplates, isRich, fromTemplate, visibleSections, frDate, pourDestinataire } from './model'

const cache = new Map()
const TTL = 30000

export async function loadPublishedDoc(docId, { force = false } = {}) {
  const hit = cache.get(docId)
  if (hit && !force && Date.now() - hit.at < TTL) return hit.value
  let value = null
  try {
    const { data } = await supabase.rpc('published_quality_doc', { p_doc_id: docId })
    // La copie figée d'une version validée ne porte ni le statut ni le numéro : on les reprend de la version, sinon le PDF
    // se croit un projet (« Projet, version 1 non validée », fichier « -V1 » pour une V3, constat du 06/11)
    if (data?.content?.sections) value = { content: { model: 'rich', ...data.content, status: 'valide', version: data.version, validated_at: data.validated_at }, version: data.version, validated_at: data.validated_at, source: 'valide' }
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

// Intertitre d'un passage propre aux formations SST (ex. « Formations Sauveteur Secouriste du Travail (SST) »)
const intertitreSST = (b) => b.t === 'h' && /\bSST\b|sauveteur secouriste/i.test(strip(b.text))

/**
 * Articles 8 et 9 des CGV (annulation et report), repris dans l'article « Annulation et report » des conventions,
 * en blocs lisibles : intertitre par article, paragraphes, barème (lignes [quand, dédommagement]), listes
 * (numérotées si elles le sont dans les CGV). Le passage propre au SST (de son intertitre à la fin de l'article)
 * n'est repris que pour une formation SST. Rien n'est reformulé. Un intertitre sans contenu derrière est retiré ;
 * [] s'il ne reste aucun texte.
 */
export function cgvAnnulationBlocs(content, { sst = false } = {}) {
  const secs = visibleSections(content || { sections: [] })
  const pick = (re) => secs.find((s) => re.test(s.title || ''))
  const blocs = []
  ;[pick(/^Article 8\b/), pick(/^Article 9\b/)].filter(Boolean).forEach((s) => {
    const titre = strip(s.title).replace(/^Article \d+\.?\s*/, '')
    if (titre) blocs.push({ h: titre, article: true })
    let dansSST = false
    s.blocks.forEach((b) => {
      // Passage SST : de son intertitre à la fin de l'article (un sous-titre ou un intertitre vide ne le ferme pas)
      if (intertitreSST(b)) dansSST = true
      if (dansSST && !sst) return
      if (b.t === 'h' && strip(b.text)) blocs.push({ h: strip(b.text) })
      if (b.t === 'p' && strip(b.text)) blocs.push({ p: strip(b.text) })
      if (b.t === 'table' && (b.rows || []).length) {
        blocs.push({ bareme: (b.rows || []).map((r) => [strip(r[0]), strip(r[1])]), titre: strip(b.head?.[1] || '') })
      }
      const items = (b.items || []).map(strip).filter(Boolean)
      if ((b.t === 'ul' || b.t === 'ol') && items.length) blocs.push(b.t === 'ol' ? { list: items.map((x, i) => `${i + 1}. ${x}`), numerote: true } : { list: items })
    })
  })
  // Intertitre sans contenu derrière : retiré (un sous-titre jusqu'au suivant, un titre d'article jusqu'au suivant)
  const contenuApres = (i) => {
    for (let j = i + 1; j < blocs.length; j++) {
      if (!blocs[j].h) return true
      if (blocs[j].article || !blocs[i].article) return false
    }
    return false
  }
  const gardes = blocs.filter((b, i) => !b.h || contenuApres(i)).map(({ article, ...b }) => b) // eslint-disable-line no-unused-vars
  return gardes.some((b) => !b.h) ? gardes : []
}

/**
 * PDF d'un document qualité dans sa version publiée (validée, sinon brouillon, sinon modèle),
 * par exemple les conditions générales de vente jointes aux devis.
 * Renvoie { base64, filename, version } ou null si la génération échoue.
 */
export async function publishedDocPDF(docId, { audience } = {}) {
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
    // Prochaine revue : la ligne de la version validée la porte, pas sa copie figée
    const base = pub.source === 'valide' && hist[0]?.version === pub.version && hist[0]?.next_review ? { ...pub.content, next_review: hist[0].next_review } : pub.content
    const content = audience ? pourDestinataire(base, audience) : base
    const r = buildRichDocPDF(ORG, { tpl, code: docCode(tpl.code), content, ctx, history: hist })
    const dataUri = r.doc.output('datauristring')
    return { base64: dataUri.split(',')[1], filename: r.filename, version: pub.version, source: pub.source, validated_at: pub.validated_at, docId, audience: audience || null }
  } catch (e) {
    console.error('publishedDocPDF', docId, e)
    return null
  }
}
