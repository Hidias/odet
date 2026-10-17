import { getAdminClient } from './_lib/auth.js'

// Espace entreprise (sans compte) : signature du formateur pour la feuille d'émargement.
// Le bucket trainer-signatures est privé (chantier 2) : le navigateur d'un visiteur ne peut plus lire
// le fichier. Cette route vérifie le lien et le code de l'espace entreprise par client_portal_data
// (mêmes règles et même verrouillage que l'écran), contrôle que la session appartient à cet espace,
// puis renvoie l'image en data URL. Aucune autre donnée n'est renvoyée.

const BUCKET = 'trainer-signatures'

function pathFrom(url) {
  const s = String(url || '')
  const i = s.indexOf(`/${BUCKET}/`)
  if (i < 0) return null
  const path = decodeURIComponent(s.slice(i + BUCKET.length + 2).split('?')[0])
  return path && !path.includes('..') ? path : null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const { token, code, session_id: sessionId } = req.body || {}
  if (!token || !code || !sessionId) return res.status(400).json({ error: 'Paramètres manquants' })
  if (!/^[0-9]{6}$/.test(String(code))) return res.status(400).json({ error: 'Code invalide' })

  try {
    const admin = getAdminClient()
    const { data, error } = await admin.rpc('client_portal_data', { p_token: String(token), p_code: String(code) })
    if (error || !data || data.error) return res.status(403).json({ error: 'Accès refusé' })

    const session = (data.sessions || []).find((s) => s.id === sessionId)
    if (!session) return res.status(403).json({ error: 'Accès refusé' })
    const path = pathFrom(session.trainers?.signature_url)
    if (!path) return res.status(200).json({ dataUrl: null })

    const { data: file, error: dlError } = await admin.storage.from(BUCKET).download(path)
    if (dlError || !file) return res.status(200).json({ dataUrl: null })
    const buf = Buffer.from(await file.arrayBuffer())
    const type = file.type || (path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg')
    return res.status(200).json({ dataUrl: `data:${type};base64,${buf.toString('base64')}` })
  } catch (e) {
    console.error('portail-signature : erreur', e?.code || e?.name || 'inconnue')
    return res.status(500).json({ error: 'Erreur serveur' })
  }
}
