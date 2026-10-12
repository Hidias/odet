// Résultats publiés au titre de l'indicateur 2 (Qualiopi) et leur méthode de calcul.
// Fonctions pures, sans accès à la base : les données sont passées en paramètre (testables en Node).
//
// Définitions (mêmes que la page Qualiopi, sauf l'assiduité) :
// - satisfaction : moyenne des 14 questions du questionnaire de fin de formation, notées de 1 à 5 ;
// - atteinte des objectifs : stagiaires « acquis » rapportés aux stagiaires dont le résultat est saisi ;
// - assiduité : demi-journées signées rapportées aux demi-journées prévues, tous stagiaires inscrits ;
// - recommandation : réponses « oui » rapportées aux réponses données.
// Seules les sessions terminées dont la date de fin tombe dans la période comptent.

export const SATISFACTION_KEYS = [
  'q_org_accueil', 'q_org_documents', 'q_org_locaux', 'q_org_materiel',
  'q_contenu_supports', 'q_contenu_programme', 'q_contenu_organisation', 'q_contenu_duree',
  'q_formateur_pedagogie', 'q_formateur_expertise', 'q_formateur_progression', 'q_formateur_moyens',
  'q_global_adequation', 'q_global_competences',
]

// Effectif en dessous duquel un résultat est signalé « effectif réduit »
export const SMALL_SAMPLE = 10

function parseDay(s) {
  if (!s) return null
  const [y, m, d] = String(s).substring(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(Date.UTC(y, m - 1, d))
}
const isoDay = (dt) => dt.toISOString().substring(0, 10)

/**
 * Demi-journées prévues d'une session, selon la même règle que la feuille d'émargement :
 * - session à la demi-journée : une demi-journée par jour (matin, ou après-midi si elle commence à 12 h ou après) ;
 * - sinon : durée du cours divisée par 3,5 h (arrondi au supérieur), réparties matin puis après-midi, jour après jour.
 * Une session d'une seule demi-journée compte donc une seule demi-journée.
 * @returns {Array<{date: string, period: 'morning'|'afternoon'}>}
 */
export function plannedHalfDays(session, durationHours) {
  const start = parseDay(session?.start_date)
  const end = parseDay(session?.end_date || session?.start_date)
  if (!start || !end || end < start) return []
  const days = []
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) days.push(isoDay(d))
  const out = []
  if (session.day_type === 'half') {
    const h = parseInt(String(session.start_time || '09').split(':')[0], 10)
    const period = Number.isFinite(h) && h >= 12 ? 'afternoon' : 'morning'
    for (const date of days) out.push({ date, period })
    return out
  }
  const hours = Number(durationHours) > 0 ? Number(durationHours) : 7
  let remaining = Math.ceil(hours / 3.5)
  for (const date of days) {
    if (remaining <= 0) break
    out.push({ date, period: 'morning' }); remaining--
    if (remaining <= 0) break
    out.push({ date, period: 'afternoon' }); remaining--
  }
  return out
}

/** Sessions terminées dont la date de fin est dans la période [from, to] (dates AAAA-MM-JJ, bornes incluses) */
export function sessionsInPeriod(sessions, { from = null, to = null } = {}) {
  return (sessions || []).filter((s) => {
    if (s.status !== 'completed') return false
    const end = String(s.end_date || s.start_date || '').substring(0, 10)
    if (!end) return false
    if (from && end < from) return false
    if (to && end > to) return false
    return true
  })
}

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null)

/**
 * Calcule les quatre résultats publiés.
 * @param {object} p
 * @param {Array} p.sessions  { id, status, start_date, end_date, day_type, start_time, course_id }
 * @param {Object} p.courseHours  course_id -> durée en heures
 * @param {Array} p.enrollments  session_trainees { session_id, trainee_id, result }
 * @param {Array} p.attendance  attendance_halfdays { session_id, trainee_id, date, morning, afternoon }
 * @param {Array} p.evaluations  trainee_evaluations { session_id, would_recommend, q_... }
 * @param {object} p.period  { from, to }
 */
export function computeResults({ sessions = [], courseHours = {}, enrollments = [], attendance = [], evaluations = [], period = {} } = {}) {
  const kept = sessionsInPeriod(sessions, period)
  const ids = new Set(kept.map((s) => s.id))
  const enr = enrollments.filter((e) => ids.has(e.session_id))
  const evals = evaluations.filter((e) => ids.has(e.session_id))

  // Satisfaction
  const scores = []
  let respondents = 0
  for (const e of evals) {
    let any = false
    for (const k of SATISFACTION_KEYS) {
      const v = e[k]
      if (v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v))) { scores.push(Number(v)); any = true }
    }
    if (any) respondents++
  }
  const satisfaction = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null

  // Atteinte des objectifs
  const withResult = enr.filter((r) => r.result)
  const acquired = withResult.filter((r) => r.result === 'acquired' || r.result === 'Acquis').length

  // Assiduité par demi-journées
  const signed = new Map()
  for (const a of attendance) {
    if (!ids.has(a.session_id)) continue
    const day = String(a.date || '').substring(0, 10)
    if (a.morning) signed.set(`${a.session_id}|${a.trainee_id}|${day}|morning`, true)
    if (a.afternoon) signed.set(`${a.session_id}|${a.trainee_id}|${day}|afternoon`, true)
  }
  let planned = 0
  let present = 0
  const slotsBySession = new Map(kept.map((s) => [s.id, plannedHalfDays(s, courseHours[s.course_id])]))
  for (const r of enr) {
    const slots = slotsBySession.get(r.session_id) || []
    planned += slots.length
    for (const sl of slots) if (signed.get(`${r.session_id}|${r.trainee_id}|${sl.date}|${sl.period}`)) present++
  }

  // Recommandation
  const answered = evals.filter((e) => e.would_recommend === true || e.would_recommend === false)
  const yes = answered.filter((e) => e.would_recommend === true).length

  return {
    sessions: kept.length,
    trainees: new Set(enr.map((r) => r.trainee_id)).size,
    enrollments: enr.length,
    satisfaction: { value: satisfaction, responses: respondents, answers: scores.length, of: enr.length },
    objectives: { value: pct(acquired, withResult.length), num: acquired, den: withResult.length },
    attendance: { value: pct(present, planned), num: present, den: planned },
    recommendation: { value: pct(yes, answered.length), num: yes, den: answered.length },
  }
}

const frNum = (v, digits = 1) => (v == null ? '' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: digits }))
const frDate = (s) => {
  const d = parseDay(s)
  return d ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''
}

/**
 * Lignes publiables : { key, label, value, method, sample, small }
 * @param {object} r résultat de computeResults
 * @param {object} show { satisfaction, objectives, attendance, recommendation } (booléens)
 */
export function publishedLines(r, show = {}) {
  const lines = []
  const on = (k) => show[k] !== false
  if (on('satisfaction')) lines.push({
    key: 'satisfaction', label: 'Satisfaction',
    value: r.satisfaction.value == null ? 'Non disponible' : `${frNum(r.satisfaction.value)} / 5`,
    method: 'Moyenne des 14 questions du questionnaire de fin de formation (organisation, contenu, formateur, perception), notées de 1 à 5.',
    sample: `${r.satisfaction.responses} questionnaire${r.satisfaction.responses > 1 ? 's' : ''} pour ${r.enrollments} inscription${r.enrollments > 1 ? 's' : ''}`,
    small: r.satisfaction.responses < SMALL_SAMPLE,
  })
  if (on('objectives')) lines.push({
    key: 'objectives', label: 'Atteinte des objectifs',
    value: r.objectives.value == null ? 'Non disponible' : `${frNum(r.objectives.value)} %`,
    method: 'Stagiaires ayant atteint les objectifs de la formation, évalués par le formateur, rapportés aux stagiaires évalués.',
    sample: `${r.objectives.num} sur ${r.objectives.den}`,
    small: r.objectives.den < SMALL_SAMPLE,
  })
  if (on('attendance')) lines.push({
    key: 'attendance', label: 'Assiduité',
    value: r.attendance.value == null ? 'Non disponible' : `${frNum(r.attendance.value)} %`,
    method: 'Demi-journées signées rapportées aux demi-journées prévues, pour tous les stagiaires inscrits. Une formation d\'une demi-journée compte une demi-journée.',
    sample: `${r.attendance.num} demi-journée${r.attendance.num > 1 ? 's' : ''} signée${r.attendance.num > 1 ? 's' : ''} sur ${r.attendance.den}`,
    small: r.attendance.den < SMALL_SAMPLE,
  })
  if (on('recommendation')) lines.push({
    key: 'recommendation', label: 'Recommandation',
    value: r.recommendation.value == null ? 'Non disponible' : `${frNum(r.recommendation.value)} %`,
    method: 'Réponses « oui » à la question « Recommanderiez-vous cette formation ? », rapportées aux réponses données.',
    sample: `${r.recommendation.num} sur ${r.recommendation.den}`,
    small: r.recommendation.den < SMALL_SAMPLE,
  })
  return lines
}

/** Texte brut à coller sur le site de l'organisme */
export function publishedText(r, show, { orgName = '', from = null, to = null, updatedOn = null } = {}) {
  const lines = publishedLines(r, show)
  const head = [
    `Nos résultats${orgName ? ` (${orgName})` : ''}`,
    `Formations terminées${from ? ` du ${frDate(from)}` : ''}${to ? ` au ${frDate(to)}` : ''} : ${r.sessions} session${r.sessions > 1 ? 's' : ''}, ${r.trainees} stagiaire${r.trainees > 1 ? 's' : ''}.`,
  ]
  const body = lines.map((l) => `${l.label} : ${l.value}${l.small ? ' (effectif réduit)' : ''}\nMéthode : ${l.method} Base : ${l.sample}.`)
  const foot = updatedOn ? [`Mis à jour le ${frDate(updatedOn)}.`] : []
  return [...head, '', ...body.flatMap((b) => [b, '']), ...foot].join('\n').trim()
}
