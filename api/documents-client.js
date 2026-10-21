import crypto from 'node:crypto'
import { getAdminClient, requireUser, clientDeLAppelant } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

// Documents mis à disposition dans l'espace client (0404), toutes prestations.
//  - publier (équipe connectée) : range un PDF remis au client (rapport d'intervention, facture émise, devis, contrat,
//    document déposé à la main). L'appelant doit voir la prestation avec ses propres droits (lecture faite avec son
//    jeton) ; le fichier est rangé tel quel avec son empreinte. Un seul document actif par prestation et par type.
//  - lire (espace client, par lien et code ou par compte) : lien de 5 minutes vers un document visible par ce client.
//  - lire_interne (équipe connectée) : lien de 5 minutes vers un document que l'appelant voit.
// Aucun e-mail n'est envoyé.

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } }

const BUCKET = 'client-documents'
const UUID = /^[0-9a-f-]{36}$/i
const MAX = 3.5 * 1024 * 1024
const TABLES = {
  client: ['clients', 'id'],
  session: ['sessions', 'client_id'],
  invoice: ['invoices', 'client_id, billing_client_id, is_subrogation, status'],
  quote: ['quotes', 'client_id'],
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
    const { data: deja } = await admin.from('client_shared_documents').select('id').eq('object_type', type).eq('object_id', id).eq('kind', kind).is('withdrawn_at', null).maybeSingle()
    if (deja) return res.status(200).json({ id: deja.id, deja: true })
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

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  try {
    const { action } = req.body || {}
    if (action === 'publier') return await publier(req, res)
    if (action === 'lire') return await lire(req, res)
    if (action === 'lire_interne') return await lireInterne(req, res)
    return res.status(400).json({ error: 'Action inconnue' })
  } catch (e) {
    console.error('documents-client : erreur', e?.code || e?.name || 'inconnue')
    return res.status(500).json({ error: 'Erreur serveur' })
  }
}

export default withErrorLog(handler, 'documents-client')
