import crypto from 'node:crypto'
import { getAdminClient, requireUser, clientDeLAppelant } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

// Documents mis à disposition dans l'espace client (0404), toutes prestations.
//  - publier (équipe connectée) : range un PDF remis au client (rapport d'intervention, facture émise, devis, contrat,
//    document déposé à la main). L'appelant doit voir la prestation avec ses propres droits (lecture faite avec son
//    jeton) ; le fichier est rangé tel quel avec son empreinte. Un seul document actif par prestation et par type.
//    Devis modifié après sa mise à disposition (21/10) : la nouvelle version remplace l'ancienne (retirée, gardée), sauf
//    si l'ancienne a été signée par le client : la version signée reste figée.
//  - lire (espace client, par lien et code ou par compte) : lien de 5 minutes vers un document visible par ce client.
//  - lire_interne (équipe connectée) : lien de 5 minutes vers un document que l'appelant voit.
//  - deposer_signe (espace client, par lien et code ou par compte) : devis ou convention imprimé, signé à la main et
//    déposé (PDF déjà compressé par le navigateur). Rangé tel quel avec son empreinte, à valider par l'organisme
//    (0431), qui est prévenu tout de suite.
//  - lire_depot (équipe connectée) : lien de 5 minutes vers un dépôt du client que l'appelant voit.
// Aucun e-mail n'est envoyé.

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } }

const BUCKET = 'client-documents'
const UUID = /^[0-9a-f-]{36}$/i
const MAX = 3.5 * 1024 * 1024
const TABLES = {
  client: ['clients', 'id'],
  session: ['sessions', 'client_id'],
  invoice: ['invoices', 'client_id, billing_client_id, is_subrogation, status'],
  quote: ['quotes', 'client_id, updated_at'],
  itv_visit: ['itv_visits', 'client_id'],
  itv_contract: ['itv_contracts', 'client_id'],
  // Groupe inter (0420) : convention ou contrat du groupe, signé en ligne par son client
  session_group: ['session_groups', 'client_id'],
}
const KINDS = ['rapport', 'facture', 'devis', 'contrat', 'convention', 'attestation', 'autre']

async function publier(req, res) {
  const ctx = await requireUser(req)
  if (!ctx || ctx.profile.role === 'entreprise') return res.status(403).json({ error: 'Accès refusé' })
  const appelant = clientDeLAppelant(req)
  const { object_type: type, object_id: id, kind, label, pdf_base64: b64 } = req.body || {}
  if (!TABLES[type] || !UUID.test(String(id || '')) || !KINDS.includes(kind) || !b64) return res.status(400).json({ error: 'Paramètres manquants' })
  const lib = String(label || '').trim().slice(0, 200)
  if (lib.length < 2) return res.status(400).json({ error: 'Libellé manquant' })

  // Lecture avec les droits de l'appelant : il doit voir la prestation
  const [table, cols] = TABLES[type]
  const { data: obj } = await appelant.from(table).select(`id, ${cols}`).eq('id', id).maybeSingle()
  if (!obj) return res.status(403).json({ error: 'Accès refusé' })
  if (type === 'invoice' && ['draft', 'brouillon'].includes(obj.status || 'draft')) return res.status(400).json({ error: 'Une facture brouillon ne se met pas à disposition' })
  const clientId = type === 'client' ? obj.id : type === 'invoice' ? (obj.is_subrogation ? obj.client_id : (obj.billing_client_id || obj.client_id)) : obj.client_id
  if (!clientId) return res.status(400).json({ error: 'Prestation sans client' })

  const { admin } = ctx
  if (type !== 'client') {
    const { data: deja } = await admin.from('client_shared_documents').select('id, published_at').eq('object_type', type).eq('object_id', id).eq('kind', kind).is('withdrawn_at', null).maybeSingle()
    if (deja) {
      // Devis modifié depuis sa mise à disposition et pas encore signé : nouvelle version (l'ancienne est retirée)
      const modifie = type === 'quote' && obj.updated_at && new Date(obj.updated_at) > new Date(deja.published_at)
      if (!modifie) return res.status(200).json({ id: deja.id, deja: true })
      const { data: sig } = await admin.from('document_signatures').select('id').eq('status', 'valid').eq('metadata->>document_id', deja.id).limit(1)
      if (sig?.length) return res.status(200).json({ id: deja.id, deja: true, signe: true })
      const { error: eRetrait } = await admin.from('client_shared_documents').update({ withdrawn_at: new Date().toISOString(), withdrawn_reason: 'Nouvelle version du document' }).eq('id', deja.id)
      if (eRetrait) return res.status(500).json({ error: 'Remplacement impossible' })
    }
  }

  const buf = Buffer.from(String(b64), 'base64')
  if (!buf.length || buf.length > MAX || buf.subarray(0, 4).toString() !== '%PDF') return res.status(400).json({ error: 'Fichier invalide' })
  const sha = crypto.createHash('sha256').update(buf).digest('hex')
  const path = `${clientId}/${type}/${id}/${kind}-${sha.slice(0, 16)}.pdf`
  const { error: up } = await admin.storage.from(BUCKET).upload(path, buf, { contentType: 'application/pdf', upsert: false })
  if (up && !/exists|duplicate/i.test(up.message || '')) return res.status(500).json({ error: 'Dépôt impossible' })
  const { data: cl } = await admin.from('clients').select('company_id').eq('id', clientId).maybeSingle()
  const nom = [ctx.profile.first_name, ctx.profile.last_name].filter(Boolean).join(' ') || ctx.profile.display_name || null
  const { data: row, error } = await admin.from('client_shared_documents').insert({
    company_id: cl?.company_id, client_id: clientId, object_type: type, object_id: id, kind, label: lib,
    file_path: path, sha256: sha, size_bytes: buf.length, published_by: ctx.user.id, published_by_name: nom,
  }).select('id').single()
  if (error) {
    if (/duplicate|unique/i.test(error.message || '')) return res.status(200).json({ deja: true })
    return res.status(500).json({ error: 'Enregistrement impossible' })
  }
  return res.status(200).json({ id: row.id, sha256: sha })
}

async function lienSigne(admin, path) {
  if (!path || String(path).includes('..')) return null
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 300)
  return error ? null : data?.signedUrl || null
}

async function lire(req, res) {
  const { token, code, document_id: docId } = req.body || {}
  if (!UUID.test(String(docId || ''))) return res.status(400).json({ error: 'Document invalide' })
  const admin = getAdminClient()
  let liste = null
  if (token && code) {
    if (!/^[0-9]{6}$/.test(String(code))) return res.status(403).json({ error: 'Accès refusé' })
    const { data } = await admin.rpc('client_portal_mes_documents', { p_token: String(token), p_code: String(code) })
    liste = data
  } else {
    const ctx = await requireUser(req)
    if (!ctx || ctx.profile.role !== 'entreprise') return res.status(403).json({ error: 'Accès refusé' })
    const { data } = await clientDeLAppelant(req).rpc('ent_mes_documents')
    liste = data
  }
  if (!Array.isArray(liste) || !liste.some((d) => d.id === docId)) return res.status(403).json({ error: 'Accès refusé' })
  const { data: doc } = await admin.from('client_shared_documents').select('file_path').eq('id', docId).maybeSingle()
  const url = await lienSigne(admin, doc?.file_path)
  return url ? res.status(200).json({ url }) : res.status(404).json({ error: 'Fichier introuvable' })
}

async function lireInterne(req, res) {
  const ctx = await requireUser(req)
  if (!ctx || ctx.profile.role === 'entreprise') return res.status(403).json({ error: 'Accès refusé' })
  const docId = String(req.body?.document_id || '')
  if (!UUID.test(docId)) return res.status(400).json({ error: 'Document invalide' })
  const { data: doc } = await clientDeLAppelant(req).from('client_shared_documents').select('file_path').eq('id', docId).maybeSingle()
  if (!doc) return res.status(403).json({ error: 'Accès refusé' })
  const url = await lienSigne(ctx.admin, doc.file_path)
  return url ? res.status(200).json({ url }) : res.status(404).json({ error: 'Fichier introuvable' })
}

// Accès du client : lien et code (vérifiés par la base) ou compte entreprise connecté
async function accesClient(req) {
  const { token, code } = req.body || {}
  const admin = getAdminClient()
  if (token && code) {
    if (!/^[0-9]{6}$/.test(String(code))) return null
    const [{ data: d }, { data: docs }, { data: acc }] = await Promise.all([
      admin.rpc('client_portal_data', { p_token: String(token), p_code: String(code) }),
      admin.rpc('client_portal_mes_documents', { p_token: String(token), p_code: String(code) }),
      admin.from('client_portal_access').select('id, client_id').eq('token', String(token)).maybeSingle(),
    ])
    if (!d || d.error || !acc?.client_id) return null
    return { admin, clientId: acc.client_id, canal: 'lien', accessId: acc.id, profileId: null, sessions: d.sessions || [], docs: Array.isArray(docs) ? docs : [] }
  }
  const ctx = await requireUser(req)
  if (!ctx || ctx.profile.role !== 'entreprise') return null
  const appelant = clientDeLAppelant(req)
  const [{ data: d }, { data: docs }, { data: compte }] = await Promise.all([
    appelant.rpc('ent_sessions'), appelant.rpc('ent_mes_documents'),
    // Société affichée (0450 : un compte peut suivre plusieurs sociétés clientes)
    appelant.rpc('ent_societes').then((r) => ({ data: (Array.isArray(r.data) ? r.data : []).find((x) => x.actif) || null })),
  ])
  if (!d || !compte?.client_id) return null
  return { admin: ctx.admin, clientId: compte.client_id, canal: 'compte', accessId: null, profileId: ctx.user.id, sessions: d.sessions || [], docs: Array.isArray(docs) ? docs : [] }
}

async function deposerSigne(req, res) {
  const a = await accesClient(req)
  if (!a) return res.status(403).json({ error: 'Accès refusé' })
  const { document_id: docId, session_id: sessionId, pdf_base64: b64, original_bytes: orig, name } = req.body || {}
  let cible = null
  if (docId) {
    if (!UUID.test(String(docId))) return res.status(400).json({ error: 'Document invalide' })
    const doc = a.docs.find((x) => x.id === docId)
    if (!doc || doc.kind !== 'devis') return res.status(403).json({ error: 'Document non signable' })
    const { data: row } = await a.admin.from('client_shared_documents').select('object_type, object_id, label').eq('id', docId).maybeSingle()
    if (!row || row.object_type !== 'quote') return res.status(403).json({ error: 'Document non signable' })
    const { data: q } = await a.admin.from('quotes').select('id, status, reference').eq('id', row.object_id).maybeSingle()
    if (!q || ['accepted', 'refused', 'expired', 'invoiced'].includes(q.status)) return res.status(400).json({ error: 'Ce devis ne se signe plus' })
    cible = { type: 'quote', id: q.id, kind: 'devis', label: `${row.label} (signé, déposé par le client)`, bucket: BUCKET, lien: `/devis?open=${q.id}`, ref: q.reference }
  } else if (sessionId) {
    if (!UUID.test(String(sessionId))) return res.status(400).json({ error: 'Session invalide' })
    const s = a.sessions.find((x) => x.id === sessionId)
    if (!s || s.convention_signed) return res.status(403).json({ error: 'Convention non signable' })
    cible = { type: 'session', id: s.id, kind: 'convention', label: `Convention ${s.reference || ''} (signée, déposée par le client)`.replace(/\s+/g, ' '), bucket: 'signed-conventions', lien: `/sessions/${s.id}`, ref: s.reference }
  } else return res.status(400).json({ error: 'Document manquant' })

  const buf = Buffer.from(String(b64 || ''), 'base64')
  if (!buf.length || buf.length > MAX || buf.subarray(0, 4).toString() !== '%PDF') return res.status(400).json({ error: 'Fichier invalide (PDF de 3,5 Mo au plus)' })
  const sha = crypto.createHash('sha256').update(buf).digest('hex')
  const path = cible.type === 'session' ? `${cible.id}/depot-client-${sha.slice(0, 16)}.pdf` : `${a.clientId}/depots/quote/${cible.id}/signe-${sha.slice(0, 16)}.pdf`
  const { error: up } = await a.admin.storage.from(cible.bucket).upload(path, buf, { contentType: 'application/pdf', upsert: false })
  if (up && !/exists|duplicate/i.test(up.message || '')) return res.status(500).json({ error: 'Dépôt impossible' })
  const { data: cl } = await a.admin.from('clients').select('company_id, name').eq('id', a.clientId).maybeSingle()
  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim().slice(0, 64) || null
  const nom = String(name || '').trim().slice(0, 120) || null
  const { data: row, error } = await a.admin.from('client_deposits').insert({
    company_id: cl?.company_id, client_id: a.clientId, object_type: cible.type, object_id: cible.id, kind: cible.kind, label: cible.label.slice(0, 200),
    bucket: cible.bucket, file_path: path, sha256: sha, size_bytes: buf.length, original_bytes: Number(orig) > 0 ? Math.round(Number(orig)) : null,
    channel: a.canal, access_id: a.accessId, profile_id: a.profileId, depositor_name: nom, ip, user_agent: String(req.headers['user-agent'] || '').slice(0, 400) || null,
  }).select('id').single()
  if (error) return res.status(500).json({ error: 'Enregistrement impossible' })
  await a.admin.from('notifications').insert({
    company_id: cl?.company_id, type: 'depot_client', title: cible.kind === 'devis' ? 'Devis signé déposé par le client' : 'Convention signée déposée par le client',
    message: `${cl?.name || 'Le client'} a déposé ${cible.kind === 'devis' ? 'le devis' : 'la convention'} ${cible.ref || ''} signé${cible.kind === 'devis' ? '' : 'e'} à la main : à vérifier et valider.`.replace(/\s+/g, ' '),
    link: cible.lien, metadata: { depot_id: row.id, object_type: cible.type, object_id: cible.id },
  })
  await a.admin.from('portal_events').insert({
    company_id: cl?.company_id, client_id: a.clientId, channel: a.canal, access_id: a.accessId, profile_id: a.profileId, event: 'depot',
    object_type: cible.type, object_id: cible.id, document_kind: cible.kind, document_label: cible.label.slice(0, 200), document_sha256: sha, ip,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 400) || null,
  })
  return res.status(200).json({ id: row.id })
}

async function lireDepot(req, res) {
  const ctx = await requireUser(req)
  if (!ctx || ctx.profile.role === 'entreprise') return res.status(403).json({ error: 'Accès refusé' })
  const id = String(req.body?.depot_id || '')
  if (!UUID.test(id)) return res.status(400).json({ error: 'Dépôt invalide' })
  const { data: d } = await clientDeLAppelant(req).from('client_deposits').select('bucket, file_path').eq('id', id).maybeSingle()
  if (!d || String(d.file_path).includes('..')) return res.status(403).json({ error: 'Accès refusé' })
  const { data, error } = await ctx.admin.storage.from(d.bucket).createSignedUrl(d.file_path, 300)
  return !error && data?.signedUrl ? res.status(200).json({ url: data.signedUrl }) : res.status(404).json({ error: 'Fichier introuvable' })
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  try {
    const { action } = req.body || {}
    if (action === 'publier') return await publier(req, res)
    if (action === 'lire') return await lire(req, res)
    if (action === 'lire_interne') return await lireInterne(req, res)
    if (action === 'deposer_signe') return await deposerSigne(req, res)
    if (action === 'lire_depot') return await lireDepot(req, res)
    return res.status(400).json({ error: 'Action inconnue' })
  } catch (e) {
    console.error('documents-client : erreur', e?.code || e?.name || 'inconnue')
    return res.status(500).json({ error: 'Erreur serveur' })
  }
}

export default withErrorLog(handler, 'documents-client')
