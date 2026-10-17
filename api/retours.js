// api/retours.js : retours des utilisateurs (post-it).
// POST  : un utilisateur connecté envoie le texte de son post-it.
// GET   : le super administrateur lit les retours.
// PATCH : le super administrateur change le statut d'un retour (nouveau, fait, écarté).
// La table user_feedback n'a aucune règle d'accès : seul ce serveur la lit et l'écrit (clé de service).
// Journaux : jamais le texte d'un retour ni le nom de son auteur.

import { requireUser } from './_lib/auth.js'

const STATUSES = ['nouveau', 'fait', 'ecarte']
const clip = (v, n) => (v == null ? null : String(v).slice(0, n))

export default async function handler(req, res) {
  const ctx = await requireUser(req)
  if (!ctx) return res.status(401).json({ error: 'Connexion requise' })
  const { user, profile, admin } = ctx
  const isSuperadmin = profile.role === 'superadmin'

  try {
    if (req.method === 'POST') {
      const body = req.body || {}
      const message = String(body.message || '').trim()
      if (!message) return res.status(400).json({ error: 'Le post-it est vide' })
      if (message.length > 4000) return res.status(400).json({ error: 'Texte trop long (4 000 caractères au plus)' })
      const { error } = await admin.from('user_feedback').insert({
        author_id: user.id,
        author_label: clip(profile.display_name || user.email, 200),
        page_path: clip(body.page_path, 500),
        page_title: clip(body.page_title, 200),
        viewport: clip(body.viewport, 40),
        message,
      })
      if (error) throw error
      return res.status(200).json({ ok: true })
    }

    if (!isSuperadmin) return res.status(403).json({ error: 'Réservé au super administrateur' })

    if (req.method === 'GET') {
      const { data, error } = await admin.from('user_feedback')
        .select('id, created_at, author_label, page_path, page_title, viewport, message, status, handled_at')
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return res.status(200).json({ items: data || [] })
    }

    if (req.method === 'PATCH') {
      const { id, status } = req.body || {}
      if (!id || !STATUSES.includes(status)) return res.status(400).json({ error: 'Retour ou statut invalide' })
      const done = status !== 'nouveau'
      const { error } = await admin.from('user_feedback')
        .update({ status, handled_at: done ? new Date().toISOString() : null, handled_by: done ? user.id : null })
        .eq('id', id)
      if (error) throw error
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Méthode non autorisée' })
  } catch (err) {
    console.error('[retours] échec', req.method, err?.code || 'erreur')
    return res.status(500).json({ error: 'Le retour n\'a pas pu être traité' })
  }
}
