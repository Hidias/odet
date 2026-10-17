// api/_lib/team.js
// Équipe de l'organisme lue en base (profiles et comptes d'envoi) : aucun prénom ni adresse en dur.

// Messageries grand public : leur domaine ne désigne pas l'organisme
const PUBLIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.fr', 'outlook.com', 'outlook.fr', 'live.com', 'live.fr',
  'msn.com', 'yahoo.com', 'yahoo.fr', 'icloud.com', 'me.com', 'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr',
  'laposte.net', 'gmx.fr', 'gmx.com', 'protonmail.com', 'proton.me', 'bbox.fr', 'neuf.fr', 'aol.com',
])

const domainOf = (email) => String(email || '').toLowerCase().split('@')[1] || ''

export const profileFirstName = (p) => p?.first_name || String(p?.display_name || '').split(' ')[0] || ''
export const profileFullName = (p) => p?.display_name || [p?.first_name, p?.last_name].filter(Boolean).join(' ') || ''

/** Profils actifs de l'équipe */
export async function loadTeam(supabase) {
  const { data } = await supabase
    .from('profiles')
    .select('id, email, sender_email, first_name, last_name, display_name, role, phone, fonction, trainer_id, gcal_id, gcal_enabled, is_active')
    .eq('is_active', true)
  return data || []
}

/** Profil correspondant à une adresse (adresse de connexion ou d'envoi) */
export function findProfileByEmail(team, email) {
  const e = String(email || '').toLowerCase()
  return (team || []).find((p) => [p.email, p.sender_email].some((x) => String(x || '').toLowerCase() === e)) || null
}

/** Dirigeants (superadmin, puis admin) : destinataires des rapports internes */
export function leaders(team) {
  const list = team || []
  const sup = list.filter((p) => p.role === 'superadmin')
  return sup.length ? sup : list.filter((p) => p.role === 'admin')
}

/**
 * Filtre des adresses internes : adresses de l'équipe et des comptes d'envoi, domaine propre de l'organisme
 * (hors messageries grand public) et adresses à ignorer saisies dans Paramètres (organization_settings.email_sync_ignored).
 */
export async function loadInternalMatcher(supabase) {
  const [team, { data: configs }, { data: org }] = await Promise.all([
    loadTeam(supabase),
    supabase.from('user_email_configs').select('email'),
    supabase.from('organization_settings').select('email, email_default_sender, email_bcc, comptable_email, email_sync_ignored').limit(1).maybeSingle(),
  ])
  const exact = new Set()
  const domains = new Set()
  const add = (e) => {
    const v = String(e || '').trim().toLowerCase()
    if (!v) return
    if (v.startsWith('@')) { domains.add(v.slice(1)); return }
    if (!v.includes('@')) return
    exact.add(v)
  }
  team.forEach((p) => { add(p.email); add(p.sender_email) })
  ;(configs || []).forEach((c) => add(c.email))
  ;[org?.email, org?.email_default_sender, org?.email_bcc].forEach(add)
  // Domaine de l'organisme : celui de ses propres adresses, sauf messagerie grand public
  ;[...exact].forEach((e) => {
    const d = domainOf(e)
    if (d && !PUBLIC_DOMAINS.has(d)) domains.add(d)
  })
  // Comptable et adresses à ignorer : l'adresse seule (ou « @domaine » saisi tel quel), jamais tout son domaine
  add(org?.comptable_email)
  String(org?.email_sync_ignored || '').split(/[\s,;]+/).forEach(add)
  return (email) => {
    const e = String(email || '').toLowerCase()
    return exact.has(e) || domains.has(domainOf(e))
  }
}

/** Libellé d'un payeur de dépense personnelle : 'perso_<id du profil>' ou ancienne valeur '<prénom>_perso' */
export function payerLabel(team, payer) {
  const v = String(payer || '')
  if (v.startsWith('perso_')) return profileFirstName((team || []).find((p) => p.id === v.slice(6))) || 'Associé'
  if (v.endsWith('_perso')) { const n = v.slice(0, -6); return n.charAt(0).toUpperCase() + n.slice(1) }
  return v
}
