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

// Même entreprise deux fois sur une inter (06/11, décision de H) : un particulier est refusé ; une entreprise passe
// après une alerte (cas légitime : deux financements différents, par exemple OPCO pour une partie des stagiaires)
export function doublonDuGroupe(groupes = [], edition = {}) {
  if (!edition?.client_id) return null
  const deja = (groupes || []).find((g) => g && g.id !== edition.id && g.status !== 'cancelled' && g.client_id === edition.client_id)
  if (!deja) return null
  const nom = deja.clients?.name || deja.group_name || 'Ce client'
  if (edition.kind === 'particulier') {
    return { refus: true, message: `${nom} a déjà un groupe sur cette session. Ouvrez ce groupe pour le modifier.` }
  }
  return {
    refus: false,
    message: `${nom} a déjà un groupe sur cette session. Pour ajouter des stagiaires, ouvrez le groupe existant. Un second groupe sert seulement à un financement différent (par exemple un OPCO pour une partie des stagiaires) : il aura sa propre convention et sa propre facture. Créer quand même un second groupe ?`,
  }
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
  if (!signataire) {
    return particulier
      ? 'La fiche du particulier n\'a pas de nom : complétez-la avant de publier le contrat.'
      : 'Aucun signataire pour ce groupe : ouvrez le groupe et choisissez le contact de l\'entreprise qui signe.'
  }
  return null
}
