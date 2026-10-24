import { getAdminClient, requireRight, clientDeLAppelant, MANAGERS } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'
import { getMailer, sendWithRetry, getOrg, getSender, buildSignatureHTML, boutonHTML } from './_lib/mailer.js'

// Comptes formateur externe et stagiaire (lot 2, 0047). Aucun email n'est envoyé par l'application.
//  - inviter (organisme) : { kind: 'formateur' | 'stagiaire', id, email } ; crée le compte relié à la fiche
//    (droit « Gérer les formateurs » ou « Modifier les stagiaires ») et rend le lien pour choisir un mot de passe.
//  - lien (organisme) : { kind, id } ; nouveau lien pour le compte relié à la fiche.
//  - creer_stagiaire (public, depuis le portail) : { token, trainee_id, ticket, email, password } ; le ticket du portail
//    (code de la convocation vérifié par la base) prouve que la personne est ce stagiaire ; compte créé avec le mot de
//    passe choisi, relié à sa fiche. Refusé si la fiche a déjà un compte ou si l'adresse est déjà utilisée.
//  - expert_envoyer (droit « Gérer les documents qualité », 0457) : { expert_id, quoi: 'lien' | 'code' } ; envoie à
//    l'expert invité son lien de relecture ou son code, dans deux e-mails séparés (jamais ensemble), depuis la boîte de
//    la personne connectée, en copie cachée de l'organisme.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const KINDS = {
  formateur: { role: 'formateur_externe', col: 'trainer_id', table: 'trainers', right: 'formation.formateurs.gerer' },
  stagiaire: { role: 'stagiaire', col: 'trainee_id', table: 'trainees', right: 'formation.stagiaires.modifier' },
}

const appUrlOf = () => (process.env.APP_URL || '').replace(/\/$/, '')
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

async function lien(admin, email, nouveau, role) {
  const appUrl = appUrlOf()
  const { data, error } = await admin.auth.admin.generateLink({
    type: nouveau ? 'invite' : 'recovery',
    email,
    options: nouveau
      ? { data: { role }, redirectTo: appUrl ? `${appUrl}/?auth=welcome` : undefined }
      : { redirectTo: appUrl ? `${appUrl}/?auth=reset` : undefined },
  })
  if (error) return { error: error.message }
  return { link: data?.properties?.action_link || null, user: data?.user || null }
}

async function relier(admin, userId, k, id) {
  const { data: prof } = await admin.from('profiles').select('id, role').eq('id', userId).maybeSingle()
  if (!prof || prof.role !== k.role) return 'Le compte n\'a pas reçu le bon rôle'
  const { error } = await admin.from('profiles').update({ [k.col]: id }).eq('id', userId)
  return error ? error.message : null
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const b = req.body || {}

  if (b.action === 'creer_stagiaire') {
    const email = String(b.email || '').trim().toLowerCase()
    const password = String(b.password || '')
    if (!b.token || !b.trainee_id || !b.ticket) return res.status(400).json({ error: 'Ouvrez d\'abord votre espace avec le code de votre convocation' })
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'Adresse email invalide' })
    if (password.length < 10) return res.status(400).json({ error: 'Mot de passe de 10 caractères au moins' })
    const admin = getAdminClient()
    // Le ticket du portail prouve le code de la convocation (contrôle et verrouillage par la base)
    const { error: e1 } = await admin.rpc('load_trainee_data', { p_token: String(b.token), p_trainee_id: String(b.trainee_id), p_ticket: String(b.ticket) })
    if (e1) return res.status(403).json({ error: 'Session du portail expirée : saisissez à nouveau votre code' })
    const { data: deja } = await admin.from('profiles').select('id').eq('trainee_id', b.trainee_id).maybeSingle()
    if (deja) return res.status(409).json({ error: 'Vous avez déjà un compte : connectez-vous avec votre adresse email' })
    const { data: pris } = await admin.from('profiles').select('id').ilike('email', escapeLike(email)).maybeSingle()
    if (pris) return res.status(409).json({ error: 'Cette adresse est déjà utilisée : choisissez-en une autre' })
    const { data: tr } = await admin.from('trainees').select('first_name, last_name').eq('id', b.trainee_id).maybeSingle()
    const { data: u, error: e2 } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { role: 'stagiaire', first_name: tr?.first_name || null, last_name: tr?.last_name || null },
    })
    if (e2 || !u?.user) return res.status(400).json({ error: e2?.message || 'Compte non créé' })
    const err = await relier(admin, u.user.id, KINDS.stagiaire, b.trainee_id)
    if (err) {
      await admin.auth.admin.deleteUser(u.user.id).catch(() => {})
      return res.status(500).json({ error: err })
    }
    return res.status(200).json({ ok: true })
  }

  if (b.action === 'expert_envoyer') return envoyerExpert(req, res, b)

  const k = KINDS[b.kind]
  if (!k) return res.status(400).json({ error: 'Type de compte inconnu' })
  const ctx = await requireRight(req, res, k.right, MANAGERS)
  if (!ctx) return
  const { admin } = ctx
  const appelant = clientDeLAppelant(req)
  if (!appelant) return res.status(401).json({ error: 'Connexion requise' })
  // L'appelant doit voir la fiche
  const { data: fiche } = await appelant.from(k.table).select('id, first_name, last_name').eq('id', b.id).maybeSingle()
  if (!fiche) return res.status(403).json({ error: 'Fiche introuvable' })
  const { data: relie } = await admin.from('profiles').select('id, email, role').eq(k.col, fiche.id).maybeSingle()

  if (b.action === 'inviter') {
    const email = String(b.email || '').trim().toLowerCase()
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'Adresse email invalide' })
    if (relie) return res.status(409).json({ error: 'Cette fiche a déjà un compte : utilisez « Nouveau lien »' })
    const { data: pris } = await admin.from('profiles').select('id').ilike('email', escapeLike(email)).maybeSingle()
    if (pris) return res.status(409).json({ error: 'Cette adresse est déjà celle d\'un autre compte' })
    const r = await lien(admin, email, true, k.role)
    if (r.error) return res.status(400).json({ error: r.error })
    if (!r.user?.id) return res.status(500).json({ error: 'Compte non créé' })
    const err = await relier(admin, r.user.id, k, fiche.id)
    if (err) {
      await admin.auth.admin.deleteUser(r.user.id).catch(() => {})
      return res.status(500).json({ error: err })
    }
    await admin.from('profiles').update({ first_name: fiche.first_name, last_name: fiche.last_name }).eq('id', r.user.id)
    return res.status(200).json({ ok: true, link: r.link })
  }

  if (b.action === 'lien') {
    if (!relie || relie.role !== k.role) return res.status(404).json({ error: 'Aucun compte relié à cette fiche' })
    const r = await lien(admin, relie.email, false, k.role)
    if (r.error) return res.status(400).json({ error: r.error })
    return res.status(200).json({ ok: true, link: r.link })
  }

  return res.status(400).json({ error: 'Action inconnue' })
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Lien ou code de l'espace de l'expert (0457), deux e-mails séparés
async function envoyerExpert(req, res, b) {
  const ctx = await requireRight(req, res, ['qualite.documents.gerer', 'qualite.documents.valider'], MANAGERS)
  if (!ctx) return
  const { admin, user } = ctx
  const quoi = b.quoi === 'code' ? 'code' : b.quoi === 'lien' ? 'lien' : null
  if (!quoi) return res.status(400).json({ error: 'Lien ou code ?' })
  const appelant = clientDeLAppelant(req)
  if (!appelant) return res.status(401).json({ error: 'Connexion requise' })
  // L'appelant doit voir l'invitation (règles de la base)
  const { data: ex } = await appelant.from('doc_review_experts').select('id, review_id, name, email, token, access_code, revoked_at, expires_at, done_at').eq('id', String(b.expert_id || '')).maybeSingle()
  if (!ex) return res.status(403).json({ error: 'Invitation introuvable' })
  if (ex.revoked_at || new Date(ex.expires_at) < new Date() || ex.done_at) return res.status(400).json({ error: 'Invitation retirée, échue ou terminée' })
  if (!EMAIL.test(ex.email || '')) return res.status(400).json({ error: 'Adresse e-mail de l\'expert manquante' })
  const { data: rv } = await appelant.from('doc_reviews').select('doc_name, due_on, status').eq('id', ex.review_id).maybeSingle()
  if (!rv || rv.status !== 'expert') return res.status(400).json({ error: 'Le document n\'est pas à l\'étape « chez l\'expert »' })

  const mailer = await getMailer(admin, user.id, { envoiReel: true })
  if (mailer.error) return res.status(400).json({ error: 'Configurez d\'abord votre e-mail dans Paramètres' })
  const org = await getOrg(admin)
  const sender = await getSender(admin, mailer.emailConfig.email)
  const lienExpert = org.app_url ? `${org.app_url}/#/relecture-expert/${ex.token}` : ''
  if (quoi === 'lien' && !lienExpert) return res.status(500).json({ error: 'Adresse de l\'application inconnue (APP_URL)' })
  const nomOrg = org.name || ''
  const echeance = rv.due_on ? ` Nous serions heureux d'avoir votre retour avant le ${new Date(rv.due_on).toLocaleDateString('fr-FR')}.` : ''
  const sujet = quoi === 'lien' ? `Relecture : ${rv.doc_name} (${nomOrg})` : `Votre code de relecture (${nomOrg})`
  const texte = quoi === 'lien'
    ? `Bonjour,\n\nNous vous remercions d'accepter de relire notre document « ${rv.doc_name} ». Vous pouvez le consulter, valider chaque article, proposer une rédaction ou commenter, à cette adresse : ${lienExpert}${echeance}\n\nPour votre sécurité, le code d'accès vous est envoyé dans un e-mail séparé.\n\nBien cordialement,`
    : `Bonjour,\n\nVoici votre code d'accès pour la relecture de « ${rv.doc_name} » : ${ex.access_code}\n\nLe lien vous est envoyé dans un autre e-mail.\n\nBien cordialement,`
  let html = esc(texte).replace(/\n/g, '<br>')
  if (quoi === 'lien') html = html.replace(esc(lienExpert), `<a href="${esc(lienExpert)}">${esc(lienExpert)}</a>`) + boutonHTML(lienExpert, 'Ouvrir le document', org.brand_accent || '#C8102E')
  else html = html.replace(esc(ex.access_code), `<strong style="font-size:18px;letter-spacing:3px">${esc(ex.access_code)}</strong>`)
  html += buildSignatureHTML(sender, org)
  await sendWithRetry(mailer.transporter, {
    from: `"${sender.name} - ${nomOrg}" <${mailer.emailConfig.email}>`, to: ex.email, bcc: org.email_bcc || undefined,
    subject: sujet, text: texte, html,
  }, 3)
  try { mailer.transporter.close() } catch { /* ignore */ }
  const maintenant = new Date().toISOString()
  await admin.from('doc_review_experts').update(quoi === 'lien' ? { link_sent_at: maintenant } : { code_sent_at: maintenant }).eq('id', ex.id)
  return res.status(200).json({ ok: true, envoye_a: ex.email, le: maintenant })
}

export default withErrorLog(handler, 'comptes-externes')
