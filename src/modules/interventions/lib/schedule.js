// Règles de calcul du module Interventions (sans accès à la base : testables seules).
// Échéances d'un appareil, opération proposée lors d'une visite, libellés des résultats.

export const RESULTS = [
  { code: 'conforme', label: 'Conforme', tone: 'success' },
  { code: 'a_remplacer', label: 'À remplacer', tone: 'warning' },
  { code: 'remplace', label: 'Remplacé', tone: 'info' },
  { code: 'absent', label: 'Absent', tone: 'danger' },
  { code: 'inaccessible', label: 'Inaccessible', tone: 'danger' },
]
export const RESULT_LABEL = Object.fromEntries(RESULTS.map((r) => [r.code, r.label]))
export const RESULT_BADGE = { conforme: 'badge-success', a_remplacer: 'badge-warning', remplace: 'badge-info', absent: 'badge-danger', inaccessible: 'badge-danger' }

export const VISIT_STATUS = {
  a_planifier: { label: 'À planifier', badge: 'badge-neutral' },
  planifiee: { label: 'Planifiée', badge: 'badge-info' },
  en_cours: { label: 'En cours', badge: 'badge-warning' },
  terminee: { label: 'Terminée', badge: 'badge-success' },
  annulee: { label: 'Annulée', badge: 'badge-neutral' },
}

export const DEFAULT_OPERATION_LABELS = {
  verification: 'Vérification périodique',
  maa: 'Maintenance additionnelle',
  revision: 'Révision en atelier',
  requalification: 'Requalification',
  epreuve: 'Épreuve',
  remplacement: 'Remplacement',
  mise_en_service: 'Mise en service',
}

const pad = (n) => String(n).padStart(2, '0')
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const todayIso = () => isoDay(new Date())
export const parseDay = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`) : null)

export function daysBetween(fromIso, toIso) {
  const a = parseDay(fromIso), b = parseDay(toIso)
  if (!a || !b) return null
  return Math.round((b - a) / 86400000)
}

export function addMonths(iso, months) {
  const d = parseDay(iso)
  if (!d) return null
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + Number(months || 0))
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return isoDay(d)
}

/** Situation d'une échéance par rapport à aujourd'hui : late, month (dans le mois), soon (60 jours), ok, none */
export function dueState(nextIso, today = todayIso()) {
  if (!nextIso) return 'none'
  const n = daysBetween(today, nextIso)
  if (n < 0) return 'late'
  const t = parseDay(today)
  const endOfMonth = isoDay(new Date(t.getFullYear(), t.getMonth() + 1, 0))
  if (nextIso <= endOfMonth) return 'month'
  if (n <= 60) return 'soon'
  return 'ok'
}
export const DUE_BADGE = { late: 'badge-danger', month: 'badge-warning', soon: 'badge-info', ok: 'badge-neutral', none: 'badge-neutral' }

/**
 * Opérations périodiques d'un appareil (années après fabrication, d'après son type).
 * Retourne [{ code, label, year, state }] : done (faite), due (cette année), late (l'an dernier, non faite),
 * past (plus ancienne : supposée traitée avant le suivi dans l'outil), future.
 */
export function periodicOperations(type, equipment, refYear = new Date().getFullYear(), doneOps = []) {
  const fy = Number(equipment?.manufactured_year)
  if (!type || !fy) return []
  const out = []
  for (const op of type.operations || []) {
    for (const y of op.years || []) {
      const year = fy + Number(y)
      const done = doneOps.some((d) => d.operation === op.code && Number(d.year) >= year)
      let state = 'future'
      if (done) state = 'done'
      else if (year === refYear) state = 'due'
      else if (year === refYear - 1) state = 'late'
      else if (year < refYear) state = 'past'
      out.push({ code: op.code, label: op.label, year, state })
    }
  }
  return out.sort((a, b) => a.year - b.year)
}

/** Fin de vie : âge atteint ou dépassé l'année de référence */
export function endOfLife(type, equipment, refYear = new Date().getFullYear()) {
  const fy = Number(equipment?.manufactured_year)
  if (!type?.lifespan_years || !fy) return null
  const year = fy + Number(type.lifespan_years)
  return { year, reached: refYear >= year }
}

/** Opération proposée pour la visite : fin de vie, puis opération périodique due ou en retard, sinon vérification */
export function suggestedOperation(type, equipment, refYear = new Date().getFullYear(), doneOps = []) {
  const eol = endOfLife(type, equipment, refYear)
  if (eol?.reached) return { code: 'remplacement', reason: `Durée de vie atteinte (${type.lifespan_years} ans)` }
  const ops = periodicOperations(type, equipment, refYear, doneOps)
  const pick = ops.find((o) => o.state === 'due') || ops.find((o) => o.state === 'late')
  if (pick) return { code: pick.code, reason: `${pick.label} prévue en ${pick.year}` }
  return { code: 'verification', reason: null }
}

/** Prochaine vérification après un contrôle (même règle que itv_close_visit côté base) */
export function nextCheckAfter(checkIso, type) {
  return addMonths(checkIso, type?.verification_months || 12)
}

/** Résumé d'une liste de lignes de visite */
export function summarize(items) {
  const s = { total: items.length, conforme: 0, a_remplacer: 0, remplace: 0, absent: 0, inaccessible: 0, todo: 0 }
  for (const it of items) {
    if (!it.result) s.todo += 1
    else s[it.result] = (s[it.result] || 0) + 1
  }
  s.done = s.total - s.todo
  return s
}

/** Distance à vol d'oiseau en km (formule de haversine) */
export function distanceKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return 0
  const R = 6371, rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

/** Longueur approximative d'une tournée (vol d'oiseau majoré de 30 % pour la route), départ et retour au point de base */
export function routeKm(points, base = null) {
  const pts = [base, ...points, base].filter((p) => p && p.lat != null)
  let km = 0
  for (let i = 1; i < pts.length; i++) km += distanceKm(pts[i - 1], pts[i])
  return Math.round(km * 1.3)
}

/** Libellé court d'un mois (1 à 12) */
export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
export const monthLabel = (m) => MONTHS[(Number(m) - 1 + 12) % 12] || ''

/** Date française courte : « 13 oct. 2026 » */
export function frShort(iso, { year = true } = {}) {
  const d = parseDay(iso)
  if (!d) return ''
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) })
}
export function frMonthYear(iso) {
  const d = parseDay(iso)
  if (!d) return ''
  return d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
}

// ─── Remplacement d'un appareil (chantier F, 0354) ───
// Mêmes règles que la garde de clôture en base (app.itv_visite_cloture_garde).

export const REPLACE_REASONS = [
  { code: 'fin_de_vie', label: 'Durée de vie atteinte' },
  { code: 'hors_service', label: 'Endommagé ou hors d\'usage' },
  { code: 'non_reparable', label: 'Non conforme, réparation impossible' },
  { code: 'obsolete', label: 'Modèle retiré ou pièces introuvables' },
  { code: 'cout', label: 'Maintenance plus chère que le remplacement' },
  { code: 'demande_client', label: 'Demande du client' },
  { code: 'autre', label: 'Autre motif (à préciser)' },
]
export const REPLACE_REASON_LABEL = Object.fromEntries(REPLACE_REASONS.map((r) => [r.code, r.label]))

/** Opérations périodiques : un remplacement à leur place demande l'information du client */
export const PERIODIC_OPERATIONS = ['maa', 'revision', 'requalification', 'epreuve']

/** Ce qui manque à une ligne « remplacé » pour pouvoir clôturer la visite (liste vide si rien) */
export function replaceMissing(item) {
  if (!item || item.result !== 'remplace') return []
  const out = []
  if (!item.replace_reason) out.push('motif')
  else if (item.replace_reason === 'autre' && !String(item.replace_note || '').trim()) out.push('précision du motif')
  if (PERIODIC_OPERATIONS.includes(item.operation) && !item.client_informed) out.push('information du client')
  return out
}

/** Lignes qui empêchent la clôture, avec ce qui leur manque */
export function replaceBlockers(items) {
  return (items || []).map((i) => ({ item: i, missing: replaceMissing(i) })).filter((x) => x.missing.length > 0)
}
