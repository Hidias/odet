// État de la convention d'une session, lu partout de la même façon (angles morts A1 et A2, 04/11).
// Une convention signée vaut envoyée : la signature en ligne, le dépôt du client ou le scan déposé posent
// `convention_signed` sans toujours poser `convention_sent`.
// Session inter : chaque groupe (client) a sa propre convention ou son contrat (`session_groups.doc_status`) ;
// la session est « signée » quand tous les groupes le sont, « envoyée » quand tous sont au moins envoyés.
// Une convention signée ou envoyée au niveau de la session (scan déposé, signature en ligne de la session) prime
// sur les groupes : rien de ce qui était « signé » avant ne repasse « en attente ».
// Inter sans groupe : colonnes de la session (anciennes sessions). Groupes annulés ignorés.
// Sous-traitance : la convention est celle du donneur d'ordre (comme conventionSignee.js), rien à réclamer.

export const CONVENTION = { SIGNEE: 'signee', ENVOYEE: 'envoyee', A_ENVOYER: 'a_envoyer', SANS_OBJET: 'sans_objet' }

export function etatConvention(session, groupes = []) {
  if (!session) return CONVENTION.A_ENVOYER
  if (session.session_type === 'subcontract') return CONVENTION.SANS_OBJET
  if (session.convention_signed) return CONVENTION.SIGNEE
  if (session.session_type === 'inter') {
    const siens = (groupes || []).filter((g) => g && g.status !== 'cancelled' && (g.session_id === undefined || g.session_id === session.id))
    if (siens.length > 0) {
      if (session.convention_sent && !siens.every((g) => g.doc_status === 'signe')) return CONVENTION.ENVOYEE
      if (siens.every((g) => g.doc_status === 'signe')) return CONVENTION.SIGNEE
      if (siens.every((g) => g.doc_status === 'signe' || g.doc_status === 'envoye')) return CONVENTION.ENVOYEE
      return CONVENTION.A_ENVOYER
    }
  }
  if (session.convention_sent) return CONVENTION.ENVOYEE
  return CONVENTION.A_ENVOYER
}

export const conventionEnvoyee = (session, groupes) => etatConvention(session, groupes) !== CONVENTION.A_ENVOYER
export const conventionSigneeEtat = (session, groupes) => etatConvention(session, groupes) === CONVENTION.SIGNEE

// Libellé d'un état dans les documents (dossier de session, échantillon d'audit)
const LIBELLES = {
  [CONVENTION.SIGNEE]: 'Signée',
  [CONVENTION.ENVOYEE]: 'Envoyée, non signée',
  [CONVENTION.A_ENVOYER]: 'Non envoyée',
  [CONVENTION.SANS_OBJET]: 'Sans objet (sous-traitance)',
}
export const libelleConvention = (etat) => LIBELLES[etat] || LIBELLES[CONVENTION.A_ENVOYER]

// Regroupe des lignes `session_groups` par session
export function groupesParSession(groupes = []) {
  const m = new Map()
  for (const g of groupes || []) {
    if (!g?.session_id) continue
    if (!m.has(g.session_id)) m.set(g.session_id, [])
    m.get(g.session_id).push(g)
  }
  return m
}
