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

// État de la demande d'avis de l'année (null : aucune demande), même calcul que public.financeurs_suivi
export const ETATS_DEMANDE = {
  preparee: ['warning', 'À valider dans les relances'],
  validee: ['info', 'Validée, à envoyer'],
  envoyee: ['info', 'Envoyée, sans réponse'],
  repondue: ['success', 'Avis reçu'],
  expiree: ['neutral', 'Envoyée, lien expiré'],
  ignoree: ['neutral', 'Relance ignorée'],
}

// Pourquoi rien n'est préparé pour un financeur non couvert (indicateurs « preparable » et « email_valide » de la base)
export function raisonSansDemande(f, anneeOuverte = true) {
  if (!f || f.couvert || f.demande) return null
  if (f.type === 'cpf' || f.type === 'pole_emploi') return 'Sa plateforme recueille les avis : notez une consultation ou un échange'
  if (!anneeOuverte) return 'Année close : notez un échange si vous avez été en contact avec ce financeur'
  if (!f.sessions_terminees) return 'Préparée après la première session terminée'
  if (!f.email_valide) return f.email ? 'Adresse du financeur mal écrite : corrigez-la sur le financement de la session, ou notez un échange' : 'Aucune adresse : ajoutez-la sur le financement de la session, ou notez un échange'
  return f.preparable ? 'Préparée la nuit prochaine' : null
}

/** Résumé de l'année (réponse de financeurs_suivi) : financeurs, couverts, avis reçus, sessions sans financeur */
export function resumeFinanceurs(suivi) {
  const liste = suivi?.financeurs
  if (!Array.isArray(liste)) return null
  return {
    total: liste.length,
    couverts: liste.filter((f) => f.couvert).length,
    avis: liste.filter((f) => f.demande === 'repondue').length,
    sansFinanceur: Array.isArray(suivi.sans_financeur) ? suivi.sans_financeur.length : 0,
  }
}

const pl = (n, s, p) => `${n} ${n > 1 ? (p || `${s}s`) : s}`

/** Lignes de l'indicateur 30 (preuves) : aucune sans financeur dans l'année ou si la lecture a échoué */
export function lignesIndicateur30(resume, annee) {
  if (!resume) return []
  const lignes = []
  if (resume.total) {
    const avis = resume.avis ? `, ${pl(resume.avis, 'avis reçu', 'avis reçus')}` : ''
    const reste = resume.total - resume.couverts
    lignes.push(reste
      ? { ok: false, label: `Financeurs ${annee} : ${resume.couverts} sur ${resume.total} sollicités ou rencontrés${avis} ; ${pl(reste, 'reste', 'restent')} à solliciter` }
      : { ok: true, label: `Financeurs ${annee} : ${resume.total} sur ${resume.total} sollicités ou rencontrés${avis}` })
  }
  if (resume.sansFinanceur) {
    lignes.push({ ok: false, label: `${pl(resume.sansFinanceur, 'session financée', 'sessions financées')} en ${annee} sans financeur renseigné : ajoutez-le sur la session` })
  }
  return lignes
}
