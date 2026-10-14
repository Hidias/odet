// Lecture des données utiles au calcul des résultats publiés (indicateur 2).

import { supabase } from '../../../core/supabase'
import { fetchAllOrThrow as fetchAll } from '../../../core/fetchAll'


export async function loadResultsData() {
  const [sessions, courses, enrollments, attendance, evaluations, demo] = await Promise.all([
    fetchAll(() => supabase.from('sessions').select('id, status, start_date, end_date, day_type, start_time, course_id').order('id')),
    fetchAll(() => supabase.from('courses').select('id, duration_hours').order('id')),
    fetchAll(() => supabase.from('session_trainees').select('session_id, trainee_id, result').order('id')),
    fetchAll(() => supabase.from('attendance_halfdays').select('session_id, trainee_id, date, morning, afternoon').order('id')),
    fetchAll(() => supabase.from('trainee_evaluations').select('session_id, trainee_id, would_recommend, q_org_accueil, q_org_documents, q_org_locaux, q_org_materiel, q_contenu_supports, q_contenu_programme, q_contenu_organisation, q_contenu_duree, q_formateur_pedagogie, q_formateur_expertise, q_formateur_progression, q_formateur_moyens, q_global_adequation, q_global_competences').order('id')),
    supabase.rpc('demo_data_summary').then(({ data }) => data || {}, () => ({})),
  ])
  const courseHours = Object.fromEntries(courses.map((c) => [c.id, Number(c.duration_hours) || null]))
  const demoCount = Object.values(demo || {}).reduce((a, b) => a + (Number(b) || 0), 0)
  return { sessions, courseHours, enrollments, attendance, evaluations, demoCount }
}
