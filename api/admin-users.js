import { requireRole } from './_lib/auth.js'

// Gestion des comptes par un administrateur de l'organisme :
//  - invite : crée le compte et envoie l'invitation (l'utilisateur choisit son mot de passe)
//  - reset  : envoie un lien de réinitialisation du mot de passe
//  - set_role, set_active : via la table profiles (RLS : admins)
//  - delete : supprime le compte Auth (super admin uniquement)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  // Gestion des comptes : super administrateur seulement (décision du 17/10)
  const ctx = await requireRole(req, res, ['superadmin'])
  if (!ctx) return
  const { admin, profile } = ctx
  const { action, email, role, user_id, display_name, first_name, last_name } = req.body || {}
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '')

  try {
    if (action === 'invite') {
      if (!email) return res.status(400).json({ error: 'Email requis' })
      const wanted = role || 'gestionnaire'
      if (wanted === 'superadmin' && profile.role !== 'superadmin') {
        return res.status(403).json({ error: 'Seul un super administrateur peut créer un super administrateur' })
      }
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email.trim().toLowerCase(), {
        data: { role: wanted, display_name, first_name, last_name },
        redirectTo: appUrl ? `${appUrl}/?auth=welcome` : undefined,
      })
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ ok: true, user_id: data.user?.id })
    }

    if (action === 'reset') {
      if (!email) return res.status(400).json({ error: 'Email requis' })
      const { data, error } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email: email.trim().toLowerCase(),
        options: { redirectTo: appUrl ? `${appUrl}/?auth=reset` : undefined },
      })
      if (error) return res.status(400).json({ error: error.message })
      // Le lien est renvoyé à l'administrateur, qui le transmet (utile quand l'email ne part pas)
      return res.status(200).json({ ok: true, link: data?.properties?.action_link || null })
    }

    if (action === 'delete') {
      if (profile.role !== 'superadmin') return res.status(403).json({ error: 'Réservé au super administrateur' })
      if (!user_id) return res.status(400).json({ error: 'Identifiant requis' })
      if (user_id === profile.id) return res.status(400).json({ error: 'Impossible de supprimer son propre compte' })
      const { error } = await admin.auth.admin.deleteUser(user_id)
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'Action inconnue' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
