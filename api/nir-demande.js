// api/nir-demande.js
// ─────────────────────────────────────────────────────────────────────────────
// Demande du n° de sécurité sociale à l'entreprise (0440, décision de H du 22/10) : le stagiaire ne retrouve pas
// son numéro, signe dans le portail une autorisation de transmission, et l'entreprise reçoit un e-mail avec
// l'autorisation signée. Elle saisit ensuite le numéro dans son espace client (jamais par e-mail).
//
//   POST { mode: 'portail', token, trainee_id, ticket, signature_id, pdf }
//        envoi automatique : seulement si l'interrupteur « demande_nir » est ouvert, une fois, juste après la
//        signature ; depuis la boîte du formateur de la session, sinon l'adresse d'envoi par défaut.
//   POST { mode: 'equipe', signature_id, pdf }
//        envoi par l'organisme depuis la session (boîte de l'utilisateur connecté), interrupteur fermé compris.
//
// Tout ce que l'e-mail affiche vient de la base (nir_demande_pour_envoi) ; le PDF joint doit être un PDF qui porte
// l'identifiant de l'autorisation. Mode démonstration et environnement de test : redirection habituelle.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin, getMailer, getMailerByEmail, getSender, getOrg, buildSignatureHTML, sendWithRetry } from './_lib/mailer.js'
import { internalMailer } from './_lib/internal.js'
import { requireRight, OFFICE_WRITE, clientDeLAppelant } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

export const config = { maxDuration: 30 }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const esc = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
const dateFr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '')
const sansAccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_')

/** Texte de l'e-mail, à partir des données lues en base */
export function texteDemande(d, orgName = '') {
  const qui = [d.first_name, String(d.last_name || '').toUpperCase()].filter(Boolean).join(' ')
  const quand = d.start_date && d.end_date && d.start_date !== d.end_date ? `du ${dateFr(d.start_date)} au ${dateFr(d.end_date)}` : `le ${dateFr(d.start_date)}`
  return {
    sujet: `N° de sécurité sociale de ${qui} : formation ${d.course ? `« ${d.course} »` : ''} ${quand}`.replace(/\s+/g, ' '),
    corps: `${d.contact_name ? `Bonjour ${d.contact_name},` : 'Bonjour,'}\n\n`
      + `${qui} suit la formation${d.course ? ` « ${d.course} »` : ''} ${quand}. Pour l'inscrire à son passeport de prévention, nous avons besoin de son numéro de sécurité sociale, qu'il ne retrouve pas.\n\n`
      + `Il autorise votre entreprise à nous le transmettre : son autorisation signée est jointe à ce message.\n\n`
      + `Merci de saisir ce numéro dans votre espace client${orgName ? ` ${orgName}` : ''}, rubrique « Numéros demandés » (accès avec l'adresse et le code habituels). Il est vérifié à la saisie et rangé à part. Pour sa protection, merci de ne pas nous l'envoyer par e-mail.\n\n`
      + 'Nous restons à votre disposition pour toute question.',
    fichier: `Autorisation_NIR_${sansAccent(d.last_name)}_${sansAccent(d.first_name)}.pdf`,
  }
}

/** PDF joint : un vrai PDF, de taille raisonnable, qui porte l'identifiant de l'autorisation */
export function pdfValide(base64, signatureId) {
  if (typeof base64 !== 'string' || base64.length > 3_000_000) return null
  const buf = Buffer.from(base64, 'base64')
  if (buf.length < 500 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') return null
  if (!buf.toString('latin1').includes(`odet-autorisation-nir ${signatureId}`)) return null
  return buf
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const body = req.body || {}
  const admin = getSupabaseAdmin()
  const signatureId = String(body.signature_id || '')
  if (!UUID.test(signatureId)) return res.status(400).json({ error: 'Demande inconnue' })

  let mailer = null
  let userId = null
  if (body.mode === 'portail') {
    if (!UUID.test(String(body.trainee_id || '')) || !body.token) return res.status(400).json({ error: 'Accès invalide' })
    // Le ticket du portail prouve que c'est bien le stagiaire, sur sa session
    const { data: etat, error: e1 } = await admin.rpc('portail_nir_demande_etat', { p_token: body.token, p_trainee_id: body.trainee_id, p_ticket: body.ticket || null })
    if (e1 || !etat || etat.signature_id !== signatureId) return res.status(403).json({ error: 'Accès refusé' })
  } else if (body.mode === 'equipe') {
    const ctx = await requireRight(req, res, ['formation.convocations.envoyer', 'formation.sessions.modifier_siennes'], OFFICE_WRITE, OFFICE_WRITE)
    if (!ctx) return
    userId = req.user?.id || ctx.profile?.id
  } else {
    return res.status(400).json({ error: 'Mode inconnu' })
  }

  const { data: d, error: e2 } = await admin.rpc('nir_demande_pour_envoi', { p_signature: signatureId })
  if (e2) throw e2
  if (!d) return res.status(404).json({ error: 'Demande introuvable' })
  if (body.mode === 'equipe') {
    // L'appelant doit voir la session (sa société, ses droits) avant tout envoi
    const appelant = clientDeLAppelant(req)
    const { data: vue } = appelant ? await appelant.from('sessions').select('id').eq('id', d.session_id).maybeSingle() : { data: null }
    if (!vue) return res.status(403).json({ error: 'Session non accessible' })
  }
  if (d.renseigne) return res.status(200).json({ ok: true, envoye: false, raison: 'Numéro déjà enregistré' })
  if (!d.email) return res.status(200).json({ ok: true, envoye: false, raison: "Aucune adresse e-mail pour le contact de l'entreprise" })
  if (body.mode === 'portail') {
    if (!d.envoi_auto) return res.status(200).json({ ok: true, envoye: false, raison: 'Envoi par votre organisme' })
    if (d.envoyee_le) return res.status(200).json({ ok: true, envoye: true, deja: true })
    if (Date.now() - new Date(d.signed_at).getTime() > 30 * 60 * 1000) return res.status(200).json({ ok: true, envoye: false, raison: 'Envoi par votre organisme' })
  }
  const pdf = pdfValide(body.pdf, signatureId)
  if (!pdf) return res.status(400).json({ error: 'Autorisation signée illisible' })

  if (body.mode === 'equipe') {
    mailer = await getMailer(admin, userId, { envoiReel: true, preferEmail: d.trainer_email || undefined })
    if (mailer.error) return res.status(400).json({ error: mailer.error })
  } else {
    // Boîte du formateur de la session, sinon l'adresse d'envoi par défaut de l'organisme
    mailer = d.trainer_email ? await getMailerByEmail(admin, d.trainer_email) : { error: 'pas de formateur' }
    if (mailer.error) {
      const m = await internalMailer(admin)
      if (m.error) return res.status(200).json({ ok: true, envoye: false, raison: 'Envoi par votre organisme' })
      mailer = { transporter: m.transporter, emailConfig: m.cfg, fromEmail: m.cfg.email }
    }
  }
  const org = await getOrg(admin)
  const sender = await getSender(admin, mailer.fromEmail)
  const { sujet, corps, fichier } = texteDemande(d, org.app_name || org.name || '')
  try {
    await sendWithRetry(mailer.transporter, {
      from: `"${String(sender.name || '').replace(/"/g, '')}" <${mailer.fromEmail}>`,
      to: d.email,
      bcc: org.email_bcc || undefined,
      subject: sujet,
      text: corps,
      html: `${esc(corps).replace(/\n/g, '<br>')}<br><br><p style="margin:0;">Bien cordialement,</p>${buildSignatureHTML(sender, org)}`,
      attachments: [{ filename: fichier, content: pdf, contentType: 'application/pdf' }],
    }, 2)
  } finally {
    try { mailer.transporter?.close() } catch { /* rien */ }
  }
  await admin.from('session_emails_sent').insert([{
    session_id: d.session_id, company_id: d.company_id, email_type: 'demande_nir', to_email: d.email,
    to_name: d.contact_name || d.email.split('@')[0], subject: sujet, body: corps,
    attachments: [{ name: fichier, size: pdf.length, signature_id: signatureId }], status: 'sent', created_by: userId,
  }])
  return res.status(200).json({ ok: true, envoye: true, a: d.email })
}

export default withErrorLog(handler, 'nir-demande')
