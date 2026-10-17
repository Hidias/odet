// api/mailing-cron.js
// ─────────────────────────────────────────────────────────────────────────────
// Envoi des campagnes mailing côté serveur — UN mail par appel
//
// Ce n'est plus Vercel qui se réveille chaque minute : c'est Supabase
// (fonction SQL public.mailing_tick, toutes les 30 s, gratuite) qui décide
// quand un mail est dû et appelle cette adresse avec la clé CRON_SECRET.
//
//   GET /api/mailing-cron?campaign=<uuid>
//     → réserve le prochain destinataire, vérifie les exclusions,
//       personnalise, envoie (logique existante de send-mailing-single),
//       met à jour les compteurs, puis s'arrête.
//       La cadence (next_send_at) a déjà été réservée par Supabase.
//
//   GET /api/mailing-cron?campaign=<uuid>&finish=1
//     → plus rien en attente : rapport de fin (/api/send-mailing-report)
//
// Aucune attente dans la fonction : elle vit quelques secondes par mail.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'
import { applyMailingVars } from '../src/modules/mailing/lib/mailingVars.js'
import sendMailingSingle from './send-mailing-single.js'
import { requireCronOrUser } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

export const config = { maxDuration: 60 }

const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const norm = (e) => String(e || '').trim().toLowerCase()

// ─── Exclusions dures, vérifiées juste avant l'envoi ─────────────────────────
// Liste de blocage : chargée en entier (petite table), comme avant.
// Statut « invalide » : lu pour CETTE adresse uniquement.
async function hardReason(email) {
  const e = norm(email)
  const d = e.split('@')[1] || ''

  const [bl, st] = await Promise.all([
    supabase.from('mailing_blocklist').select('kind, value, category'),
    supabase.from('mailing_email_status').select('email').eq('email', e).eq('status', 'invalide').limit(1),
  ])

  let cat = null
  for (const b of (bl.data || [])) {
    if (b.kind === 'email' && norm(b.value) === e) { cat = b.category; break }
    if (b.kind === 'domaine' && d && norm(b.value).replace(/^@/, '') === d) { cat = b.category; break }
  }
  if (cat === 'desabonne') return 'Ignoré : désabonné'
  if (cat) return 'Ignoré : liste de blocage'
  if ((st.data || []).length > 0) return 'Ignoré : adresse invalide'
  return null
}

async function loadAttachment(campaign) {
  const att = campaign.attachment
  if (!att?.path) return []
  const { data, error } = await supabase.storage.from('mailing-attachments').download(att.path)
  if (error || !data) throw new Error('Pièce jointe introuvable : ' + (error?.message || att.path))
  const buf = Buffer.from(await data.arrayBuffer())
  return [{ filename: att.filename || 'piece-jointe', base64: buf.toString('base64'), contentType: att.contentType || 'application/octet-stream' }]
}

async function refreshCounters(campaignId) {
  const { data } = await supabase
    .from('mailing_campaign_stats_v')
    .select('envoyes, erreurs, total')
    .eq('campaign_id', campaignId)
    .maybeSingle()
  if (data) {
    await supabase.from('mailing_campaigns')
      .update({ sent_count: data.envoyes, error_count: data.erreurs, total_recipients: data.total })
      .eq('id', campaignId)
  }
}

async function finishCampaign(campaignId) {
  const { count } = await supabase
    .from('mailing_sends')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .in('status', ['pending', 'sending'])
  if ((count || 0) > 0) return { finished: false }

  try {
    if (!APP_URL) throw new Error('APP_URL non définie')
    const r = await fetch(`${APP_URL}/api/send-mailing-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRON_SECRET || ''}` },
      body: JSON.stringify({ campaign_id: campaignId }),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
  } catch (e) {
    await supabase.from('mailing_campaigns')
      .update({ status: 'terminée', completed_at: new Date().toISOString(), last_error: 'Rapport non envoyé : ' + e.message })
      .eq('id', campaignId)
  }
  return { finished: true }
}

// Appelle la logique d'envoi existante (send-mailing-single) sans passer
// par une deuxième fonction Vercel facturée en parallèle.
async function sendOne(body) {
  const out = { statusCode: 200, body: null }
  const fakeRes = {
    status(code) { out.statusCode = code; return this },
    json(payload) { out.body = payload; return this },
    send(payload) { out.body = payload; return this },
    setHeader() { return this },
    end() { return this },
  }
  // Appel interne (pas de jeton utilisateur) : le handler saute la vérification grâce à req.internal
  await sendMailingSingle({ method: 'POST', body, headers: {}, query: {}, internal: true }, fakeRes)
  return out
}

async function handler(req, res) {
  if (!(await requireCronOrUser(req, res))) return

  const campaignId = String(req.query?.campaign || '')
  if (!UUID_RE.test(campaignId)) {
    return res.status(400).json({ error: 'Paramètre campaign manquant ou invalide' })
  }

  try {
    // ── Fin de campagne ──
    if (req.query?.finish) {
      const r = await finishCampaign(campaignId)
      return res.status(200).json({ ok: true, ...r })
    }

    // ── Campagne toujours active en mode serveur ? ──
    const { data: c } = await supabase
      .from('mailing_campaigns')
      .select('id, name, status, send_mode, subject, body_html, sender_email, attachment')
      .eq('id', campaignId)
      .maybeSingle()
    if (!c || c.status !== 'en_cours' || c.send_mode !== 'serveur') {
      return res.status(200).json({ ok: true, skipped: 'campagne inactive' })
    }

    // ── Réservation atomique du destinataire ──
    const { data: claimed, error: claimErr } = await supabase.rpc('mailing_claim_next_send', { p_campaign: c.id })
    if (claimErr) throw claimErr
    const send = Array.isArray(claimed) ? claimed[0] : claimed
    if (!send) return res.status(200).json({ ok: true, skipped: 'plus rien en attente' })

    // ── Exclusions de dernière minute ──
    const reason = await hardReason(send.email)
    if (reason) {
      await supabase.from('mailing_sends').update({ status: 'skipped', error_message: reason }).eq('id', send.id)
      // Créneau non consommé : le prochain passage Supabase enverra le suivant
      await supabase.from('mailing_campaigns').update({ next_send_at: new Date().toISOString() }).eq('id', c.id)
      await refreshCounters(c.id)
      return res.status(200).json({ ok: true, skipped: reason })
    }

    // ── Pièce jointe ──
    let attachments
    try {
      attachments = await loadAttachment(c)
    } catch (e) {
      await supabase.from('mailing_sends').update({ status: 'pending' }).eq('id', send.id)
      await supabase.from('mailing_campaigns')
        .update({ status: 'en_pause', paused_at: new Date().toISOString(), last_error: e.message })
        .eq('id', c.id)
      return res.status(200).json({ ok: false, paused: e.message })
    }

    // ── Envoi ──
    const vars = send.vars || {}
    let result
    try {
      result = await sendOne({
        send_id: send.id,
        to: send.email,
        subject: applyMailingVars(c.subject, vars),
        body_html: applyMailingVars(c.body_html, vars, { html: true }),
        sender_email: c.sender_email,
        unsubscribe_token: send.unsubscribe_token,
        attachments,
      })
    } catch (e) {
      result = { statusCode: 500, body: { error: 'Appel envoi : ' + e.message } }
    }

    if (result.statusCode !== 200) {
      // send-mailing-single a normalement déjà marqué l'erreur ; sécurité sinon
      await supabase.from('mailing_sends')
        .update({ status: 'error', error_message: String(result.body?.error || `HTTP ${result.statusCode}`).slice(0, 500) })
        .eq('id', send.id).eq('status', 'sending')
    }

    await refreshCounters(c.id)
    return res.status(200).json({ ok: result.statusCode === 200, send_id: send.id })
  } catch (e) {
    console.error('[mailing-cron] erreur:', e)
    await supabase.from('mailing_campaigns').update({ last_error: String(e.message || e).slice(0, 500) }).eq('id', campaignId)
    return res.status(500).json({ error: e.message })
  }
}

export default withErrorLog(handler, 'mailing-cron')
