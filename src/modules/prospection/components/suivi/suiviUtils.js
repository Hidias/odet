// ════════════════════════════════════════════════════════════════
// suiviUtils.js — Outils partagés du Suivi commercial
// ════════════════════════════════════════════════════════════════
// Dates : toujours en heure locale (jamais toISOString().split('T')[0],
// qui donne le mauvais jour entre minuit et 2h).
// ════════════════════════════════════════════════════════════════

export const CALLERS = ['Hicham', 'Maxime', 'Marine']

export const SENDER_NAMES = { Hicham: 'Hicham Saidi', Maxime: 'Maxime Langlais', Marine: 'Hicham Saidi' }

export function authorFromEmail(email) {
  const e = (email || '').toLowerCase()
  if (e.includes('maxime')) return 'Maxime'
  if (e.includes('hicham')) return 'Hicham'
  if (e.includes('entreprise') || e.includes('marine')) return 'Marine'
  return 'Hicham'
}

// ── Dates locales ──────────────────────────────────────────────
export function toDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayStr() {
  return toDateStr(new Date())
}

// "YYYY-MM-DD" ou timestamp → Date locale à minuit
export function parseLocal(value) {
  if (!value) return null
  const s = String(value).slice(0, 10)
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

export function addDays(value, n) {
  const d = parseLocal(value)
  if (!d) return null
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}

// Nombre de jours entre deux dates (b - a)
export function diffDays(a, b) {
  const da = parseLocal(a)
  const db = parseLocal(b)
  if (!da || !db) return 0
  return Math.round((db - da) / 86400000)
}

export function maxDate(a, b) {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

export function fmtDate(value) {
  const d = parseLocal(value)
  if (!d) return ''
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

export function fmtDateLong(value) {
  const d = parseLocal(value)
  if (!d) return ''
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function fmtTime(value) {
  if (!value) return ''
  return String(value).slice(0, 5).replace(':', 'h')
}

export function fmtMoney(value) {
  const n = Number(value || 0)
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

// Prochain mardi ou jeudi (jamais aujourd'hui)
export function nextWeekday(targetDay) {
  const d = new Date()
  const day = d.getDay()
  let diff = targetDay - day
  if (diff <= 0) diff += 7
  d.setDate(d.getDate() + diff)
  return toDateStr(d)
}

// Jour ouvré suivant (lundi-vendredi)
export function nextBusinessDay() {
  const d = new Date()
  do { d.setDate(d.getDate() + 1) } while (d.getDay() === 0 || d.getDay() === 6)
  return toDateStr(d)
}

export function quickDates() {
  return [
    { label: 'Demain', value: nextBusinessDay() },
    { label: 'Mardi prochain', value: nextWeekday(2) },
    { label: 'Jeudi prochain', value: nextWeekday(4) },
    { label: 'Dans 2 semaines', value: addDays(todayStr(), 14) },
    { label: 'Dans 1 mois', value: addDays(todayStr(), 30) },
    { label: 'Dans 3 mois', value: addDays(todayStr(), 90) },
  ]
}

// ── Seuils du tri de départ ────────────────────────────────────
export const OLD_RDV_DAYS = 21
export const OLD_QUOTE_DAYS = 45
export const CALLBACK_SLIDE_DAYS = 7

// ── RDV ────────────────────────────────────────────────────────
export const RDV_STATUS_LABELS = {
  a_prendre: 'À planifier',
  prevu: 'Planifié',
  realise: 'Fait',
  annule: 'Annulé',
  reporte: 'Reporté',
}

export const OUTCOME_LABELS = {
  devis_a_faire: 'Devis à faire',
  devis_envoye: 'Devis envoyé',
  a_recontacter: 'À recontacter',
  sans_suite: 'Sans suite',
  converti_rappel: 'Converti en rappel',
}

export const SANS_SUITE_REASONS = [
  'Pas de besoin',
  'Pas le décideur',
  'Budget reporté',
  'Autre',
]

export const LOST_REASONS = [
  'Prix',
  'Concurrent retenu',
  'Projet abandonné',
  'Plus de réponse',
  'Variante non retenue',
  'Autre',
]

export function rdvRefDate(rdv) {
  return rdv.rdv_date || (rdv.created_at ? String(rdv.created_at).slice(0, 10) : null)
}

// RDV ancien, jamais trié → part dans le tri de départ
export function isOldRdv(rdv, today = todayStr()) {
  if (rdv.triaged_at || rdv.outcome) return false
  if (!['a_prendre', 'prevu', 'realise'].includes(rdv.status)) return false
  const ref = rdvRefDate(rdv)
  if (!ref) return false
  return diffDays(ref, today) > OLD_RDV_DAYS
}

// RDV qui attend un compte rendu
export function needsReport(rdv, today = todayStr()) {
  if (rdv.outcome) return false
  if (rdv.status === 'realise') return true
  if (rdv.status === 'prevu' && rdv.rdv_date && rdv.rdv_date < today) return true
  return false
}

// ── Devis ──────────────────────────────────────────────────────
export function isQuoteInFollowup(q) {
  if (q.status === 'sent') return true
  if (q.status === 'partial' && !q.lost_reason) return true
  return false
}

// Cadence : J+7, J+21, puis tous les 30 jours après la dernière relance
export function quoteNextDue(q) {
  if (q.followup_state === 'veille' && q.veille_until) return q.veille_until
  if (q.next_followup_date) return q.next_followup_date
  const base = q.quote_date || (q.created_at ? String(q.created_at).slice(0, 10) : todayStr())
  const count = q.relance_count || 0
  if (count === 0) return addDays(base, 7)
  if (count === 1) return maxDate(addDays(base, 21), addDays(q.last_relance_date, 7))
  return addDays(q.last_relance_date || base, 30)
}

export function isQuoteSleeping(q, today = todayStr()) {
  return q.followup_state === 'veille' && q.veille_until && q.veille_until > today
}

export function isOldQuote(q, today = todayStr()) {
  if (q.triaged_at) return false
  if (!isQuoteInFollowup(q)) return false
  const base = q.quote_date || (q.created_at ? String(q.created_at).slice(0, 10) : null)
  if (!base) return false
  return diffDays(base, today) > OLD_QUOTE_DAYS
}

// Regroupe des devis par client
export function groupQuotesByClient(quotes, today = todayStr()) {
  const map = new Map()
  quotes.forEach(q => {
    const key = q.client_id || 'sans-client'
    if (!map.has(key)) {
      map.set(key, {
        clientId: q.client_id,
        client: q.clients || null,
        quotes: [],
        total: 0,
        nextDue: null,
      })
    }
    const g = map.get(key)
    g.quotes.push(q)
    g.total += Number(q.total_ht || 0)
    const due = quoteNextDue(q)
    if (due && (!g.nextDue || due < g.nextDue)) g.nextDue = due
  })
  return Array.from(map.values())
    .map(g => ({ ...g, isDue: g.nextDue ? g.nextDue <= today : true }))
    .sort((a, b) => (a.nextDue || '').localeCompare(b.nextDue || ''))
}

// ── Rappels (prospect_calls) ───────────────────────────────────
export function callbackLateDays(cb, today = todayStr()) {
  if (!cb.callback_date) return 0
  return Math.max(0, diffDays(String(cb.callback_date).slice(0, 10), today))
}

// Rappel sans date ou en retard de plus de 7 jours → à décider
export function isCallbackToDecide(cb, today = todayStr()) {
  if (!cb.callback_date) return true
  return callbackLateDays(cb, today) > CALLBACK_SLIDE_DAYS
}

export function isCallbackForToday(cb, today = todayStr()) {
  if (!cb.callback_date) return false
  const d = String(cb.callback_date).slice(0, 10)
  return d <= today && !isCallbackToDecide(cb, today)
}

// ── Kit RDV ────────────────────────────────────────────────────
export const KIT_CATEGORIES = [
  { value: 'toujours', label: 'À prendre à chaque RDV' },
  { value: 'sst', label: 'SST / MAC SST' },
  { value: 'incendie', label: 'Incendie / évacuation' },
  { value: 'electrique', label: 'Habilitation électrique' },
  { value: 'conduite', label: 'Conduite de chariots et gerbeurs (R485/R489)' },
  { value: 'gestes_postures', label: 'Gestes et postures' },
  { value: 'duerp', label: 'DUERP' },
  { value: 'opco', label: 'Démarches OPCO' },
  { value: 'autre', label: 'Autre' },
]

export function kitCategoryLabel(value) {
  return KIT_CATEGORIES.find(c => c.value === value)?.label || value
}

// Log dans le fil client (silencieux en cas d'échec)
export async function logInteraction(supabase, { clientId, type = 'meeting', title, content, author }) {
  if (!clientId) return
  try {
    await supabase.from('client_interactions').insert({
      client_id: clientId,
      type,
      title,
      content: content || '',
      author,
      interaction_date: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Journal client :', err)
  }
}
