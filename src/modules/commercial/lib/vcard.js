// Export de fiches contact au format vCard 3.0 (lisible par iOS, Android, Outlook, Google Contacts).
// Réservé aux rôles commerciaux et de direction : voir VCARD_ROLES et canExportVCard().

export const VCARD_ROLES = ['superadmin', 'admin', 'direction', 'commercial']

export function canExportVCard(role) {
  return VCARD_ROLES.includes(role)
}

// Échappement des valeurs vCard (virgule, point-virgule, retour à la ligne)
function esc(v) {
  return String(v ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;').trim()
}

// Découpe nom / prénom à partir des champs disponibles sur client_contacts
function splitName(contact) {
  if (contact.last_name || contact.first_name) return { last: contact.last_name || '', first: contact.first_name || '' }
  const parts = String(contact.name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { last: '', first: '' }
  if (parts.length === 1) return { last: parts[0], first: '' }
  // Convention « Prénom NOM » ; si le dernier mot est en capitales on le prend comme nom
  const lastIsUpper = parts[parts.length - 1] === parts[parts.length - 1].toUpperCase()
  if (lastIsUpper) return { last: parts[parts.length - 1], first: parts.slice(0, -1).join(' ') }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

/**
 * Construit une vCard pour un contact d'entreprise.
 * @param {object} contact ligne client_contacts (name, first_name, last_name, role/fonction, email, phone, mobile, notes)
 * @param {object} client ligne clients (name, address, postal_code, city, website, phone) pour l'organisation et l'adresse
 */
export function buildVCard(contact, client = {}) {
  const { last, first } = splitName(contact)
  const fn = contact.name || [first, last].filter(Boolean).join(' ')
  const title = contact.fonction || contact.role || ''
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${esc(last)};${esc(first)};;${esc(contact.civilite || '')};`,
    `FN:${esc(fn)}`,
  ]
  if (client?.name) lines.push(`ORG:${esc(client.name)}`)
  if (title) lines.push(`TITLE:${esc(title)}`)
  if (contact.mobile) lines.push(`TEL;TYPE=CELL,VOICE:${esc(contact.mobile)}`)
  if (contact.phone && contact.phone !== contact.mobile) lines.push(`TEL;TYPE=WORK,VOICE:${esc(contact.phone)}`)
  if (!contact.phone && !contact.mobile && client?.phone) lines.push(`TEL;TYPE=WORK,VOICE:${esc(client.phone)}`)
  if (contact.email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${esc(contact.email)}`)
  if (client?.address || client?.city) {
    lines.push(`ADR;TYPE=WORK:;;${esc(client.address || '')};${esc(client.city || '')};;${esc(client.postal_code || '')};France`)
  }
  if (client?.website) lines.push(`URL:${esc(client.website)}`)
  if (contact.notes) lines.push(`NOTE:${esc(contact.notes)}`)
  lines.push(`REV:${new Date().toISOString()}`)
  lines.push('END:VCARD')
  return lines.join('\r\n') + '\r\n'
}

// Contact générique porté par la fiche client (contact_name, contact_email...), quand aucun contact détaillé n'existe
export function clientAsContact(client) {
  if (!client?.contact_name && !client?.contact_email && !client?.contact_phone) return null
  return {
    name: client.contact_name || client.name,
    role: client.contact_function || '',
    email: client.contact_email || client.email || '',
    phone: client.contact_phone || client.phone || '',
    mobile: client.mobile || '',
  }
}

// Plusieurs contacts dans un seul fichier .vcf (import groupé sur téléphone)
export function buildVCards(entries) {
  return entries.map(({ contact, client }) => buildVCard(contact, client)).join('')
}

// Nom de fichier sans accents ni caractères spéciaux
export function vcfFilename(label) {
  const base = String(label || 'contacts').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return `${base || 'contacts'}.vcf`
}

export function downloadVCard(text, filename) {
  const blob = new Blob([text], { type: 'text/vcard;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
