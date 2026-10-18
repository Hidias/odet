// api/send-mailing-single.js
// Envoi d'un email de campagne à un destinataire (une ligne mailing_sends), avec signature
// de l'expéditeur et pied de page de désabonnement aux mentions de l'organisme.
// Expéditeur :
//  - appel interne (mailing-cron) ou administrateur : la boîte demandée (sender_email), sinon celle de
//    l'utilisateur, sinon l'expéditeur par défaut de l'organisme, sinon le premier compte actif ;
//  - autres rôles : uniquement une boîte appartenant à l'utilisateur appelant (user_email_configs.user_id).
// La ligne mailing_sends visée doit correspondre au destinataire (et au jeton de désabonnement pour une campagne).

import { getSupabaseAdmin, getMailer, getMailerByEmail, sendWithRetry, getOrg, getSender, wrapEmailHTML } from './_lib/mailer.js'
import { requireRight, SALES, ADMINS } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

const supabase = getSupabaseAdmin()

export const config = {
  api: { bodyParser: { sizeLimit: '8mb' } },
  maxDuration: 30,
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const norm = (e) => String(e || '').trim().toLowerCase()

async function pickMailer(userId, org, preferEmail, trusted) {
  if (!trusted) {
    // Utilisateur non administrateur : seulement ses propres boîtes
    if (!userId) return { error: 'Utilisateur inconnu' }
    const m = await getMailer(supabase, userId, { preferEmail })
    if (m.error) return { error: 'Configurez votre compte email dans Paramètres > Comptes email' }
    return m
  }
  if (preferEmail) {
    const m = await getMailerByEmail(supabase, preferEmail)
    if (!m.error) return m
  }
  let m = userId ? await getMailer(supabase, userId) : { error: 'Utilisateur inconnu' }
  if (!m.error) return m
  if (org.email_default_sender) {
    m = await getMailerByEmail(supabase, org.email_default_sender)
    if (!m.error) return m
  }
  const { data: configs } = await supabase.from('user_email_configs').select('email').eq('is_active', true).limit(1)
  if (configs?.[0]) return getMailerByEmail(supabase, configs[0].email)
  return { error: 'Aucune configuration email active' }
}

/**
 * Vérifie que send_id désigne bien l'envoi demandé : même destinataire, même campagne si elle est
 * précisée, même jeton de désabonnement pour un envoi de campagne. Retourne un message d'erreur ou null.
 */
async function checkSend({ send_id, to, campaign_id, unsubscribe_token }, callerEmail) {
  if (!UUID_RE.test(String(send_id))) {
    // Test sans ligne en base (repli de l'écran de composition) : uniquement vers soi-même
    return callerEmail && norm(to) === norm(callerEmail) ? null : 'Envoi inconnu'
  }
  const { data: row } = await supabase.from('mailing_sends')
    .select('id, campaign_id, email, unsubscribe_token, status')
    .eq('id', send_id).maybeSingle()
  if (!row) return 'Envoi introuvable'
  if (norm(row.email) !== norm(to)) return 'Destinataire différent de celui de l\'envoi'
  if (campaign_id !== undefined && campaign_id !== null && String(row.campaign_id || '') !== String(campaign_id)) {
    return 'Cet envoi n\'appartient pas à la campagne indiquée'
  }
  if (row.campaign_id) {
    if (!row.unsubscribe_token || String(row.unsubscribe_token) !== String(unsubscribe_token)) return 'Jeton de désabonnement incohérent'
    if (row.status === 'sent') return 'Envoi déjà effectué'
  } else if (!callerEmail || norm(to) !== norm(callerEmail)) {
    // Ligne de test (sans campagne) : envoi vers soi-même uniquement
    return 'Un envoi de test ne peut partir que vers votre propre adresse'
  }
  return null
}

function formatSiret(siret) {
  const d = String(siret || '').replace(/\s/g, '')
  return d.length === 14 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}` : d
}
function formatNda(nda) {
  const d = String(nda || '').replace(/\s/g, '')
  return d.length === 11 ? `${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)} ${d.slice(9)}` : d
}

// Pied de page légal + désabonnement (mentions de l'organisme)
function buildUnsubscribeFooter(org, token) {
  const linkDesabo = `${org.app_url}/api/unsubscribe?token=${token}`
  const mailDesabo = org.email ? `mailto:${org.email}?subject=D%C3%A9sabonnement` : null
  const mentions = [
    org.siret ? `SIRET : ${formatSiret(org.siret)}` : '',
    org.nda ? `NDA : ${formatNda(org.nda)}` : '',
    org.qualiopi ? 'Organisme certifié Qualiopi' : '',
  ].filter(Boolean).join(' &nbsp;|&nbsp; ')
  return `
    <table cellpadding="0" cellspacing="0" style="margin-top: 28px; border-top: 1px solid #e5e7eb; width: 100%; max-width: 650px; border-collapse: collapse;">
      <tr>
        <td style="padding-top: 12px;">
          <p style="font-family: Arial, sans-serif; font-size: 11px; color: #9ca3af; margin: 0 0 6px 0; line-height: 1.6;">
            <strong style="color: #6b7280;">${org.legal_name || org.name}</strong>${org.addressLine ? `, ${org.addressLine}` : ''}${mentions ? `<br>${mentions}` : ''}
          </p>
          <p style="font-family: Arial, sans-serif; font-size: 11px; color: #9ca3af; margin: 0; line-height: 1.6;">
            Vous recevez cet email car votre entreprise correspond à notre domaine d'activité.
            Pour ne plus recevoir nos communications :
            <a href="${linkDesabo}" style="color: #6b7280; text-decoration: underline;">Se désabonner en un clic</a>
            ${mailDesabo ? `&nbsp;&middot;&nbsp; <a href="${mailDesabo}" style="color: #6b7280; text-decoration: underline;">Nous écrire directement</a>` : ''}
          </p>
        </td>
      </tr>
    </table>
  `
}

async function markSendError(sendId, message) {
  try {
    await supabase.from('mailing_sends').update({ status: 'error', error_message: String(message || '').substring(0, 500) }).eq('id', sendId)
  } catch (e) {
    console.error('markSendError :', e.message)
  }
}

async function handler(req, res) {
  const internal = req.internal === true
  if (!internal) {
    const ctx = await requireRight(req, res, 'communication.campagnes.gerer', SALES, SALES)
    if (!ctx) return
    req.user = ctx.user
    req.profile = ctx.profile
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })

  const { send_id, to, subject, body_html, sender_email, unsubscribe_token, attachments, campaign_id } = req.body || {}
  if (!send_id || !to || !subject || !body_html || !unsubscribe_token) {
    return res.status(400).json({ error: 'Paramètres manquants : send_id, to, subject, body_html, unsubscribe_token requis' })
  }

  // Cohérence de l'envoi (l'appel interne de mailing-cron vient d'une réservation en base : contrôle aussi, sans test)
  const callerEmail = internal ? null : (req.user?.email || req.profile?.email || null)
  const sendError = await checkSend({ send_id, to, campaign_id, unsubscribe_token }, callerEmail)
  if (sendError) return res.status(400).json({ error: sendError })
  const trusted = internal || ADMINS.includes(req.profile?.role)

  let transporter = null
  try {
    const org = await getOrg(supabase)
    const mailer = await pickMailer(req.user?.id, org, sender_email, trusted)
    if (mailer.error) {
      await markSendError(send_id, mailer.error)
      return res.status(400).json({ error: mailer.error })
    }
    const { emailConfig } = mailer
    transporter = mailer.transporter
    const sender = await getSender(supabase, emailConfig.email)
    const senderEmail = emailConfig.email

    const baseHTML = wrapEmailHTML(body_html, sender, org)
    const footerHTML = buildUnsubscribeFooter(org, unsubscribe_token)
    const lastDivIdx = baseHTML.lastIndexOf('</div>')
    const fullHTML = lastDivIdx !== -1 ? baseHTML.slice(0, lastDivIdx) + footerHTML + baseHTML.slice(lastDivIdx) : baseHTML + footerHTML

    // Identifiant de message stable pour reconnaître les réponses (mailing-replies-cron) ; les tests n'en ont pas
    const isRealSend = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(send_id))
    const domain = senderEmail.split('@')[1] || 'localhost'
    const messageId = isRealSend ? `<mailing-${String(send_id).toLowerCase()}@${domain}>` : undefined

    // Désabonnement en un clic par la messagerie (RFC 8058) : uniquement pour les vrais envois
    const unsubHeaders = isRealSend && org.app_url
      ? {
          'List-Unsubscribe': `<${org.app_url}/api/unsubscribe?token=${encodeURIComponent(unsubscribe_token)}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        }
      : null

    const mailOptions = {
      ...(messageId ? { messageId } : {}),
      ...(unsubHeaders ? { headers: unsubHeaders } : {}),
      from: `"${org.name}" <${senderEmail}>`,
      replyTo: `"${sender.name}" <${senderEmail}>`,
      to,
      subject,
      html: fullHTML,
      attachments: [],
    }
    if (Array.isArray(attachments)) {
      for (const att of attachments) {
        if (att.base64 && att.filename) {
          mailOptions.attachments.push({ filename: att.filename, content: Buffer.from(att.base64, 'base64'), contentType: att.contentType || 'application/octet-stream' })
        }
      }
    }

    await sendWithRetry(transporter, mailOptions, 3)
    try { transporter.close() } catch {}

    await supabase.from('mailing_sends')
      .update({ status: 'sent', sent_at: new Date().toISOString(), ...(messageId ? { message_id: messageId } : {}) })
      .eq('id', send_id)

    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('Envoi campagne :', error.message)
    if (transporter) try { transporter.close() } catch {}
    await markSendError(send_id, error.message)
    return res.status(500).json({ error: error.message || 'Erreur lors de l\'envoi' })
  }
}

export default withErrorLog(handler, 'send-mailing-single')
