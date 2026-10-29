// Attestation de fin de formation (lot S12-1a, décision de H du 29/10) : document remis au stagiaire, distinct du
// certificat de réalisation. Il reprend les objectifs de la formation et le résultat de l'évaluation des acquis,
// objectif par objectif, tel que saisi dans l'onglet Suivi de la session. Aucune référence légale n'y est imprimée :
// l'ancien alinéa de l'article L6353-1 qui l'imposait n'est plus en vigueur depuis le 01/01/2019 (vérifié sur
// Légifrance le 29/10/2026) ; la convention le promet au client.

/** Objectifs de la formation, dans l'ordre et avec les mêmes index que l'onglet Suivi (une ligne = un objectif) */
export function listeObjectifs(course) {
  return String(course?.objectives || '').split('\n').map((o) => o.trim()).filter((o) => o.length > 0)
}

/** Texte affiché d'un objectif : sans puce de début de ligne */
export function texteObjectif(o) {
  return String(o || '').replace(/^[-•*]\s*/, '').trim()
}

/**
 * Résultat de chaque objectif pour un stagiaire.
 * acquis : true (validé), false (non validé), null (pas encore évalué : jamais « acquis » par défaut).
 * @param course formation de la session (objectives)
 * @param lignes lignes de trainee_objectives de la session
 */
export function objectifsResultats(course, lignes, traineeId) {
  const parIndex = {}
  ;(lignes || []).filter((l) => l.trainee_id === traineeId).forEach((l) => { parIndex[l.objective_index] = l })
  return listeObjectifs(course).map((o, i) => {
    const l = parIndex[i]
    return { texte: texteObjectif(o), acquis: l ? !!l.validated : null }
  })
}

/** Ajoute objectifs_resultats à chaque stagiaire de la liste */
export function avecObjectifs(liste, course, lignes) {
  return (liste || []).map((t) => ({ ...t, objectifs_resultats: objectifsResultats(course, lignes, t.id) }))
}

/** Libellé du résultat d'un objectif sur le document */
export function libelleAcquis(acquis) {
  if (acquis === true) return 'Acquis'
  if (acquis === false) return 'Non acquis'
  return 'Non évalué'
}

/**
 * Raison de ne pas éditer l'attestation d'un stagiaire, ou null si elle peut l'être.
 * Pas d'attestation pour un absent, sans résultat global, ni sans objectif renseigné sur la formation.
 */
export function blocageFinFormation(t, { absent = false } = {}) {
  if (absent) return 'Stagiaire absent sur toute la session : pas d\'attestation de fin de formation'
  if (!t?.result || t.result === 'in_progress') return 'Saisissez d\'abord le résultat du stagiaire (acquis ou non acquis)'
  if (!(t.objectifs_resultats || []).length) return 'Renseignez les objectifs de la formation (fiche de la formation) avant l\'attestation de fin de formation'
  return null
}

/** Nombre d'objectifs pas encore évalués (signalé avant l'édition) */
export function nonEvalues(t) {
  return (t?.objectifs_resultats || []).filter((o) => o.acquis === null).length
}

/** Comparaison de deux listes d'objectifs figées (texte et résultat) */
export function memesObjectifs(a, b) {
  const n = (x) => JSON.stringify((x || []).map((o) => [o.texte || '', o.acquis === true ? 1 : o.acquis === false ? 0 : null]))
  return n(a) === n(b)
}
