import { requireRole, ADMINS } from './_lib/auth.js'
import { internalMailer } from './_lib/internal.js'
import { sendWithRetry } from './_lib/mailer.js'

// Rang hiérarchique : superadmin > admin > tous les autres rôles
const RANK = { superadmin: 3, admin: 2 }
const rankOf = (role) => RANK[role] || 1

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Gestion des comptes par un administrateur de l'organisme :
//  - invite : crée le compte et envoie l'invitation (l'utilisateur choisit son mot de passe)
//  - reset  : super administrateur : renvoie le lien de réinitialisation (comportement d'origine) ;
//             administrateur : envoie le lien par email à la personne visée, refusé si le compte visé
//             est de rang supérieur ou égal
//  - set_role, set_active : via la table profiles (RLS : admins)
//  - delete : supprime le compte Auth (super admin uniquement)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const ctx = await requireRole(req, res, ADMINS)
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
      const target = email.trim().toLowerCase()

      // Contrôle hiérarchique AVANT de générer le lien : superadmin > admin > autres rôles
      const { data: targetProfile } = await admin.from('profiles')
        .select('id, role, first_name, display_name').ilike('email', target.replace(/[\\%_]/g, (c) => `\\${c}`)).maybeSingle()
      if (profile.role !== 'superadmin' && rankOf(targetProfile?.role) >= rankOf(profile.role)) {
        return res.status(403).json({ error: 'Vous ne pouvez pas réinitialiser le mot de passe d\'un compte de rang égal ou supérieur au vôtre' })
      }

      const { data, error } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email: target,
        options: { redirectTo: appUrl ? `${appUrl}/?auth=reset` : undefined },
      })
      if (error) return res.status(400).json({ error: error.message })
      const link = data?.properties?.action_link || null
      if (!link) return res.status(500).json({ error: 'Lien de réinitialisation non généré' })

      // Super administrateur : le lien lui est rendu, comme avant (il le transmet lui-même,
      // par exemple pour régler le mot de passe d'un compte de terrain en fenêtre privée)
      if (profile.role === 'superadmin') {
        return res.status(200).json({ ok: true, sent: false, link })
      }

      // Administrateur : le lien part directement à la personne visée, depuis la boîte d'envoi de l'organisme
      const mailer = await internalMailer(admin, [profile.sender_email, profile.email])
      if (!mailer.error) {
        try {
          const name = targetProfile?.first_name || String(targetProfile?.display_name || '').split(' ')[0] || ''
          const appName = mailer.org?.app_name || mailer.org?.name || ''
          await sendWithRetry(mailer.transporter, {
            from: mailer.from,
            to: target,
            subject: `Réinitialisation de votre mot de passe${appName ? ` ${appName}` : ''}`,
            html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;">
              <p>Bonjour${name ? ` ${escapeHtml(name)}` : ''},</p>
              <p>Un administrateur a demandé la réinitialisation de votre mot de passe. Cliquez sur le lien ci-dessous pour en choisir un nouveau (lien valable une seule fois) :</p>
              <p><a href="${escapeHtml(link)}" style="color:#2563eb;">Choisir un nouveau mot de passe</a></p>
              <p style="color:#888;font-size:12px;">Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>
            </div>`,
            text: `Bonjour${name ? ` ${name}` : ''},\n\nUn administrateur a demandé la réinitialisation de votre mot de passe. Lien (valable une seule fois) :\n${link}\n`,
          }, 2)
          try { mailer.transporter.close() } catch {}
          return res.status(200).json({ ok: true, sent: true })
        } catch (e) {
          console.error('[admin-users] envoi du lien de réinitialisation impossible :', e.message)
        }
      }

      // Envoi impossible (aucune boîte configurée ou échec SMTP) : le lien n'est renvoyé
      // qu'à un super administrateur, qui le transmet lui-même. Un administrateur reçoit une erreur.
      if (profile.role === 'superadmin') {
        return res.status(200).json({ ok: true, sent: false, link })
      }
      return res.status(502).json({ error: 'Email de réinitialisation non envoyé : configurez une boîte d\'envoi dans Paramètres > Comptes email' })
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
