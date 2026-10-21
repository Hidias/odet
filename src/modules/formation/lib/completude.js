// Ce qui manque à une formation du catalogue pour être prête à vendre et à animer (demande de H du 21/10 :
// « l'outil devrait me dire : pour cette formation il me manque tel ou tel document »).
// Règles simples, sans exigence inventée : de quoi produire le programme, un support pour le formateur, un livret
// pour les stagiaires, un test de positionnement pour le thème.

import { supabase } from '../../../core/supabase'

export const PIECES = [
  { cle: 'programme', label: 'contenu du programme', aide: 'Objectifs et contenu, qui servent à produire le programme PDF' },
  { cle: 'support_formateur', label: 'support formateur', aide: 'Diaporama ou document du formateur (onglet Documents de formations)' },
  { cle: 'document_stagiaire', label: 'livret stagiaire', aide: 'PDF remis aux stagiaires (onglet Documents de formations)' },
  { cle: 'positionnement', label: 'test de positionnement', aide: 'Questions du thème de la formation (onglet Tests de positionnement)' },
]

const rempli = (v) => typeof v === 'string' ? v.trim().length > 0 : !!v

/**
 * Pièces manquantes d'une formation.
 * @param course la formation (objectives, program ou content, theme_id)
 * @param docs nombre de documents par type pour cette formation : { support_formateur: 1, ... }
 * @param themesAvecTest ensemble des thèmes qui ont au moins une question de positionnement
 */
export function piecesManquantes(course, docs = {}, themesAvecTest = new Set()) {
  if (!course) return []
  const manque = []
  if (!rempli(course.objectives) || !(rempli(course.program) || rempli(course.content))) manque.push('programme')
  if (!(docs.support_formateur > 0)) manque.push('support_formateur')
  if (!(docs.document_stagiaire > 0)) manque.push('document_stagiaire')
  if (!course.theme_id || !themesAvecTest.has(course.theme_id)) manque.push('positionnement')
  return manque
}

export const libellesManquants = (cles) => cles.map((c) => PIECES.find((p) => p.cle === c)?.label || c)

/** Charge les comptes de documents par formation et les thèmes qui ont un test de positionnement */
export async function chargerCompletude() {
  const [{ data: docs, error: e1 }, { data: questions, error: e2 }] = await Promise.all([
    supabase.from('course_documents').select('course_id, type'),
    supabase.from('theme_questions').select('theme_id'),
  ])
  if (e1) throw e1
  if (e2) throw e2
  const parFormation = {}
  for (const d of docs || []) {
    const c = (parFormation[d.course_id] = parFormation[d.course_id] || {})
    c[d.type] = (c[d.type] || 0) + 1
  }
  return { parFormation, themesAvecTest: new Set((questions || []).map((q) => q.theme_id).filter(Boolean)) }
}
