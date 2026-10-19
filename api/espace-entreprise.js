import { requireRight, requireUser, clientDeLAppelant, MANAGERS } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

// Espace entreprise avec compte (lot 2, 0046).
//  - inviter (droit « Gérer l'espace entreprise ») : crée le compte au rôle « entreprise » relié au client et au
//    contact, puis rend le lien d'accès à la personne qui invite. L'application n'envoie aucun email : le lien est
//    transmis par la personne, depuis sa messagerie.
//  - lien (même droit) : nouveau lien pour choisir un mot de passe (compte existant).
//  - signature (compte entreprise) : signature du formateur pour la feuille d'émargement d'une de ses sessions
//    (bucket privé), après contrôle par ent_sessions.
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

  return res.status(400).json({ error: 'Action inconnue' })
}

export default withErrorLog(handler, 'espace-entreprise')
