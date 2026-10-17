// api/unsubscribe.js
// ─────────────────────────────────────────────────────────────────────────────
// Endpoint PUBLIC (aucune auth requise) — géré par clic sur le lien de désabonnement
// dans les emails de campagne
//
// GET /api/unsubscribe?token=<uuid>
//
// Actions :
//   1. Retrouve la ligne mailing_sends via unsubscribe_token
//   2. Marque mailing_sends.unsubscribed_at
//   3. Marque la source comme do_not_call / do_not_mail selon la table source
//   4. Envoie une notification email à l'expéditeur de la campagne
//   5. Retourne une page HTML de confirmation (affichée dans le navigateur)
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'
import { getOrg, decrypt, createTransporter } from './_lib/mailer.js'
import { withErrorLog } from './_lib/errors.js'

export const config = { maxDuration: 15 }

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))

// Identité affichée sur les pages publiques : Paramètres de l'organisme, rien en dur
async function orgForPage() {
  try { return await getOrg(supabase) } catch { return {} }
}

function pageShell(org, title, body) {
  const nav = org.brand_nav || '#1C2024'
  const highlight = org.brand_highlight || '#D9A62E'
  const name = org.name || ''
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}${name ? ' | ' + esc(name) : ''}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; background: #f3f4f6; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: #fff; border-radius: 12px; padding: 40px 32px; max-width: 480px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); text-align: center; }
    h1 { font-size: 22px; color: ${nav}; margin-bottom: 12px; }
    p { font-size: 15px; color: #555; line-height: 1.6; margin-bottom: 16px; }
    .badge { display: inline-block; background: ${highlight}; color: ${nav}; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; padding: 4px 12px; border-radius: 20px; margin-bottom: 24px; }
    a { color: ${nav}; }
    .site { font-size: 13px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="card">
    ${name ? `<div class="badge">${esc(name)}${org.qualiopi ? ' · Certifié Qualiopi' : ''}</div>` : ''}
    ${body}
    ${org.website ? `<p class="site"><a href="${esc(org.website)}">${esc(org.websiteLabel || org.website)}</a></p>` : ''}
  </div>
</body>
</html>`
}

// ─── Page HTML de confirmation ────────────────────────────────────────────────
function confirmationPage(org, companyName, alreadyDone = false) {
  const title = alreadyDone ? 'Déjà désabonné' : 'Désabonnement confirmé'
  const who = `<strong>${esc(companyName || 'Votre entreprise')}</strong>`
  const contact = org.email ? `<br>Si vous changez d'avis, écrivez-nous à <a href="mailto:${esc(org.email)}">${esc(org.email)}</a>.` : ''
  const message = alreadyDone
    ? `${who} était déjà désabonnée de nos communications.`
    : `${who} ne recevra plus nos communications commerciales.${contact}`
  return pageShell(org, title, `<h1>${title}</h1><p>${message}</p>`)
}

// ─── Page d'erreur HTML ───────────────────────────────────────────────────────
function errorPage(org, message) {
  const contact = org.email ? `<p class="site">Contactez-nous : <a href="mailto:${esc(org.email)}">${esc(org.email)}</a></p>` : ''
  return pageShell(org, 'Lien invalide', `<h1 style="color:#dc2626;">Lien invalide</h1><p>${esc(message)}</p>${contact}`)
}

// ─── Notification email à l'expéditeur ───────────────────────────────────────
async function sendNotificationToSender(org, senderEmail, companyName, recipientEmail, campaignName) {
  try {
    const { data: configs } = await supabase
      .from('user_email_configs')
      .select('*')
      .eq('is_active', true)

    if (!configs || configs.length === 0) return

    const emailConfig =
      configs.find(c => c.email === senderEmail) ||
      configs.find(c => c.email === org.email_default_sender) ||
      configs[0]

    const transporter = createTransporter(emailConfig, decrypt(emailConfig.smtp_password_encrypted), supabase)

    const dateStr = new Date().toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
    })
    const fromName = (org.app_name || org.name || '').replace(/"/g, '')

    await transporter.sendMail({
      from: fromName ? `"${fromName}" <${emailConfig.email}>` : emailConfig.email,
      to: senderEmail,
      subject: `Désabonnement : ${companyName || recipientEmail}`,
      html: `
        <div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:500px;">
          <p style="margin:0 0 12px 0;"><strong>Un destinataire s'est désabonné de la campagne.</strong></p>
          <table style="border-collapse:collapse;width:100%;font-size:14px;">
            <tr><td style="padding:6px 12px 6px 0;color:#888;width:140px;">Entreprise</td><td style="padding:6px 0;font-weight:bold;">${esc(companyName || '-')}</td></tr>
            <tr><td style="padding:6px 12px 6px 0;color:#888;">Email</td><td style="padding:6px 0;">${esc(recipientEmail)}</td></tr>
            <tr><td style="padding:6px 12px 6px 0;color:#888;">Campagne</td><td style="padding:6px 0;">${esc(campaignName || '-')}</td></tr>
            <tr><td style="padding:6px 12px 6px 0;color:#888;">Date</td><td style="padding:6px 0;">${dateStr}</td></tr>
          </table>
          <p style="margin:16px 0 0 0;font-size:12px;color:#9ca3af;">
            Cette entreprise a été automatiquement ajoutée à la liste de non-sollicitation.
          </p>
        </div>
      `,
    })

    try { transporter.close() } catch {}
  } catch (err) {
    // Non bloquant : le désabonnement est déjà acté en base
    console.warn('Notification désabonnement échouée (non bloquant):', err.message)
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────
async function handler(req, res) {
  // Accepte GET uniquement (lien cliqué depuis un client email)
  const org = await orgForPage()
  if (req.method !== 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(405).send(errorPage(org, 'Méthode non autorisée.'))
  }

  const { token } = req.query

  if (!token || token.length < 30) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(400).send(errorPage(org, 'Ce lien de désabonnement est invalide ou expiré.'))
  }

  try {
    // ── 1. Trouver le send correspondant au token ──
    const { data: send, error: sendError } = await supabase
      .from('mailing_sends')
      .select('id, campaign_id, source, source_id, email, company_name, unsubscribed_at')
      .eq('unsubscribe_token', token)
      .maybeSingle()

    if (sendError || !send) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return res.status(404).send(errorPage(org, 'Ce lien de désabonnement est introuvable ou a déjà été supprimé.'))
    }

    // ── 2. Déjà désabonné ? ──
    if (send.unsubscribed_at) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return res.status(200).send(confirmationPage(org, send.company_name, true))
    }

    const now = new Date().toISOString()

    // ── 3. Marquer dans mailing_sends ──
    await supabase
      .from('mailing_sends')
      .update({ unsubscribed_at: now })
      .eq('id', send.id)

    // ── 4. Marquer la source comme do_not_contact ──
    if (send.source === 'prospection_massive' && send.source_id) {
      await supabase
        .from('prospection_massive')
        .update({ do_not_call: true, do_not_call_reason: 'Désabonnement mailing', do_not_call_at: now })
        .eq('id', send.source_id)
    } else if (send.source === 'clients' && send.source_id) {
      await supabase
        .from('clients')
        .update({ do_not_mail: true })
        .eq('id', send.source_id)
    }

    // ── 5. Récupérer le nom de la campagne + sender pour la notification ──
    const { data: campaign } = await supabase
      .from('mailing_campaigns')
      .select('name, sender_email')
      .eq('id', send.campaign_id)
      .maybeSingle()

    // ── 6. Notifier l'expéditeur (non bloquant) ──
    if (campaign?.sender_email) {
      await sendNotificationToSender(
        org,
        campaign.sender_email,
        send.company_name,
        send.email,
        campaign.name
      )
    }

    // ── 7. Page de confirmation ──
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(200).send(confirmationPage(org, send.company_name, false))

  } catch (error) {
    console.error('Erreur unsubscribe:', error)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(500).send(errorPage(org, 'Une erreur est survenue. Contactez-nous directement.'))
  }
}

export default withErrorLog(handler, 'unsubscribe')
