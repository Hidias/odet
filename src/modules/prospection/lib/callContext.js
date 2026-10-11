// ════════════════════════════════════════════════════════════════
// callContext.js — Contexte affiché pendant l'appel
//   - fiche client (si elle existe), formations suivies / non suivies,
//     échéance MAC SST, devis en cours, sessions prévues
//   - dernier échange, dernier mail, dernier mailing
//   - prestataires en place
//   - alertes avant appel
//   - scénario proposé automatiquement
//   - cadence graduée après non-réponse
// Lecture seule : aucune écriture dans ce fichier.
// ════════════════════════════════════════════════════════════════

import { supabase } from '../../../core/supabase'
import { todayStr, addDays, diffDays, toDateStr, nextBusinessDay } from '../components/suivi/suiviUtils'

// Thèmes reconnus dans les titres de formation
const THEME_PATTERNS = [
  { theme: 'sst', label: 'SST / MAC SST', re: /\b(sst|mac\s*sst|secour)/i },
  { theme: 'incendie', label: 'Incendie / évacuation', re: /(incendie|evacuation|évacuation|\bepi\b|extincteur)/i },
  { theme: 'electrique', label: 'Habilitation électrique', re: /(electri|électri|b0|h0v)/i },
  { theme: 'conduite', label: 'Conduite de chariots et gerbeurs', re: /(r489|r485|chariot|gerbeur|conduite)/i },
  { theme: 'gestes_postures', label: 'Gestes et postures', re: /(geste|posture|tms|prap)/i },
  { theme: 'duerp', label: 'DUERP', re: /(duerp|document unique)/i },
]

export const ALL_THEMES = THEME_PATTERNS.map(t => ({ theme: t.theme, label: t.label }))

export function themeOfTitle(title) {
  const t = THEME_PATTERNS.find(p => p.re.test(title || ''))
  return t ? t.theme : null
}

function addMonths(dateStr, months) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number)
  const dt = new Date(y, m - 1 + months, d)
  return toDateStr(dt)
}

export const EFFECTIF_LABELS = {
  '00': '0 salarié', '01': '1-2 sal.', '02': '3-5 sal.', '03': '6-9 sal.',
  '11': '10-19 sal.', '12': '20-49 sal.', '21': '50-99 sal.', '22': '100-199 sal.',
  '31': '200-249 sal.', '32': '250-499 sal.', '41': '500-999 sal.', '42': '1000-1999 sal.',
  '51': '2000-4999 sal.', '52': '5000-9999 sal.', '53': '10000+ sal.',
}

export function effectifLabel(code) {
  if (!code) return null
  return EFFECTIF_LABELS[String(code)] || `${code} sal.`
}

// Trouve la fiche client liée à un prospect (SIRET exact, sinon SIREN)
// match = 'siret' (même établissement) ou 'siren' (autre établissement du même groupe)
async function findClientForProspect(prospect) {
  const siret = prospect?.siret && !String(prospect.siret).startsWith('MANUAL_') ? String(prospect.siret).slice(0, 14) : null
  const siren = prospect?.siren && !String(prospect.siren).startsWith('MANUAL_') ? String(prospect.siren).slice(0, 9) : null
  if (siret) {
    const { data } = await supabase.from('clients').select('*').eq('siret', siret).limit(1)
    if (data && data.length > 0) return { client: data[0], match: 'siret' }
  }
  if (siren) {
    const { data } = await supabase.from('clients').select('*').eq('siren', siren).order('created_at').limit(1)
    if (data && data.length > 0) return { client: data[0], match: 'siren' }
  }
  return { client: null, match: null }
}

// « Ne pas rappeler » posé dans la prospection (par SIRET, sinon par SIREN)
async function findDoNotCall(siret, siren) {
  if (siret) {
    const { data } = await supabase.from('prospection_massive')
      .select('id, do_not_call, do_not_call_reason').eq('siret', siret).eq('do_not_call', true).limit(1)
    if (data && data.length > 0) return data[0]
  }
  if (siren) {
    const { data } = await supabase.from('prospection_massive')
      .select('id, do_not_call, do_not_call_reason').eq('siren', siren).eq('do_not_call', true).limit(1)
    if (data && data.length > 0) return data[0]
  }
  return null
}

async function loadLastMailing(source, sourceId) {
  if (!sourceId) return null
  const { data } = await supabase.from('mailing_sends')
    .select('sent_at, replied_at, campaign_id')
    .eq('source', source).eq('source_id', sourceId)
    .not('sent_at', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(1)
  const send = data?.[0]
  if (!send) return null
  if (send.campaign_id) {
    const { data: camp } = await supabase.from('mailing_campaigns')
      .select('name, subject, phoning_message').eq('id', send.campaign_id).maybeSingle()
    return { ...send, mailing_campaigns: camp || null }
  }
  return { ...send, mailing_campaigns: null }
}

export async function loadCallContext({ prospect, clientId }) {
  const today = todayStr()
  let client = null
  let clientMatch = null
  if (clientId) {
    const { data } = await supabase.from('clients').select('*').eq('id', clientId).maybeSingle()
    client = data || null
    clientMatch = client ? 'direct' : null
  } else if (prospect) {
    const found = await findClientForProspect(prospect)
    client = found.client
    clientMatch = found.match
  }
  const cid = client?.id || null
  const siren = prospect?.siren ? String(prospect.siren).slice(0, 9) : (client?.siren || null)

  const empty = { data: [] }
  const dncSiret = prospect?.siret && !String(prospect.siret).startsWith('MANUAL_')
    ? String(prospect.siret).slice(0, 14)
    : (client?.siret || null)

  const [
    sessionsRes, quotesRes, callsRes, interRes, mailLogRes, providersRes, contactsRes,
    lastMailingProspect, lastMailingClient, dncRow,
  ] = await Promise.all([
    cid
      ? supabase.from('sessions')
        .select('id, reference, start_date, end_date, status, courses (title)')
        .eq('client_id', cid)
        .order('start_date', { ascending: false })
        .limit(50)
      : empty,
    cid
      ? supabase.from('quotes')
        .select('id, reference, quote_date, status, total_ht, object, relance_count, last_relance_date, followup_state, veille_until')
        .eq('client_id', cid)
        .order('quote_date', { ascending: false })
        .limit(20)
      : empty,
    cid
      ? supabase.from('prospect_calls')
        .select('id, called_at, called_by, call_result, notes, contact_name, contact_function, contact_email, contact_mobile, needs_callback, callback_date, is_planned, outcome_detail, duration_seconds')
        .eq('client_id', cid)
        .order('called_at', { ascending: false })
        .limit(15)
      : empty,
    cid
      ? supabase.from('client_interactions')
        .select('id, type, title, content, author, interaction_date')
        .eq('client_id', cid)
        .order('interaction_date', { ascending: false })
        .limit(5)
      : empty,
    (cid || siren)
      ? supabase.from('prospect_email_logs')
        .select('subject, template_type, sent_at, to_email, sent_by')
        .or([cid ? `client_id.eq.${cid}` : null, siren ? `prospect_siren.eq.${siren}` : null].filter(Boolean).join(','))
        .order('sent_at', { ascending: false })
        .limit(1)
      : empty,
    cid
      ? supabase.from('client_providers').select('*').eq('client_id', cid).order('theme')
      : empty,
    cid
      ? supabase.from('client_contacts').select('id, name, first_name, last_name, fonction, role, email, phone, mobile, is_primary, notes')
        .eq('client_id', cid)
        .order('is_primary', { ascending: false })
      : empty,
    prospect?.id ? loadLastMailing('prospection_massive', prospect.id) : null,
    cid && clientMatch !== 'siren' ? loadLastMailing('clients', cid) : null,
    prospect?.do_not_call ? null : findDoNotCall(dncSiret, siren),
  ])

  // Autre établissement du même groupe : on n'affiche que l'essentiel pour ne pas mélanger
  const sameSite = clientMatch !== 'siren'
  const sessions = sessionsRes.data || []
  const quotes = quotesRes.data || []
  const calls = callsRes.data || []
  const interactions = interRes.data || []
  const providers = providersRes.data || []
  const contacts = contactsRes.data || []

  // Formations suivies / non suivies
  const doneSessions = sessions.filter(s => s.status !== 'cancelled' && s.end_date && s.end_date < today)
  const plannedSessions = sessions.filter(s => s.status !== 'cancelled' && s.start_date && s.start_date >= today)
  const doneThemes = new Set(doneSessions.map(s => themeOfTitle(s.courses?.title)).filter(Boolean))
  const notDone = ALL_THEMES.filter(t => !doneThemes.has(t.theme) && t.theme !== 'duerp')

  // Échéance MAC SST : dernière session SST + 24 mois
  const lastSst = doneSessions.find(s => themeOfTitle(s.courses?.title) === 'sst')
  const macDue = lastSst ? addMonths(lastSst.end_date, 24) : null

  // Devis en cours
  const openQuotes = quotes.filter(q => q.status === 'sent' || q.status === 'partial')

  // Derniers échanges
  const realCalls = calls.filter(c => !c.is_planned && c.call_result !== 'a_rappeler')
  const lastCall = realCalls[0] || null
  const lastJoined = realCalls.find(c => ['chaud', 'tiede', 'froid', 'blocked'].includes(c.call_result)) || null

  // Tentatives sans réponse depuis le dernier contact joint
  let noAnswerStreak = 0
  for (const c of realCalls) {
    if (c.call_result === 'no_answer') noAnswerStreak++
    else break
  }

  // Dernier mailing (prospect ou client)
  const mailings = [lastMailingProspect, lastMailingClient].filter(Boolean)
    .sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))
  const lastMailing = mailings[0] || null

  // Rappel convenu en attente (le dernier rappel posé pour ce client)
  const pendingCallback = calls.find(c => c.needs_callback && c.callback_date) || null

  // Contact connu le plus récent
  const lastWithContact = calls.find(c => c.contact_name) || null

  // Alertes avant appel
  const alerts = []
  const recentCall = realCalls.find(c => diffDays(String(c.called_at).slice(0, 10), today) < 7)
  if (recentCall) {
    alerts.push(`Appelé il y a ${diffDays(String(recentCall.called_at).slice(0, 10), today)} j par ${recentCall.called_by || '—'}`)
  }
  if (openQuotes.length > 0) {
    alerts.push(`${openQuotes.length} devis en cours : ce n'est pas un appel de prospection`)
  }
  if (plannedSessions.length > 0) {
    alerts.push(`Session prévue le ${plannedSessions[plannedSessions.length - 1].start_date.split('-').reverse().join('/')}`)
  }
  if (prospect?.do_not_call || dncRow) {
    alerts.push(`Marqué « ne pas rappeler »${(prospect?.do_not_call_reason || dncRow?.do_not_call_reason) ? ' : ' + (prospect?.do_not_call_reason || dncRow?.do_not_call_reason) : ''}`)
  }
  if (clientMatch === 'siren') {
    alerts.push(`Fiche client trouvée sur un autre établissement du groupe (${client?.city || client?.name}) : historique à vérifier`)
  }

  // Scénario proposé
  let scenario = 'prospect_froid'
  if (sameSite && openQuotes.length > 0) scenario = 'relance_devis'
  else if (sameSite && client && ['actif'].includes(client.status)) scenario = 'client_existant'
  else if (lastMailing && diffDays(String(lastMailing.sent_at).slice(0, 10), today) <= 30) scenario = 'prospect_mailing'

  return {
    client,
    clientMatch,
    sameSite,
    pendingCallback,
    doNotCall: !!(prospect?.do_not_call || dncRow),
    sessions: doneSessions,
    plannedSessions,
    doneThemes: Array.from(doneThemes),
    notDone,
    macDue,
    openQuotes,
    lastCall,
    lastJoined,
    noAnswerStreak,
    lastInteraction: interactions[0] || null,
    lastMail: (mailLogRes.data || [])[0] || null,
    lastMailing,
    providers,
    contacts,
    lastWithContact,
    alerts,
    scenario,
  }
}

// ── Cadence graduée après non-réponse ──────────────────────────
// attempt = numéro de la tentative qui vient d'échouer (1, 2, 3, 4+)
export function noAnswerPlan(attempt, now = new Date()) {
  const afternoon = now.getHours() >= 12
  if (attempt <= 1) {
    return {
      attempt,
      date: nextBusinessDay(),
      time: afternoon ? '10:00' : '14:00',
      email: null,
      label: 'Rappel demain, sur l\'autre demi-journée. Pas de mail.',
      pause: false,
    }
  }
  if (attempt === 2) {
    return {
      attempt,
      date: addDays(todayStr(), 3),
      time: '10:00',
      email: 'nrp',
      label: 'Message vocal + mail court « suite à mon message ». Rappel dans 3 jours à 10h.',
      pause: false,
    }
  }
  if (attempt === 3) {
    return {
      attempt,
      date: addDays(todayStr(), 7),
      time: '16:30',
      email: 'relance',
      label: 'Mail différent. Rappel dans 7 jours à 16h30.',
      pause: false,
    }
  }
  return {
    attempt,
    date: addDays(todayStr(), 90),
    time: '10:00',
    email: null,
    label: 'Injoignable : pause de 3 mois, le contact reviendra seul. Il n\'est pas classé « pas intéressé ».',
    pause: true,
  }
}

// Remplace les repères entre crochets dans une phrase de trame
export function fillPlaceholders(text, ctx) {
  const map = {
    'votre prénom': ctx.callerFirstName,
    'prénom': ctx.contactFirstName,
    'nom du contact': ctx.contactName,
    'date du devis': ctx.quoteDate,
    'formation': ctx.lastFormation,
    'date': ctx.macDue,
  }
  return String(text || '').replace(/\[([^\]]+)\]/g, (m, key) => {
    const v = map[key.trim().toLowerCase()]
    return v ? v : m
  })
}
