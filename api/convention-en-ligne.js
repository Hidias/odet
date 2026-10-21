import crypto from 'node:crypto'
import { getAdminClient, requireUser, clientDeLAppelant } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

// Convention de l'espace client (0402), par lien et code ou par compte entreprise.
//  - deposer : après une signature en ligne, garde le PDF exact présenté au signataire. Son empreinte SHA-256 doit être
//    celle enregistrée avec la signature : aucun autre fichier n'est accepté. Rangé dans le bucket privé des
//    conventions signées ; devient la convention signée de la session si aucune n'y est déjà.
//  - lire : lien de 5 minutes vers la convention signée de la session (signée en ligne, ou scan déposé par
//    l'organisme après un retour par e-mail), si la session appartient bien à ce client.
// Aucune autre donnée n'est renvoyée.

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } }

const BUCKET = 'signed-conventions'
const UUID = /^[0-9a-f-]{36}$/i
const MAX = 12 * 1024 * 1024

// Accès : lien et code (vérifiés par la base, mêmes essais comptés) ou compte entreprise connecté
async function acces(req) {
  const { token, code } = req.body || {}
  const admin = getAdminClient()
  if (token && code) {
    if (!/^[0-9]{6}$/.test(String(code))) return null
    const [{ data: d }, { data: sg }] = await Promise.all([
      admin.rpc('client_portal_data', { p_token: String(token), p_code: String(code) }),
      admin.rpc('client_portal_signatures', { p_token: String(token), p_code: String(code) }),
    ])
    if (!d || d.error) return null
    return { admin, sessions: d.sessions || [], signatures: Array.isArray(sg) ? sg : [] }
  }
  const ctx = await requireUser(req)
  if (!ctx || ctx.profile.role !== 'entreprise') return null
  const appelant = clientDeLAppelant(req)
  if (!appelant) return null
  const [{ data: d, error }, { data: sg }] = await Promise.all([appelant.rpc('ent_sessions'), appelant.rpc('ent_signatures')])
  if (error || !d) return null
  return { admin: ctx.admin, sessions: d.sessions || [], signatures: Array.isArray(sg) ? sg : [] }
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const { action } = req.body || {}
  try {
    const a = await acces(req)
    if (!a) return res.status(403).json({ error: 'Accès refusé' })

    if (action === 'deposer') {
      const sigId = String(req.body?.signature_id || '')
      const b64 = String(req.body?.pdf_base64 || '')
      if (!UUID.test(sigId) || !b64) return res.status(400).json({ error: 'Paramètres manquants' })
      const sig = a.signatures.find((x) => x.id === sigId && x.document_type === 'convention')
      if (!sig) return res.status(403).json({ error: 'Accès refusé' })
      const buf = Buffer.from(b64, 'base64')
      if (!buf.length || buf.length > MAX || buf.subarray(0, 4).toString() !== '%PDF') return res.status(400).json({ error: 'Fichier invalide' })
      const sha = crypto.createHash('sha256').update(buf).digest('hex')
      if (sha !== sig.document_hash) return res.status(409).json({ error: 'Ce document n\'est pas celui qui a été signé' })
      const path = `${sig.session_id}/convention-signee-en-ligne-${sigId}.pdf`
      const { error: up } = await a.admin.storage.from(BUCKET).upload(path, buf, { contentType: 'application/pdf', upsert: false })
      if (up && !/exists|duplicate/i.test(up.message || '')) return res.status(500).json({ error: 'Dépôt impossible' })
      await a.admin.from('sessions').update({ convention_signed_file_url: path }).eq('id', sig.session_id).is('convention_signed_file_url', null)
      return res.status(200).json({ ok: true })
    }

    if (action === 'lire') {
      const sessionId = String(req.body?.session_id || '')
      if (!UUID.test(sessionId) || !a.sessions.some((s) => s.id === sessionId)) return res.status(403).json({ error: 'Accès refusé' })
      const { data: ses } = await a.admin.from('sessions').select('convention_signed_file_url').eq('id', sessionId).maybeSingle()
      const path = ses?.convention_signed_file_url
      if (!path || String(path).includes('..')) return res.status(404).json({ error: 'Aucune convention signée déposée' })
      const { data: s, error } = await a.admin.storage.from(BUCKET).createSignedUrl(path, 300)
      if (error || !s?.signedUrl) return res.status(404).json({ error: 'Aucune convention signée déposée' })
      return res.status(200).json({ url: s.signedUrl })
    }

    return res.status(400).json({ error: 'Action inconnue' })
  } catch (e) {
    console.error('convention-en-ligne : erreur', e?.code || e?.name || 'inconnue')
    return res.status(500).json({ error: 'Erreur serveur' })
  }
}

export default withErrorLog(handler, 'convention-en-ligne')
