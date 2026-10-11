// api/send-statement-comptable.js
// Envoi d'un relevé bancaire (PDF) au cabinet comptable.
//
// Le destinataire est lu dans org_settings (helper partagé) : aucune adresse
// en dur, et refus d'envoi si aucun comptable n'est configuré.

import { getSupabaseAdmin, getMailer, sendWithRetry, buildSignatureHTML } from './_lib/mailer.js'
import { getComptableConfig } from './_lib/comptable.js'

export const config = {
  maxDuration: 60,
  api: { bodyParser: { sizeLimit: '15mb' } }
}

const fmt = (n) => (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

const fmtDateFR = (d) => {
  if (!d) return '-'
  const [y, m, day] = String(d).slice(0, 10).split('-')
  return (y && m && day) ? `${day}/${m}/${y}` : '-'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let transporter = null

  try {
    const { userId, statementId, notes } = req.body || {}

    if (!userId || !statementId) {
      return res.status(400).json({ error: 'userId et statementId requis' })
    }

    const supabase = getSupabaseAdmin()

    // 1. Destinataire comptable — bloquant si non configuré
    const comptable = await getComptableConfig(supabase)
    if (comptable.error) {
      return res.status(400).json({ error: comptable.error })
    }

    // 2. Relevé
    const { data: st, error: stErr } = await supabase
      .from('bank_statements')
      .select('*')
      .eq('id', statementId)
      .maybeSingle()

    if (stErr || !st) {
      return res.status(404).json({ error: 'Relevé introuvable' })
    }

    // 3. Mailer (forcer hicham.saidi@)
    const mailerResult = await getMailer(supabase, userId, { preferEmail: 'hicham.saidi@accessformation.pro' })
    if (mailerResult.error) {
      return res.status(400).json({ error: mailerResult.error })
    }
    transporter = mailerResult.transporter
    const fromEmail = mailerResult.fromEmail

    // 4. Télécharger le PDF depuis le bucket privé
    const { data: signed, error: signErr } = await supabase.storage
      .from('bank-statements')
      .createSignedUrl(st.file_path, 300)

    if (signErr || !signed?.signedUrl) {
      return res.status(500).json({ error: 'PDF du relevé introuvable dans le stockage' })
    }

    const pdfRes = await fetch(signed.signedUrl)
    if (!pdfRes.ok) {
      return res.status(500).json({ error: 'Téléchargement du PDF impossible' })
    }
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer())

    // 5. Corps du mail
    const periodeLabel = st.statement_number
      ? `n°${st.statement_number}/${st.statement_year}`
      : `arrêté au ${fmtDateFR(st.period_end)}`

    const notesHtml = notes
      ? `<p style="margin:16px 0;padding:12px;background:#f3f4f6;border-radius:6px;font-size:13px;"><strong>📝 Notes :</strong><br>${String(notes).replace(/\n/g, '<br>')}</p>`
      : ''

    const alerteHtml = st.arithmetic_ok === false
      ? `<p style="margin:12px 0;padding:10px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;font-size:12px;color:#b91c1c;">
           ⚠️ Le contrôle arithmétique de ce relevé n'est pas équilibré (écart de ${fmt(st.arithmetic_delta)}).
         </p>`
      : ''

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;max-width:700px;">
        <h2 style="color:#1a3a4a;margin-bottom:4px;">🏦 Relevé bancaire — ${periodeLabel}</h2>
        <p style="color:#6b7280;font-size:13px;margin-top:0;">
          ${st.account_label || 'Compte professionnel'} • arrêté au ${fmtDateFR(st.period_end)}
        </p>

        ${notesHtml}
        ${alerteHtml}

        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #d1d5db;border-radius:6px;margin-top:12px;">
          <tbody>
            <tr style="border-bottom:1px solid #e5e7eb;">
              <td style="padding:8px 12px;font-size:13px;color:#374151;">Ancien solde</td>
              <td style="padding:8px 12px;font-size:13px;text-align:right;font-family:monospace;">${fmt(st.opening_balance)}</td>
            </tr>
            <tr style="border-bottom:1px solid #e5e7eb;">
              <td style="padding:8px 12px;font-size:13px;color:#374151;">Total des débits</td>
              <td style="padding:8px 12px;font-size:13px;text-align:right;font-family:monospace;color:#dc2626;">${fmt(st.total_debits)}</td>
            </tr>
            <tr style="border-bottom:1px solid #e5e7eb;">
              <td style="padding:8px 12px;font-size:13px;color:#374151;">Total des crédits</td>
              <td style="padding:8px 12px;font-size:13px;text-align:right;font-family:monospace;color:#059669;">${fmt(st.total_credits)}</td>
            </tr>
            <tr style="background:#f0fdf4;">
              <td style="padding:10px 12px;font-size:14px;font-weight:bold;">Nouveau solde</td>
              <td style="padding:10px 12px;font-size:14px;text-align:right;font-family:monospace;font-weight:bold;color:${st.closing_balance < 0 ? '#dc2626' : '#059669'};">${fmt(st.closing_balance)}</td>
            </tr>
          </tbody>
        </table>

        <p style="color:#9ca3af;font-size:11px;margin-top:20px;">
          Le PDF original du relevé est joint à cet email.<br>
          Généré automatiquement par Access Campus — Module Budget
        </p>
      </div>
      ${buildSignatureHTML('Hicham')}
    `

    const subject = `[Access Formation] Relevé bancaire ${periodeLabel} — arrêté au ${fmtDateFR(st.period_end)}`

    const mailOptions = {
      from: `"Access Formation" <${fromEmail}>`,
      to: comptable.to,
      ...(comptable.cc ? { cc: comptable.cc } : {}),
      ...(comptable.bcc ? { bcc: comptable.bcc } : {}),
      subject,
      html: htmlBody,
      attachments: [{
        filename: st.file_name || `releve_${st.period_end}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }]
    }

    const info = await sendWithRetry(transporter, mailOptions, 3)

    // 6. Marquer comme envoyé
    await supabase
      .from('bank_statements')
      .update({ sent_to_comptable: true, sent_to_comptable_at: new Date().toISOString() })
      .eq('id', statementId)

    try { transporter.close() } catch {}

    return res.status(200).json({
      success: true,
      message: `Relevé ${periodeLabel} envoyé au comptable (${comptable.to})`,
      messageId: info.messageId,
    })

  } catch (error) {
    console.error('send-statement-comptable error:', error)
    if (transporter) { try { transporter.close() } catch {} }
    return res.status(500).json({ error: error.message })
  }
}
