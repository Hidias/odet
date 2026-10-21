import { getAdminClient } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

// Portail stagiaire (sans compte) : lien de lecture d'un livret de formation.
// Le bucket course-documents est privé (0392) : le navigateur du stagiaire ne peut plus lire le fichier.
// Cette route vérifie le jeton de la session par portal_documents (mêmes règles que l'écran : documents activés
// pour cette session), contrôle que le document en fait partie, puis renvoie un lien signé de 5 minutes.
// Aucune autre donnée n'est renvoyée.

const BUCKET = 'course-documents'

function pathFrom(url) {
  const s = String(url || '')
  const i = s.indexOf(`/${BUCKET}/`)
  if (i < 0) return null
  const path = decodeURIComponent(s.slice(i + BUCKET.length + 2).split('?')[0])
  return path && !path.includes('..') ? path : null
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const { token, document_id: documentId } = req.body || {}
  if (!token || !documentId) return res.status(400).json({ error: 'Paramètres manquants' })
  if (!/^[0-9a-f-]{36}$/i.test(String(documentId))) return res.status(400).json({ error: 'Document invalide' })

  try {
    const admin = getAdminClient()
    const { data, error } = await admin.rpc('portal_documents', { p_token: String(token) })
    if (error || !Array.isArray(data)) return res.status(403).json({ error: 'Accès refusé' })
    const doc = data.find((d) => d.id === documentId)
    if (!doc) return res.status(403).json({ error: 'Accès refusé' })
    const path = pathFrom(doc.file_url)
    if (!path) return res.status(404).json({ error: 'Fichier introuvable' })
    const { data: signe, error: e2 } = await admin.storage.from(BUCKET).createSignedUrl(path, 300)
    if (e2 || !signe?.signedUrl) return res.status(404).json({ error: 'Fichier introuvable' })
    return res.status(200).json({ url: signe.signedUrl })
  } catch (e) {
    console.error('portail-document : erreur', e?.code || e?.name || 'inconnue')
    return res.status(500).json({ error: 'Erreur serveur' })
  }
}

export default withErrorLog(handler, 'portail-document')
