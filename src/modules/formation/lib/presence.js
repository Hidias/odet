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
