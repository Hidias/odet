// api/point-semaine.js
// Envoi du point de la semaine ou du bilan (0407) aux destinataires choisis dans les utilisateurs.
// L'appelant doit avoir le droit du cockpit de direction ; le point est lu avec ses droits (jeton), les adresses des
// destinataires avec le compte de service. Le mode démonstration et l'environnement de test redirigent l'envoi.
// L'envoi est noté sur le point (date, auteur, destinataires). Aucun envoi automatique.

import { requireRight, clientDeLAppelant, MANAGERS } from './_lib/auth.js'
import { internalMailer, appUrl } from './_lib/internal.js'
import { withErrorLog } from './_lib/errors.js'
import { emailPoint, objetEmail } from '../src/core/point/pointSemaine.js'

export const config = { maxDuration: 30 }
const UUID = /^[0-9a-f-]{36}$/i

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' })
  const ctx = await requireRight(req, res, 'manager.cockpit.voir', MANAGERS)
  if (!ctx) return
  const { brief_id: id, apercu } = req.body || {}
  if (!UUID.test(String(id || ''))) return res.status(400).json({ error: 'Point inconnu' })

  const appelant = clientDeLAppelant(req)
  const { data: brief } = await appelant.from('weekly_briefs').select('*').eq('id', id).maybeSingle()
  if (!brief) return res.status(403).json({ error: 'Accès refusé' })

  const admin = ctx.admin
  const col = brief.kind === 'bilan' ? 'bilan' : 'point'
  const { data: dest } = await admin.from('weekly_brief_recipients').select('profile_id').eq('company_id', brief.company_id).eq(col, true)
  const ids = (dest || []).map((d) => d.profile_id)
  const { data: profils } = ids.length
    ? await admin.from('profiles').select('id, email, sender_email, first_name, display_name, is_active').in('id', ids)
    : { data: [] }
  const liste = (profils || []).filter((p) => p.is_active !== false && (p.sender_email || p.email))
    .map((p) => ({ id: p.id, email: p.sender_email || p.email, prenom: p.first_name || '' }))
  if (!liste.length) return res.status(400).json({ error: 'Aucun destinataire choisi : Paramètres › Utilisateurs, colonne « Point et bilan ».' })

  const mailer = await internalMailer(admin)
  if (mailer.error) return res.status(400).json({ error: mailer.error })
  const { transporter, org } = mailer
  const html = emailPoint(brief, {
    appUrl: appUrl(req),
    couleur: org.brand_nav || '#1f2937',
    bonjour: liste.length === 1 && liste[0].prenom ? `Bonjour ${liste[0].prenom},` : 'Bonjour à tous,',
    signature: `${org.app_name || org.name || ''} : ${brief.kind === 'bilan' ? 'bilan du vendredi' : 'point du lundi'}`,
  })
  if (apercu) { transporter.close(); return res.status(200).json({ html, destinataires: liste.map((d) => d.email) }) }

  await transporter.sendMail({ from: mailer.from, to: liste.map((d) => d.email).join(', '), subject: objetEmail(brief, org.name || ''), html })
  transporter.close()
  await admin.from('weekly_briefs').update({ sent_at: new Date().toISOString(), sent_by: ctx.user.id, sent_to: liste.map((d) => d.email) }).eq('id', brief.id)
  return res.status(200).json({ ok: true, destinataires: liste.length })
}

export default withErrorLog(handler, 'point-semaine')
