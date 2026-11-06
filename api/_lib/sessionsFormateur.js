// Sessions d'un formateur pour les agendas (iCal, synchronisation Google) : celles dont il est le formateur principal
// (sessions.trainer_id) et celles où il est un autre formateur (session_trainers, C6). Règle côté serveur ; le
// planning de l'application suit la même règle par formateursDuPlanning (src/core/session/formateursSession.js).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Identifiants des sessions où le formateur figure dans session_trainers. Lecture en échec : erreur levée (on ne
// publie pas un agenda à moitié vide sans le savoir).
export async function sessionsCoFormateur(supabase, trainerId) {
  if (!UUID.test(String(trainerId || ''))) throw new Error('Identifiant de formateur invalide')
  const { data, error } = await supabase.from('session_trainers').select('session_id').eq('trainer_id', trainerId)
  if (error) throw new Error(`session_trainers : ${error.message}`)
  return [...new Set((data || []).map((l) => l.session_id).filter((id) => UUID.test(String(id || ''))))]
}

// Filtre « principal ou autre formateur » pour une requête sur sessions (.or de PostgREST)
export function filtreFormateur(trainerId, sessionIds = []) {
  if (!UUID.test(String(trainerId || ''))) throw new Error('Identifiant de formateur invalide')
  const ids = (sessionIds || []).filter((id) => UUID.test(String(id || '')))
  return ids.length ? `trainer_id.eq.${trainerId},id.in.(${ids.join(',')})` : `trainer_id.eq.${trainerId}`
}
