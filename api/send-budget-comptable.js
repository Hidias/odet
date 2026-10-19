// api/send-budget-comptable.js
// Envoi hebdomadaire des factures + récap au comptable

import { getSupabaseAdmin, getMailer, sendWithRetry, buildSignatureHTML, getOrg, getSender } from './_lib/mailer.js'
import { loadTeam, payerLabel } from './_lib/team.js'
import { getComptableConfig } from './_lib/comptable.js'
import { requireRight, FINANCE } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

async function handler(req, res) {
  const ctx = await requireRight(req, res, 'facturation.export.comptable', FINANCE, FINANCE)
  if (!ctx) return
  req.user = ctx.user
  req.profile = ctx.profile
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let transporter = null

  try {
    const { userId, transactionIds, notes } = req.body

    if (!userId || !transactionIds?.length) {
      return res.status(400).json({ error: 'userId et transactionIds requis' })
    }

    const supabase = getSupabaseAdmin()

    // 0. Destinataire comptable (paramètres de l'organisme), bloquant si non configuré
    const comptable = await getComptableConfig(supabase)
    if (comptable.error) {
      return res.status(400).json({ error: comptable.error })
    }

    // 1. Récupérer le mailer de l'utilisateur
    const orgForMail = await getOrg(supabase)
    const mailerResult = await getMailer(supabase, req.user.id)
    if (mailerResult.error) {
      return res.status(400).json({ error: mailerResult.error })
    }
    transporter = mailerResult.transporter
    const fromEmail = mailerResult.fromEmail

    // 2. Récupérer les transactions sélectionnées
    const { data: fetched, error: txError } = await supabase
      .from('budget_transactions')
      .select('*')
      .in('id', transactionIds)
      .order('date', { ascending: true })

    // La clé serveur contourne la RLS : on réapplique la règle des opérations privées
    // (une opération privée n'est visible et transmissible que par son propriétaire)
    const callerEmail = String(req.user.email || req.profile?.email || '').toLowerCase()
    const transactions = (fetched || []).filter((tx) => !tx.is_private || String(tx.private_owner || '').toLowerCase() === callerEmail)
    if (txError || !transactions.length) {
      return res.status(400).json({ error: 'Transactions non trouvées' })
    }
    // Seules les opérations autorisées sont jointes, envoyées et marquées
    const allowedIds = transactions.map((tx) => tx.id)

    // 3. Récupérer toutes les pièces jointes
    const { data: allReceipts } = await supabase
      .from('budget_receipts')
      .select('*')
      .in('transaction_id', allowedIds)

    const receiptsByTx = {}
    ;(allReceipts || []).forEach(r => {
      if (!receiptsByTx[r.transaction_id]) receiptsByTx[r.transaction_id] = []
      receiptsByTx[r.transaction_id].push(r)
    })

    // 4. Télécharger les fichiers depuis Supabase Storage
    const mailAttachments = []
    for (const receipt of (allReceipts || [])) {
      try {
        const { data: signedUrlData, error: signError } = await supabase.storage
          .from('budget-receipts')
          .createSignedUrl(receipt.file_path, 120)

        if (signError || !signedUrlData?.signedUrl) {
          console.error('Erreur URL signée:', receipt.file_path, signError)
          continue
        }

        const fileResponse = await fetch(signedUrlData.signedUrl)
        if (!fileResponse.ok) continue

        const fileBuffer = Buffer.from(await fileResponse.arrayBuffer())
        mailAttachments.push({
          filename: receipt.file_name,
          content: fileBuffer,
          contentType: receipt.file_type || 'application/octet-stream'
        })
        console.log('✅ PJ récupérée:', receipt.file_name, fileBuffer.length, 'bytes')
      } catch (e) {
        console.error('Erreur récupération PJ:', e.message)
      }
    }

    // 5. Construire le tableau récapitulatif HTML
    const totalDebit = transactions.reduce((s, tx) => s + (tx.debit || 0), 0)
    const totalCredit = transactions.reduce((s, tx) => s + (tx.credit || 0), 0)
    const nbPerso = transactions.filter(tx => tx.is_personal).length

    const formatMoney = (n) => n ? n.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €' : '-'
    const formatDate = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : '-'

    const team = await loadTeam(supabase)
    let tableRows = ''
    for (const tx of transactions) {
      const receipts = receiptsByTx[tx.id] || []
      const pjLabel = receipts.length > 0 ? `📎 ${receipts.length} PJ` : ''
      const persoLabel = tx.is_personal
        ? `<span style="color:#7c3aed;font-weight:bold;">PERSO ${payerLabel(team, tx.payer)}</span>`
        : '<span style="color:#059669;">Entreprise</span>'
      const noteLabel = tx.note_comptable ? `<br><em style="color:#6b7280;font-size:11px;">${tx.note_comptable}</em>` : ''

      tableRows += `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:6px 8px;font-size:12px;">${formatDate(tx.date)}</td>
          <td style="padding:6px 8px;font-size:12px;">${tx.description}${noteLabel}</td>
          <td style="padding:6px 8px;font-size:12px;">${tx.category_name || '-'}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:right;color:#dc2626;">${tx.debit > 0 ? formatMoney(tx.debit) : ''}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:right;color:#059669;">${tx.credit > 0 ? formatMoney(tx.credit) : ''}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:center;">${persoLabel}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:center;">${pjLabel}</td>
        </tr>`
    }

    const today = new Date().toLocaleDateString('fr-FR')
    const notesHtml = notes ? `<p style="margin:16px 0;padding:12px;background:#f3f4f6;border-radius:6px;font-size:13px;"><strong>📝 Notes :</strong><br>${notes.replace(/\n/g, '<br>')}</p>` : ''

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;max-width:800px;">
        <h2 style="color:#1a3a4a;margin-bottom:4px;">Récapitulatif comptable : ${orgForMail.name}</h2>
        <p style="color:#6b7280;font-size:13px;margin-top:0;">Envoyé le ${today} • ${transactions.length} opération(s) • ${mailAttachments.length} pièce(s) jointe(s)</p>

        ${notesHtml}

        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #d1d5db;border-radius:6px;margin-top:12px;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:8px;font-size:11px;text-align:left;color:#374151;border-bottom:2px solid #d1d5db;">Date</th>
              <th style="padding:8px;font-size:11px;text-align:left;color:#374151;border-bottom:2px solid #d1d5db;">Description</th>
              <th style="padding:8px;font-size:11px;text-align:left;color:#374151;border-bottom:2px solid #d1d5db;">Catégorie</th>
              <th style="padding:8px;font-size:11px;text-align:right;color:#374151;border-bottom:2px solid #d1d5db;">Débit</th>
              <th style="padding:8px;font-size:11px;text-align:right;color:#374151;border-bottom:2px solid #d1d5db;">Crédit</th>
              <th style="padding:8px;font-size:11px;text-align:center;color:#374151;border-bottom:2px solid #d1d5db;">Type</th>
              <th style="padding:8px;font-size:11px;text-align:center;color:#374151;border-bottom:2px solid #d1d5db;">PJ</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
          <tfoot>
            <tr style="background:#f0fdf4;font-weight:bold;">
              <td colspan="3" style="padding:8px;font-size:12px;">TOTAL (${transactions.length} opérations${nbPerso > 0 ? `, dont ${nbPerso} perso` : ''})</td>
              <td style="padding:8px;font-size:12px;text-align:right;color:#dc2626;">${formatMoney(totalDebit)}</td>
              <td style="padding:8px;font-size:12px;text-align:right;color:#059669;">${formatMoney(totalCredit)}</td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>

        <p style="color:#9ca3af;font-size:11px;margin-top:16px;">
          Généré automatiquement par ${orgForMail.app_name || orgForMail.name} (module Budget)
        </p>
      </div>
      ${buildSignatureHTML(await getSender(supabase, fromEmail), orgForMail)}
    `

    // 6. Préparer et envoyer l'email
    const subject = `[${orgForMail.name}] Pièces comptables — ${today} (${transactions.length} opérations)`

    const mailOptions = {
      from: `"${(orgForMail.name || '').replace(/"/g, '')}" <${fromEmail}>`,
      to: comptable.to,
      ...(comptable.cc ? { cc: comptable.cc } : {}),
      ...(comptable.bcc ? { bcc: comptable.bcc } : {}),
      subject,
      html: htmlBody,
      attachments: mailAttachments
    }

    const info = await sendWithRetry(transporter, mailOptions, 3)

    // 7. Marquer les transactions comme envoyées
    const now = new Date().toISOString()
    await supabase
      .from('budget_transactions')
      .update({ sent_to_comptable: true, sent_to_comptable_at: now })
      .in('id', allowedIds)

    // 8. Sauvegarder dans l'historique
    await supabase.from('budget_emails_sent').insert({
      sent_by: fromEmail,
      to_email: comptable.to,
      cc_email: comptable.cc,
      subject,
      nb_transactions: transactions.length,
      nb_receipts: mailAttachments.length,
      transaction_ids: allowedIds,
      notes: notes || null,
      message_id: info.messageId,
      status: 'sent'
    })

    // 9. Cleanup
    try { transporter.close() } catch {}

    return res.status(200).json({
      success: true,
      message: `Email envoyé au comptable (${comptable.to}) avec ${transactions.length} opérations et ${mailAttachments.length} PJ`,
      messageId: info.messageId
    })

  } catch (error) {
    console.error('Erreur envoi comptable:', error)
    if (transporter) { try { transporter.close() } catch {} }
    return res.status(500).json({ error: error.message })
  }
}

export default withErrorLog(handler, 'send-budget-comptable')
