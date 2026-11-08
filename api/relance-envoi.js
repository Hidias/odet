// api/relance-envoi.js
// ─────────────────────────────────────────────────────────────────────────────
// Envoi d'une relance validée depuis l'outil (0518, demande de H du 08/11 : notification, aperçu, envoi après
// validation). Rien ne part seul : la relance doit être « à envoyer » (validée par une personne), et c'est la personne
// connectée qui clique « Envoyer ».
//   - l'appelant est vérifié (droit d'envoyer aux stagiaires et aux clients, compte qui écrit) ; la base revérifie
//     tout à la réservation (relance_envoi_reserver, appelée avec le jeton de l'appelant) ;
//   - boîte d'envoi de la personne connectée, signature et copie cachée habituelles ; les règles d'envoi réel de
//     l'outil s'appliquent (getMailer, envoi réel du super administrateur ; sinon mode démonstration) ;
//   - l'envoi est tracé sur la relance (relance_envoi_terminer) : envoyée, ou erreur notée et relance à reprendre.
//
//   POST /api/relance-envoi { id, action: 'apercu' } → le mail tel qu'il partira, rien n'est réservé ni envoyé
//   POST /api/relance-envoi { id, action: 'test' }   → un exemple à l'adresse de la personne connectée
//   POST /api/relance-envoi { id, action: 'envoi' }  → envoi au destinataire
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin, getMailer, sendWithRetry, getOrgForCompany, getSender, buildSignatureHTML, finirParCordialement } from './_lib/mailer.js'
import { requireRight, clientDeLAppelant, refusVueGroupe, OFFICE_WRITE } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'
import { texteEnHtml } from '../src/core/html.js'

export const config = { maxDuration: 60 }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Mail d'une relance : objet (titre si vide), texte brut, HTML (texte échappé, formule de politesse si absente, signature)
export function mailDeRelance({ objet, texte, titre }, sender, org) {
  const corps = String(texte || '')
  const sujet = String(objet || '').trim() || String(titre || '').trim()
  const politesse = finirParCordialement(corps) ? '' : '<p style="margin: 0;">Bien cordialement,</p>'
  return { sujet, texte: politesse ? `${corps.replace(/\s+$/, '')}\n\nBien cordialement,` : corps, html: `${texteEnHtml(corps)}${politesse}${sender ? buildSignatureHTML(sender, org) : ''}` }
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const ctx = await requireRight(req, res, ['formation.convocations.envoyer'], OFFICE_WRITE)
  if (!ctx) return
  if (refusVueGroupe(req, res)) return
  const id = typeof req.body?.id === 'string' && UUID.test(req.body.id) ? req.body.id : null
  const action = ['apercu', 'test', 'envoi'].includes(req.body?.action) ? req.body.action : null
  if (!id || !action) return res.status(400).json({ error: 'Relance ou action inconnue' })
  const appelant = clientDeLAppelant(req)
  if (!appelant) return res.status(401).json({ error: 'Connexion requise' })
  const admin = getSupabaseAdmin()

  // Aperçu et test : la relance telle que l'appelant la voit (règles de la base), rien n'est réservé
  if (action !== 'envoi') {
    const { data: a, error } = await appelant.from('scheduled_actions').select('id, company_id, title, status, payload').eq('id', id).maybeSingle()
    if (error) return res.status(400).json({ error: error.message })
    if (!a) return res.status(404).json({ error: 'Relance introuvable' })
    const p = a.payload || {}
    if (!String(p.texte || '').trim()) return res.status(400).json({ error: 'Texte vide : rien à envoyer' })
    const org = await getOrgForCompany(admin, a.company_id)
    const mailer = await getMailer(admin, ctx.user.id, { envoiReel: true })
    const sender = mailer.error ? null : await getSender(admin, mailer.emailConfig.email)
    const mail = mailDeRelance({ objet: p.objet, texte: p.texte, titre: a.title }, sender, org)
    if (action === 'apercu') {
      try { mailer.transporter?.close() } catch {}
      return res.status(200).json({
        destinataire: String(p.destinataire || '').trim(), expediteur: mailer.emailConfig?.email || null,
        copieCachee: org.email_bcc || null, sujet: mail.sujet, html: mail.html, piecesJointes: [],
        avertissement: mailer.error || null,
      })
    }
    if (mailer.error) return res.status(400).json({ error: mailer.error })
    try {
      await sendWithRetry(mailer.transporter, {
        from: `"${sender.name}" <${mailer.emailConfig.email}>`, to: mailer.emailConfig.email,
        subject: `[Test] ${mail.sujet}`, text: mail.texte, html: mail.html,
      }, 1)
    } finally { try { mailer.transporter.close() } catch {} }
    return res.status(200).json({ ok: true, test: mailer.emailConfig.email })
  }

  // Boîte d'envoi d'abord : sans elle, rien n'est réservé
  const mailer = await getMailer(admin, ctx.user.id, { envoiReel: true })
  if (mailer.error) return res.status(400).json({ error: mailer.error })
  // Réservation par la base au nom de l'appelant (droit, état, adresse, texte, une seule personne à la fois)
  const { data: r, error: rErr } = await appelant.rpc('relance_envoi_reserver', { p_id: id })
  if (rErr) {
    try { mailer.transporter.close() } catch {}
    return res.status(rErr.code === '42501' ? 403 : 409).json({ error: rErr.message })
  }
  const org = await getOrgForCompany(admin, r.company_id)
  const sender = await getSender(admin, mailer.emailConfig.email)
  const mail = mailDeRelance({ objet: r.objet, texte: r.texte }, sender, org)
  try {
    const info = await sendWithRetry(mailer.transporter, {
      from: `"${sender.name}" <${mailer.emailConfig.email}>`,
      to: r.destinataire,
      bcc: org.email_bcc || undefined,
      subject: mail.sujet, text: mail.texte, html: mail.html,
    }, 1)
    const { error: fErr } = await appelant.rpc('relance_envoi_terminer', { p_id: id, p_ok: true, p_message_id: info?.messageId || null, p_boite: mailer.emailConfig.email })
    // Mail parti mais trace refusée : on le dit, pour ne pas le renvoyer une seconde fois
    if (fErr) return res.status(200).json({ ok: true, destinataire: r.destinataire, avertissement: 'Mail envoyé, mais la relance n\'a pas pu être marquée « envoyée » : ne la renvoyez pas, marquez-la envoyée dans quelques minutes.' })
    return res.status(200).json({ ok: true, destinataire: r.destinataire })
  } catch (err) {
    const message = String(err?.message || 'Échec de l\'envoi').slice(0, 300)
    await appelant.rpc('relance_envoi_terminer', { p_id: id, p_ok: false, p_erreur: message })
    return res.status(502).json({ error: `Envoi impossible : ${message}` })
  } finally { try { mailer.transporter.close() } catch {} }
}

export default withErrorLog(handler, 'relance-envoi')
