// Chargement de l'émargement d'une session et heures réellement suivies de chaque stagiaire (0398).
import { supabase } from '../../../core/supabase'
import { controleEmargement, heuresRealisees, libelleDemiJournee } from './presence'

export async function chargerEmargement(sessionId) {
  const [h, p, r] = await Promise.all([
    supabase.from('attendance_halfdays').select('trainee_id, date, morning, afternoon, signature_morning, signature_afternoon').eq('session_id', sessionId),
    supabase.from('attendance_proxy_signatures').select('trainee_id, date, period').eq('session_id', sessionId),
    supabase.from('attendance_regularisations').select('*').eq('session_id', sessionId).order('decided_at'),
  ])
  return { halfdays: h.data || [], proxies: p.data || [], regularisations: r.error ? [] : (r.data || []) }
}

/**
 * Ajoute à chaque stagiaire ses heures réellement suivies (heures_realisees, absences_notees) pour l'attestation et le
 * certificat, et compte les demi-journées encore à régulariser.
 */
export async function avecHeuresRealisees(session, liste) {
  const donnees = await chargerEmargement(session.id)
  const course = session?.courses || {}
  let aRegulariser = 0
  const noms = []
  const out = (liste || []).map((t) => {
    const st = (session?.session_trainees || []).find((x) => x.trainee_id === t.id) || {}
    const controle = controleEmargement({ session, course, traineeId: t.id, ...donnees })
    if (!controle.controle) return t
    if (controle.aRegulariser.length) { aRegulariser += controle.aRegulariser.length; noms.push(`${t.first_name || ''} ${t.last_name || ''}`.trim()) }
    const h = heuresRealisees({ session, course, st, controle })
    return { ...t, heures_realisees: h.hours, absences_notees: controle.absents.map(libelleDemiJournee) }
  })
  return { liste: out, aRegulariser, noms }
}
