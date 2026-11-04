// Alertes avant une action risquée sur une session (angles morts du 04/11, lot 1 : B7 et B10).
// Le droit reste entier (super administrateur compris) : l'action demande seulement une confirmation qui dit ce qui
// sera perdu ou ce qui ne sera plus vrai. Rien n'est refusé ici.

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`

// Bilan de ce qu'une suppression effacerait. Une erreur de lecture laisse le compteur à null (« non vérifié »)
export async function bilanSession(supabase, sessionId) {
  const compter = async (requete) => {
    const { count, error } = await requete
    return error ? null : (count ?? 0)
  }
  const [inscrits, matins, apresMidis, evaluations, factures, devis, froid, certificats, documents, fiches] = await Promise.all([
    compter(supabase.from('session_trainees').select('id', { count: 'exact', head: true }).eq('session_id', sessionId)),
    compter(supabase.from('attendance_halfdays').select('id', { count: 'exact', head: true }).eq('session_id', sessionId).eq('morning', true)),
    compter(supabase.from('attendance_halfdays').select('id', { count: 'exact', head: true }).eq('session_id', sessionId).eq('afternoon', true)),
    compter(supabase.from('trainee_evaluations').select('id', { count: 'exact', head: true }).eq('session_id', sessionId)),
    compter(supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('session_id', sessionId)),
    compter(supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('session_id', sessionId)),
    compter(supabase.from('evaluations_cold').select('id', { count: 'exact', head: true }).eq('session_id', sessionId)),
    compter(supabase.from('sst_certifications').select('id', { count: 'exact', head: true }).eq('session_id', sessionId)),
    compter(supabase.from('training_documents_issued').select('id', { count: 'exact', head: true }).eq('session_id', sessionId)),
    compter(supabase.from('trainee_info_sheets').select('id', { count: 'exact', head: true }).eq('session_id', sessionId)),
  ])
  return {
    inscrits,
    demiJournees: matins === null || apresMidis === null ? null : matins + apresMidis,
    evaluations,
    factures,
    devis,
    froid,
    certificats,
    documents,
    fiches,
  }
}

// Refus de la base (clé étrangère) : même texte que le blocage annoncé, jamais le message technique en anglais
export function erreurSuppressionSession(error) {
  if (error?.code === '23503') return 'Cette session est liée à une facture ou à un devis : elle ne peut pas être supprimée. Passez-la plutôt en « Annulée ».'
  return 'Suppression impossible : ' + (error?.message || 'erreur inconnue')
}

// Factures et devis gardent la session (clé étrangère sans cascade) : la base refuse la suppression.
// Texte à afficher à la place de la confirmation, ou null si rien ne bloque
export function blocageSuppressionSession(bilan = {}) {
  const liens = []
  if (bilan.factures) liens.push(pluriel(bilan.factures, 'facture', 'factures'))
  if (bilan.devis) liens.push(pluriel(bilan.devis, 'devis', 'devis'))
  if (!liens.length) return null
  return `Cette session est liée à ${liens.join(' et ')} : elle ne peut pas être supprimée. Passez-la plutôt en « Annulée ».`
}

export function alerteSuppressionSession(session, bilan = {}) {
  const pertes = []
  if (bilan.inscrits) pertes.push(pluriel(bilan.inscrits, 'inscription de stagiaire', 'inscriptions de stagiaires'))
  if (bilan.demiJournees) pertes.push(pluriel(bilan.demiJournees, 'demi-journée émargée', 'demi-journées émargées'))
  if (bilan.evaluations) pertes.push(pluriel(bilan.evaluations, 'évaluation', 'évaluations'))
  if (bilan.froid) pertes.push(pluriel(bilan.froid, 'évaluation à froid', 'évaluations à froid'))
  if (bilan.certificats) pertes.push(pluriel(bilan.certificats, 'certificat SST', 'certificats SST'))
  if (bilan.documents) pertes.push(pluriel(bilan.documents, 'attestation ou document remis', 'attestations ou documents remis'))
  if (bilan.fiches) pertes.push(pluriel(bilan.fiches, 'fiche de renseignements', 'fiches de renseignements'))
  if (session?.convention_signed) pertes.push('la convention signée')
  const inconnu = Object.values(bilan).some((v) => v === null)
  const ref = session?.reference ? ` ${session.reference}` : ''
  let message
  if (pertes.length) {
    message = `La suppression de la session${ref} efface définitivement : ${pertes.join(', ')}. Ce sont des preuves Qualiopi : elles ne pourront pas être retrouvées.`
  } else {
    message = `La session${ref} sera supprimée définitivement.`
  }
  if (inconnu) message += ' Une partie du bilan n\'a pas pu être vérifiée.'
  message += '\n\nPour une session qui n\'aura pas lieu, préférez le statut « Annulée ».'
  return {
    title: 'Supprimer la session',
    message,
    confirmLabel: pertes.length ? 'Supprimer quand même' : 'Supprimer',
    danger: true,
  }
}

// Annulation : null si rien ne la rend risquée (le changement de statut se fait alors sans fenêtre)
export function alerteAnnulationSession(session) {
  if (!session || session.status === 'cancelled') return null
  const st = session.session_trainees || []
  const convoques = st.filter((x) => x.convocation_sent_at).length
  const faits = []
  if (session.convention_signed && session.session_type !== 'subcontract') faits.push('la convention est signée par le client')
  if (convoques) faits.push(`${pluriel(convoques, 'stagiaire a reçu sa convocation', 'stagiaires ont reçu leur convocation')}`)
  if (!faits.length) return null
  return {
    title: 'Annuler la session',
    message: `Pour cette session, ${faits.join(' et ')}. L'annulation ne prévient personne : informez le client et les stagiaires, et vérifiez la convention et la facture.\n\nAnnuler quand même la session ?`,
    confirmLabel: 'Oui, annuler',
    cancelLabel: 'Non',
    danger: true,
  }
}

// Suppression d'un stagiaire (B8) : la base efface en cascade tout ce qui le concerne
export async function bilanStagiaire(supabase, traineeId) {
  const compter = async (table, filtre = (q) => q) => {
    const { count, error } = await filtre(supabase.from(table).select('id', { count: 'exact', head: true }).eq('trainee_id', traineeId))
    return error ? null : (count ?? 0)
  }
  const [sessions, matins, apresMidis, evaluations, certificats, documents] = await Promise.all([
    compter('session_trainees'),
    compter('attendance_halfdays', (q) => q.eq('morning', true)),
    compter('attendance_halfdays', (q) => q.eq('afternoon', true)),
    compter('trainee_evaluations'),
    compter('sst_certifications'),
    compter('training_documents_issued'),
  ])
  return {
    sessions,
    demiJournees: matins === null || apresMidis === null ? null : matins + apresMidis,
    evaluations,
    certificats,
    documents,
  }
}

export function alerteSuppressionStagiaire(stagiaire, bilan = {}) {
  const pertes = []
  if (bilan.sessions) pertes.push(pluriel(bilan.sessions, 'inscription à une session', 'inscriptions à des sessions'))
  if (bilan.demiJournees) pertes.push(pluriel(bilan.demiJournees, 'demi-journée émargée', 'demi-journées émargées'))
  if (bilan.evaluations) pertes.push(pluriel(bilan.evaluations, 'évaluation', 'évaluations'))
  if (bilan.certificats) pertes.push(pluriel(bilan.certificats, 'certificat SST', 'certificats SST'))
  if (bilan.documents) pertes.push(pluriel(bilan.documents, 'attestation ou document remis', 'attestations ou documents remis'))
  const nom = [stagiaire?.first_name, stagiaire?.last_name].filter(Boolean).join(' ')
  let message = pertes.length
    ? `Supprimer ${nom || 'ce stagiaire'} efface définitivement : ${pertes.join(', ')}, ainsi que sa fiche de renseignements et ses documents. Ce sont des preuves Qualiopi : elles ne pourront pas être retrouvées.`
    : `${nom || 'Ce stagiaire'} sera supprimé définitivement, avec sa fiche et ses documents.`
  if (Object.values(bilan).some((v) => v === null)) message += ' Une partie du bilan n\'a pas pu être vérifiée.'
  return {
    title: 'Supprimer le stagiaire',
    message,
    confirmLabel: pertes.length ? 'Supprimer quand même' : 'Supprimer',
    danger: true,
  }
}
