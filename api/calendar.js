// api/calendar.js
// Endpoint iCal pour synchronisation Google Agenda
//
// Usage :
//   GET /api/calendar?link=UUID|all              → (utilisateur connecté) renvoie le lien d'abonnement signé
//   GET /api/calendar?trainer=UUID&key=SIGNATURE → sessions + RDV + événements d'un formateur
//   GET /api/calendar?trainer=all&key=SIGNATURE  → tout le planning
//
// Google Agenda → Autres agendas → À partir de l'URL → coller le lien
// Ne modifie RIEN dans l'agenda existant (calendrier séparé en lecture seule)
// Le lien est signé : sans la bonne clé, rien n'est renvoyé (le planning contient des noms de clients et des notes).

import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { requireRole, ADMINS, OFFICE_WRITE } from './_lib/auth.js'
import { getOrg } from './_lib/mailer.js'
import { loadTeam, profileFirstName } from './_lib/team.js'
import { appUrl } from './_lib/internal.js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Signature du lien d'abonnement (clé serveur, jamais exposée)
// Clé dédiée CALENDAR_SECRET en priorité pour les nouveaux liens.
// Compatibilité : les liens déjà distribués ont été signés avec l'ancienne clé
// (ENCRYPTION_KEY, sinon CRON_SECRET) ; ils restent acceptés en lecture tant que cette clé existe,
// pour ne pas casser les agendas déjà abonnés. Pour les révoquer : redistribuer les liens
// puis définir CALENDAR_LEGACY_DISABLED=1.
function hmacTrainer(secret, trainer) {
  return crypto.createHmac('sha256', secret).update(`calendar:${trainer}`).digest('hex').slice(0, 32)
}

function legacySecret() {
  if (process.env.CALENDAR_LEGACY_DISABLED === '1') return ''
  return process.env.ENCRYPTION_KEY || process.env.CRON_SECRET || ''
}

function signTrainer(trainer) {
  const secret = process.env.CALENDAR_SECRET || legacySecret()
  if (!secret) return null
  return hmacTrainer(secret, trainer)
}

function validKey(trainer, key) {
  const secrets = [process.env.CALENDAR_SECRET, legacySecret()].filter(Boolean)
  return secrets.some((secret) => sameKey(key, hmacTrainer(secret, trainer)))
}

// Formateur → utilisateur relié (profiles.trainer_id) : prénom porté par les RDV, id des événements personnels
async function trainerMap() {
  const team = await loadTeam(supabase)
  const map = {}
  team.filter(p => p.trainer_id).forEach(p => { map[p.trainer_id] = { conductedBy: profileFirstName(p), authUserId: p.id } })
  return map
}

// Lien d'abonnement signé, demandé depuis l'écran Planning par un utilisateur connecté
async function linkHandler(req, res) {
  // Personnel de bureau (les rôles externes et « lecture » n'obtiennent aucun lien)
  const ctx = await requireRole(req, res, OFFICE_WRITE)
  if (!ctx) return
  const target = String(req.query.link)
  const isAdmin = ADMINS.includes(ctx.profile.role)
  if (target === 'all' ? !isAdmin : !(isAdmin || ctx.profile.trainer_id === target)) {
    return res.status(403).json({ error: 'Ce lien est réservé à la direction ou au formateur concerné' })
  }
  const key = signTrainer(target)
  if (!key) return res.status(500).json({ error: 'Clé de signature absente du serveur' })
  return res.status(200).json({ url: `${appUrl(req)}/api/calendar?trainer=${encodeURIComponent(target)}&key=${key}` })
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

  if (req.query.link) return linkHandler(req, res)

  const { trainer, key } = req.query

  if (trainer && !validKey(trainer, key)) {
    return res.status(403).json({ error: 'Lien d\'agenda invalide : copiez-le à nouveau depuis le Planning' })
  }

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
    const [org, TRAINER_MAP] = await Promise.all([getOrg(supabase), trainerMap()])
    const orgLabel = org.app_name || org.name || 'Planning'
    const uidDomain = (appUrl(req).replace(/^https?:\/\//, '') || 'agenda.local').replace(/[^A-Za-z0-9.-]/g, '')
    let calName = `${orgLabel} - Planning`
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
      calName = `${orgLabel} - ${trainerName}`
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
      `PRODID:-//${escapeIcal(orgLabel)}//Planning//FR`,
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
        `UID:session-${session.id}@${uidDomain}`,
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
        `UID:rdv-${rdv.id}@${uidDomain}`,
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
        `UID:event-${evt.id}@${uidDomain}`,
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
    res.setHeader('Content-Disposition', `inline; filename="planning_${trainerName.replace(/[^A-Za-z0-9]+/g, '_')}.ics"`)
    res.setHeader('Cache-Control', 'public, max-age=900, s-maxage=900')

    return res.status(200).send(icalContent)

  } catch (error) {
    console.error('Calendar endpoint error:', error)
    return res.status(500).json({ error: 'Erreur serveur' })
  }
}
