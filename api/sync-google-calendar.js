// api/sync-google-calendar.js
// Cron de synchronisation du planning → Google Agenda
// Pousse sessions, RDV commerciaux, rappels et planning events dans les agendas des formateurs
//
// Cron: toutes les heures (vercel.json)
// Manuel :
//   GET /api/sync-google-calendar?dry=true   → simulation, n'écrit RIEN dans Google (rapport seulement)
//   GET /api/sync-google-calendar?force=true → exécution normale (si GCAL_SYNC_ENABLED=true)
//
// ─── INTERRUPTEUR ────────────────────────────────────────
// Écritures actives si la constante WRITES_ENABLED vaut true.
// Coupure d'urgence : WRITES_ENABLED = false, ou variable Vercel GCAL_SYNC_ENABLED = "false".
//
// ─── CORRECTIFS ANTI-DOUBLONS (sept. 2026) ───────────────
// 1. Fenêtre unique : lecture Google et construction Supabase sur la même période
//    (J-2 mois → J+12 mois). Plus aucun événement "attendu" invisible à la lecture.
// 2. Lecture Google en échec = sync annulée (aucune création sur une liste incomplète).
// 3. Id Google déterministe dérivé du campusId → Google refuse lui-même un doublon (409).
// 4. Nettoyage auto : pour un même campusId, 1 seul événement conservé, les autres supprimés.
// 5. Plafond de créations par exécution + notification d'alerte.
// 6. Erreur Supabase = sync annulée (évite la suppression massive d'événements).

import { createClient } from '@supabase/supabase-js'
import { createHash, createSign } from 'crypto'
import { requireCronOrRole, ADMINS } from './_lib/auth.js'
import { getOrg, isTestEnvironment } from './_lib/mailer.js'
import { loadTeam, leaders, profileFirstName } from './_lib/team.js'
import { withErrorLog } from './_lib/errors.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ─── Réglages ────────────────────────────────────────────
const PAST_MONTHS = 2              // historique synchronisé
const FUTURE_MONTHS = 12           // horizon synchronisé
const MAX_CREATES_PER_RUN = 200    // au-delà : arrêt des créations + alerte
const DUPLICATE_ALERT_THRESHOLD = 20
const TIME_BUDGET_MS = 50000       // maxDuration Vercel = 60 s
const SUPABASE_ROW_LIMIT = 1000    // limite par défaut de l'API Supabase
const WRITES_ENABLED = true        // false = simulation forcée (interrupteur d'urgence)

// ─── Agendas : un par utilisateur (Paramètres > Utilisateurs : agenda Google et case « synchroniser ») ───
// conductedBy = prénom porté par les RDV et les appels ; trainerId = fiche formateur reliée au compte.
async function loadCalendarMap() {
  const team = await loadTeam(supabase)
  const heads = new Set(leaders(team).map(p => p.id))
  const firstNames = new Set(team.map(profileFirstName).filter(Boolean))
  const map = {}
  team.forEach(p => {
    const key = profileFirstName(p).toLowerCase() || p.id
    map[key] = {
      calendarId: p.gcal_id || p.sender_email || p.email,
      trainerId: p.trainer_id || null,
      conductedBy: profileFirstName(p),
      userId: p.id,
      // Rappels sans auteur de l'équipe (opérateur externe, ancien utilisateur) : à la direction
      takesOrphanCallbacks: heads.has(p.id),
      teamFirstNames: firstNames,
      enabled: !!p.gcal_enabled && !!(p.gcal_id || p.sender_email || p.email),
    }
  })
  return map
}

// ─── Google Auth (Service Account JWT) ────────────────────
async function getAccessToken() {
  const keyData = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY)

  const header = { alg: 'RS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const claim = {
    iss: keyData.client_email,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }

  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const signingInput = `${encode(header)}.${encode(claim)}`

  const sign = createSign('RSA-SHA256')
  sign.update(signingInput)
  const signature = sign.sign(keyData.private_key, 'base64url')

  const jwt = `${signingInput}.${signature}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    throw new Error(`Google Auth failed: ${err}`)
  }

  const { access_token } = await tokenRes.json()
  return access_token
}

// ─── Google Calendar API helper ───────────────────────────
// Retourne toujours { ok, status, data, error } — ne masque jamais un échec
async function gcalFetch(accessToken, calendarId, method, path, body = null, timeoutMs = 15000) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    signal: controller.signal,
  }
  if (body) options.body = JSON.stringify(body)

  try {
    const res = await fetch(url, options)
    let data = null
    if (res.status !== 204) {
      const text = await res.text()
      try { data = text ? JSON.parse(text) : null } catch { data = text }
    }
    return { ok: res.ok, status: res.status, data }
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err.name === 'AbortError' ? 'timeout' : err.message }
  } finally {
    clearTimeout(timer)
  }
}

function isRateLimited(res) {
  if (res.status === 429) return true
  if (res.status === 403) {
    const reasons = res.data?.error?.errors?.map(e => e.reason || '') || []
    return reasons.some(r => /rateLimit/i.test(r))
  }
  return false
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Lecture de TOUS les événements Campus de la fenêtre.
// Toute erreur → exception → la sync est annulée (jamais de liste partielle).
async function listCampusEvents(accessToken, calendarId, timeMin, timeMax) {
  const events = []
  let pageToken = null
  let pages = 0

  do {
    const params = new URLSearchParams({
      maxResults: '2500',
      singleEvents: 'true',
      privateExtendedProperty: 'campusManaged=true',
      timeMin,
      timeMax,
    })
    if (pageToken) params.set('pageToken', pageToken)

    let res = await gcalFetch(accessToken, calendarId, 'GET', `/events?${params.toString()}`, null, 20000)
    if (!res.ok) {
      await sleep(1500)
      res = await gcalFetch(accessToken, calendarId, 'GET', `/events?${params.toString()}`, null, 20000)
    }
    if (!res.ok || !res.data || !Array.isArray(res.data.items)) {
      throw new Error(`Lecture Google Agenda impossible (status ${res.status}${res.error ? ' ' + res.error : ''}) — sync annulée, aucune création`)
    }

    events.push(...res.data.items)
    pageToken = res.data.nextPageToken || null
    pages++
    if (pages > 40) throw new Error('Pagination Google anormale (> 40 pages) — sync annulée')
  } while (pageToken)

  return events
}

// ─── Helpers dates ────────────────────────────────────────
function parisToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function addMonthsStr(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}

function getDateRange(startDate, endDate) {
  const dates = []
  const start = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  const current = new Date(start)
  while (current <= end) {
    const dow = current.getDay()
    if (dow !== 0 && dow !== 6) {
      dates.push(current.toISOString().split('T')[0])
    }
    current.setDate(current.getDate() + 1)
  }
  if (dates.length === 0) {
    const c = new Date(start)
    while (c <= end) {
      dates.push(c.toISOString().split('T')[0])
      c.setDate(c.getDate() + 1)
    }
  }
  return dates
}

function timeToGcal(date, time) {
  const t = time || '09:00:00'
  const timePart = t.length === 5 ? t + ':00' : t
  return `${date}T${timePart}`
}

function addMinutes(time, mins) {
  const [h, m] = (time || '10:00').split(':').map(Number)
  const total = h * 60 + (m || 0) + mins
  const newH = String(Math.floor(total / 60)).padStart(2, '0')
  const newM = String(total % 60).padStart(2, '0')
  return `${newH}:${newM}:00`
}

function eventStartDate(gcalEvent) {
  return (gcalEvent.start?.dateTime || gcalEvent.start?.date || '').slice(0, 10)
}

// Id Google déterministe : caractères autorisés a-v et 0-9, longueur 5-1024
function gcalIdFor(campusId) {
  return 'campus' + createHash('sha1').update(String(campusId)).digest('hex')
}

// Supabase : toute erreur est bloquante
function checkSupabase(label, result) {
  if (result.error) {
    throw new Error(`Supabase (${label}) : ${result.error.message} — sync annulée`)
  }
  return result.data || []
}

// Couleurs Google Calendar (colorId)
// Mapping aligné sur les event_type réels en DB
const COLORS = {
  session:        '9',  // Blueberry (bleu foncé)
  rdv:            '2',  // Sage (vert)
  callback:       '5',  // Banana (jaune)
  indispo:        '11', // Tomato (rouge)
  task:           '6',  // Tangerine (orange)
  adm:            '1',  // Lavender (lavande)
  phoning_manual: '3',  // Grape (violet)
  conges:         '7',  // Peacock (bleu ciel)
  perso:          '4',  // Flamingo (rose)
  autre:          '8',  // Graphite (gris)
}

// Emojis par type — alignés sur les event_type réels en DB
const EVENT_EMOJI = {
  indispo:        '🚫',
  task:           '✅',
  adm:            '🗂️',
  phoning_manual: '📞',
  conges:         '🏖️',
  perso:          '👤',
  autre:          '📌',
}

// ─── Construire les événements attendus ───────────────────
// Retourne { events, truncated } — truncated = une requête a peut-être été coupée
async function buildExpectedEvents(trainerConfig, pastDate, futureDate) {
  const events = []
  let truncated = false
  const flagTruncation = (rows) => { if (rows.length >= SUPABASE_ROW_LIMIT) truncated = true }

  // ═══ SESSIONS ═══
  // Sessions du formateur relié au compte (aucune si le compte n'a pas de fiche formateur)
  const sessions = trainerConfig.trainerId ? checkSupabase('sessions', await supabase
    .from('sessions')
    .select('id, reference, start_date, end_date, start_time, end_time, location_city, location_name, location_address, status, course_id, client_id, notes')
    .eq('trainer_id', trainerConfig.trainerId)
    .neq('status', 'cancelled')
    .gte('end_date', pastDate)
    .lte('start_date', futureDate)
    .order('start_date')) : []
  flagTruncation(sessions)

  const courseIds = [...new Set(sessions.map(s => s.course_id).filter(Boolean))]
  const clientIds = [...new Set(sessions.map(s => s.client_id).filter(Boolean))]

  const [coursesRes, clientsRes] = await Promise.all([
    courseIds.length > 0 ? supabase.from('courses').select('id, title').in('id', courseIds) : { data: [] },
    clientIds.length > 0 ? supabase.from('clients').select('id, name').in('id', clientIds) : { data: [] },
  ])
  const coursesMap = new Map(checkSupabase('courses', coursesRes).map(c => [c.id, c]))
  const clientsMap = new Map(checkSupabase('clients', clientsRes).map(c => [c.id, c]))

  for (const session of sessions) {
    const course = coursesMap.get(session.course_id)
    const client = clientsMap.get(session.client_id)
    const courseName = course?.title || 'Formation'
    const clientName = client?.name || ''

    const days = getDateRange(session.start_date, session.end_date || session.start_date)
    const totalDays = days.length

    days.forEach((dayDate, dayIdx) => {
      const dayLabel = totalDays > 1 ? ` (J${dayIdx + 1}/${totalDays})` : ''
      const campusId = totalDays > 1
        ? `session-${session.id}-day${dayIdx + 1}`
        : `session-${session.id}`

      const locationParts = [session.location_name, session.location_address, session.location_city].filter(Boolean)

      events.push({
        campusId,
        campusType: 'session',
        summary: `🎓 ${courseName} - ${clientName}${dayLabel}`,
        description: [
          `Formation : ${courseName}`,
          clientName ? `Client : ${clientName}` : null,
          session.reference ? `Réf : ${session.reference}` : null,
          `Formateur : ${trainerData.first_name} ${trainerData.last_name}`,
          session.notes ? `\nNotes : ${session.notes}` : null,
        ].filter(Boolean).join('\n'),
        location: locationParts.join(', '),
        startDateTime: timeToGcal(dayDate, session.start_time || '09:00'),
        endDateTime: timeToGcal(dayDate, session.end_time || '17:00'),
        colorId: COLORS.session,
        status: session.status === 'completed' ? 'confirmed' : 'tentative',
      })
    })
  }

  // ═══ RDV COMMERCIAUX ═══
  const rdvs = checkSupabase('prospect_rdv', await supabase
    .from('prospect_rdv')
    .select('id, rdv_date, rdv_time, contact_name, contact_phone, conducted_by, status, notes, formations_interet, rdv_type, rdv_address, rdv_location, client_id')
    .eq('conducted_by', trainerConfig.conductedBy)
    .gte('rdv_date', pastDate)
    .lte('rdv_date', futureDate)
    .in('status', ['a_prendre', 'prevu', 'planifie', 'realise'])
    .order('rdv_date'))
  flagTruncation(rdvs)

  const rdvClientIds = [...new Set(rdvs.map(r => r.client_id).filter(Boolean))]
  let rdvClientsMap = new Map()
  if (rdvClientIds.length > 0) {
    const rdvClients = checkSupabase('clients rdv', await supabase.from('clients').select('id, name').in('id', rdvClientIds))
    rdvClientsMap = new Map(rdvClients.map(c => [c.id, c]))
  }

  for (const rdv of rdvs) {
    const client = rdvClientsMap.get(rdv.client_id)
    const clientName = client?.name || 'Prospect'
    const rdvTime = rdv.rdv_time || '10:00'
    const isPhone = rdv.rdv_type === 'telephone' || rdv.rdv_type === 'visio'
    const durationMin = isPhone ? 30 : 60

    let location = ''
    if (rdv.rdv_address) {
      location = rdv.rdv_address
    } else if (rdv.rdv_location === 'client') {
      location = `Chez ${clientName}`
    } else if (rdv.rdv_location === 'bureau') {
      location = [trainerConfig.orgName, trainerConfig.orgAddress].filter(Boolean).join(', ')
    }

    events.push({
      campusId: `rdv-${rdv.id}`,
      campusType: 'rdv',
      summary: `🤝 ${clientName}${rdv.contact_name ? ' — ' + rdv.contact_name : ''}`,
      description: [
        `RDV commercial : ${clientName}`,
        rdv.contact_name ? `Contact : ${rdv.contact_name}` : null,
        rdv.contact_phone ? `Tél : ${rdv.contact_phone}` : null,
        rdv.rdv_type ? `Type : ${rdv.rdv_type}` : null,
        rdv.formations_interet?.length > 0 ? `Formations : ${rdv.formations_interet.join(', ')}` : null,
        rdv.notes ? `\nNotes : ${rdv.notes}` : null,
      ].filter(Boolean).join('\n'),
      location,
      startDateTime: timeToGcal(rdv.rdv_date, rdvTime),
      endDateTime: timeToGcal(rdv.rdv_date, addMinutes(rdvTime, durationMin)),
      colorId: COLORS.rdv,
      status: 'confirmed',
    })
  }

  // ═══ RAPPELS (callbacks) : ceux de l'utilisateur, plus les rappels sans auteur de l'équipe pour la direction ═══
  {
    const allCallbacks = checkSupabase('prospect_calls', await supabase
      .from('prospect_calls')
      .select('id, callback_date, callback_time, contact_name, notes, client_id, called_by')
      .eq('needs_callback', true)
      .gte('callback_date', pastDate)
      .lte('callback_date', futureDate))
    const callbacks = allCallbacks.filter(c => c.called_by === trainerConfig.conductedBy
      || (trainerConfig.takesOrphanCallbacks && !trainerConfig.teamFirstNames.has(c.called_by)))
    flagTruncation(allCallbacks)

    const cbClientIds = [...new Set(callbacks.map(c => c.client_id).filter(Boolean))]
    let cbClientsMap = new Map()
    if (cbClientIds.length > 0) {
      const cbClients = checkSupabase('clients rappels', await supabase.from('clients').select('id, name').in('id', cbClientIds))
      cbClientsMap = new Map(cbClients.map(c => [c.id, c]))
    }

    for (const cb of callbacks) {
      if (!cb.callback_date) continue
      const client = cbClientsMap.get(cb.client_id)
      const clientName = client?.name || 'Rappel'
      const cbTime = cb.callback_time || '10:00'

      events.push({
        campusId: `callback-${cb.id}`,
        campusType: 'callback',
        summary: `📞 Rappeler ${clientName}${cb.contact_name ? ' — ' + cb.contact_name : ''}`,
        description: cb.notes ? `Notes : ${cb.notes}` : '',
        location: '',
        startDateTime: timeToGcal(cb.callback_date, cbTime),
        endDateTime: timeToGcal(cb.callback_date, addMinutes(cbTime, 30)),
        colorId: COLORS.callback,
        status: 'confirmed',
      })
    }
  }

  // ═══ PLANNING EVENTS (tâches, indispos, ADM, congés, perso...) ═══
  if (trainerConfig.userId) {
    const planningEvents = checkSupabase('user_planning_events', await supabase
      .from('user_planning_events')
      .select('id, event_type, event_date, start_time, end_time, title, description, location, google_event_id')
      .eq('user_id', trainerConfig.userId)
      .gte('event_date', pastDate)
      .lte('event_date', futureDate)
      .order('event_date'))
    flagTruncation(planningEvents)

    for (const evt of planningEvents) {
      const emoji = EVENT_EMOJI[evt.event_type] || '📌'
      const colorId = COLORS[evt.event_type] || COLORS.autre

      const descParts = [evt.description, evt.location ? `📍 ${evt.location}` : null].filter(Boolean)

      events.push({
        campusId: `planning-${evt.id}`,
        campusType: 'planning',
        supabaseId: evt.id,                        // pour mise à jour google_event_id
        currentGoogleId: evt.google_event_id || null,
        summary: `${emoji} ${evt.title}`,
        description: descParts.join('\n') || '',
        location: evt.location || '',
        startDateTime: timeToGcal(evt.event_date, evt.start_time || '09:00'),
        endDateTime: timeToGcal(evt.event_date, evt.end_time || '18:00'),
        colorId,
        status: 'confirmed',
      })
    }
  }

  return { events, truncated }
}

// ─── Construire le body Google Calendar ───────────────────
function buildGcalEvent(event) {
  return {
    summary: event.summary,
    description: event.description || '',
    location: event.location || '',
    start: {
      dateTime: event.startDateTime,
      timeZone: 'Europe/Paris',
    },
    end: {
      dateTime: event.endDateTime,
      timeZone: 'Europe/Paris',
    },
    colorId: event.colorId,
    status: event.status || 'confirmed',
    extendedProperties: {
      private: {
        campusManaged: 'true',
        campusId: event.campusId,
        campusType: event.campusType,
      },
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
      ],
    },
  }
}

function needsUpdate(existing, event) {
  return (
    (existing.summary || '') !== (event.summary || '') ||
    (existing.description || '') !== (event.description || '') ||
    (existing.location || '') !== (event.location || '') ||
    (existing.start?.dateTime || '').substring(0, 16) !== event.startDateTime.substring(0, 16) ||
    (existing.end?.dateTime || '').substring(0, 16) !== event.endDateTime.substring(0, 16) ||
    (existing.colorId || '') !== (event.colorId || '') ||
    (existing.status || 'confirmed') !== (event.status || 'confirmed')
  )
}

async function saveGoogleIdIfChanged(event, googleId) {
  if (event.campusType !== 'planning' || !event.supabaseId || !googleId) return
  if (event.currentGoogleId === googleId) return
  const { error } = await supabase
    .from('user_planning_events')
    .update({ google_event_id: googleId })
    .eq('id', event.supabaseId)
  if (error) console.error(`[GCal Sync] google_event_id non enregistré (${event.supabaseId}):`, error.message)
}

// ─── Sync principal ───────────────────────────────────────
async function syncCalendar(accessToken, trainerConfig, trainerLabel, { dryRun, deadline }) {
  const calendarId = trainerConfig.calendarId
  const stats = {
    mode: dryRun ? 'simulation' : 'ecriture',
    window: null,
    listed: 0,
    expected: 0,
    created: 0,
    revived: 0,
    updated: 0,
    unchanged: 0,
    deleted: 0,
    duplicatesFound: 0,
    duplicatesRemoved: 0,
    duplicatesRemaining: 0,
    topDuplicates: [],
    errors: 0,
    capReached: false,
    timeBudgetReached: false,
    rateLimited: false,
    truncated: false,
    aborted: false,
    abortReason: null,
  }

  const outOfTime = () => Date.now() > deadline

  try {
    // 0. Fenêtre unique
    const today = parisToday()
    const pastDate = addMonthsStr(today, -PAST_MONTHS)
    const futureDate = addMonthsStr(today, FUTURE_MONTHS)
    const timeMin = `${addDaysStr(pastDate, -1)}T00:00:00Z`
    const timeMax = `${addDaysStr(futureDate, 2)}T00:00:00Z`
    const inWindow = (d) => d >= pastDate && d <= futureDate
    stats.window = { from: pastDate, to: futureDate }

    // 1. Lecture Google (exception si échec → rien n'est écrit)
    const listed = await listCampusEvents(accessToken, calendarId, timeMin, timeMax)
    stats.listed = listed.length

    // 2. Regroupement par campusId + repérage des doublons
    const groups = new Map()
    for (const evt of listed) {
      const cid = evt.extendedProperties?.private?.campusId
      if (!cid) continue
      if (!groups.has(cid)) groups.set(cid, [])
      groups.get(cid).push(evt)
    }

    const existingMap = new Map()
    const duplicatesToDelete = []
    const dupSummary = []
    for (const [cid, list] of groups) {
      const detId = gcalIdFor(cid)
      list.sort((a, b) => {
        if (a.id === detId) return -1
        if (b.id === detId) return 1
        return (a.created || '').localeCompare(b.created || '')
      })
      existingMap.set(cid, list[0])
      if (list.length > 1) {
        dupSummary.push({ title: list[0].summary, date: eventStartDate(list[0]), copies: list.length })
        for (let i = 1; i < list.length; i++) duplicatesToDelete.push(list[i])
      }
    }
    stats.duplicatesFound = duplicatesToDelete.length
    stats.topDuplicates = dupSummary.sort((a, b) => b.copies - a.copies).slice(0, 5)

    // 3. Événements attendus (exception si erreur Supabase)
    const built = await buildExpectedEvents(trainerConfig, pastDate, futureDate)
    stats.truncated = built.truncated
    const expectedMap = new Map()
    for (const e of built.events) {
      if (inWindow(e.startDateTime.slice(0, 10))) expectedMap.set(e.campusId, e)
    }
    const expected = [...expectedMap.values()]
    stats.expected = expected.length

    const obsolete = [...existingMap.entries()]
      .filter(([cid, evt]) => !expectedMap.has(cid) && inWindow(eventStartDate(evt)))

    // ─── MODE SIMULATION : on compte, on n'écrit rien ───
    if (dryRun) {
      for (const event of expected) {
        const existing = existingMap.get(event.campusId)
        if (!existing) stats.created++
        else if (needsUpdate(existing, event)) stats.updated++
        else stats.unchanged++
      }
      stats.deleted = built.truncated ? 0 : obsolete.length
      stats.duplicatesRemaining = duplicatesToDelete.length
      stats.capReached = stats.created > MAX_CREATES_PER_RUN
      return stats
    }

    // 4. Suppression des doublons (par lots de 5, dans le budget temps)
    for (let i = 0; i < duplicatesToDelete.length; i += 5) {
      if (outOfTime()) { stats.timeBudgetReached = true; break }
      const batch = duplicatesToDelete.slice(i, i + 5)
      const results = await Promise.all(
        batch.map(evt => gcalFetch(accessToken, calendarId, 'DELETE', `/events/${encodeURIComponent(evt.id)}`))
      )
      let stop = false
      for (const res of results) {
        if (res.ok || res.status === 404 || res.status === 410) stats.duplicatesRemoved++
        else if (isRateLimited(res)) { stats.rateLimited = true; stop = true }
        else stats.errors++
      }
      if (stop) break
      await sleep(200)
    }
    stats.duplicatesRemaining = duplicatesToDelete.length - stats.duplicatesRemoved

    // 5. Créer / mettre à jour
    for (const event of expected) {
      if (stats.rateLimited) break
      if (outOfTime()) { stats.timeBudgetReached = true; break }

      const existing = existingMap.get(event.campusId)
      const gcalBody = buildGcalEvent(event)

      if (existing) {
        if (needsUpdate(existing, event)) {
          const res = await gcalFetch(accessToken, calendarId, 'PATCH', `/events/${encodeURIComponent(existing.id)}`, gcalBody)
          if (res.ok) stats.updated++
          else if (isRateLimited(res)) stats.rateLimited = true
          else stats.errors++
        } else {
          stats.unchanged++
        }
        await saveGoogleIdIfChanged(event, existing.id)
        continue
      }

      if (stats.created + stats.revived >= MAX_CREATES_PER_RUN) {
        stats.capReached = true
        continue // on continue les mises à jour, mais plus aucune création
      }

      const detId = gcalIdFor(event.campusId)
      const res = await gcalFetch(accessToken, calendarId, 'POST', '/events', { id: detId, ...gcalBody })

      if (res.ok) {
        stats.created++
        await saveGoogleIdIfChanged(event, res.data?.id || detId)
      } else if (res.status === 409) {
        // L'id existe déjà chez Google (événement supprimé ou hors fenêtre) → on le remet à jour
        const patch = await gcalFetch(accessToken, calendarId, 'PATCH', `/events/${detId}`, gcalBody)
        if (patch.ok) {
          stats.revived++
          await saveGoogleIdIfChanged(event, detId)
        } else if (isRateLimited(patch)) {
          stats.rateLimited = true
        } else {
          stats.errors++
          console.error(`[GCal Sync] 409 non résolu pour ${event.campusId}:`, patch.status, JSON.stringify(patch.data))
        }
      } else if (isRateLimited(res)) {
        stats.rateLimited = true
      } else {
        stats.errors++
        console.error(`[GCal Sync] Création échouée ${event.campusId}:`, res.status, res.error || JSON.stringify(res.data))
      }
    }

    // 6. Supprimer les événements Campus disparus de Supabase
    //    (uniquement dans la fenêtre, jamais si une requête Supabase a pu être tronquée)
    if (!built.truncated && !stats.rateLimited) {
      for (const [, gcalEvent] of obsolete) {
        if (outOfTime()) { stats.timeBudgetReached = true; break }
        const res = await gcalFetch(accessToken, calendarId, 'DELETE', `/events/${encodeURIComponent(gcalEvent.id)}`)
        if (res.ok || res.status === 404 || res.status === 410) stats.deleted++
        else if (isRateLimited(res)) { stats.rateLimited = true; break }
        else stats.errors++
      }
    }
  } catch (err) {
    console.error(`[GCal Sync] ${trainerLabel} annulée:`, err.message)
    stats.aborted = true
    stats.abortReason = err.message
    stats.errors++
  }

  console.log(
    `[GCal Sync] ${trainerLabel} (${stats.mode}): +${stats.created} ↺${stats.revived} ~${stats.updated} ` +
    `-${stats.deleted} =${stats.unchanged} doublons ${stats.duplicatesRemoved}/${stats.duplicatesFound} ` +
    `!${stats.errors}${stats.capReached ? ' [PLAFOND]' : ''}${stats.aborted ? ' [ANNULÉE]' : ''}`
  )
  return stats
}

// ─── Alerte dans les notifications Campus (1 max / 24 h) ──
async function notifyIfNeeded(trainerLabel, stats) {
  if (stats.mode !== 'ecriture') return
  const reasons = []
  if (stats.aborted) reasons.push(`sync annulée : ${stats.abortReason}`)
  if (stats.capReached) reasons.push(`plafond de ${MAX_CREATES_PER_RUN} créations atteint`)
  if (stats.duplicatesFound > DUPLICATE_ALERT_THRESHOLD) reasons.push(`${stats.duplicatesFound} doublons détectés`)
  if (reasons.length === 0) return

  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { data: recent } = await supabase
      .from('notifications')
      .select('id')
      .eq('type', 'gcal_sync_alert')
      .gte('created_at', since)
      .limit(1)
    if (recent && recent.length > 0) return

    await supabase.from('notifications').insert({
      type: 'gcal_sync_alert',
      title: '⚠️ Synchronisation Google Agenda',
      message: `Agenda ${trainerLabel} : ${reasons.join(' · ')}`,
      metadata: { trainer: trainerLabel, stats },
    })
  } catch (err) {
    console.error('[GCal Sync] Notification impossible:', err.message)
  }
}

// ═══ HANDLER ══════════════════════════════════════════════
async function handler(req, res) {
  // Tâche planifiée (CRON_SECRET) ou lancement manuel par un administrateur
  if (!(await requireCronOrRole(req, res, ADMINS))) return
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return res.status(500).json({ error: 'GOOGLE_SERVICE_ACCOUNT_KEY non configurée' })
  }

  const startedAt = Date.now()
  const deadline = startedAt + TIME_BUDGET_MS
  // Coupure d'urgence : passer WRITES_ENABLED à false dans le code,
  // ou mettre la variable Vercel GCAL_SYNC_ENABLED à "false"
  const rawFlag = process.env.GCAL_SYNC_ENABLED
  const flag = String(rawFlag || '').trim().toLowerCase()
  // Préversion : simulation forcée, rien n'est écrit dans les vrais agendas
  const writesEnabled = isTestEnvironment() ? false : (flag === 'false' ? false : WRITES_ENABLED)
  const envFlag = rawFlag === undefined ? 'absente' : `présente (${flag})`
  const dryRun = req.query?.dry === 'true' || !writesEnabled

  try {
    const CALENDAR_MAP = await loadCalendarMap()
    if (!Object.values(CALENDAR_MAP).some(c => c.enabled)) {
      return res.status(200).json({ success: true, skipped: true, reason: 'Aucun utilisateur avec la synchronisation Google Agenda activée' })
    }
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      return res.status(200).json({ success: true, skipped: true, reason: 'Compte de service Google absent (GOOGLE_SERVICE_ACCOUNT_KEY)' })
    }
    const org = await getOrg(supabase)
    Object.values(CALENDAR_MAP).forEach(c => { c.orgName = org.name; c.orgAddress = org.siteLine || org.addressLine })
    const accessToken = await getAccessToken()
    const results = {}

    for (const [key, config] of Object.entries(CALENDAR_MAP)) {
      if (!config.enabled) {
        results[key] = { skipped: true, reason: 'disabled' }
        console.log(`[GCal Sync] ${key}: skipped (disabled)`)
        continue
      }
      results[key] = await syncCalendar(accessToken, config, key, { dryRun, deadline })
      await notifyIfNeeded(key, results[key])
    }

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      writesEnabled,
      envFlag,
      vercelEnv: process.env.VERCEL_ENV || null,
      dryRun,
      results,
    })
  } catch (error) {
    console.error('GCal sync global error:', error)
    return res.status(500).json({ error: error.message })
  }
}

export default withErrorLog(handler, 'sync-google-calendar')
