// api/send-mailing-report.js
// ─────────────────────────────────────────────────────────────────────────────
// Envoi du rapport de fin de campagne mailing à l'expéditeur
// Appelé par Mailing.jsx une seule fois, quand la boucle d'envoi est terminée
//
// Actions :
//   1. Récupère les stats finales depuis mailing_sends
//   2. Construit un email HTML récapitulatif
//   3. Envoie à campaign.sender_email
//   4. Met à jour mailing_campaigns (status, sent_count, error_count, completed_at)
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin, getMailerByEmail, getOrg } from './_lib/mailer.js'
import { requireCronOrUser } from './_lib/auth.js'

export const config = { maxDuration: 20 }

const supabase = getSupabaseAdmin()


// ─── Construction du rapport HTML ────────────────────────────────────────────
function buildReportHTML(campaign, sends, org) {
  const sent      = sends.filter(s => s.status === 'sent')
  const errors    = sends.filter(s => s.status === 'error')
  const skipped   = sends.filter(s => s.status === 'skipped')
  const unsub     = sends.filter(s => s.unsubscribed_at)
  const total     = sends.length

  const dateStr = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })

  // ── Bloc erreurs détaillées ──
  let errorsBlock = ''
  if (errors.length > 0) {
    const rows = errors.map(e => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #fee2e2;font-size:13px;">${e.company_name || '—'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #fee2e2;font-size:13px;">${e.email}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #fee2e2;font-size:12px;color:#dc2626;">${e.error_message || 'Erreur inconnue'}</td>
      </tr>`).join('')

    errorsBlock = `
      <div style="margin-top:24px;">
        <p style="font-family:Arial,sans-serif;font-size:14px;font-weight:bold;color:#dc2626;margin:0 0 8px 0;">
          Erreurs d'envoi (${errors.length})
        </p>
        <table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;background:#fef2f2;border-radius:8px;overflow:hidden;">
          <thead>
            <tr>
              <th style="padding:8px 10px;text-align:left;font-size:12px;color:#991b1b;background:#fee2e2;">Entreprise</th>
              <th style="padding:8px 10px;text-align:left;font-size:12px;color:#991b1b;background:#fee2e2;">Email</th>
              <th style="padding:8px 10px;text-align:left;font-size:12px;color:#991b1b;background:#fee2e2;">Raison</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
  }

  // ── Liste des envois réussis (max 200 pour ne pas surcharger) ──
  const sentToShow = sent.slice(0, 200)
  const sentRows = sentToShow.map((s, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#fff'};">
      <td style="padding:5px 10px;font-size:12px;color:#374151;border-bottom:1px solid #f3f4f6;">${s.company_name || '—'}</td>
      <td style="padding:5px 10px;font-size:12px;color:#6b7280;border-bottom:1px solid #f3f4f6;">${s.email}</td>
    </tr>`).join('')

  const sentTableNote = sent.length > 200
    ? `<p style="font-size:11px;color:#9ca3af;margin:6px 0 0 0;">… et ${sent.length - 200} autres destinataires.</p>`
    : ''

  const sentBlock = sent.length > 0 ? `
    <div style="margin-top:24px;">
      <p style="font-family:Arial,sans-serif;font-size:14px;font-weight:bold;color:#059669;margin:0 0 8px 0;">
        Envois réussis (${sent.length})
      </p>
      <table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;">
        <thead>
          <tr>
            <th style="padding:8px 10px;text-align:left;font-size:12px;color:#065f46;background:#d1fae5;">Entreprise</th>
            <th style="padding:8px 10px;text-align:left;font-size:12px;color:#065f46;background:#d1fae5;">Email</th>
          </tr>
        </thead>
        <tbody>${sentRows}</tbody>
      </table>
      ${sentTableNote}
    </div>` : ''

  return `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:700px;">

      <table cellpadding="0" cellspacing="0" style="width:100%;background:#1a2e3d;border-radius:8px 8px 0 0;border-collapse:collapse;">
        <tr>
          <td style="padding:18px 24px;">
            <p style="margin:0;font-size:18px;font-weight:bold;color:#fff;">Rapport de campagne mailing</p>
            <p style="margin:4px 0 0 0;font-size:12px;color:rgba(255,255,255,0.6);">Terminée le ${dateStr}</p>
          </td>
        </tr>
      </table>

      <table cellpadding="0" cellspacing="0" style="width:100%;background:#f8f9fa;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;border-collapse:collapse;">
        <tr>
          <td style="padding:20px 24px;">

            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
              <tr>
                <td style="padding:4px 12px 4px 0;color:#6b7280;width:160px;">Campagne</td>
                <td style="padding:4px 0;font-weight:bold;color:#1a2e3d;">${campaign.name}</td>
              </tr>
              <tr>
                <td style="padding:4px 12px 4px 0;color:#6b7280;">Objet envoyé</td>
                <td style="padding:4px 0;">${campaign.subject}</td>
              </tr>
              <tr>
                <td style="padding:4px 12px 4px 0;color:#6b7280;">Expéditeur</td>
                <td style="padding:4px 0;">${campaign.sender_email}</td>
              </tr>
              <tr>
                <td style="padding:4px 12px 4px 0;color:#6b7280;">Signature</td>
                <td style="padding:4px 0;">${campaign.sender_email || ''}</td>
              </tr>
            </table>

            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="width:25%;padding:10px;background:#eff6ff;border-radius:8px;text-align:center;">
                  <p style="margin:0;font-size:11px;color:#1d4ed8;">Total</p>
                  <p style="margin:4px 0 0 0;font-size:26px;font-weight:bold;color:#1e3a8a;">${total}</p>
                </td>
                <td style="width:4%;"></td>
                <td style="width:25%;padding:10px;background:#ecfdf5;border-radius:8px;text-align:center;">
                  <p style="margin:0;font-size:11px;color:#059669;">Envoyés</p>
                  <p style="margin:4px 0 0 0;font-size:26px;font-weight:bold;color:#065f46;">${sent.length}</p>
                </td>
                <td style="width:4%;"></td>
                <td style="width:25%;padding:10px;background:#fef2f2;border-radius:8px;text-align:center;">
                  <p style="margin:0;font-size:11px;color:#dc2626;">Erreurs</p>
                  <p style="margin:4px 0 0 0;font-size:26px;font-weight:bold;color:#991b1b;">${errors.length}</p>
                </td>
                <td style="width:4%;"></td>
                <td style="width:13%;padding:10px;background:#f5f3ff;border-radius:8px;text-align:center;">
                  <p style="margin:0;font-size:11px;color:#7c3aed;">Désabo.</p>
                  <p style="margin:4px 0 0 0;font-size:26px;font-weight:bold;color:#5b21b6;">${unsub.length}</p>
                </td>
              </tr>
            </table>

            ${skipped.length > 0 ? `<p style="margin:12px 0 0 0;font-size:12px;color:#9ca3af;">${skipped.length} destinataires ignorés (do_not_call ou email vide).</p>` : ''}

          </td>
        </tr>
      </table>

      ${errorsBlock}
      ${sentBlock}

      <p style="margin-top:24px;font-size:11px;color:#9ca3af;">
        Ce rapport a été généré automatiquement par ${org.app_name || org.name}.
      </p>
    </div>
  `
}

// ─── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (!(await requireCronOrUser(req, res))) return
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { campaign_id } = req.body

  if (!campaign_id) {
    return res.status(400).json({ error: 'campaign_id requis' })
  }

  try {
    // ── 1. Récupérer la campagne ──
    const { data: campaign, error: campError } = await supabase
      .from('mailing_campaigns')
      .select('*')
      .eq('id', campaign_id)
      .maybeSingle()

    if (campError || !campaign) {
      return res.status(404).json({ error: 'Campagne introuvable' })
    }

    // ── 2. Récupérer tous les sends ──
    const { data: sends, error: sendsError } = await supabase
      .from('mailing_sends')
      .select('status, email, company_name, error_message, unsubscribed_at')
      .eq('campaign_id', campaign_id)

    if (sendsError) {
      return res.status(500).json({ error: 'Erreur lecture mailing_sends' })
    }

    const allSends = sends || []
    const sentCount   = allSends.filter(s => s.status === 'sent').length
    const errorCount  = allSends.filter(s => s.status === 'error').length

    // ── 3. Mettre à jour la campagne ──
    await supabase
      .from('mailing_campaigns')
      .update({
        status: 'terminée',
        sent_count: sentCount,
        error_count: errorCount,
        total_recipients: allSends.length,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaign_id)

    // ── 4. Construire et envoyer le rapport ──
    const org = await getOrg(supabase)
    const mailer = await getMailerByEmail(supabase, campaign.sender_email || org.email_default_sender)
    if (mailer.error) {
      // On ne bloque pas : la campagne est quand même marquée terminée
      return res.status(200).json({ success: true, warning: 'Rapport non envoyé : ' + mailer.error })
    }
    const { transporter, emailConfig } = mailer
    const reportHTML = buildReportHTML(campaign, allSends, org)

    await transporter.sendMail({
      from: `"${org.app_name || org.name}" <${emailConfig.email}>`,
      to: campaign.sender_email || emailConfig.email,
      subject: `Rapport campagne : ${campaign.name} (${sentCount} envoyés, ${errorCount} erreurs)`,
      html: reportHTML,
    })

    try { transporter.close() } catch {}

    return res.status(200).json({
      success: true,
      stats: { total: allSends.length, sent: sentCount, errors: errorCount }
    })

  } catch (error) {
    console.error('Erreur send-mailing-report:', error)
    return res.status(500).json({ error: error.message })
  }
}
