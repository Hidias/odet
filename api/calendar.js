// api/calendar.js
// Endpoint iCal pour synchronisation Google Agenda
//
// Usage :
//   GET /api/calendar?trainer=UUID        → sessions + RDV + events d'un formateur
//   GET /api/calendar?trainer=all         → tout (pour contact@)
//
// Google Agenda → Autres agendas → À partir de l'URL → coller le lien
// Ne modifie RIEN dans l'agenda existant (calendrier séparé en lecture seule)

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Mapping trainer_id → { conductedBy, authUserId }
const TRAINER_MAP = {
  'ddf1ec18-c1c1-4fc5-8095-af85ffbf4ee1': { conductedBy: 'Hicham', authUserId: 'a5482cd6-3961-4c55-adcd-2bff9f5736b3' },
  '06048463-24cb-4989-998f-2b84d8a3a196': { conductedBy: 'Maxime', authUserId: 'e028a949-d0d8-4702-b2db-e281fd4bfdb1' },
}

const EVENT_TYPE_LABELS = {
  indispo: 'Indispo',
  task:    'Tâche',
  adm:    'Admin',
  rappel:  'Rappel',
}

const RDV_TYPE_LABELS = {
  decouverte: 'Découverte',
  suivi:      'Suivi',
  sur_place:  'Sur place',
  tel:        'Téléphone',
  visio:      'Visio',
}

function escapeIcal(str) {
  if (!str) return ''
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

function formatIcalDateTime(date, time) {
  if (!date) return ''
  const d = date.replace(/-/g, '')
  const t = time ? time.replace(/:/g, '').substring(0, 6) : '090000'
  const tPadded = t.length === 4 ? t + '00' : t
  return d + 'T' + tPadded
}

function addOneHour(time) {
  if (!time) return '100000'
  const [h, m, s] = time.split(':').map(Number)
  const newH = Math.min(h + 1, 23)
  return `${String(newH).padStart(2, '0')}${String(m || 0).padStart(2, '0')}${String(s || 0).padStart(2, '0')}`
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { trainer } = req.query

  if (!trainer) {
    return res.status(400).json({
      error: 'Paramètre trainer requis',
      usage: [
        '/api/calendar?trainer=UUID   → sessions + RDV + events d\'un formateur',
        '/api/calendar?trainer=all    → tout'
      ]
    })
  }

  try {
    const isAll = trainer === 'all'
    let calName = 'Access Formation - Planning'
    let trainerName = 'Tous'
    let trainerInfo = null

    // ─── Charger le formateur (si spécifique) ─────────────────
    if (!isAll) {
      const { data: trainerData, error: trainerError } = await supabase
        .from('trainers')
        .select('id, first_name, last_name, email')
        .eq('id', trainer)
        .single()

      if (trainerError || !trainerData) {
        return res.status(404).json({ error: 'Formateur non trouvé' })
      }

      trainerName = `${trainerData.first_name} ${trainerData.last_name}`
      calName = `Access Formation - ${trainerName}`
      trainerInfo = TRAINER_MAP[trainer] || null
    }

    // ─── Fenêtre temporelle : 6 mois passés + futur ───────────
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const pastDate = sixMonthsAgo.toISOString().split('T')[0]

    // ─── 1. Sessions ──────────────────────────────────────────
    let sessionsQuery = supabase
      .from('sessions')
      .select('*')
      .neq('status', 'cancelled')
      .gte('end_date', pastDate)
      .order('start_date', { ascending: true })

    if (!isAll) {
      sessionsQuery = sessionsQuery.eq('trainer_id', trainer)
    }

    // ─── 2. RDV prospects ─────────────────────────────────────
    let rdvQuery = supabase
      .from('prospect_rdv')
      .select('id, client_id, rdv_date, rdv_time, rdv_type, conducted_by, status, contact_name, notes_crm, formations_interet')
      .neq('status', 'annule')
      .not('rdv_date', 'is', null)
      .gte('rdv_date', pastDate)
      .order('rdv_date', { ascending: true })

    if (!isAll && trainerInfo) {
      rdvQuery = rdvQuery.eq('conducted_by', trainerInfo.conductedBy)
    }

    // ─── 3. Events manuels (user_planning_events) ─────────────
    let eventsQuery = supabase
      .from('user_planning_events')
      .select('id, user_id, event_type, event_date, start_time, end_time, title, description')
      .gte('event_date', pastDate)
      .order('event_date', { ascending: true })

    if (!isAll && trainerInfo) {
      eventsQuery = eventsQuery.eq('user_id', trainerInfo.authUserId)
    }

    // ─── Lancer les 3 requêtes en parallèle ───────────────────
    const [
      { data: sessions, error: sessionsError },
      { data: rdvList, error: rdvError },
      { data: eventsList, error: eventsError },
    ] = await Promise.all([sessionsQuery, rdvQuery, eventsQuery])

    if (sessionsError) {
      console.error('Calendar - sessions error:', sessionsError)
      return res.status(500).json({ error: 'Erreur chargement sessions' })
    }

    // ─── Charger cours, clients, formateurs associés ──────────
    const courseIds   = [...new Set((sessions || []).map(s => s.course_id).filter(Boolean))]
    const clientIds   = [
      ...new Set([
        ...(sessions || []).map(s => s.client_id),
        ...(rdvList   || []).map(r => r.client_id),
      ].filter(Boolean))
    ]
    const trainerIds  = isAll
      ? [...new Set((sessions || []).map(s => s.trainer_id).filter(Boolean))]
      : []

    const promises = [
      courseIds.length > 0
        ? supabase.from('courses').select('id, title').in('id', courseIds)
        : Promise.resolve({ data: [] }),
      clientIds.length > 0
        ? supabase.from('clients').select('id, name').in('id', clientIds)
        : Promise.resolve({ data: [] }),
    ]
    if (trainerIds.length > 0) {
      promises.push(
        supabase.from('trainers').select('id, first_name, last_name').in('id', trainerIds)
      )
    }

    const results     = await Promise.all(promises)
    const coursesMap  = new Map((results[0].data || []).map(c => [c.id, c]))
    const clientsMap  = new Map((results[1].data || []).map(c => [c.id, c]))
    const trainersMap = trainerIds.length > 0
      ? new Map((results[2].data || []).map(t => [t.id, t]))
      : new Map()

    // ─── Génération iCal ──────────────────────────────────────
    const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'

    const ical = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Access Formation//Access Campus//FR',
      `X-WR-CALNAME:${escapeIcal(calName)}`,
      'X-WR-TIMEZONE:Europe/Paris',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VTIMEZONE',
      'TZID:Europe/Paris',
      'BEGIN:DAYLIGHT',
      'TZOFFSETFROM:+0100',
      'TZOFFSETTO:+0200',
      'TZNAME:CEST',
      'DTSTART:19700329T020000',
      'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'TZOFFSETFROM:+0200',
      'TZOFFSETTO:+0100',
      'TZNAME:CET',
      'DTSTART:19701025T030000',
      'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
      'END:STANDARD',
      'END:VTIMEZONE',
    ]

    // ── Bloc sessions ─────────────────────────────────────────
    for (const session of (sessions || [])) {
      const course        = coursesMap.get(session.course_id)
      const client        = clientsMap.get(session.client_id)
      const sessionTrainer = trainersMap.get(session.trainer_id)

      const courseName = session.session_type === 'subcontract'
        ? (session.subcontract_course_title || 'Sous-traitance')
        : (course?.title || 'Formation')
      const clientName = client?.name || ''

      let summary = clientName ? `${courseName} - ${clientName}` : courseName
      if (isAll && sessionTrainer) {
        summary = `[${sessionTrainer.first_name}] ${summary}`
      }

      const locationParts = [
        session.location_name, session.location_address,
        session.location_postal_code, session.location_city
      ].filter(Boolean)
      const location = locationParts.join(', ')

      const descParts = [
        `Formation : ${courseName}`,
        clientName         ? `Client : ${clientName}` : null,
        sessionTrainer     ? `Formateur : ${sessionTrainer.first_name} ${sessionTrainer.last_name}` : null,
        session.reference  ? `Réf : ${session.reference}` : null,
        location           ? `Lieu : ${location}` : null,
        session.notes      ? `Notes : ${session.notes}` : null,
      ].filter(Boolean)

      const dtstart = formatIcalDateTime(session.start_date, session.start_time || '09:00:00')
      const dtend   = formatIcalDateTime(session.end_date,   session.end_time   || '17:00:00')

      ical.push(...[
        'BEGIN:VEVENT',
        `UID:session-${session.id}@access-formation.fr`,
        `DTSTAMP:${now}`,
        `DTSTART;TZID=Europe/Paris:${dtstart}`,
        `DTEND;TZID=Europe/Paris:${dtend}`,
        `SUMMARY:${escapeIcal(summary)}`,
        location ? `LOCATION:${escapeIcal(location)}` : null,
        `DESCRIPTION:${escapeIcal(descParts.join('\\n'))}`,
        `STATUS:${session.status === 'completed' ? 'CONFIRMED' : 'TENTATIVE'}`,
        'BEGIN:VALARM',
        'TRIGGER:-P1D',
        'ACTION:DISPLAY',
        `DESCRIPTION:Demain : ${escapeIcal(summary)}`,
        'END:VALARM',
        'BEGIN:VALARM',
        'TRIGGER:-PT1H',
        'ACTION:DISPLAY',
        `DESCRIPTION:Dans 1h : ${escapeIcal(summary)}`,
        'END:VALARM',
        'END:VEVENT',
      ].filter(Boolean))
    }

    // ── Bloc RDV prospects ────────────────────────────────────
    for (const rdv of (rdvList || [])) {
      const client     = clientsMap.get(rdv.client_id)
      const clientName = client?.name || ''
      const typeLabel  = RDV_TYPE_LABELS[rdv.rdv_type] || rdv.rdv_type || 'RDV'
      const statusDone = rdv.status === 'realise'

      let summary = `📅 RDV ${typeLabel}`
      if (clientName) summary += ` - ${clientName}`
      if (isAll && rdv.conducted_by) summary = `[${rdv.conducted_by}] ${summary}`

      const descParts = [
        clientName          ? `Client : ${clientName}` : null,
        rdv.contact_name    ? `Contact : ${rdv.contact_name}` : null,
        rdv.conducted_by    ? `Responsable : ${rdv.conducted_by}` : null,
        rdv.formations_interet?.length ? `Formations : ${rdv.formations_interet.join(', ')}` : null,
        rdv.notes_crm       ? `Notes : ${rdv.notes_crm}` : null,
      ].filter(Boolean)

      const startTime = rdv.rdv_time ? rdv.rdv_time.substring(0, 8) : '09:00:00'
      const endTime   = addOneHour(startTime)
      const dtstart   = formatIcalDateTime(rdv.rdv_date, startTime)
      const dtend     = formatIcalDateTime(rdv.rdv_date, endTime)

      ical.push(...[
        'BEGIN:VEVENT',
        `UID:rdv-${rdv.id}@access-formation.fr`,
        `DTSTAMP:${now}`,
        `DTSTART;TZID=Europe/Paris:${dtstart}`,
        `DTEND;TZID=Europe/Paris:${dtend}`,
        `SUMMARY:${escapeIcal(summary)}`,
        descParts.length ? `DESCRIPTION:${escapeIcal(descParts.join('\\n'))}` : null,
        `STATUS:${statusDone ? 'CONFIRMED' : 'TENTATIVE'}`,
        'END:VEVENT',
      ].filter(Boolean))
    }

    // ── Bloc events manuels ───────────────────────────────────
    for (const evt of (eventsList || [])) {
      const typeLabel = EVENT_TYPE_LABELS[evt.event_type] || evt.event_type || 'Événement'

      // En mode "all", préfixer par le prénom du formateur
      let ownerPrefix = ''
      if (isAll) {
        const ownerEntry = Object.entries(TRAINER_MAP).find(([, v]) => v.authUserId === evt.user_id)
        if (ownerEntry) {
          const tid = ownerEntry[0]
          const conductedBy = TRAINER_MAP[tid].conductedBy
          ownerPrefix = `[${conductedBy}] `
        }
      }

      const summary = `${ownerPrefix}${escapeIcal(evt.title || typeLabel)}`

      const descParts = [
        `Type : ${typeLabel}`,
        evt.description ? evt.description : null,
      ].filter(Boolean)

      const dtstart = formatIcalDateTime(evt.event_date, evt.start_time || '09:00:00')
      const dtend   = formatIcalDateTime(evt.event_date, evt.end_time   || '18:00:00')

      ical.push(...[
        'BEGIN:VEVENT',
        `UID:event-${evt.id}@access-formation.fr`,
        `DTSTAMP:${now}`,
        `DTSTART;TZID=Europe/Paris:${dtstart}`,
        `DTEND;TZID=Europe/Paris:${dtend}`,
        `SUMMARY:${summary}`,
        descParts.length ? `DESCRIPTION:${escapeIcal(descParts.join('\\n'))}` : null,
        'STATUS:CONFIRMED',
        'END:VEVENT',
      ].filter(Boolean))
    }

    ical.push('END:VCALENDAR')

    const icalContent = ical.join('\r\n')

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Content-Disposition', `inline; filename="access_formation_${trainerName.replace(/\s+/g, '_')}.ics"`)
    res.setHeader('Cache-Control', 'public, max-age=900, s-maxage=900')

    return res.status(200).send(icalContent)

  } catch (error) {
    console.error('Calendar endpoint error:', error)
    return res.status(500).json({ error: 'Erreur serveur' })
  }
}
