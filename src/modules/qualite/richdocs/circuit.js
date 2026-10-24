// Circuit de validation des documents (0455) : rédaction, relecture par l'équipe, arbitrage par la direction,
// vérification par un expert (selon l'entreprise), retour arbitré, version validée. Réglable par document.
import { supabase } from '../../../core/supabase'
import { diffMots } from './docxRichDoc'

export const MODES = {
  direct: { label: 'Validation directe', aide: 'Une personne qui valide les documents valide seule, sans relecture.' },
  interne: { label: 'Relecture par l\'équipe', aide: 'Des personnes de l\'entreprise relisent, la direction arbitre et valide.' },
  complet: { label: 'Relecture et expert', aide: 'Relecture par l\'équipe, puis vérification par un expert (avocat, juriste, expert-comptable…), puis validation par la direction.' },
}

export const ETATS = {
  relecture: { label: 'En relecture', tone: 'blue' },
  arbitrage: { label: 'À arbitrer', tone: 'amber' },
  expert: { label: 'Chez l\'expert', tone: 'blue' },
  validee: { label: 'Validée', tone: 'green' },
  abandonnee: { label: 'Abandonnée', tone: 'gray' },
}

export const QUALITES = { interne: 'Équipe', expert: 'Expert', modele: 'Modèle de l\'outil' }

/** Circuit d'un document d'après les réglages de la société (défaut : validation directe) */
export function modeDuDocument(reglages, docId) {
  const m = reglages?.per_doc?.[docId] || reglages?.default_mode
  return MODES[m] ? m : 'direct'
}

/** Étapes affichées, selon le circuit */
export function etapes(mode) {
  return mode === 'complet'
    ? [['relecture', 'Relecture'], ['arbitrage', 'Arbitrage'], ['expert', 'Expert'], ['retour', 'Retour arbitré'], ['validee', 'Validée']]
    : [['relecture', 'Relecture'], ['arbitrage', 'Arbitrage'], ['validee', 'Validée']]
}

/** Étape en cours dans la liste des étapes */
export function etapeCourante(review) {
  if (!review) return null
  if (review.status === 'arbitrage' && review.mode === 'complet' && review.expert_returned_at) return 'retour'
  return review.status
}

/** Texte suivi d'un article (pour la comparaison mot à mot) */
export function texteArticle(s) {
  return (s?.blocks || []).map((b) => {
    if (b.t === 'p' || b.t === 'h' || b.t === 'note') return b.text || ''
    if (b.t === 'quote') return (b.paras || []).join(' ')
    if (b.t === 'table') return [...(b.head || []), ...(b.rows || []).flat()].join(' | ')
    return (b.items || []).join(' ; ')
  }).join('\n')
}

/** Différence mot à mot entre l'article au moment de l'avis et la proposition */
export const diffProposition = (base, proposed) => diffMots(texteArticle(base), texteArticle(proposed))

/** Ce qui reste à trancher avant d'envoyer à l'expert ou de valider */
export function resteATrancher(items = []) {
  const ouverts = items.filter((i) => i.status === 'ouverte')
  return {
    modifications: ouverts.filter((i) => i.kind === 'modification').length,
    questions: ouverts.filter((i) => i.kind === 'question').length,
    commentaires: ouverts.filter((i) => i.kind === 'commentaire').length,
  }
}

/** Ce que le circuit permet maintenant (droits : peutValider, peutGerer ; estRelecteur, estAuteur) */
export function actionsPossibles(review, { peutValider = false, peutGerer = false, estRelecteur = false, estAuteur = false, items = [] } = {}) {
  const a = new Set()
  if (!review) return a
  const reste = resteATrancher(items)
  const bloque = reste.modifications + reste.questions > 0
  if (review.status === 'relecture') {
    if (estRelecteur || peutGerer) a.add('avis')
    if (estRelecteur) a.add('terminer')
    if (peutValider) a.add('arbitrer')
  }
  if (review.status === 'arbitrage' && peutValider) {
    a.add('decider'); a.add('modifier_texte'); a.add('renvoyer')
    if (review.mode === 'complet' && !review.expert_returned_at && !bloque) a.add('expert')
    if ((review.mode === 'interne' || review.expert_returned_at) && !bloque) a.add('valider')
  }
  if (review.status === 'expert' && peutGerer) { a.add('retour_expert'); a.add('dossier_expert') }
  if (['relecture', 'arbitrage', 'expert'].includes(review.status) && (peutValider || estAuteur)) a.add('abandonner')
  return a
}

/** Propositions de l'expert à partir du fichier relu : une modification par article changé */
export function propositionsDepuisFichier(actuelles = [], relues = []) {
  const parId = new Map(actuelles.map((s) => [s.id, s]))
  const out = []
  for (const s of relues) {
    const a = parId.get(s.id)
    if (!a || texteArticle(a) !== texteArticle(s) || (a.title || '') !== (s.title || '')) {
      out.push({ section_id: s.id, proposed: { title: s.title, blocks: s.blocks, ...(a ? {} : { extra: s.cond ? { cond: s.cond } : {} }) } })
    }
  }
  return out
}

// ── Accès à la base ──
export async function chargerReglages() {
  const { data } = await supabase.from('doc_review_settings').select('*').maybeSingle()
  return data || { default_mode: 'direct', per_doc: {} }
}

/** Réglage du circuit : mode par défaut et/ou modes par document ({ doc_id: mode | null }) */
export async function enregistrerReglages({ defaultMode = null, perDoc = null } = {}) {
  const { data, error } = await supabase.rpc('doc_review_regler', { p_default_mode: defaultMode, p_per_doc: perDoc })
  if (error) throw new Error(error.message)
  return data
}

export async function circuitOuvert(docId) {
  const { data } = await supabase.from('doc_reviews').select('*').eq('doc_id', docId).in('status', ['relecture', 'arbitrage', 'expert']).maybeSingle()
  return data || null
}

/** Lance le circuit : contenu figé, relecteurs, questions ouvertes */
export async function lancerCircuit({ tpl, content, mode, participants = [], questions = [], message = '', dueOn = null }) {
  const { data: r, error } = await supabase.from('doc_reviews').insert({
    doc_id: tpl.id, doc_name: tpl.name, base_version: content.version || 0, mode,
    content: { sections: content.sections, options: content.options || {} }, message: message.trim() || null, due_on: dueOn || null,
  }).select('*').single()
  if (error) throw new Error(error.message)
  if (participants.length) {
    const { error: e2 } = await supabase.from('doc_review_participants').insert(participants.map((p) => ({ review_id: r.id, profile_id: p })))
    if (e2) throw new Error(e2.message)
  }
  const qs = questions.filter((q) => String(q.q || '').trim().length >= 3 && (q.choix || []).filter(Boolean).length >= 2)
  if (qs.length) {
    const { error: e3 } = await supabase.from('doc_review_items').insert(qs.map((q) => ({
      review_id: r.id, section_id: q.section || null, kind: 'question', text: q.q.trim(), choices: q.choix.map((c) => c.trim()).filter(Boolean).slice(0, 6),
    })))
    if (e3) throw new Error(e3.message)
  }
  return r
}
