import { requireRight } from './_lib/auth.js'
import { internalMailer } from './_lib/internal.js'
import { sendWithRetry } from './_lib/mailer.js'
import { withErrorLog } from './_lib/errors.js'

// Rang hiérarchique : superadmin > admin > tous les autres rôles
const RANK = { superadmin: 3, admin: 2 }
const rankOf = (role) => RANK[role] || 1

const adresseValide = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254
const echapperMotif = (v) => v.replace(/[\\%_]/g, (c) => `\\${c}`)

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Gestion des comptes par un administrateur de l'organisme :
//  - invite : crée le compte et envoie l'invitation (l'utilisateur choisit son mot de passe)
//  - reset  : super administrateur : renvoie le lien de réinitialisation (comportement d'origine) ;
//             administrateur : envoie le lien par email à la personne visée, refusé si le compte visé
//             est de rang supérieur ou égal
//  - set_role, set_active : via la table profiles (RLS : admins)
//  - email  : change l'adresse de connexion (super admin uniquement). Même compte, même mot de passe, mêmes droits,
//             session en cours conservée ; la fiche profil (et la fiche formateur, par la base) suit
//  - activite : dernière connexion de chaque compte, pour savoir s'il peut être supprimé
//  - delete : supprime le compte Auth (super admin uniquement), seulement s'il n'a aucune activité
//             (jamais connecté, aucune ligne au journal d'audit) ; sinon il se désactive

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  // Gestion des comptes : droit parametres.utilisateurs.gerer (super administrateur, administrateur avec la
  // licence totale, 0379). Droits inconnus : super administrateur seulement (décision du 17/10, PR #15).
  const ctx = await requireRight(req, res, 'parametres.utilisateurs.gerer', ['superadmin'])
  if (!ctx) return
  const { admin, profile } = ctx
  const { action, email, role, user_id, display_name, first_name, last_name, new_email, fonction, phone } = req.body || {}
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
      // Fonction et téléphone (signature des emails) : posés sur la fiche créée par la base à l'invitation
      if (data.user?.id && (fonction || phone)) {
        const fiche = {}
        if (fonction) fiche.fonction = String(fonction).trim().slice(0, 120)
        if (phone) fiche.phone = String(phone).trim().slice(0, 30)
        await admin.from('profiles').update(fiche).eq('id', data.user.id)
      }
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

    if (action === 'email') {
      if (profile.role !== 'superadmin') return res.status(403).json({ error: 'Réservé au super administrateur' })
      if (!user_id) return res.status(400).json({ error: 'Identifiant requis' })
      const cible = String(new_email || '').trim().toLowerCase()
      if (!adresseValide(cible)) return res.status(400).json({ error: 'Adresse email invalide' })
      const { data: avant, error: e1 } = await admin.auth.admin.getUserById(user_id)
      if (e1 || !avant?.user) return res.status(404).json({ error: 'Compte introuvable' })
      if (String(avant.user.email || '').toLowerCase() === cible) return res.status(400).json({ error: 'C\'est déjà l\'adresse de ce compte' })
      const { data: pris } = await admin.from('profiles').select('id').ilike('email', echapperMotif(cible)).neq('id', user_id).limit(1)
      if (pris?.length) return res.status(409).json({ error: 'Cette adresse est déjà utilisée par un autre compte' })
      // Changement fait par l'administrateur : aucune confirmation demandée, le mot de passe et les sessions restent
      const { error: e2 } = await admin.auth.admin.updateUserById(user_id, { email: cible, email_confirm: true })
      if (e2) return res.status(400).json({ error: e2.message })
      const { error: e3 } = await admin.from('profiles').update({ email: cible }).eq('id', user_id)
      if (e3) return res.status(500).json({ error: `Adresse de connexion changée, mais la fiche n'a pas suivi : ${e3.message}` })
      return res.status(200).json({ ok: true, email: cible })
    }

    if (action === 'activite') {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (error) return res.status(400).json({ error: error.message })
      const activite = {}
      for (const u of data?.users || []) activite[u.id] = { derniere_connexion: u.last_sign_in_at || null, invitation_acceptee: !!u.email_confirmed_at }
      return res.status(200).json({ ok: true, activite })
    }

    if (action === 'delete') {
      if (profile.role !== 'superadmin') return res.status(403).json({ error: 'Réservé au super administrateur' })
      if (!user_id) return res.status(400).json({ error: 'Identifiant requis' })
      if (user_id === profile.id) return res.status(400).json({ error: 'Impossible de supprimer son propre compte' })
      // Un compte qui a servi garde ses traces (Qualiopi, RGPD) : on le désactive au lieu de le supprimer
      const { data: cibleUser } = await admin.auth.admin.getUserById(user_id)
      const { count: traces } = await admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('user_id', user_id)
      if (cibleUser?.user?.last_sign_in_at || (traces || 0) > 0) {
        return res.status(409).json({ error: 'Ce compte a déjà servi : il ne peut pas être supprimé. Désactivez-le (son historique est conservé).' })
      }
      const { error } = await admin.auth.admin.deleteUser(user_id)
      if (error) return res.status(400).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'Action inconnue' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

export default withErrorLog(handler, 'admin-users')
