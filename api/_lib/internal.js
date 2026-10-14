// api/_lib/internal.js
// Emails internes (rapports, alertes) : destinataires et compte d'envoi lus en base.
// Destinataires : les dirigeants (profils superadmin, sinon admin), sinon l'email de l'organisme.
// Expéditeur : l'adresse d'envoi par défaut de Paramètres, sinon le compte d'un dirigeant, sinon le premier compte actif.
// Le transporteur passe par createTransporter : le mode démonstration s'applique.

import { getOrg, decrypt, createTransporter } from './mailer.js'
import { loadTeam, leaders, profileFirstName } from './team.js'

export async function internalRecipients(supabase) {
  const team = await loadTeam(supabase)
  const heads = leaders(team)
  const list = heads.map((p) => ({ email: p.sender_email || p.email, firstName: profileFirstName(p) })).filter((r) => r.email)
  if (list.length) return list
  const org = await getOrg(supabase)
  return org.email ? [{ email: org.email, firstName: '' }] : []
}

export async function internalMailer(supabase, preferredEmails = []) {
  const { data: configs } = await supabase.from('user_email_configs').select('*').eq('is_active', true)
  if (!configs || configs.length === 0) return { error: 'Aucune configuration email active' }
  const org = await getOrg(supabase)
  const wanted = [org.email_default_sender, ...preferredEmails].map((e) => String(e || '').toLowerCase()).filter(Boolean)
  const cfg = wanted.map((w) => configs.find((c) => String(c.email).toLowerCase() === w)).find(Boolean) || configs[0]
  const transporter = createTransporter(cfg, decrypt(cfg.smtp_password_encrypted), supabase)
  const fromName = org.app_name || org.name || ''
  return { transporter, cfg, org, from: fromName ? `"${fromName.replace(/"/g, '')}" <${cfg.email}>` : cfg.email }
}

/** Formule d'appel : « Bonjour Prénom, » pour un seul destinataire nommé, sinon « Bonjour, » */
export function greeting(recipients) {
  return recipients.length === 1 && recipients[0].firstName ? `Bonjour ${recipients[0].firstName},` : 'Bonjour,'
}

/** Adresse de l'application : variable APP_URL, sinon l'hôte qui a reçu la requête */
export function appUrl(req) {
  const env = String(process.env.APP_URL || '').replace(/\/$/, '')
  if (env) return env
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host || ''
  return host ? `https://${host}` : ''
}
