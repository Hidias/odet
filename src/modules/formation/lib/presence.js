// Heures de présence d'un stagiaire, pour l'attestation de présence.
//
// Règle (validée avec la direction) :
// - par défaut, le stagiaire est compté du début à la fin de la formation (aucune saisie pour le formateur) ;
// - si une heure d'arrivée est notée, le décompte de ce jour commence à cette heure ;
// - si un départ anticipé est noté, le décompte s'arrête à l'heure de départ ce jour-là, et les jours suivants ne comptent pas.
//
// Toutes les heures sont des heures locales (heure de Paris) saisies en « HH:MM » : on calcule en minutes,
// sans passer par des objets Date, donc sans conversion UTC.
// La pause déjeuner n'est pas en base : sa durée est déduite (amplitude de la journée moins heures du jour)
// et elle est placée à partir de 12h00. La valeur calculée reste modifiable avant enregistrement.

const DEFAULT_BREAK_START = 12 * 60

export function toMinutes(t) {
  if (!t) return null
  const m = String(t).match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

function overlap(a1, a2, b1, b2) {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1))
}

// Jours de la session au format « AAAA-MM-JJ », sans passer par l'UTC
export function sessionDayList(session) {
  const s = (session?.start_date || '').slice(0, 10)
  const e = (session?.end_date || s).slice(0, 10)
  if (!s) return []
  const [ys, ms, ds] = s.split('-').map(Number)
  const [ye, me, de] = e.split('-').map(Number)
  const out = []
  const d = new Date(ys, ms - 1, ds, 12)
  const end = new Date(ye, me - 1, de, 12)
  while (d <= end && out.length < 60) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    d.setDate(d.getDate() + 1)
  }
  return out
}

// Durée totale prévue (heures), selon le catalogue
export function plannedHours(course) {
  const h = parseFloat(course?.duration_hours || course?.duration || 0)
  return Number.isFinite(h) && h > 0 ? h : 7
}

/**
 * Calcule les heures de présence.
 * @param {object} session  start_date, end_date, start_time, end_time
 * @param {object} course   duration_hours, duration_days
 * @param {object} st       arrival_date, arrival_time, early_departure, departure_date, departure_time
 * @returns {{ hours: number, partial: boolean, breakLabel: string }}
 */
export function computePresenceHours(session, course, st = {}) {
  const total = plannedHours(course)
  const allDays = sessionDayList(session)
  const nDays = Math.max(1, Math.min(parseInt(course?.duration_days, 10) || allDays.length || 1, allDays.length || 1))
  const days = allDays.slice(0, nDays)
  const start = toMinutes(session?.start_time)
  const end = toMinutes(session?.end_time)
  const hasArrival = !!(st?.arrival_date && st?.arrival_time)
  const hasDeparture = !!(st?.early_departure && st?.departure_date)
  if (!hasArrival && !hasDeparture) return { hours: total, partial: false, breakLabel: '' }
  if (start == null || end == null || end <= start || days.length === 0) return { hours: total, partial: false, breakLabel: '' }

  const perDayMin = (total * 60) / days.length
  const breakLen = Math.max(0, (end - start) - perDayMin)
  const bStart = Math.min(Math.max(DEFAULT_BREAK_START, start), end)
  const bEnd = Math.min(bStart + breakLen, end)

  let minutes = 0
  for (const day of days) {
    if (hasDeparture && day > st.departure_date) break
    let from = start
    let to = end
    if (hasArrival && day === st.arrival_date) from = Math.max(start, toMinutes(st.arrival_time) ?? start)
    if (hasDeparture && day === st.departure_date) {
      const dep = toMinutes(st.departure_time)
      to = dep == null ? start : Math.min(end, dep) // départ sans heure : la journée ne compte pas
    }
    if (to <= from) continue
    const worked = (to - from) - overlap(from, to, bStart, bEnd)
    minutes += Math.min(worked, perDayMin)
  }
  const hours = Math.round((minutes / 60) * 4) / 4 // au quart d'heure
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}h${String(Math.round(m % 60)).padStart(2, '0')}`
  return { hours, partial: true, breakLabel: breakLen > 0 ? `pause de ${fmt(bStart)} à ${fmt(bEnd)} déduite` : '' }
}

// « 5 heures », « 5,5 heures », « 1 heure »
export function formatHours(h) {
  const n = Number(h) || 0
  return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} heure${n > 1 ? 's' : ''}`
}

// ── Heures réellement suivies (0398) ──
// Le certificat de réalisation porte la durée réellement suivie, rapprochée par l'OPCO des feuilles d'émargement.
// Une demi-journée attendue sans signature (ni signature par procuration) se décide : « présent, a oublié de signer »
// ou « absent ». Tant qu'elle n'est pas décidée, elle reste comptée (comme avant) et l'outil la signale.
// Une session sans aucune signature électronique (feuille papier) n'est pas contrôlée.

/** Demi-journées attendues : { date, period: 'morning'|'afternoon' }, comme la feuille de présence de la session */
export function listeDemiJournees(session, course) {
  const days = sessionDayList(session)
  if (!days.length) return []
  const half = session?.day_type === 'half'
  const afternoonHalf = half && toMinutes(session?.start_time) != null && toMinutes(session.start_time) >= 12 * 60
  let reste = half ? days.length : Math.ceil(plannedHours(course) / 3.5)
  const out = []
  for (const date of days) {
    if (reste <= 0) break
    if (half) { out.push({ date, period: afternoonHalf ? 'afternoon' : 'morning' }); reste--; continue }
    out.push({ date, period: 'morning' }); reste--
    if (reste > 0) { out.push({ date, period: 'afternoon' }); reste-- }
  }
  return out
}

const jour = (d) => String(d || '').slice(0, 10)

/** Décision la plus récente par demi-journée d'un stagiaire : { 'date_period': decision } */
export function decisionsEnVigueur(regularisations, traineeId) {
  const out = {}
  ;[...(regularisations || [])]
    .filter((r) => r.trainee_id === traineeId)
    .sort((a, b) => String(a.decided_at).localeCompare(String(b.decided_at)))
    .forEach((r) => { out[`${jour(r.date)}_${r.period}`] = r })
  return out
}

/**
 * Contrôle de l'émargement d'un stagiaire.
 * @returns {{ controle: boolean, aRegulariser: object[], absents: object[], presentsSansSignature: object[] }}
 */
export function controleEmargement({ session, course, traineeId, halfdays = [], proxies = [], regularisations = [] }) {
  const sessionSignee = (halfdays || []).some((h) => h.signature_morning || h.signature_afternoon) || (proxies || []).length > 0
  const vide = { controle: false, aRegulariser: [], absents: [], presentsSansSignature: [] }
  if (!sessionSignee) return vide
  const signe = new Set()
  ;(halfdays || []).filter((h) => h.trainee_id === traineeId).forEach((h) => {
    if (h.signature_morning) signe.add(`${jour(h.date)}_morning`)
    if (h.signature_afternoon) signe.add(`${jour(h.date)}_afternoon`)
  })
  ;(proxies || []).filter((p) => p.trainee_id === traineeId).forEach((p) => signe.add(`${jour(p.date)}_${p.period}`))
  const notePresent = new Set()
  ;(halfdays || []).filter((h) => h.trainee_id === traineeId).forEach((h) => {
    if (h.morning === true) notePresent.add(`${jour(h.date)}_morning`)
    if (h.afternoon === true) notePresent.add(`${jour(h.date)}_afternoon`)
  })
  const decisions = decisionsEnVigueur(regularisations, traineeId)
  const res = { controle: true, aRegulariser: [], absents: [], presentsSansSignature: [] }
  for (const hd of listeDemiJournees(session, course)) {
    const cle = `${hd.date}_${hd.period}`
    if (signe.has(cle)) continue
    const d = decisions[cle]
    const ligne = { ...hd, notePresent: notePresent.has(cle), decision: d || null }
    if (!d) res.aRegulariser.push(ligne)
    else if (d.decision === 'absent') res.absents.push(ligne)
    else res.presentsSansSignature.push(ligne)
  }
  return res
}

/**
 * Heures réellement suivies : heures de présence (arrivée, départ) moins les demi-journées décidées « absent ».
 * Les demi-journées d'un jour d'arrivée tardive ou de départ anticipé (et après le départ) ne sont pas retirées
 * une seconde fois : elles sont déjà décomptées.
 */
export function heuresRealisees({ session, course, st = {}, controle }) {
  const calc = computePresenceHours(session, course, st)
  const base = st.presence_hours != null && (st.early_departure || st.arrival_time) ? Number(st.presence_hours) : calc.hours
  const attendues = listeDemiJournees(session, course).length || 1
  const parDemi = plannedHours(course) / attendues
  const dejaDecompte = (d) => (st.arrival_time && st.arrival_date && d === jour(st.arrival_date))
    || (st.early_departure && st.departure_date && d >= jour(st.departure_date))
  const retirees = (controle?.absents || []).filter((a) => !dejaDecompte(a.date))
  const hours = Math.max(0, Math.round((base - retirees.length * parDemi) * 4) / 4)
  return { hours, base, retirees: retirees.length, partiel: hours < plannedHours(course) }
}

const LIBELLE_PERIODE = { morning: 'matin', afternoon: 'après-midi' }
export function libelleDemiJournee(hd) {
  const [a, m, j] = String(hd.date).split('-')
  return `${j}/${m}/${a} ${LIBELLE_PERIODE[hd.period] || hd.period}`
}
