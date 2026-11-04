// Alerte avant de changer la liste des stagiaires d'une session dont la convention est signée (demande de H, 04/11).
// Le droit reste entier (super administrateur compris) mais l'action demande une confirmation explicite :
// la convention signée ne correspond plus à la réalité, il faut un avenant ou une nouvelle convention signée.
// Sous-traitance : la convention est celle du donneur d'ordre, pas d'alerte.

export function alerteConventionSignee(session, action) {
  if (!session?.convention_signed || session.session_type === 'subcontract') return null
  const quand = session.convention_signed_date
    ? ` le ${new Date(session.convention_signed_date).toLocaleDateString('fr-FR')}`
    : ''
  if (action === 'retrait') {
    return {
      title: 'Convention déjà signée',
      message: `La convention de cette session a été signée${quand}. Retirer ce stagiaire la rend inexacte : il faudra un avenant ou une nouvelle convention signée par le client.\n\nRetirer quand même ce stagiaire ?`,
      confirmLabel: 'Retirer quand même',
      danger: true,
    }
  }
  if (action === 'ajout') {
    return {
      title: 'Convention déjà signée',
      message: `La convention de cette session a été signée${quand}. Ajouter un stagiaire la rend inexacte : il faudra un avenant ou une nouvelle convention signée par le client.\n\nAjouter quand même ce stagiaire ?`,
      confirmLabel: 'Ajouter quand même',
      danger: false,
    }
  }
  return null
}

// Confirmation d'une inscription en ligne sur une session inter (une seule fenêtre). Reprend la recherche du client
// faite par la base (inscription_confirmer, 0421) : entreprise par SIRET, sinon nom et code postal ; particulier par
// adresse email. Si ce client a déjà un groupe sur la session, les stagiaires y sont ajoutés : une convention (ou un
// contrat) déjà signé devient inexact. Sinon, un nouveau groupe est créé, avec sa propre convention ou son contrat.
const norm = (v) => String(v ?? '').trim().toLowerCase()

export function groupeExistantPourInscription(r, groupes) {
  const avecClient = (groupes || []).filter((g) => g.clients)
  if (r.kind === 'entreprise') {
    if (r.siret) {
      const parSiret = avecClient.find((g) => g.clients.siret && g.clients.siret === r.siret)
      if (parSiret) return parSiret
    }
    return avecClient.find((g) => norm(g.clients.name) === norm(r.company_name) && norm(g.clients.postal_code) === norm(r.postal_code)) || null
  }
  const mail = norm(r.contact_email)
  return avecClient.find((g) => g.clients.client_type === 'particulier' && mail && (norm(g.clients.email) === mail || norm(g.clients.contact_email) === mail)) || null
}

export function confirmationInscriptionInter(r, groupes) {
  const n = (r.participants || []).length
  const qui = r.kind === 'entreprise' ? r.company_name : `${r.contact_first_name} ${r.contact_last_name}`
  const doc = r.kind === 'entreprise' ? 'convention' : 'contrat'
  const base = `${qui} : ${n} participant${n > 1 ? 's' : ''}. Le client et les stagiaires sont créés ou retrouvés, sans doublon.`
  const g = groupeExistantPourInscription(r, groupes)
  if (g && g.doc_status === 'signe') {
    return {
      title: `${doc === 'convention' ? 'Convention' : 'Contrat'} déjà signé pour ce client`,
      message: `${base}\n\nCe client a déjà un groupe sur cette session et son ${doc} est signé : les nouveaux stagiaires y seront ajoutés et ce ${doc} deviendra inexact. Il faudra un avenant ou un nouveau ${doc} signé.\n\nConfirmer quand même l'inscription ?`,
      confirmLabel: 'Confirmer quand même',
      danger: true,
    }
  }
  return {
    title: 'Confirmer cette inscription ?',
    message: g
      ? `${base} Les stagiaires rejoignent le groupe existant de ce client, dont le ${doc} n'est pas encore signé.`
      : `${base} Un nouveau groupe est créé, avec son propre ${doc} à faire signer ; les conventions déjà signées des autres clients ne changent pas.`,
    confirmLabel: 'Confirmer',
    danger: false,
  }
}
