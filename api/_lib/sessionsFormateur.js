// Sessions d'un formateur pour les agendas (iCal, synchronisation Google) : celles dont il est le formateur principal
// (sessions.trainer_id) et celles où il est un autre formateur (session_trainers, C6). Règle côté serveur ; le
// planning de l'application suit la même règle par formateursDuPlanning (src/core/session/formateursSession.js).
// Deux lectures bornées par les mêmes filtres (fenêtre de dates, statut), fusionnées sans doublon : aucune liste
// d'identifiants dans l'adresse, qui grandirait sans limite avec l'historique.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const LIMITE_LIGNES = 1000 // limite par défaut de l'API Supabase : une lecture qui l'atteint est peut-être coupée

// filtres(requete) ajoute fenêtre, statut et tri. Lecture en échec : erreur levée (pas d'agenda à moitié vide sans le
// savoir). Renvoie { sessions, tronque } ; tronque vrai si une des lectures a pu être coupée.
export async function sessionsDuFormateur(supabase, trainerId, { colonnes = '*', filtres = (q) => q } = {}) {
  if (!UUID.test(String(trainerId || ''))) throw new Error('Identifiant de formateur invalide')
  const [principal, autres] = await Promise.all([
    filtres(supabase.from('sessions').select(colonnes).eq('trainer_id', trainerId)),
    filtres(supabase.from('sessions').select(`${colonnes}, session_trainers!inner(trainer_id)`).eq('session_trainers.trainer_id', trainerId)),
  ])
  if (principal.error) throw new Error(`sessions : ${principal.error.message}`)
  if (autres.error) throw new Error(`session_trainers : ${autres.error.message}`)
  return fusionnerSessions(principal.data, autres.data)
}

export function fusionnerSessions(principal = [], autres = []) {
  const parId = new Map()
  for (const s of [...(principal || []), ...(autres || [])]) {
    if (!s?.id || parId.has(s.id)) continue
    const { session_trainers: _lignes, ...session } = s
    parId.set(s.id, session)
  }
  const sessions = [...parId.values()].sort((a, b) => String(a.start_date || '').localeCompare(String(b.start_date || '')))
  return { sessions, tronque: (principal || []).length >= LIMITE_LIGNES || (autres || []).length >= LIMITE_LIGNES }
}
