// api/mailing-replies-cron.js
// ─────────────────────────────────────────────────────────────────────────────
// CRON (toutes les 15 min) — Détection des réponses aux campagnes mailing
//
// Règle stricte : un mail reçu n'est compté comme réponse QUE s'il répond
// directement à un mail de campagne, c'est-à-dire si ses en-têtes techniques
// « In-Reply-To » ou « References » contiennent l'identifiant du mail envoyé
// (<mailing-{id}@domaine-de-l-expediteur>).
//
//   • Seuls les EN-TÊTES sont lus (jamais le contenu des mails)
//   • Les réponses automatiques (absence, accusé…) sont ignorées
//   • Aucun effet ailleurs dans Campus : seule la date de réponse est notée
//     sur la ligne d'envoi de la campagne
// ─────────────────────────────────────────────────────────────────────────────

import { ImapFlow } from 'imapflow'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from './_lib/mailer.js'
import { requireCronOrUser } from './_lib/auth.js'
import { getImapHost } from './_lib/save-to-sent.js'

export const config = { maxDuration: 60 }

// Client Supabase créé à la demande (et non au chargement du fichier) :
// une variable d'environnement absente donne une erreur lisible au lieu d'un plantage
let supabase = null
function getSupabase() {
  if (supabase) return supabase
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    const present = Object.keys(process.env).filter(k => /SUPABASE|ENCRYPTION|CRON/i.test(k)).sort()
    throw new Error(`Variables manquantes (url: ${!!url}, clé serveur: ${!!key}). Variables visibles : ${present.join(', ') || 'aucune'}`)
  }
  supabase = createClient(url, key)
  return supabase
}

const MAX_MESSAGES_PER_ACCOUNT = 300
const LOOKBACK_DAYS = 60
const ID_RE = /<mailing-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@[^>\s]+>/gi


function parseHeaders(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '')
  // Dépliage des en-têtes multi-lignes
  const unfolded = text.replace(/\r?\n[ \t]+/g, ' ')
  const out = {}
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  return out
}

function isAutoReply(h, subject) {
  const auto = (h['auto-submitted'] || '').toLowerCase()
  if (auto && auto !== 'no') return true
  if (h['x-autoreply'] || h['x-autorespond'] || h['x-auto-response-suppress']?.toLowerCase().includes('all')) return true
  const prec = (h['precedence'] || '').toLowerCase()
  if (['auto_reply', 'bulk', 'junk', 'list'].includes(prec)) return true
  if (/(absence|absent|out of office|r[ée]ponse automatique|automatic reply|auto[- ]?reply|autoreply|accus[ée] de r[ée]ception|undeliverable|non remis|delivery status)/i.test(subject || '')) return true
  return false
}

async function syncAccount(config, cursor) {
  const client = new ImapFlow({
    host: getImapHost(config),
    port: 993,
    secure: true,
    auth: { user: config.email, pass: decrypt(config.smtp_password_encrypted) },
    logger: false,
    tls: { rejectUnauthorized: false },
  })

  const result = { scanned: 0, replies: 0, auto_ignored: 0 }
  await client.connect()
  const lock = await client.getMailboxLock('INBOX')
  try {
    const uidValidity = Number(client.mailbox?.uidValidity || 0)
    const lastUid = Number(cursor?.last_uid || 0)
    const firstRun = !cursor || !lastUid || Number(cursor.uid_validity || 0) !== uidValidity

    // Liste des UID à examiner : les plus RÉCENTS en priorité
    let uids
    if (firstRun) {
      // Premier passage (ou boîte réinitialisée) : messages des derniers jours
      uids = await client.search({ since: new Date(Date.now() - LOOKBACK_DAYS * 86400000) }, { uid: true })
    } else {
      uids = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true })
    }
    uids = (uids || []).map(Number).filter(u => firstRun || u > lastUid).sort((a, b) => a - b)

    if (!uids.length) {
      if (firstRun) await saveCursor(config.email, Number(client.mailbox?.uidNext || 1) - 1, uidValidity, null)
      else await saveCursor(config.email, lastUid, uidValidity, null)
      return result
    }

    const batch = uids.slice(-MAX_MESSAGES_PER_ACCOUNT)
    const maxUid = uids[uids.length - 1]
    const replied = new Map() // sendId → date

    for await (const msg of client.fetch(batch.join(','), {
      uid: true,
      envelope: true,
      headers: ['in-reply-to', 'references', 'auto-submitted', 'x-autoreply', 'x-autorespond', 'x-auto-response-suppress', 'precedence'],
    }, { uid: true })) {
      result.scanned++

      const h = parseHeaders(msg.headers)
      const refs = `${msg.envelope?.inReplyTo || ''} ${h['in-reply-to'] || ''} ${h['references'] || ''}`
      const ids = [...refs.matchAll(ID_RE)].map(m => m[1].toLowerCase())
      if (!ids.length) continue

      if (isAutoReply(h, msg.envelope?.subject)) { result.auto_ignored++; continue }

      const date = msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : new Date().toISOString()
      for (const id of ids) if (!replied.has(id)) replied.set(id, date)
    }

    for (const [id, date] of replied) {
      const { data } = await supabase
        .from('mailing_sends')
        .update({ replied_at: date })
        .eq('id', id)
        .is('replied_at', null)
        .select('id')
      if (data?.length) result.replies++
    }

    await saveCursor(config.email, maxUid, uidValidity, null)
  } finally {
    lock.release()
    await client.logout().catch(() => {})
  }
  return result
}

async function saveCursor(email, lastUid, uidValidity, lastError) {
  await supabase.from('mailing_reply_cursors').upsert({
    email,
    last_uid: lastUid,
    uid_validity: uidValidity,
    last_synced_at: new Date().toISOString(),
    last_error: lastError,
  }, { onConflict: 'email' })
}

export default async function handler(req, res) {
  if (!(await requireCronOrUser(req, res))) return

  try {
    getSupabase()
    // Boîtes à surveiller : expéditeurs de campagnes des 60 derniers jours
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString()
    const { data: camps } = await supabase
      .from('mailing_campaigns')
      .select('sender_email')
      .gte('created_at', since)
    const senders = [...new Set((camps || []).map(c => String(c.sender_email || '').toLowerCase()).filter(Boolean))]
    if (!senders.length) return res.status(200).json({ ok: true, message: 'Aucune campagne récente' })

    const [{ data: configs }, { data: cursors }] = await Promise.all([
      supabase.from('user_email_configs').select('*').eq('is_active', true),
      supabase.from('mailing_reply_cursors').select('*'),
    ])

    const results = {}
    for (const email of senders) {
      const config = (configs || []).find(c => String(c.email).toLowerCase() === email)
      if (!config?.smtp_password_encrypted) { results[email] = 'pas de configuration active'; continue }
      const cursor = (cursors || []).find(c => c.email === email)
      try {
        results[email] = await syncAccount(config, cursor)
      } catch (e) {
        console.error(`[mailing-replies] ${email}:`, e.message)
        await saveCursor(email, Number(cursor?.last_uid || 0), cursor?.uid_validity ?? null, e.message.slice(0, 300))
        results[email] = 'erreur : ' + e.message
      }
    }
    return res.status(200).json({ ok: true, results })
  } catch (e) {
    console.error('[mailing-replies] erreur globale:', e)
    return res.status(500).json({ error: e.message })
  }
}
