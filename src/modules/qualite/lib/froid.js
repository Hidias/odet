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
function mailsGroupes(envois) {
  const mails = []
  const groupes = new Map()
  for (const e of envois || []) {
    if (e.cible === 'stagiaire') { mails.push([e.id]); continue }
    const cle = `${e.session_id}|${String(e.destinataire || '').toLowerCase()}`
    if (!groupes.has(cle)) { groupes.set(cle, []); mails.push(groupes.get(cle)) }
    groupes.get(cle).push(e.id)
  }
  return mails
}
// Nombre de mails réellement envoyés pour ces lignes (annoncé avant l'envoi)
export function nombreDeMails(envois) {
  return mailsGroupes(envois).length
}
export function decouperEnLots(envois, max = MAILS_PAR_LOT) {
  const mails = mailsGroupes(envois)
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

// Réglages de la société (froid_reglages) ; sans ligne : valeurs par défaut de la base (app.froid_reglage, 0482)
export const REGLAGES_FROID_DEFAUT = { actif: true, premier_envoi_jours: 60, relance_apres_jours: 30, entre_relances_jours: 60, relances_max: 1, employeur_actif: true }

// Fin du cycle d'une évaluation à froid, après laquelle une réponse manque vraiment (Complétude). Même règle que la
// préparation de nuit (froid_preparer_corps) : premier envoi à la fin de la session plus le délai de la formation
// (sinon celui de la société), relances au délai réglé après l'envoi précédent ; puis un délai de réponse après le
// dernier envoi, égal au délai de relance. Quand un envoi est réellement parti plus tard (validation à la main), le
// cycle part de cet envoi. L'évaluation reste due même si la société a coupé les envois (actif = false) ou si la
// session est trop ancienne pour être préparée : Complétude la signale, c'est à l'organisme de la recueillir.
export function finCycleFroid(fin, reglage, delaiFormation, dernierEnvoi = null, rangDernierEnvoi = 0) {
  if (!fin) return null
  const r = { ...REGLAGES_FROID_DEFAUT, ...(reglage || {}) }
  const ajouter = (iso, n) => {
    const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
  }
  const premier = Number(delaiFormation) > 0 ? Number(delaiFormation) : Number(r.premier_envoi_jours)
  const relances = Math.max(0, Number(r.relances_max) || 0)
  const apres = Number(r.relance_apres_jours)
  const entre = Number(r.entre_relances_jours)
  // Jours entre le premier envoi et la fin du cycle : relances prévues puis délai de réponse
  const resteDepuis = (rang) => {
    let n = 0
    for (let k = rang + 1; k <= relances; k++) n += k === 1 ? apres : entre
    return n + apres
  }
  const prevu = ajouter(fin, premier + resteDepuis(0))
  if (!dernierEnvoi) return prevu
  // Date de Paris de l'envoi (la base compte en heure de Paris) : un envoi à 0 h 30 à Paris est du jour même
  const jourParis = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(dernierEnvoi))
  const reel = ajouter(jourParis, resteDepuis(Math.max(0, Number(rangDernierEnvoi) || 0)))
  return reel > prevu ? reel : prevu
}

// Questions fermées de base de l'employeur (même liste que la base, 0482)
export const QUESTIONS_EMPLOYEUR_BASE = [
  { cle: 'e_pratique', libelle: 'Le salarié met en pratique ce qu\'il a appris' },
  { cle: 'e_besoins', libelle: 'La formation a répondu aux besoins de l\'entreprise' },
  { cle: 'e_recommande', libelle: 'L\'employeur recommande la formation' },
]

// Évaluations à froid des employeurs pour les sessions retenues : entreprises sollicitées (envoi parti), réponses
// reçues, taux de retour et part de « oui » par question de base (Indicateurs, indicateur 30).
// `clientId` : filtre client des Indicateurs (une session inter compte sinon toutes ses entreprises).
export function statsEmployeurs(envois, reponses, sessionIds, clientId = null) {
  const dans = new Set(sessionIds || [])
  const retenu = (x) => dans.has(x.session_id) && (!clientId || x.client_id === clientId)
  const cle = (x) => `${x.session_id}|${x.client_id}`
  const sollicites = new Set((envois || []).filter((e) => e.cible === 'employeur' && e.statut === 'envoye' && retenu(e)).map(cle))
  // Une réponse reçue compte même si son envoi n'est pas retrouvé (saisie depuis l'espace entreprise sans relance)
  const recues = (reponses || []).filter((r) => r.completed_at && retenu(r))
  recues.forEach((r) => sollicites.add(cle(r)))
  const questions = QUESTIONS_EMPLOYEUR_BASE.map((q) => {
    const rep = recues.filter((r) => typeof r.reponses?.[q.cle] === 'boolean')
    const oui = rep.filter((r) => r.reponses[q.cle] === true).length
    return { ...q, oui, total: rep.length, taux: rep.length ? Math.round((oui / rep.length) * 100) : null }
  })
  return {
    sollicites: sollicites.size,
    recues: recues.length,
    tauxRetour: sollicites.size ? Math.round((recues.length / sollicites.size) * 100) : null,
    questions,
  }
}
