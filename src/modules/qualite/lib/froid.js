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

// Vue « à reprendre » : envois en erreur et envois interrompus (en cours depuis plus de 15 minutes, calculé par la base).
// Un envoi en cours récent reste dans « à envoyer », sans case à cocher : il ne peut pas être repris.
export function vueDeLEnvoi(e) {
  if (e.statut === 'erreur' || (e.statut === 'en_cours' && e.interrompu)) return 'erreur'
  if (e.statut === 'en_cours') return 'prepare'
  return e.statut
}

// Ligne qu'on peut cocher : à envoyer, en erreur ou interrompue
export function cochable(e) {
  return e.statut === 'prepare' || e.statut === 'erreur' || (e.statut === 'en_cours' && !!e.interrompu)
}

export function filtrerEnvois(envois, { vue = 'prepare', anciennete = 'tout' } = {}, aujourdhui = new Date()) {
  return (envois || []).filter((e) => {
    if (vue !== 'tous' && vueDeLEnvoi(e) !== vue) return false
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

// Envoi par lots : au plus `max` mails par appel (temps limite du serveur), sans couper un mail groupé
// (contact et employeur d'une même session à la même adresse partent ensemble). Même regroupement que le serveur.
export const MAILS_PAR_LOT = 15
export function decouperEnLots(envois, max = MAILS_PAR_LOT) {
  const mails = []
  const groupes = new Map()
  for (const e of envois || []) {
    if (e.cible === 'stagiaire') { mails.push([e.id]); continue }
    const cle = `${e.session_id}|${String(e.destinataire || '').toLowerCase()}`
    if (!groupes.has(cle)) { groupes.set(cle, []); mails.push(groupes.get(cle)) }
    groupes.get(cle).push(e.id)
  }
  const lots = []
  for (let i = 0; i < mails.length; i += max) lots.push(mails.slice(i, i + max).flat())
  return lots
}

// Personne concernée par la ligne : le stagiaire (même quand la demande passe par le contact de l'entreprise), ou l'employeur.
// `noms` : nom des stagiaires par identifiant (lignes « contact », dont destinataire_nom est le contact).
export function nomPersonne(e, noms = {}) {
  if (e.cible === 'employeur') return 'Employeur'
  if (e.cible === 'contact') return noms[e.trainee_id] || 'Stagiaire sans adresse'
  return e.destinataire_nom || ''
}

// Destinataire lisible : « Nom (adresse) » pour le contact et l'employeur, l'adresse seule pour le stagiaire
export function libelleDestinataire(e) {
  if (!e.destinataire) return ''
  return e.cible !== 'stagiaire' && e.destinataire_nom ? `${e.destinataire_nom} (${e.destinataire})` : e.destinataire
}
