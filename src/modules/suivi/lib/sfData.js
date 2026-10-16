// Suivi formatif : lecture et écriture des séquences, saisies et fiches, et calculs (statut affiché, couverture).
// Module activable (org_modules, clé « suivi_formatif »). Les droits sont posés en base (migration 0250) :
// le formateur ne lit et n'écrit que ses sessions, la lecture seule ne modifie rien.

import { supabase } from '../../../core/supabase'

export const SF_MODULE = 'suivi_formatif'

export const STATUSES = [
  { key: 'acquis', code: 'A', label: 'Acquis', solid: '#1F6B45', tint: '#DDEFE4', ink: '#174F33' },
  { key: 'en_cours', code: 'EC', label: 'En cours', solid: '#8A5A00', tint: '#FBEBC7', ink: '#5E3E00' },
  { key: 'a_revoir', code: 'AR', label: 'À revoir', solid: '#B4320C', tint: '#FADCD0', ink: '#7D2207' },
  { key: 'non_observe', code: 'NO', label: 'Non observé', solid: '#4B5250', tint: '#E6E6E3', ink: '#33393A' },
]
export const statusOf = (key) => STATUSES.find((s) => s.key === key) || null

// Rôles qui comptent pour savoir si une séquence se joue « en rôle » (mise en situation, démonstration)
export const hasRoles = (seq) => Array.isArray(seq?.roles) && seq.roles.length > 0
export const principalRole = (seq) => (hasRoles(seq) ? seq.roles[0] : null)

const ROLES_EDIT = ['superadmin', 'admin', 'direction', 'gestionnaire']
export const canEditCatalog = (role) => ROLES_EDIT.includes(role)
export const canWriteSession = (role, isTrainerOfSession) => ROLES_EDIT.includes(role) || (role === 'formateur' && isTrainerOfSession)

const SEQ_FIELDS = 'id, course_id, position, title, competences, modality, roles, success_indicators, duration_minutes, notes'
const SSEQ_FIELDS = 'id, session_id, source_sequence_id, position, title, competences, modality, roles, success_indicators, planned_date, group_status, group_remark, group_updated_at, closed_at, closed_by'
const EVAL_FIELDS = 'id, session_id, session_sequence_id, trainee_id, status, role, indicators_met, remark, evaluated_by, client_updated_at, updated_at'

function check({ data, error }) {
  if (error) throw error
  return data
}

// ── Catalogue ─────────────────────────────────────────────────────────────

export async function loadCourseSequences(courseId) {
  return check(await supabase.from('course_sequences').select(SEQ_FIELDS).eq('course_id', courseId).order('position')) || []
}

/** Nombre de séquences par formation (pour les cartes du catalogue) */
export async function countSequencesByCourse() {
  const rows = check(await supabase.from('course_sequences').select('course_id')) || []
  return rows.reduce((acc, r) => { acc[r.course_id] = (acc[r.course_id] || 0) + 1; return acc }, {})
}

/**
 * Enregistre la liste complète des séquences d'une formation : met à jour celles qui existent, ajoute les
 * nouvelles, retire celles qui ont disparu de la liste. Les sessions déjà préparées gardent leur copie.
 */
export async function saveCourseSequences(courseId, list) {
  const clean = list.map((s, i) => ({
    id: s.id || undefined,
    course_id: courseId,
    position: i + 1,
    title: String(s.title || '').trim(),
    competences: (s.competences || []).map((c) => String(c).trim()).filter(Boolean),
    modality: s.modality || 'oral',
    roles: (s.roles || []).map((r) => String(r).trim()).filter(Boolean),
    success_indicators: (s.success_indicators || []).map((r) => String(r).trim()).filter(Boolean),
    duration_minutes: s.duration_minutes ? Number(s.duration_minutes) : null,
    notes: s.notes || null,
  }))
  if (clean.some((s) => !s.title)) throw new Error('Chaque séquence doit avoir un intitulé')

  const existing = await loadCourseSequences(courseId)
  const keep = new Set(clean.filter((s) => s.id).map((s) => s.id))
  const removed = existing.filter((s) => !keep.has(s.id)).map((s) => s.id)
  if (removed.length) check(await supabase.from('course_sequences').delete().in('id', removed))

  const updates = clean.filter((s) => s.id)
  for (const s of updates) {
    const { id, ...fields } = s
    check(await supabase.from('course_sequences').update(fields).eq('id', id))
  }
  const inserts = clean.filter((s) => !s.id).map(({ id, ...fields }) => fields)
  if (inserts.length) check(await supabase.from('course_sequences').insert(inserts))
  return loadCourseSequences(courseId)
}

export async function setCourseFormativeEnabled(courseId, enabled) {
  check(await supabase.from('courses').update({ formative_enabled: !!enabled }).eq('id', courseId))
}

// ── Session ───────────────────────────────────────────────────────────────

/** Copie les séquences du catalogue dans la session si ce n'est pas déjà fait. Renvoie le nombre de séquences. */
export async function initSession(sessionId) {
  return check(await supabase.rpc('sf_init_session', { p_session: sessionId }))
}

/** Tout ce qu'il faut pour la saisie et la fiche d'une session */
export async function loadSessionFormative(sessionId) {
  const [session, sequences, evaluations, trainees, sheets] = await Promise.all([
    supabase.from('sessions')
      .select('id, reference, start_date, end_date, location_name, location_city, course_id, trainer_id, courses(id, title, code, formative_enabled), trainers:trainer_id(id, first_name, last_name)')
      .eq('id', sessionId).maybeSingle().then(check),
    supabase.from('session_sequences').select(SSEQ_FIELDS).eq('session_id', sessionId).order('position').then(check),
    supabase.from('formative_evaluations').select(EVAL_FIELDS).eq('session_id', sessionId).then(check),
    supabase.from('session_trainees')
      .select('trainee_id, early_departure, departure_date, trainees(id, first_name, last_name)')
      .eq('session_id', sessionId).then(check),
    supabase.from('formative_sheets').select('id, version, file_path, file_name, content_hash, reason, created_by, created_at')
      .eq('session_id', sessionId).order('version', { ascending: false }).then(check),
  ])
  const list = (trainees || [])
    .filter((st) => st.trainees)
    .map((st) => ({
      id: st.trainees.id,
      first_name: st.trainees.first_name || '',
      last_name: st.trainees.last_name || '',
      early_departure: !!st.early_departure,
      departure_date: st.departure_date || null,
    }))
    .sort((a, b) => (a.last_name + a.first_name).localeCompare(b.last_name + b.first_name, 'fr'))
  return { session, sequences: sequences || [], evaluations: evaluations || [], trainees: list, sheets: sheets || [] }
}

/** Le stagiaire est-il encore là pour cette séquence (départ anticipé noté avant sa date) ? */
export function isPresentFor(trainee, seq) {
  if (!trainee.early_departure || !trainee.departure_date) return true
  const day = seq?.planned_date || new Date().toISOString().slice(0, 10)
  return String(day) <= String(trainee.departure_date)
}

// ── Calculs ───────────────────────────────────────────────────────────────

/** Index des saisies : `${sequenceId}|${traineeId}` → ligne */
export function indexEvaluations(evaluations) {
  const m = new Map()
  for (const e of evaluations || []) m.set(`${e.session_sequence_id}|${e.trainee_id}`, e)
  return m
}

/**
 * Statut affiché d'un stagiaire pour une séquence :
 * { key, source: 'individuel' | 'groupe' | null } ; key null = pas encore noté
 */
export function effectiveStatus(seq, row) {
  if (row?.status) return { key: row.status, source: 'individuel' }
  if (seq?.group_status) return { key: seq.group_status, source: 'groupe' }
  return { key: null, source: null }
}

/**
 * Couverture : pour chaque stagiaire, nombre de séquences en rôle principal ; pour chaque compétence travaillée
 * en rôle, stagiaires jamais vus dans ce rôle ; « à revoir » sans reprise acquise ensuite sur une compétence commune.
 */
export function computeCoverage(sequences, evaluations, trainees) {
  const idx = indexEvaluations(evaluations)
  const roleSeqs = sequences.filter(hasRoles)
  const principalCount = {}
  for (const t of trainees) principalCount[t.id] = 0
  for (const s of roleSeqs) {
    const p = principalRole(s)
    for (const t of trainees) {
      const row = idx.get(`${s.id}|${t.id}`)
      if (row?.role && p && row.role === p) principalCount[t.id] += 1
    }
  }

  const competences = new Map()
  for (const s of roleSeqs) {
    for (const c of s.competences || []) {
      if (!competences.has(c)) competences.set(c, { code: c, seen: new Set(), sequences: [] })
      competences.get(c).sequences.push(s)
      const p = principalRole(s)
      for (const t of trainees) {
        const row = idx.get(`${s.id}|${t.id}`)
        if (row?.role && row.role === p) competences.get(c).seen.add(t.id)
      }
    }
  }
  const byCompetence = [...competences.values()]
    .map((c) => ({
      code: c.code,
      principal: principalRole(c.sequences[0]),
      seen: c.seen.size,
      total: trainees.length,
      missing: trainees.filter((t) => !c.seen.has(t.id)),
    }))
    .sort((a, b) => a.code.localeCompare(b.code, 'fr', { numeric: true }))

  const pending = []
  sequences.forEach((s, i) => {
    for (const t of trainees) {
      const st = effectiveStatus(s, idx.get(`${s.id}|${t.id}`))
      if (st.key !== 'a_revoir') continue
      const later = sequences.slice(i + 1).some((s2) => {
        const shared = (s2.competences || []).some((c) => (s.competences || []).includes(c))
        if (!shared && (s.competences || []).length) return false
        return effectiveStatus(s2, idx.get(`${s2.id}|${t.id}`)).key === 'acquis'
      })
      if (!later) pending.push({ trainee: t, sequence: s, remark: idx.get(`${s.id}|${t.id}`)?.remark || s.group_remark || '' })
    }
  })

  const neverPrincipal = roleSeqs.length ? trainees.filter((t) => principalCount[t.id] === 0) : []
  return { principalCount, byCompetence, pending, neverPrincipal, hasRoleSequences: roleSeqs.length > 0 }
}

/** Résumé par stagiaire (affiché en lecture seule dans Certification SST et Objectifs) */
export function traineeSummary(sequences, evaluations, traineeId) {
  const idx = indexEvaluations(evaluations)
  const counts = { acquis: 0, en_cours: 0, a_revoir: 0, non_observe: 0, none: 0 }
  let principal = 0
  for (const s of sequences) {
    const row = idx.get(`${s.id}|${traineeId}`)
    const st = effectiveStatus(s, row)
    counts[st.key || 'none'] += 1
    if (row?.role && hasRoles(s) && row.role === principalRole(s)) principal += 1
  }
  return { counts, principal, total: sequences.length }
}

/** Résumé de toute une session pour les onglets en lecture seule ; null si le module est absent ou vide */
export async function loadSessionSummary(sessionId) {
  try {
    const [sequences, evaluations] = await Promise.all([
      supabase.from('session_sequences').select(SSEQ_FIELDS).eq('session_id', sessionId).order('position').then(check),
      supabase.from('formative_evaluations').select(EVAL_FIELDS).eq('session_id', sessionId).then(check),
    ])
    if (!sequences?.length) return null
    return { sequences, evaluations: evaluations || [] }
  } catch {
    return null
  }
}

/** Séquences notées : au moins une note de groupe ou une saisie individuelle */
export function notedSequenceCount(sequences, evaluations) {
  const withRows = new Set((evaluations || []).filter((e) => e.status).map((e) => e.session_sequence_id))
  return sequences.filter((s) => s.group_status || withRows.has(s.id)).length
}
