// Convention (entreprise) ou contrat (particulier) d'un groupe inter (05/11, C3 et C8, décisions de H) :
// le document porte le signataire choisi dans le groupe, jamais celui du client principal de la session ; il ne se
// publie pas pour 0 participant ni sans signataire (publication refusée avec un message).

export const nomContact = (c) => (c ? String(c.name || [c.first_name, c.last_name].filter(Boolean).join(' ')).trim() : '')

/** Signataire du document du groupe : le particulier lui-même, ou le contact de l'entreprise choisi dans le groupe */
export function signataireDuGroupe(groupe, contacts = []) {
  if (groupe?.kind === 'particulier') return groupe.clients?.name ? { name: groupe.clients.name, role: '' } : null
  // Le contact doit appartenir à l'entreprise du groupe (défense : un contact d'un autre client ne signe jamais)
  const c = (contacts || []).find((x) => x.id === groupe?.contact_id && (x.client_id === undefined || x.client_id === groupe?.client_id))
  const name = nomContact(c)
  return name ? { name, role: String(c.fonction || c.role || '').trim() } : null
}

// Lecture d'un groupe avec son client et son contact (onglet Groupes, fiche session, envoi par groupe)
export const SELECT_GROUPE = '*, clients:client_id(id, name, client_type, address, postal_code, city, email, contact_email, contact_phone, siret), contact:contact_id(id, client_id, name, first_name, last_name, fonction, role, email, phone), payeur:payer_client_id(id, name)'

/** Groupes qui comptent : les groupes annulés sont ignorés */
export const groupesActifs = (groupes = []) => (groupes || []).filter((g) => g && g.status !== 'cancelled')

// Session inter suivie par groupes (06/11, décision de H : un envoi par groupe) : la convention, les convocations et
// les documents d'après formation se font groupe par groupe ; jamais au client principal pour tous les inscrits.
export const envoiParGroupe = (session, groupes = []) => session?.session_type === 'inter' && groupesActifs(groupes).length > 0

/** Prix du document du groupe : prix total du groupe, sinon prix par personne × inscrits, sinon null */
export function prixDuGroupe(groupe, nbStagiaires) {
  const total = parseFloat(groupe?.price_total)
  if (total) return total
  const pp = parseFloat(groupe?.price_per_person)
  return pp ? pp * Math.max(1, nbStagiaires || 0) : null
}

// Financement du groupe (payeur et numéro de dossier du groupe, jamais ceux du client principal)
const FINANCEMENT = { opco: 'opco', france_travail: 'france_travail', autre: 'other' }
export function financementDuGroupe(groupe) {
  const type = FINANCEMENT[groupe?.payer_kind] || 'none'
  if (type === 'none') return { funding_type: 'none', funding_details: '' }
  const details = [groupe?.payeur?.name, groupe?.dossier_number ? `dossier ${groupe.dossier_number}` : ''].filter(Boolean).join(', ')
  return { funding_type: type, funding_details: details }
}

/** Contact lisible par les documents (nom et fonction même saisis en prénom, nom et fonction) */
const contactLisible = (c) => (c ? { ...c, name: nomContact(c), role: String(c.fonction || c.role || '').trim() } : null)

/** Inscriptions d'un groupe parmi celles de la session */
export const inscritsDuGroupe = (session, groupe) => (session?.session_trainees || []).filter((st) => groupe?.id && st.group_id === groupe.id)

/**
 * Session vue d'un groupe : entreprise (ou particulier), contact, signataire, prix et inscrits du seul groupe.
 * `client_id` est celui du groupe : l'encadré « Signer en ligne » mène à l'espace de ce client, jamais à celui du
 * client principal de la session.
 */
export function sessionDuGroupe(session, groupe, contacts = []) {
  const inscrits = inscritsDuGroupe(session, groupe)
  const signataire = signataireDuGroupe(groupe, contacts.length ? contacts : [groupe?.contact].filter(Boolean))
  const prix = prixDuGroupe(groupe, inscrits.length)
  return {
    ...session,
    client_id: groupe?.client_id || null,
    clients: groupe?.clients || null,
    contact_id: groupe?.kind === 'particulier' ? null : (groupe?.contact_id || null),
    contact: groupe?.kind === 'particulier' ? null : contactLisible(groupe?.contact),
    signatory_name: signataire?.name || '',
    signatory_role: signataire?.role || '',
    // Jamais le prix de la session : un groupe sans prix est refusé avant tout document (refusPublicationGroupe)
    total_price: prix,
    ...financementDuGroupe(groupe),
    session_trainees: inscrits,
  }
}

/** Destinataire d'un envoi pour le groupe : contact choisi, sinon e-mail de l'entreprise ou du particulier */
export function destinataireDuGroupe(groupe) {
  const valide = (m) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(m || '').trim())
  const c = groupe?.kind === 'particulier' ? null : groupe?.contact
  return [c?.email, groupe?.clients?.email, groupe?.clients?.contact_email].map((m) => String(m || '').trim()).find(valide) || ''
}

/** Contact proposé à l'ouverture d'un groupe sans signataire : contact « documents », sinon principal, sinon aucun */
export function contactPropose(contacts = []) {
  const l = contacts || []
  return (l.find((c) => c.is_document_contact) || l.find((c) => c.is_primary) || null)?.id || ''
}

/** Message de refus, ou null quand le document du groupe peut être mis à signer */
export function refusPublicationGroupe(groupe, nbStagiaires, signataire) {
  const particulier = groupe?.kind === 'particulier'
  const doc = particulier ? 'le contrat' : 'la convention'
  if (!nbStagiaires) return `Aucun stagiaire dans ce groupe : rattachez d'abord ses stagiaires (${doc} ne se publie pas pour 0 participant).`
  if (prixDuGroupe(groupe, nbStagiaires) == null) return 'Aucun prix pour ce groupe : ouvrez le groupe et saisissez le prix total ou le prix par personne.'
  if (!signataire) {
    return particulier
      ? 'La fiche du particulier n\'a pas de nom : complétez-la avant de publier le contrat.'
      : 'Aucun signataire pour ce groupe : ouvrez le groupe et choisissez le contact de l\'entreprise qui signe.'
  }
  return null
}
