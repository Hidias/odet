import { requireRight, requireUser, clientDeLAppelant, MANAGERS } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'
import { getSupabaseAdmin, getMailer, sendWithRetry, getOrg, getSender, buildSignatureHTML, boutonHTML } from './_lib/mailer.js'

// Espace entreprise avec compte (lot 2, 0046).
//  - inviter (droit « Gérer l'espace entreprise ») : crée le compte au rôle « entreprise » relié au client et au
//    contact, puis rend le lien d'accès à la personne qui invite. L'application n'envoie aucun email : le lien est
//    transmis par la personne, depuis sa messagerie.
//  - lien (même droit) : nouveau lien pour choisir un mot de passe (compte existant).
//  - signature (compte entreprise) : signature du formateur pour la feuille d'émargement d'une de ses sessions
//    (bucket privé), après contrôle par ent_sessions.
//  - envoyer_acces (droit « Gérer l'espace entreprise », 0449) : envoie le lien de l'espace, ou le code d'accès, dans
//    deux e-mails séparés (jamais les deux ensemble), depuis la boîte de la personne, à un contact du client.
//  - creer_compte (le client lui-même, avec son lien et son code, 0449) : crée son compte personnel à la première
//    connexion, pour l'adresse d'un contact du client connu de l'organisme ; il choisit son mot de passe.
// Avant toute écriture par le client serveur, on vérifie que l'appelant voit le client (règles de la base).

const BUCKET = 'trainer-signatures'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function pathFrom(url) {
  const s = String(url || '')
  const i = s.indexOf(`/${BUCKET}/`)
  if (i < 0) return null
  const path = decodeURIComponent(s.slice(i + BUCKET.length + 2).split('?')[0])
  return path && !path.includes('..') ? path : null
}

const appUrlOf = () => (process.env.APP_URL || '').replace(/\/$/, '')

async function lienMotDePasse(admin, email, nouveau) {
  const appUrl = appUrlOf()
  const { data, error } = await admin.auth.admin.generateLink({
    type: nouveau ? 'invite' : 'recovery',
    email,
    options: nouveau
      ? { data: { role: 'entreprise' }, redirectTo: appUrl ? `${appUrl}/?auth=welcome` : undefined }
      : { redirectTo: appUrl ? `${appUrl}/?auth=reset` : undefined },
  })
  if (error) return { error: error.message }
  return { link: data?.properties?.action_link || null, user: data?.user || null }
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const { action } = req.body || {}

  if (action === 'signature') {
    const ctx = await requireUser(req)
    if (!ctx) return res.status(401).json({ error: 'Connexion requise' })
    if (ctx.profile.role !== 'entreprise') return res.status(403).json({ error: 'Accès refusé' })
    const sessionId = String(req.body?.session_id || '')
    const appelant = clientDeLAppelant(req)
    if (!appelant || !sessionId) return res.status(400).json({ error: 'Paramètres manquants' })
    const { data, error } = await appelant.rpc('ent_sessions')
    if (error || !data) return res.status(403).json({ error: 'Accès refusé' })
    if (!(data.sessions || []).some((s) => s.id === sessionId)) return res.status(403).json({ error: 'Accès refusé' })
    const { data: ses } = await ctx.admin.from('sessions').select('trainer_id, trainers(signature_url)').eq('id', sessionId).maybeSingle()
    const path = pathFrom(ses?.trainers?.signature_url)
    if (!path) return res.status(200).json({ dataUrl: null })
    const { data: file, error: dlError } = await ctx.admin.storage.from(BUCKET).download(path)
    if (dlError || !file) return res.status(200).json({ dataUrl: null })
    const buf = Buffer.from(await file.arrayBuffer())
    const type = file.type || (path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg')
    return res.status(200).json({ dataUrl: `data:${type};base64,${buf.toString('base64')}` })
  }

  if (action === 'creer_compte') return creerCompte(req, res)

  const ctx = await requireRight(req, res, 'clients.espace.gerer', MANAGERS)
  if (!ctx) return
  const { admin, user } = ctx
  const appelant = clientDeLAppelant(req)
  if (!appelant) return res.status(401).json({ error: 'Connexion requise' })

  if (action === 'inviter') {
    const b = req.body || {}
    const email = String(b.email || '').trim().toLowerCase()
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'Adresse email invalide' })
    if (!b.client_id) return res.status(400).json({ error: 'Client requis' })
    // L'appelant doit voir le client (et son contact)
    const { data: client } = await appelant.from('clients').select('id, name, company_id').eq('id', b.client_id).maybeSingle()
    if (!client) return res.status(403).json({ error: 'Client introuvable' })
    if (b.contact_id) {
      const { data: contact } = await appelant.from('client_contacts').select('id').eq('id', b.contact_id).eq('client_id', client.id).maybeSingle()
      if (!contact) return res.status(400).json({ error: 'Contact introuvable pour ce client' })
    }
    const siteIds = Array.isArray(b.site_ids) ? b.site_ids.filter((x) => typeof x === 'string') : []
    if (b.all_sites === false && siteIds.length === 0) return res.status(400).json({ error: 'Choisissez au moins un site' })

    // Adresse déjà connue : compte de l'organisme refusé ; compte entreprise déjà relié refusé
    const { data: existant } = await admin.from('profiles').select('id, role').ilike('email', email.replace(/[\\%_]/g, (c) => `\\${c}`)).maybeSingle()
    let profileId = existant?.id || null
    let link = null
    if (existant) {
      if (existant.role !== 'entreprise') return res.status(409).json({ error: 'Cette adresse est celle d\'un compte de l\'organisme : utilisez une autre adresse' })
      const { data: deja } = await admin.from('client_accounts').select('id').eq('profile_id', existant.id).maybeSingle()
      if (deja) return res.status(409).json({ error: 'Cette adresse a déjà un compte entreprise' })
      const r = await lienMotDePasse(admin, email, false)
      if (r.error) return res.status(400).json({ error: r.error })
      link = r.link
    } else {
      const r = await lienMotDePasse(admin, email, true)
      if (r.error) return res.status(400).json({ error: r.error })
      link = r.link
      profileId = r.user?.id || null
      if (!profileId) return res.status(500).json({ error: 'Compte non créé' })
      // Profil créé par la base à partir de l'invitation : rôle « entreprise » vérifié
      const { data: prof } = await admin.from('profiles').select('id, role').eq('id', profileId).maybeSingle()
      if (!prof || prof.role !== 'entreprise') {
        await admin.auth.admin.deleteUser(profileId).catch(() => {})
        return res.status(500).json({ error: 'Le compte n\'a pas reçu le rôle entreprise : invitation annulée' })
      }
    }

    const { data: compte, error } = await admin.from('client_accounts').insert({
      company_id: client.company_id, profile_id: profileId, client_id: client.id, contact_id: b.contact_id || null, email,
      all_sites: b.all_sites !== false, can_register: b.can_register !== false, can_see_invoices: !!b.can_see_invoices,
      invited_by: user.id,
    }).select('id').single()
    if (error) return res.status(400).json({ error: error.message })
    if (b.all_sites === false && siteIds.length) {
      const { error: e2 } = await admin.from('client_account_sites').insert(siteIds.map((site_id) => ({ account_id: compte.id, site_id })))
      if (e2) return res.status(400).json({ error: e2.message })
    }
    return res.status(200).json({ ok: true, account_id: compte.id, link })
  }

  if (action === 'lien') {
    const accountId = String(req.body?.account_id || '')
    const { data: compte } = await appelant.from('client_accounts').select('id, email, profile_id, is_active').eq('id', accountId).maybeSingle()
    if (!compte) return res.status(403).json({ error: 'Compte introuvable' })
    if (!compte.is_active) return res.status(400).json({ error: 'Compte désactivé : réactivez-le d\'abord' })
    const { data: prof } = await admin.from('profiles').select('email, role').eq('id', compte.profile_id).maybeSingle()
    if (!prof || prof.role !== 'entreprise') return res.status(400).json({ error: 'Compte entreprise introuvable' })
    const r = await lienMotDePasse(admin, prof.email || compte.email, false)
    if (r.error) return res.status(400).json({ error: r.error })
    return res.status(200).json({ ok: true, link: r.link })
  }

  if (action === 'envoyer_acces') return envoyerAcces(req, res, ctx, appelant)

  return res.status(400).json({ error: 'Action inconnue' })
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const normEmail = (e) => String(e || '').trim().toLowerCase()

// Adresses de contact connues pour un client (accès + contacts de la fiche)
async function adressesDuClient(db, clientId, acces) {
  const { data: contacts } = await db.from('client_contacts').select('id, email, first_name, last_name, name').eq('client_id', clientId)
  const liste = (contacts || []).filter((c) => c.email).map((c) => ({ ...c, email: normEmail(c.email) }))
  if (acces?.contact_email && !liste.some((c) => c.email === normEmail(acces.contact_email))) liste.push({ id: null, email: normEmail(acces.contact_email) })
  return liste
}

async function envoyerAcces(req, res, ctx, appelant) {
  const { admin, user } = ctx
  const b = req.body || {}
  const quoi = b.quoi === 'code' ? 'code' : b.quoi === 'lien' ? 'lien' : null
  if (!quoi) return res.status(400).json({ error: 'Lien ou code ?' })
  // L'appelant doit voir l'accès (règles de la base)
  const { data: acces } = await appelant.from('client_portal_access').select('id, client_id, token, access_code, is_active, contact_email').eq('client_id', String(b.client_id || '')).maybeSingle()
  if (!acces) return res.status(403).json({ error: 'Accès introuvable' })
  if (!acces.is_active) return res.status(400).json({ error: 'Accès désactivé : réactivez-le d\'abord' })
  const to = normEmail(b.to || acces.contact_email)
  const connues = await adressesDuClient(admin, acces.client_id, acces)
  if (!EMAIL.test(to) || !connues.some((c) => c.email === to)) return res.status(400).json({ error: 'Choisissez l\'adresse d\'un contact du client' })
  const { data: client } = await admin.from('clients').select('name').eq('id', acces.client_id).maybeSingle()

  const mailer = await getMailer(admin, user.id, { envoiReel: true })
  if (mailer.error) return res.status(400).json({ error: 'Configurez d\'abord votre e-mail dans Paramètres' })
  const org = await getOrg(admin)
  const sender = await getSender(admin, mailer.emailConfig.email)
  const lien = org.app_url ? `${org.app_url}/#/entreprise/${acces.token}` : ''
  if (quoi === 'lien' && !lien) return res.status(500).json({ error: 'Adresse de l\'application inconnue (APP_URL)' })
  const nomOrg = org.name || ''
  const sujet = quoi === 'lien' ? `Votre espace client ${nomOrg}` : `Votre code d'accès à l'espace client ${nomOrg}`
  const texte = quoi === 'lien'
    ? `Bonjour,\n\nVotre espace client ${nomOrg} rassemble vos devis, conventions, rapports, factures et documents : ${lien}\n\nPour votre sécurité, le code d'accès vous est envoyé dans un e-mail séparé. Vous pourrez ensuite le changer, ou créer votre compte personnel.\n\nBien cordialement,`
    : `Bonjour,\n\nVoici votre code d'accès à l'espace client ${nomOrg} : ${acces.access_code}\n\nLe lien de l'espace vous est envoyé dans un autre e-mail. Ne transmettez pas ce code : il donne accès aux documents de votre entreprise. Vous pouvez le changer depuis l'espace.\n\nBien cordialement,`
  let html = esc(texte).replace(/\n/g, '<br>')
  if (quoi === 'lien') html = html.replace(esc(lien), `<a href="${esc(lien)}">${esc(lien)}</a>`) + boutonHTML(lien, 'Ouvrir mon espace client', org.brand_accent || '#C8102E')
  else html = html.replace(esc(acces.access_code), `<strong style="font-size:18px;letter-spacing:3px">${esc(acces.access_code)}</strong>`)
  html += buildSignatureHTML(sender, org)
  await sendWithRetry(mailer.transporter, {
    from: `"${sender.name} - ${nomOrg}" <${mailer.emailConfig.email}>`, to, bcc: org.email_bcc || undefined,
    subject: sujet, text: texte, html,
  }, 3)
  try { mailer.transporter.close() } catch { /* ignore */ }
  const maintenant = new Date().toISOString()
  await admin.from('client_portal_access').update(quoi === 'lien' ? { link_sent_at: maintenant, updated_at: maintenant } : { code_sent_at: maintenant, updated_at: maintenant }).eq('id', acces.id)
  await admin.from('client_interactions').insert({
    client_id: acces.client_id, type: 'email', title: quoi === 'lien' ? 'Lien de l\'espace client envoyé' : 'Code d\'accès à l\'espace client envoyé (e-mail séparé)',
    content: `Envoyé par ${sender.name} à ${to}${client?.name ? ` (${client.name})` : ''}`, author: sender.name,
  })
  return res.status(200).json({ ok: true, envoye_a: to, le: maintenant })
}

// Première connexion : le client crée son compte avec son lien et son code (0449)
async function creerCompte(req, res) {
  const b = req.body || {}
  const token = String(b.token || '')
  const code = String(b.code || '').replace(/\s/g, '')
  const email = normEmail(b.email)
  const motDePasse = String(b.password || '')
  if (!token || !code) return res.status(400).json({ error: 'Lien ou code manquant' })
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'Adresse e-mail invalide' })
  if (motDePasse.length < 10 || !/[A-Za-z]/.test(motDePasse) || !/[0-9]/.test(motDePasse)) {
    return res.status(400).json({ error: 'Mot de passe : 10 caractères au moins, avec des lettres et des chiffres' })
  }
  const admin = getSupabaseAdmin()
  // Lien et code vérifiés par la base (mêmes tentatives et blocage que l'accès à l'espace)
  const { data: infos, error: e0 } = await admin.rpc('client_portal_acces_infos', { p_token: token, p_code: code })
  if (e0) return res.status(400).json({ error: 'Vérification impossible' })
  if (infos?.error) return res.status(403).json({ error: infos.error })
  const { data: acces } = await admin.from('client_portal_access').select('id, client_id, company_id, contact_email').eq('token', token).maybeSingle()
  if (!acces) return res.status(403).json({ error: 'Lien invalide' })
  const connues = await adressesDuClient(admin, acces.client_id, acces)
  const contact = connues.find((c) => c.email === email)
  if (!contact) return res.status(400).json({ error: 'Utilisez l\'adresse e-mail connue de l\'organisme pour votre entreprise (celle qui a reçu le lien), ou demandez-lui d\'ajouter la vôtre' })
  const { data: existant } = await admin.from('profiles').select('id, role').ilike('email', email.replace(/[\\%_]/g, (c) => `\\${c}`)).maybeSingle()
  if (existant) return res.status(409).json({ error: 'Un compte existe déjà avec cette adresse : connectez-vous avec votre mot de passe' })

  const { data: cree, error: e1 } = await admin.auth.admin.createUser({
    email, password: motDePasse, email_confirm: true,
    user_metadata: { role: 'entreprise', first_name: contact.first_name || null, last_name: contact.last_name || null },
  })
  if (e1 || !cree?.user?.id) return res.status(400).json({ error: e1?.message || 'Compte non créé' })
  const profileId = cree.user.id
  const { data: prof } = await admin.from('profiles').select('id, role').eq('id', profileId).maybeSingle()
  if (!prof || prof.role !== 'entreprise') {
    await admin.auth.admin.deleteUser(profileId).catch(() => {})
    return res.status(500).json({ error: 'Le compte n\'a pas reçu le rôle entreprise : création annulée' })
  }
  const { error: e2 } = await admin.from('client_accounts').insert({
    company_id: acces.company_id, profile_id: profileId, client_id: acces.client_id, contact_id: contact.id || null, email,
    all_sites: true, can_register: true, can_see_invoices: false, invited_by: null,
  })
  if (e2) {
    await admin.auth.admin.deleteUser(profileId).catch(() => {})
    return res.status(400).json({ error: e2.message })
  }
  const { data: client } = await admin.from('clients').select('name').eq('id', acces.client_id).maybeSingle()
  await admin.from('notifications').insert({
    company_id: acces.company_id, type: 'espace_client_compte', title: 'Espace client : compte créé',
    message: `${client?.name || 'Un client'} : ${email} a créé son compte personnel (factures masquées tant que vous ne les ouvrez pas)`,
    link: `/clients/${acces.client_id}`, metadata: { client_id: acces.client_id, profile_id: profileId },
  })
  return res.status(200).json({ ok: true })
}

export default withErrorLog(handler, 'espace-entreprise')
