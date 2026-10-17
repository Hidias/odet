// api/retours.js : retours des utilisateurs (post-it).
// POST  : un compte interne actif envoie le texte de son post-it.
// GET   : le super administrateur lit les retours.
// PATCH : le super administrateur change le statut d'un retour (nouveau, fait, écarté).
// La table user_feedback n'a aucune règle d'accès et aucun droit pour anon ni pour les comptes connectés
// (0260) : seul ce serveur la lit et l'écrit (clé de service).
// Contrôle (chantier 2) : connexion vérifiée, compte actif, rôle interne (OFFICE) pour écrire,
// super administrateur seulement pour lire et traiter. Les comptes externes (entreprise, formateur
// externe) n'écrivent pas.
// Journaux : jamais le texte d'un retour ni le nom de son auteur.

import { requireRole, OFFICE, SA } from './_lib/auth.js'
import { withErrorLog } from './_lib/errors.js'

const STATUSES = ['nouveau', 'fait', 'ecarte']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const clip = (v, n) => (v == null ? null : String(v).slice(0, n))

async function handler(req, res) {
  if (!['POST', 'GET', 'PATCH'].includes(req.method)) return res.status(405).json({ error: 'Méthode non autorisée' })
  const ctx = await requireRole(req, res, req.method === 'POST' ? OFFICE : SA)
  if (!ctx) return
  const { user, profile, admin } = ctx

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

    if (req.method === 'GET') {
      const { data, error } = await admin.from('user_feedback')
        .select('id, created_at, author_label, page_path, page_title, viewport, message, status, handled_at')
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return res.status(200).json({ items: data || [] })
    }

    // PATCH
    const { id, status } = req.body || {}
    if (!id || !UUID.test(String(id)) || !STATUSES.includes(status)) return res.status(400).json({ error: 'Retour ou statut invalide' })
    const done = status !== 'nouveau'
    const { error } = await admin.from('user_feedback')
      .update({ status, handled_at: done ? new Date().toISOString() : null, handled_by: done ? user.id : null })
      .eq('id', id)
    if (error) throw error
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[retours] échec', req.method, err?.code || 'erreur')
    return res.status(500).json({ error: 'Le retour n\'a pas pu être traité' })
  }
}

export default withErrorLog(handler, 'retours')
