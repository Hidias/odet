// Évaluations à froid (0482) : fonctions d'affichage de la page des non-répondants, sans accès réseau (testables).

export function libelleEnvoi(e) {
  const quoi = Number(e.rang) === 0 ? 'Premier envoi' : Number(e.rang) === 1 ? 'Relance' : `Relance ${e.rang}`
  if (e.cible === 'contact') return `${quoi} par le contact de l'entreprise`
  if (e.cible === 'employeur') return `${quoi} à l'employeur`
  return quoi
}

// Jours écoulés depuis la fin de la session
export function joursDepuis(fin, aujourdhui = new Date()) {
  if (!fin) return null
  const f = new Date(`${String(fin).slice(0, 10)}T12:00:00`)
  return Math.floor((aujourdhui - f) / 86400000)
}

export function filtrerEnvois(envois, { vue = 'prepare', anciennete = 'tout' } = {}, aujourdhui = new Date()) {
  return (envois || []).filter((e) => {
    if (vue !== 'tous' && e.statut !== vue && !(vue === 'prepare' && e.statut === 'en_cours')) return false
    if (anciennete === 'tout') return true
    const j = joursDepuis(e.fin, aujourdhui)
    if (j == null) return false
    if (anciennete === '90') return j < 90
    if (anciennete === '180') return j >= 90 && j < 180
    if (anciennete === '365') return j >= 180 && j <= 365
    if (anciennete === 'plus') return j > 365
    return true
  })
}

export function grouperParSession(envois) {
  const m = new Map()
  for (const e of envois || []) {
    if (!m.has(e.session_id)) m.set(e.session_id, { session_id: e.session_id, session_ref: e.session_ref, formation: e.formation, fin: e.fin, lignes: [] })
    m.get(e.session_id).lignes.push(e)
  }
  return [...m.values()]
}

// Questions : base de la plateforme (même liste que la base, 0482)
export const QUESTIONS_BASE = [
  { cle: 'skills_applied', libelle: 'Avez-vous pu mettre en pratique ce que vous avez appris ?', type: 'oui_non' },
  { cle: 'objectives_met', libelle: 'Estimez-vous avoir atteint les objectifs de la formation ?', type: 'oui_non' },
  { cle: 'knowledge_retained', libelle: 'La formation a-t-elle répondu à vos besoins ?', type: 'oui_non' },
  { cle: 'job_impact', libelle: 'La formation a-t-elle amélioré votre façon de travailler ?', type: 'oui_non' },
  { cle: 'would_recommend', libelle: 'Recommanderiez-vous cette formation ?', type: 'oui_non' },
  { cle: 'comments', libelle: 'Un commentaire ?', type: 'texte' },
]

// Réponses complètes ? (mêmes règles que la base : toutes les questions fermées répondues)
export function reponsesCompletes(questions, reponses) {
  return (questions || []).every((q) => q.type === 'texte' || (reponses?.[q.cle] !== undefined && reponses?.[q.cle] !== null))
}

// Nouvelle question ajoutée par la formation : clé libre, jamais une clé de base
export function nouvelleQuestion(questions) {
  let n = 1
  const cles = new Set((questions || []).map((q) => q.cle))
  while (cles.has(`q_${n}`)) n += 1
  return { cle: `q_${n}`, libelle: '', type: 'oui_non' }
}
