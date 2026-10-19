// api/send-invoices-comptable.js
// Envoi mensuel des factures clients (PDF) + récap au comptable

import { getSupabaseAdmin, getMailer, sendWithRetry, buildSignatureHTML, getOrg, getSender } from './_lib/mailer.js'
import { loadTeam, payerLabel } from './_lib/team.js'
import { getComptableConfig } from './_lib/comptable.js'
import { requireRight, FINANCE } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
}

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
    const { userId, invoices, attachments, monthLabel, notes } = req.body

    // invoices = [{ id, reference, type, client_name, invoice_date, due_date, total_ht, total_tva, total_ttc, amount_paid, amount_due, status, tva_applicable, tvaByRate }]
    // attachments = [{ filename, base64, contentType }]

    if (!userId || !invoices?.length) {
      return res.status(400).json({ error: 'userId et invoices requis' })
    }

    const supabase = getSupabaseAdmin()

    // 0. Destinataire comptable (paramètres de l'organisme), bloquant si non configuré
    const comptable = await getComptableConfig(supabase)
    if (comptable.error) {
      return res.status(400).json({ error: comptable.error })
    }

    // 1. Compte d'envoi de l'utilisateur (adresse d'envoi par défaut de Paramètres si elle lui appartient)
    const orgForMail = await getOrg(supabase)
    const mailerResult = await getMailer(supabase, req.user.id, { preferEmail: orgForMail.email_default_sender })
    if (mailerResult.error) {
      return res.status(400).json({ error: mailerResult.error })
    }
    transporter = mailerResult.transporter
    const fromEmail = mailerResult.fromEmail

    // 2. Calculs récap
    const facturesOnly = invoices.filter(i => i.type !== 'credit_note')
    const avoirs = invoices.filter(i => i.type === 'credit_note')

    const totalHT = facturesOnly.reduce((s, i) => s + (i.total_ht || 0), 0)
    const totalTVA = facturesOnly.reduce((s, i) => s + (i.total_tva || 0), 0)
    const totalTTC = facturesOnly.reduce((s, i) => s + (i.total_ttc || 0), 0)

    const avoirsHT = avoirs.reduce((s, i) => s + (i.total_ht || 0), 0)
    const avoirsTVA = avoirs.reduce((s, i) => s + (i.total_tva || 0), 0)
    const avoirsTTC = avoirs.reduce((s, i) => s + (i.total_ttc || 0), 0)

    // Regrouper TVA par taux
    const tvaGlobal = {}
    invoices.forEach(i => {
      if (!i.tvaByRate) return
      const sign = i.type === 'credit_note' ? -1 : 1
      Object.entries(i.tvaByRate).forEach(([rate, data]) => {
        if (!tvaGlobal[rate]) tvaGlobal[rate] = { base: 0, tva: 0 }
        tvaGlobal[rate].base += (data.base || 0) * sign
        tvaGlobal[rate].tva += (data.tva || 0) * sign
      })
    })

    // Factures en retard
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const overdue = invoices.filter(i => {
      if (i.type === 'credit_note') return false
      return (i.status === 'overdue' || (i.status === 'sent' && i.due_date && new Date(i.due_date) < today))
    })

    // 3. Construire le HTML
    const fmt = (n) => (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : '-'

    const STATUS_LABELS = {
      draft: 'Brouillon', sent: 'Envoyée', due: 'À régler', overdue: 'En retard',
      partial: 'Partiel', paid: 'Payée', cancelled: 'Annulée', credited: 'Annulée par avoir'
    }
    const STATUS_COLORS = {
      paid: '#059669', overdue: '#dc2626', partial: '#ea580c', sent: '#2563eb', due: '#ca8a04', draft: '#6b7280', cancelled: '#9ca3af', credited: '#9ca3af'
    }

    // Tableau factures
    let factureRows = ''
    for (const inv of invoices) {
      const isCr = inv.type === 'credit_note'
      const stLabel = isCr ? 'Avoir' : (STATUS_LABELS[inv.status] || inv.status)
      const stColor = isCr ? '#7c3aed' : (STATUS_COLORS[inv.status] || '#6b7280')
      const exoLabel = inv.tva_applicable === false ? '<br><em style="font-size:10px;color:#6b7280;">Exo TVA art. 261-4-4°a</em>' : ''

      factureRows += `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:6px 8px;font-size:12px;font-weight:bold;white-space:nowrap;">${inv.reference}${exoLabel}</td>
          <td style="padding:6px 8px;font-size:12px;">${inv.client_name || '-'}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:center;">${fmtDate(inv.invoice_date)}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:center;">${fmtDate(inv.due_date)}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:right;">${fmt(inv.total_ht)}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:right;">${fmt(inv.total_tva)}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:right;font-weight:bold;">${fmt(inv.total_ttc)}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:right;">${fmt(inv.amount_paid)}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:center;">
            <span style="color:${stColor};font-weight:bold;">${stLabel}</span>
          </td>
        </tr>`
    }

    // Tableau TVA
    let tvaRows = ''
    const tvaRates = Object.keys(tvaGlobal).sort((a, b) => parseFloat(a) - parseFloat(b))
    for (const rate of tvaRates) {
      const r = parseFloat(rate)
      tvaRows += `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:6px 12px;font-size:12px;">TVA ${r}%</td>
          <td style="padding:6px 12px;font-size:12px;text-align:right;">${fmt(tvaGlobal[rate].base)}</td>
          <td style="padding:6px 12px;font-size:12px;text-align:right;font-weight:bold;">${fmt(tvaGlobal[rate].tva)}</td>
        </tr>`
    }

    // Exonérées (factures sans TVA)
    const exoInvoices = invoices.filter(i => i.tva_applicable === false && i.type !== 'credit_note')
    const exoTotal = exoInvoices.reduce((s, i) => s + (i.total_ht || 0), 0)
    if (exoTotal > 0) {
      tvaRows += `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:6px 12px;font-size:12px;">Exonéré (art. 261-4-4°a CGI)</td>
          <td style="padding:6px 12px;font-size:12px;text-align:right;">${fmt(exoTotal)}</td>
          <td style="padding:6px 12px;font-size:12px;text-align:right;font-weight:bold;">0,00 €</td>
        </tr>`
    }

    // Section retard
    let overdueSection = ''
    if (overdue.length > 0) {
      const overdueTotal = overdue.reduce((s, i) => s + (i.amount_due || 0), 0)
      let overdueRows = ''
      for (const inv of overdue) {
        const dueDate = new Date(inv.due_date)
        const daysLate = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24))
        overdueRows += `
          <tr style="border-bottom:1px solid #fecaca;">
            <td style="padding:6px 8px;font-size:12px;font-weight:bold;">${inv.reference}</td>
            <td style="padding:6px 8px;font-size:12px;">${inv.client_name}</td>
            <td style="padding:6px 8px;font-size:12px;text-align:center;">${fmtDate(inv.due_date)}</td>
            <td style="padding:6px 8px;font-size:12px;text-align:right;color:#dc2626;font-weight:bold;">${fmt(inv.amount_due)}</td>
            <td style="padding:6px 8px;font-size:12px;text-align:center;color:#dc2626;font-weight:bold;">${daysLate}j</td>
          </tr>`
      }
      overdueSection = `
        <div style="margin-top:20px;padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;">
          <h3 style="color:#dc2626;margin:0 0 8px 0;font-size:14px;">⚠️ Factures en retard de paiement (${overdue.length})</h3>
          <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:#fee2e2;">
                <th style="padding:6px 8px;font-size:11px;text-align:left;">Référence</th>
                <th style="padding:6px 8px;font-size:11px;text-align:left;">Client</th>
                <th style="padding:6px 8px;font-size:11px;text-align:center;">Échéance</th>
                <th style="padding:6px 8px;font-size:11px;text-align:right;">Reste dû</th>
                <th style="padding:6px 8px;font-size:11px;text-align:center;">Retard</th>
              </tr>
            </thead>
            <tbody>${overdueRows}</tbody>
            <tfoot>
              <tr style="background:#fee2e2;font-weight:bold;">
                <td colspan="3" style="padding:6px 8px;font-size:12px;">Total impayé</td>
                <td style="padding:6px 8px;font-size:12px;text-align:right;color:#dc2626;">${fmt(overdueTotal)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>`
    }

    const notesHtml = notes ? `<p style="margin:16px 0;padding:12px;background:#f3f4f6;border-radius:6px;font-size:13px;"><strong>📝 Notes :</strong><br>${notes.replace(/\n/g, '<br>')}</p>` : ''
    const todayStr = new Date().toLocaleDateString('fr-FR')

    // Résumé avoirs si présents
    const avoirsLine = avoirs.length > 0
      ? `<p style="margin:8px 0;font-size:13px;color:#7c3aed;">📌 Dont ${avoirs.length} avoir(s) : HT ${fmt(avoirsHT)} • TVA ${fmt(avoirsTVA)} • TTC ${fmt(avoirsTTC)}</p>`
      : ''

    const netHT = totalHT - Math.abs(avoirsHT)
    const netTVA = totalTVA - Math.abs(avoirsTVA)
    const netTTC = totalTTC - Math.abs(avoirsTTC)

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;max-width:900px;">
        <h2 style="color:#1a3a4a;margin-bottom:4px;">🧾 Récapitulatif factures clients — ${monthLabel || 'Mois en cours'}</h2>
        <p style="color:#6b7280;font-size:13px;margin-top:0;">
          Envoyé le ${todayStr} • ${facturesOnly.length} facture(s)${avoirs.length > 0 ? ` + ${avoirs.length} avoir(s)` : ''} • ${(attachments || []).length} PDF joint(s)
        </p>

        ${notesHtml}

        <!-- Tableau des factures -->
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #d1d5db;border-radius:6px;margin-top:12px;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:8px;font-size:11px;text-align:left;color:#374151;border-bottom:2px solid #d1d5db;">Référence</th>
              <th style="padding:8px;font-size:11px;text-align:left;color:#374151;border-bottom:2px solid #d1d5db;">Client</th>
              <th style="padding:8px;font-size:11px;text-align:center;color:#374151;border-bottom:2px solid #d1d5db;">Date</th>
              <th style="padding:8px;font-size:11px;text-align:center;color:#374151;border-bottom:2px solid #d1d5db;">Échéance</th>
              <th style="padding:8px;font-size:11px;text-align:right;color:#374151;border-bottom:2px solid #d1d5db;">HT</th>
              <th style="padding:8px;font-size:11px;text-align:right;color:#374151;border-bottom:2px solid #d1d5db;">TVA</th>
              <th style="padding:8px;font-size:11px;text-align:right;color:#374151;border-bottom:2px solid #d1d5db;">TTC</th>
              <th style="padding:8px;font-size:11px;text-align:right;color:#374151;border-bottom:2px solid #d1d5db;">Réglé</th>
              <th style="padding:8px;font-size:11px;text-align:center;color:#374151;border-bottom:2px solid #d1d5db;">Statut</th>
            </tr>
          </thead>
          <tbody>
            ${factureRows}
          </tbody>
          <tfoot>
            <tr style="background:#f0fdf4;font-weight:bold;">
              <td colspan="4" style="padding:8px;font-size:12px;">TOTAL FACTURES (${facturesOnly.length})</td>
              <td style="padding:8px;font-size:12px;text-align:right;">${fmt(totalHT)}</td>
              <td style="padding:8px;font-size:12px;text-align:right;">${fmt(totalTVA)}</td>
              <td style="padding:8px;font-size:12px;text-align:right;">${fmt(totalTTC)}</td>
              <td colspan="2"></td>
            </tr>
            ${avoirs.length > 0 ? `
            <tr style="background:#faf5ff;font-weight:bold;">
              <td colspan="4" style="padding:8px;font-size:12px;color:#7c3aed;">TOTAL AVOIRS (${avoirs.length})</td>
              <td style="padding:8px;font-size:12px;text-align:right;color:#7c3aed;">${fmt(avoirsHT)}</td>
              <td style="padding:8px;font-size:12px;text-align:right;color:#7c3aed;">${fmt(avoirsTVA)}</td>
              <td style="padding:8px;font-size:12px;text-align:right;color:#7c3aed;">${fmt(avoirsTTC)}</td>
              <td colspan="2"></td>
            </tr>
            <tr style="background:#dbeafe;font-weight:bold;">
              <td colspan="4" style="padding:8px;font-size:13px;color:#1e40af;">NET</td>
              <td style="padding:8px;font-size:13px;text-align:right;color:#1e40af;">${fmt(netHT)}</td>
              <td style="padding:8px;font-size:13px;text-align:right;color:#1e40af;">${fmt(netTVA)}</td>
              <td style="padding:8px;font-size:13px;text-align:right;color:#1e40af;">${fmt(netTTC)}</td>
              <td colspan="2"></td>
            </tr>` : ''}
          </tfoot>
        </table>

        ${avoirsLine}

        <!-- Assiettes de TVA -->
        ${tvaRows ? `
        <h3 style="color:#1a3a4a;margin:20px 0 8px;font-size:14px;">📊 Ventilation TVA</h3>
        <table cellpadding="0" cellspacing="0" style="width:auto;border-collapse:collapse;border:1px solid #d1d5db;border-radius:6px;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:6px 12px;font-size:11px;text-align:left;border-bottom:2px solid #d1d5db;">Taux</th>
              <th style="padding:6px 12px;font-size:11px;text-align:right;border-bottom:2px solid #d1d5db;">Base HT</th>
              <th style="padding:6px 12px;font-size:11px;text-align:right;border-bottom:2px solid #d1d5db;">Montant TVA</th>
            </tr>
          </thead>
          <tbody>${tvaRows}</tbody>
          <tfoot>
            <tr style="background:#f0fdf4;font-weight:bold;">
              <td style="padding:6px 12px;font-size:12px;">Total</td>
              <td style="padding:6px 12px;font-size:12px;text-align:right;">${fmt(tvaRates.reduce((s, r) => s + tvaGlobal[r].base, 0) + exoTotal)}</td>
              <td style="padding:6px 12px;font-size:12px;text-align:right;">${fmt(tvaRates.reduce((s, r) => s + tvaGlobal[r].tva, 0))}</td>
            </tr>
          </tfoot>
        </table>` : ''}

        ${overdueSection}

        <p style="color:#9ca3af;font-size:11px;margin-top:20px;">
          Généré automatiquement par ${orgForMail.app_name || orgForMail.name} (module Facturation)
        </p>
      </div>
      ${buildSignatureHTML(await getSender(supabase, fromEmail), orgForMail)}
    `

    // 4. Préparer les PJ (PDF base64 → Buffer)
    const mailAttachments = (attachments || []).map(att => ({
      filename: att.filename,
      content: Buffer.from(att.base64, 'base64'),
      contentType: att.contentType || 'application/pdf'
    }))

    // 5. Envoyer l'email
    const subject = `[${orgForMail.name}] Factures clients — ${monthLabel || 'Récap'} (${facturesOnly.length} facture(s)${overdue.length > 0 ? `, ${overdue.length} en retard` : ''})`

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

    // 6. Marquer les factures comme envoyées
    const now = new Date().toISOString()
    const invoiceIds = invoices.map(i => i.id)
    await supabase
      .from('invoices')
      .update({ sent_to_comptable: true, sent_to_comptable_at: now })
      .in('id', invoiceIds)

    // 7. Historique
    await supabase.from('invoice_emails_sent').insert({
      sent_by: fromEmail,
      to_email: comptable.to,
      cc_email: comptable.cc,
      subject,
      month_label: monthLabel || null,
      nb_invoices: facturesOnly.length,
      nb_overdue: overdue.length,
      total_ht: totalHT,
      total_tva: totalTVA,
      total_ttc: totalTTC,
      invoice_ids: invoiceIds,
      notes: notes || null,
      message_id: info.messageId,
      status: 'sent'
    })

    // 8. Cleanup
    try { transporter.close() } catch {}

    return res.status(200).json({
      success: true,
      message: `Email envoyé avec ${facturesOnly.length} facture(s)${avoirs.length > 0 ? ` + ${avoirs.length} avoir(s)` : ''} et ${mailAttachments.length} PDF`,
      messageId: info.messageId,
      totals: { ht: totalHT, tva: totalTVA, ttc: totalTTC, overdue: overdue.length }
    })

  } catch (error) {
    console.error('Erreur envoi factures comptable:', error)
    if (transporter) { try { transporter.close() } catch {} }
    return res.status(500).json({ error: error.message })
  }
}

export default withErrorLog(handler, 'send-invoices-comptable')
