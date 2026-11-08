// Avis des financeurs (0517, Qualiopi indicateur 30) : règles d'affichage, sans accès à la base (testables).
// Guide de lecture V10 (novembre 2026), p. 37 : sollicitation au moins une fois par an, ou participation à un webinaire
// ou une réunion organisés par le financeur. Un financeur est « couvert » quand la demande est partie ou qu'un échange
// de l'année est saisi (même règle que public.financeurs_suivi en base).

export const TYPES_FINANCEUR = {
  opco: 'OPCO', region: 'Région', autre: 'Autre financeur', cpf: 'CPF (Caisse des Dépôts)', pole_emploi: 'France Travail',
}

export const TYPES_ECHANGE = [
  ['webinaire', 'Webinaire organisé par le financeur'],
  ['reunion', 'Réunion organisée par le financeur'],
  ['echange', 'Échange sur une ou plusieurs formations'],
  ['controle', 'Contrôle mené par le financeur'],
  ['consultation_site', 'Consultation de son site d\'avis (ex : Anotéa)'],
]
export const libelleEchange = (k) => (TYPES_ECHANGE.find(([v]) => v === k) || [k, k])[1]

// Questions de l'avis (colonnes de funder_feedback), notées de 1 à 5, facultatives ; la note globale est obligatoire
export const QUESTIONS_FINANCEUR = [
  ['q_information', 'Informations et documents transmis'],
  ['q_administratif', 'Pièces administratives et délais'],
  ['q_qualite', 'Qualité des formations financées'],
  ['q_relation', 'Échanges avec l\'organisme'],
]

// État de la demande d'avis de l'année (null : aucune demande)
export const ETATS_DEMANDE = {
  preparee: ['warning', 'À valider dans les relances'],
  envoyee: ['info', 'Envoyée, sans réponse'],
  repondue: ['success', 'Avis reçu'],
  expiree: ['neutral', 'Lien expiré'],
  ignoree: ['neutral', 'Relance ignorée'],
}

// Pourquoi rien n'est préparé pour un financeur non couvert
export function raisonSansDemande(f) {
  if (!f || f.couvert || f.demande) return null
  if (f.type === 'cpf' || f.type === 'pole_emploi') return 'Sa plateforme recueille les avis : notez une consultation ou un échange'
  if (!f.sessions_terminees) return 'Préparée après la première session terminée'
  if (!f.email) return 'Aucune adresse : ajoutez-la sur le financement de la session, ou notez un échange'
  return 'Préparée la nuit prochaine'
}

/** Résumé de l'année : financeurs, couverts, avis reçus */
export function resumeFinanceurs(liste) {
  if (!Array.isArray(liste)) return null
  return {
    total: liste.length,
    couverts: liste.filter((f) => f.couvert).length,
    avis: liste.filter((f) => f.demande === 'repondue').length,
  }
}

const pl = (n, s, p) => `${n} ${n > 1 ? (p || `${s}s`) : s}`

/** Ligne de l'indicateur 30 (preuves) : null si aucun financeur dans l'année ou lecture impossible */
export function ligneIndicateur30(resume, annee) {
  if (!resume || !resume.total) return null
  const avis = resume.avis ? `, ${pl(resume.avis, 'avis reçu', 'avis reçus')}` : ''
  if (resume.couverts === resume.total) {
    return { ok: true, label: `Financeurs ${annee} : ${resume.total} sur ${resume.total} sollicités ou rencontrés${avis}` }
  }
  const reste = resume.total - resume.couverts
  return { ok: false, label: `Financeurs ${annee} : ${resume.couverts} sur ${resume.total} sollicités ou rencontrés${avis} ; ${pl(reste, 'reste', 'restent')} à solliciter` }
}
