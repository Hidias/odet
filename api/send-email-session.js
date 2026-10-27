// api/send-email-session.js
// Envoyer les documents de session (avant/après formation) par email

import { getSupabaseAdmin, getMailer, sendWithRetry, getOrg, getSender, buildSignatureHTML, wrapEmailHTML, finirParCordialement } from './_lib/mailer.js'
import { mot } from '../src/core/genre.js'
import { requireRight, OFFICE_WRITE, isSafeStoragePath } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

const supabase = getSupabaseAdmin()




async function handler(req, res) {
  const ctx = await requireRight(req, res, ['formation.convocations.envoyer', 'formation.sessions.modifier_siennes'], OFFICE_WRITE, OFFICE_WRITE)
  if (!ctx) return
  req.user = ctx.user
  req.profile = ctx.profile
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let transporter = null

  try {
    const { userId, to, subject, body, attachmentPaths = [], sessionId, emailType, convocationsStagiaires = [] } = req.body

    if (!userId || !to || !subject || !body || !sessionId || !emailType) {
      return res.status(400).json({ error: 'Paramètres manquants' })
    }

    // Pièces jointes : uniquement des fichiers déposés pour CETTE session (bucket session-email-docs, « <sessionId>/... »)
    if (!Array.isArray(attachmentPaths) || attachmentPaths.some((it) => !isSafeStoragePath(it?.path, `${sessionId}/`))) {
      return res.status(400).json({ error: 'Pièce jointe non autorisée pour cette session' })
    }
    // Convocation personnelle de chaque stagiaire (22/10, décision de H) : uniquement un fichier déjà joint au message
    if (!Array.isArray(convocationsStagiaires) || convocationsStagiaires.length > 60
        || convocationsStagiaires.some((c) => !c?.traineeId || !attachmentPaths.some((a) => a.path === c.path))) {
      return res.status(400).json({ error: 'Convocations des stagiaires invalides' })
    }

    // 1. Configuration SMTP de l'utilisateur connecté et transporteur (redirection démo incluse)
    // Toujours la boîte de l'utilisateur connecté (userId du corps ignoré)
    const mailer = await getMailer(supabase, req.user.id, { envoiReel: true })
    if (mailer.error) {
      return res.status(400).json({ error: 'Configuration email non trouvée. Configurez votre email dans Paramètres.' })
    }
    const emailConfig = mailer.emailConfig
    transporter = mailer.transporter
    const org = await getOrg(supabase)
    const sender = await getSender(supabase, emailConfig.email)

    // 4. Récupérer les fichiers depuis Supabase Storage via URL signée
    const mailAttachments = []
    for (const item of attachmentPaths) {
      try {
        // Générer une URL signée (valable 60s)
        const { data: signedUrlData, error: signError } = await supabase.storage
          .from('session-email-docs')
          .createSignedUrl(item.path, 60)

        if (signError || !signedUrlData?.signedUrl) {
          console.error('Erreur URL signée pour:', item.path, signError)
          continue
        }

        // Fetch le fichier via l'URL signée
        const fileResponse = await fetch(signedUrlData.signedUrl)
        if (!fileResponse.ok) {
          console.error('Erreur fetch fichier:', item.path, fileResponse.status)
          continue
        }

        const fileBuffer = Buffer.from(await fileResponse.arrayBuffer())
        mailAttachments.push({
          filename: item.filename,
          content: fileBuffer,
          contentType: 'application/pdf'
        })
        console.log('Fichier récupéré:', item.filename, fileBuffer.length, 'bytes')
      } catch (e) {
        console.error('Erreur récupération fichier:', item.path, e.message)
      }
    }

    // 5. Préparer le corps avec signature pro
    let htmlBody = body.replace(/\n/g, '<br>')
    
    htmlBody += `${finirParCordialement(body) ? '' : '<br><br><p style="margin: 0;">Bien cordialement,</p>'}${buildSignatureHTML(sender, org)}`
    
    const mailOptions = {
      from: `"${sender.name}" <${emailConfig.email}>`,
      to: to,
      bcc: org.email_bcc || undefined,
      subject: subject,
      text: body,
      html: htmlBody,
      attachments: mailAttachments
    }

    // 6. Envoyer avec retry
    const info = await sendWithRetry(transporter, mailOptions, 3)

    // 7. Sauvegarder dans l'historique
    const { error: historyError } = await supabase
      .from('session_emails_sent')
      .insert([{
        session_id: sessionId,
        email_type: emailType,
        to_email: to,
        to_name: to.split('@')[0],
        subject: subject,
        body: body,
        resend_email_id: info.messageId,
        attachments: attachmentPaths.map(a => ({ name: a.filename, size: 0 })),
        status: 'sent',
        created_by: userId
      }])

    if (historyError) {
      console.error('Erreur sauvegarde historique:', historyError)
    }

    // 7b. Traçabilité CRM : ajouter dans l'historique client
    try {
      const { data: sessionData } = await supabase.from('sessions').select('client_id, reference').eq('id', sessionId).single()
      if (sessionData?.client_id) {
        const now = new Date()
        const dateStr = now.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })
        const timeStr = now.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })
        const authorName = sender.name
        const typeLabel = emailType === 'before' ? 'avant' : 'après'

        await supabase.from('client_interactions').insert({
          client_id: sessionData.client_id,
          type: 'email',
          title: `Email ${typeLabel} formation envoyé (${sessionData.reference || ''})`,
          content: `Email ${typeLabel} formation envoyé par ${authorName} le ${dateStr} à ${timeStr}\nSession : ${sessionData.reference || sessionId}\nDestinataire : ${to}\nObjet : ${subject}`,
          author: authorName,
        })
        console.log('Traçabilité CRM ajoutée pour client:', sessionData.client_id)
      }
    } catch (traceErr) {
      console.error('Erreur traçabilité CRM (non bloquant):', traceErr.message)
    }

    // 7c. Convocation envoyée aussi à chaque stagiaire qui a un e-mail (le contact de l'entreprise a déjà tout reçu)
    const stagiaires = { envoyes: 0, echecs: [] }
    if (emailType === 'before' && convocationsStagiaires.length) {
      const ids = convocationsStagiaires.map((c) => c.traineeId)
      const { data: inscrits } = await supabase.from('session_trainees')
        .select('trainee_id, trainees(first_name, last_name, email, gender)')
        .eq('session_id', sessionId).in('trainee_id', ids)
      const { data: ses } = await supabase.from('sessions')
        .select('reference, start_date, end_date, start_time, location_name, location_city, courses(title)').eq('id', sessionId).single()
      const titre = ses?.courses?.title || 'votre formation'
      const dateFr = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '')
      const quand = ses?.start_date ? (ses.end_date && ses.end_date !== ses.start_date ? `du ${dateFr(ses.start_date)} au ${dateFr(ses.end_date)}` : `le ${dateFr(ses.start_date)}`) : ''
      const lieu = [ses?.location_name, ses?.location_city].filter(Boolean).join(', ')
      for (const c of convocationsStagiaires) {
        const t = (inscrits || []).find((i) => i.trainee_id === c.traineeId)?.trainees
        const mail = String(t?.email || '').trim()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) continue
        const piece = mailAttachments.find((m) => m.filename === attachmentPaths.find((a) => a.path === c.path)?.filename)
        if (!piece) { stagiaires.echecs.push(mail); continue }
        const texte = `Bonjour ${t.first_name || ''},\n\nVous êtes ${mot('inscrit', t.gender)} à la formation « ${titre} »${quand ? ` ${quand}` : ''}${ses?.start_time ? ` à partir de ${String(ses.start_time).slice(0, 5).replace(':', ' h ')}` : ''}${lieu ? `, ${lieu}` : ''}.\n\nVotre convocation est jointe à ce message. Elle contient un QR code et un lien vers votre espace stagiaire : vous pourrez y compléter vos informations, indiquer vos attentes et faire un court test de positionnement avant la formation.\n\nPour toute question, répondez simplement à ce message.`
        try {
          await sendWithRetry(transporter, {
            from: `"${sender.name}" <${emailConfig.email}>`,
            to: mail,
            bcc: org.email_bcc || undefined,
            subject: `Convocation : ${titre}${ses?.start_date ? ` (${new Date(`${ses.start_date}T12:00:00`).toLocaleDateString('fr-FR')})` : ''}`,
            text: texte,
            html: `${texte.replace(/\n/g, '<br>')}<br><br><p style="margin: 0;">Bien cordialement,</p>${buildSignatureHTML(sender, org)}`,
            attachments: [piece],
          }, 3)
          stagiaires.envoyes++
          await supabase.from('session_emails_sent').insert([{ session_id: sessionId, email_type: 'before', to_email: mail,
            to_name: `${t.first_name || ''} ${t.last_name || ''}`.trim(), subject: `Convocation : ${titre}`, body: texte,
            attachments: [{ name: piece.filename, size: 0 }], status: 'sent', created_by: userId }])
        } catch (e) {
          console.error('Convocation stagiaire non envoyée :', mail, e.message)
          stagiaires.echecs.push(mail)
        }
      }
    }

    // 8. Nettoyer les fichiers temporaires dans le storage
    if (attachmentPaths.length > 0) {
      const paths = attachmentPaths.map(a => a.path)
      try {
        await supabase.storage.from('session-email-docs').remove(paths)
        console.log('Fichiers temporaires nettoyés:', paths.length)
      } catch (cleanupError) {
        console.error('Erreur nettoyage storage (non bloquant):', cleanupError)
      }
    }

    // 9. Fermer le transporteur
    try {
      transporter.close()
    } catch (e) {
      // Ignore
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Email envoyé avec succès',
      messageId: info.messageId,
      stagiaires,
    })

  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'email:', error)
    
    // Fermer le transporteur en cas d'erreur
    if (transporter) {
      try {
        transporter.close()
      } catch (e) {
        // Ignore
      }
    }
    
    return res.status(500).json({ 
      error: 'Erreur lors de l\'envoi de l\'email',
      details: error.message 
    })
  }
}

export default withErrorLog(handler, 'send-email-session')
