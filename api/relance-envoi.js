// api/relance-envoi.js
// ─────────────────────────────────────────────────────────────────────────────
// Envoi d'une relance validée depuis l'outil (0518, demande de H du 08/11 : notification, aperçu, envoi après
// validation). Rien ne part seul : la relance doit être « à envoyer » (validée par une personne), et c'est la personne
// connectée qui clique « Envoyer ».
//   - l'appelant est vérifié (droit d'envoyer aux stagiaires et aux clients, compte qui écrit) ; la base revérifie
//     tout à la réservation (relance_envoi_reserver, appelée avec le jeton de l'appelant) ;
//   - boîte d'envoi de la personne connectée, signature et copie cachée habituelles ; les règles d'envoi réel de
//     l'outil s'appliquent (getMailer, envoi réel du super administrateur ; sinon mode démonstration) ;
//   - mode démonstration ou environnement de test : seul l'envoi réel du super administrateur part au destinataire ;
//     pour les autres comptes l'envoi est refusé (la relance serait marquée envoyée sans être arrivée) ;
//   - l'envoi est tracé sur la relance (relance_envoi_terminer, clé de service) : envoyée, ou erreur notée et relance à
//     reprendre. Une trace qui échoue après le mail laisse la relance « envoi sans suite » : jamais renvoyée seule.
//
//   POST /api/relance-envoi { id, action: 'apercu' }               → le mail tel qu'il partira, rien n'est réservé ni envoyé
//   POST /api/relance-envoi { id, action: 'test' }                 → un exemple à l'adresse de la personne connectée
//   POST /api/relance-envoi { id, action: 'envoi', destinataire }  → envoi au destinataire vu dans l'aperçu
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin, getMailer, sendWithRetry, getOrgForCompany, getSender, buildSignatureHTML, finirParCordialement, isTestEnvironment } from './_lib/mailer.js'
import { requireRight, clientDeLAppelant, refusVueGroupe, OFFICE_WRITE } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'
import { texteEnHtml } from '../src/core/html.js'

export const config = { maxDuration: 60 }

// Envoi qui n'arriverait pas au destinataire : mode démonstration ou test, hors envoi réel du super administrateur
// (en préversion ou en test, tout est redirigé, même l'envoi réel)
export function envoiRedirige(mailer, org) {
  return isTestEnvironment() || (!mailer.envoiReel && !!org.demo_mode)
}
export const MESSAGE_REDIRIGE = 'Mode démonstration : le mail irait à l\'adresse de test, pas au destinataire. Seul le super administrateur envoie pour de vrai ; « Test à moi » part lui aussi vers l\'adresse de test.'

// Échec de messagerie survenu sûrement avant l'envoi du contenu (nodemailer 6) : identifiants refusés, adresse refusée,
// serveur introuvable, connexion ou accueil jamais établis, chiffrement refusé au début. Une coupure ou un délai dépassé
// plus tard porte aussi « CONN » chez nodemailer : le mail a pu partir, donc incertain.
export function echecAvantEnvoi(err) {
  if (['EAUTH', 'ENOAUTH', 'EENVELOPE', 'EDNS'].includes(err?.code)) return true
  // Connexion refusée ou serveur injoignable
  if (err?.code === 'ESOCKET' && err?.syscall === 'connect') return true
  const message = String(err?.message || '')
  if (err?.code === 'ETIMEDOUT') return /^(Connection timeout|Greeting never received)/.test(message)
  if (err?.code === 'ETLS') return /^Error initiating TLS/.test(message)
  return false
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Formule de clôture déjà écrite dans les dernières lignes (« Cordialement, / Organisme », « salutations distinguées »)
export function aUneFormule(texte) {
  const lignes = String(texte || '').replace(/\u00a0/g, ' ').split('\n').map((l) => l.trim()).filter(Boolean).slice(-3)
  return finirParCordialement(lignes.join('\n')) || lignes.some((l) => /cordialement|salutations|sinc[eè]res|bonne (journée|fin de journée)/i.test(l))
}

// Mail d'une relance : objet (titre si vide), texte brut, HTML (texte échappé, formule de politesse si absente, signature)
export function mailDeRelance({ objet, texte, titre }, sender, org) {
  const corps = String(texte || '')
  const sujet = String(objet || '').trim() || String(titre || '').trim()
  const politesse = aUneFormule(corps) ? '' : '<p style="margin: 0;">Bien cordialement,</p>'
  const signatureTexte = sender ? `\n\n${[sender.name, sender.title, org?.name && org.name !== sender.name ? org.name : '', sender.phone, sender.email].filter(Boolean).join('\n')}` : ''
  return { sujet, texte: `${politesse ? `${corps.replace(/\s+$/, '')}\n\nBien cordialement,` : corps}${signatureTexte}`, html: `${texteEnHtml(corps)}${politesse}${sender ? buildSignatureHTML(sender, org) : ''}` }
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
    const { data: a, error } = await appelant.from('scheduled_actions').select('id, company_id, title, status, payload, validated_at').eq('id', id).maybeSingle()
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
        id: a.id, valideLe: a.validated_at || null, redirige: envoiRedirige(mailer.error ? {} : mailer, org), destinataire: String(p.destinataire || '').trim(), expediteur: mailer.emailConfig?.email || null,
        copieCachee: [org.email_bcc, mailer.envoiReel ? mailer.emailConfig?.email : null].filter(Boolean).join(', ') || null, sujet: mail.sujet, html: mail.html, piecesJointes: [],
        avertissement: mailer.error || (envoiRedirige(mailer, org) ? MESSAGE_REDIRIGE : null),
      })
    }
    if (mailer.error) return res.status(400).json({ error: mailer.error })
    // Mode démonstration ou test : l'exemple part, lui aussi, vers l'adresse de test (on le dit)
    const redirige = envoiRedirige(mailer, await getOrgForCompany(admin, null))
    try {
      await sendWithRetry(mailer.transporter, {
        from: `"${sender.name}" <${mailer.emailConfig.email}>`, to: mailer.emailConfig.email,
        subject: `[Test] ${mail.sujet}`, text: mail.texte, html: mail.html,
      }, 1)
    } finally { try { mailer.transporter.close() } catch {} }
    return res.status(200).json({ ok: true, test: redirige ? 'l\'adresse de test' : mailer.emailConfig.email })
  }

  // Boîte d'envoi d'abord : sans elle, rien n'est réservé
  const destinataireVu = typeof req.body?.destinataire === 'string' ? req.body.destinataire : ''
  const valideLe = typeof req.body?.valideLe === 'string' ? req.body.valideLe : null
  if (!destinataireVu.trim()) return res.status(400).json({ error: 'Ouvrez l\'aperçu du mail avant de l\'envoyer' })
  const mailer = await getMailer(admin, ctx.user.id, { envoiReel: true })
  if (mailer.error) return res.status(400).json({ error: mailer.error })
  const fermer = () => { try { mailer.transporter.close() } catch {} }
  {
    const orgDefaut = await getOrgForCompany(admin, null)
    if (envoiRedirige(mailer, orgDefaut)) { fermer(); return res.status(409).json({ error: MESSAGE_REDIRIGE }) }
  }
  // Réservation par la base au nom de l'appelant (droit, état, adresse vue, texte, une seule personne à la fois)
  const { data: r, error: rErr } = await appelant.rpc('relance_envoi_reserver', { p_id: id, p_destinataire: destinataireVu, p_valide_le: valideLe })
  if (rErr) { fermer(); return res.status(rErr.code === '42501' ? 403 : 409).json({ error: rErr.message }) }
  // Trace de fin par la clé de service ; un second essai si la base ne répond pas
  const terminer = async (args) => {
    const appelFin = () => admin.rpc('relance_envoi_terminer', { p_id: id, p_auteur: ctx.user.id, ...args })
    let r2 = await appelFin()
    if (r2.error) r2 = await appelFin()
    return { error: r2.error, data: r2.data }
  }
  let mail
  let sender
  try {
    const org = await getOrgForCompany(admin, r.company_id)
    sender = await getSender(admin, mailer.emailConfig.email)
    mail = { ...mailDeRelance({ objet: r.objet, texte: r.texte }, sender, org), bcc: org.email_bcc || undefined }
  } catch (err) {
    fermer()
    await terminer({ p_ok: false, p_erreur: 'Mail non préparé, rien n\'est parti' })
    throw err
  }
  try {
    const info = await sendWithRetry(mailer.transporter, {
      from: `"${sender.name}" <${mailer.emailConfig.email}>`,
      to: r.destinataire,
      bcc: mail.bcc,
      subject: mail.sujet, text: mail.texte, html: mail.html,
    }, 1)
    // Adresse du destinataire refusée par le serveur (le mail n'est parti qu'aux copies cachées) : échec
    const refuse = (info?.rejected || []).map((x) => String(x?.address || x).toLowerCase()).includes(r.destinataire.toLowerCase())
    if (refuse) {
      await terminer({ p_ok: false, p_erreur: `Adresse refusée par le serveur : ${r.destinataire}` })
      return res.status(502).json({ error: `Envoi impossible : adresse refusée par le serveur (${r.destinataire})` })
    }
    const { error: fErr, data: fin } = await terminer({ p_ok: true, p_message_id: info?.messageId || null, p_boite: mailer.emailConfig.email })
    if (!fErr && fin === 'ecartee') return res.status(200).json({ ok: true, destinataire: r.destinataire, avertissement: 'Mail envoyé alors que la relance venait d\'être écartée par l\'outil (par exemple facture réglée entre-temps). L\'envoi est noté sur la relance.' })
    // Mail parti mais trace refusée : la relance reste « envoi sans suite », jamais renvoyée seule
    if (fErr) return res.status(200).json({ ok: true, destinataire: r.destinataire, avertissement: 'Mail envoyé, mais la relance n\'a pas pu être mise à jour. Ne la renvoyez pas : vérifiez-la dans quelques minutes (si elle est encore « à envoyer », marquez-la envoyée).' })
    return res.status(200).json({ ok: true, destinataire: r.destinataire })
  } catch (err) {
    const message = String(err?.message || 'Échec de l\'envoi').slice(0, 300)
    // Refus avant le contenu du mail (connexion, identifiants, adresse) : rien n'est parti, on peut réessayer.
    // Sinon le mail a pu partir : la relance reste « envoi sans suite », à vérifier dans la boîte avant tout renvoi.
    if (!echecAvantEnvoi(err)) {
      return res.status(502).json({ error: `Résultat incertain : ${message}. Vérifiez dans votre boîte d'envoi si le mail est parti avant de le renvoyer.` })
    }
    await terminer({ p_ok: false, p_erreur: message })
    return res.status(502).json({ error: `Envoi impossible : ${message}` })
  } finally { fermer() }
}

export default withErrorLog(handler, 'relance-envoi')
