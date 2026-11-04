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
// Écart assumé, dans le sens prudent : l'écran ne cherche que parmi les clients qui ont déjà un groupe sur la session.
const norm = (v) => String(v ?? '').trim().toLowerCase()

export function groupesDuClientPourInscription(r, groupes) {
  const avecClient = (groupes || []).filter((g) => g.clients)
  if (r.kind === 'entreprise') {
    const parSiret = r.siret ? avecClient.filter((g) => g.clients.siret && g.clients.siret === r.siret) : []
    if (parSiret.length) return parSiret
    return avecClient.filter((g) => norm(g.clients.name) === norm(r.company_name) && norm(g.clients.postal_code) === norm(r.postal_code))
  }
  const mail = norm(r.contact_email)
  return mail ? avecClient.filter((g) => g.clients.client_type === 'particulier' && (norm(g.clients.email) === mail || norm(g.clients.contact_email) === mail)) : []
}

// Textes accordés au document : convention (entreprise, féminin) ou contrat (particulier, masculin)
const DOCS = {
  convention: { titre: 'Convention déjà signée pour ce client', sa: 'sa convention est signée', cette: 'cette convention deviendra inexacte', nouveau: 'une nouvelle convention signée', dont: "dont la convention n'est pas encore signée", propre: 'sa propre convention' },
  contrat: { titre: 'Contrat déjà signé pour ce client', sa: 'son contrat est signé', cette: 'ce contrat deviendra inexact', nouveau: 'un nouveau contrat signé', dont: "dont le contrat n'est pas encore signé", propre: 'son propre contrat' },
}

export function confirmationInscriptionInter(r, groupes, { lectureImpossible = false } = {}) {
  const n = (r.participants || []).length
  const qui = r.kind === 'entreprise' ? r.company_name : `${r.contact_first_name} ${r.contact_last_name}`
  const d = DOCS[r.kind === 'entreprise' ? 'convention' : 'contrat']
  const base = `${qui} : ${n} participant${n > 1 ? 's' : ''}. Le client et les stagiaires sont créés ou retrouvés, sans doublon.`
  if (lectureImpossible) {
    return {
      title: 'Vérification impossible',
      message: `${base}\n\nImpossible de vérifier si ce client a déjà un groupe sur cette session avec un document signé. Si c'est le cas, les stagiaires y seront ajoutés et il faudra un avenant.\n\nConfirmer quand même l'inscription ?`,
      confirmLabel: 'Confirmer quand même',
      danger: true,
    }
  }
  const siens = groupesDuClientPourInscription(r, groupes)
  if (siens.some((g) => g.doc_status === 'signe')) {
    return {
      title: d.titre,
      message: `${base}\n\nCe client a déjà un groupe sur cette session et ${d.sa} : les nouveaux stagiaires y seront ajoutés et ${d.cette}. Il faudra un avenant ou ${d.nouveau}.\n\nConfirmer quand même l'inscription ?`,
      confirmLabel: 'Confirmer quand même',
      danger: true,
    }
  }
  return {
    title: 'Confirmer cette inscription ?',
    message: siens.length
      ? `${base} Les stagiaires rejoignent le groupe existant de ce client, ${d.dont}.`
      : `${base} Un nouveau groupe est créé, avec ${d.propre} à faire signer ; les documents déjà signés des autres clients ne changent pas.`,
    confirmLabel: 'Confirmer',
    danger: false,
  }
}
