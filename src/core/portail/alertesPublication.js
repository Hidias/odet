// Ce qui part dans l'espace client doit se dire (angles morts B4, B5, B6, B12, 04/11).
// Aucun e-mail ne part : le client voit le document quand il ouvre son espace. Textes seuls, sans accès aux données.

const AUCUN_MAIL = 'Aucun e-mail ne part : le client le trouve en ouvrant son espace.'
const maj = (t) => t.charAt(0).toUpperCase() + t.slice(1)

// B12 : convention ou contrat d'un groupe inter mis à signer en ligne. Tant qu'il n'est pas signé, une nouvelle
// publication remplace le document que voit le client ; signé, il reste figé (api/documents-client.js, publier, 0490)
// `sansAcces` vrai : le client n'a ni lien et code actifs ni compte actif sur son espace ; on le dit avant de publier
export function confirmationSignatureGroupe(groupe, { sansAcces = false } = {}) {
  const particulier = groupe?.kind === 'particulier'
  const doc = particulier ? 'le contrat de formation' : 'la convention de formation'
  const e = particulier ? '' : 'e'
  const pron = particulier ? 'le' : 'la'
  const il = particulier ? 'il' : 'elle'
  const qui = groupe?.clients?.name ? ` de ${groupe.clients.name}` : ' du client'
  if (groupe?.doc_status === 'signe') {
    return {
      title: particulier ? 'Contrat déjà signé' : 'Convention déjà signée',
      message: `${maj(doc)}${qui} est signé${e} : ${il} ne sera pas remplacé${e}. Pour un changement, prévoyez un avenant avec le client.`,
      confirmLabel: 'Continuer',
    }
  }
  const accesManquant = sansAcces ? `\n\nAttention : ce client n'a pas encore d'accès à son espace. Créez-le ensuite sur sa fiche (Accès entreprise) et envoyez-lui le lien et le code, sinon il ne verra pas ${doc}.` : ''
  if (groupe?.doc_status === 'envoye') {
    return {
      title: particulier ? 'Remplacer le contrat à signer ?' : 'Remplacer la convention à signer ?',
      message: `${maj(doc)} est noté${e} « envoyé${e} » et pas encore signé${e}. ${particulier ? "S'il" : 'Si elle'} est déjà dans l'espace${qui}, la version d'aujourd'hui ${pron} remplace (l'ancienne est retirée et gardée) : vérifiez les stagiaires et le prix du groupe. ${AUCUN_MAIL}${accesManquant}`,
      confirmLabel: 'Publier cette version',
    }
  }
  return {
    title: particulier ? 'Mettre le contrat à signer en ligne ?' : 'Mettre la convention à signer en ligne ?',
    message: `${maj(doc)} sera publié${e} dans l'espace${qui}, qui pourra ${pron} lire et ${pron} signer. ${AUCUN_MAIL}\n\nVérifiez avant les stagiaires et le prix du groupe : une fois signé${e}, ${il} ne sera plus remplacé${e}.${accesManquant}`,
    confirmLabel: 'Publier pour signature',
  }
}

// B6 : devis remis (envoyé, ou accepté sans signature) qu'on enregistre après modification. Un devis passé en
// « Accepté » sans être envoyé n'a jamais été publié : le texte couvre les deux cas
export function confirmationModificationDevisPublie(devis) {
  return {
    title: 'Devis remis au client',
    message: `Le devis ${devis?.reference || ''} est remis au client. En enregistrant, la nouvelle version est publiée dans son espace et remplace celle qu'il y voit déjà, s'il y en a une (l'ancienne est retirée et gardée). ${AUCUN_MAIL}`.replace(/\s+/g, ' ').trim(),
    confirmLabel: 'Enregistrer et publier',
  }
}

// B6 : passage en « Envoyé »
export function confirmationPassageEnvoye() {
  return {
    title: 'Passer le devis en « Envoyé » ?',
    message: `Le devis sera publié dans l'espace du client, pour lecture et signature en ligne. ${AUCUN_MAIL}`,
    confirmLabel: 'Passer en « Envoyé »',
  }
}

// Passage en « Accepté » ou « Partiellement accepté » (même sans envoi préalable) : version à jour mise à disposition,
// sauf pour un devis signé en ligne (gardé tel quel)
export const PUBLICATION_DEVIS_ACCEPTE = `Le devis sera aussi mis à disposition dans l'espace du client, pour lecture, sans signature en ligne (sauf s'il l'a déjà signé en ligne : sa version signée reste). ${AUCUN_MAIL}`

// B4 : facture émise téléchargée, publiée une fois dans l'espace du client. `r` : réponse du serveur (ou null)
export function messageFacturePubliee(r, estAvoir = false) {
  if (!r?.id || r.deja) return null
  return `${estAvoir ? 'Avoir' : 'Facture'} mis${estAvoir ? '' : 'e'} aussi à disposition dans l'espace du client (une seule fois, sans e-mail).`
}

// B5 : rapport d'intervention. Seule la première version est publiée : le dire à chaque fois
export function messageRapportPublie(r) {
  if (r?.deja) return { ton: 'info', texte: "Le client voit toujours la première version du rapport : elle n'est pas remplacée." }
  if (!r?.id) return { ton: 'erreur', texte: "Le rapport n'a pas pu être mis à disposition dans l'espace du client." }
  return { ton: 'succes', texte: "Rapport mis à disposition dans l'espace du client (sans e-mail). Les versions suivantes ne le remplaceront pas." }
}

// B13 : envois au comptable (e-mail externe). Adresse vide (aucun comptable configuré) : null, le serveur refuserait
export function confirmationEnvoiComptable({ nombre, quoi, email }) {
  if (email === '') return null
  const n = Number(nombre) || 0
  const libelles = { transactions: ['opération', 'opérations'], factures: ['facture', 'factures'], releve: ['relevé', 'relevés'] }
  const [un, plusieurs] = libelles[quoi] || ['document', 'documents']
  return {
    title: 'Envoyer au comptable ?',
    message: `${n} ${n > 1 ? plusieurs : un} ${n > 1 ? 'partiront' : 'partira'} par e-mail à ${email || 'votre comptable'}. Un e-mail envoyé ne se reprend pas.`,
    confirmLabel: 'Envoyer',
  }
}

// B14 : suppressions définitives
export function confirmationSuppressionDevis(devis) {
  // Tout devis sorti du brouillon a pu être publié (envoyé puis refusé, par exemple)
  const remis = !!devis?.status && devis.status !== 'draft'
  return {
    title: 'Supprimer ce devis ?',
    message: `Le devis ${devis?.reference || ''} et ses lignes seront supprimés définitivement : rien ne pourra être récupéré.${remis ? " S'il a été publié dans l'espace du client, il en est retiré (gardé dans l'historique)." : ''} Pour garder une trace, passez-le plutôt en « Refusé ».`.replace(/\s+/g, ' ').trim(),
    confirmLabel: 'Supprimer définitivement',
    danger: true,
  }
}

// Statuts où un devis a pu être signé par le client (0435 : `app.devis_signe`, lu par `devis_est_signe`)
export const devisPeutEtreSigne = (status) => ['accepted', 'partial', 'invoiced', 'replaced'].includes(status)

export const REFUS_SUPPRESSION_DEVIS_SIGNE = "Ce devis est signé par le client : il ne se supprime pas, il sert de preuve de l'accord."

// Ce qui reste possible selon l'état du devis signé (Quotes.jsx : nouvelle version refusée pour un devis facturé)
export function refusSuppressionDevisSigne(status) {
  if (status === 'replaced') return `${REFUS_SUPPRESSION_DEVIS_SIGNE} Une version plus récente existe : travaillez sur la dernière version.`
  if (status === 'invoiced') return `${REFUS_SUPPRESSION_DEVIS_SIGNE} Il est déjà facturé : pour un écart, faites un avenant ou un avoir.`
  return `${REFUS_SUPPRESSION_DEVIS_SIGNE} Pour un changement, faites un avenant ou une nouvelle version depuis le devis.`
}

// Motif montré quand la base refuse la suppression d'un devis (jamais de message technique en anglais)
export function messageRefusSuppressionDevis(error, status = null) {
  const m = error?.message || ''
  if (/foreign key|violates/i.test(m)) return 'Ce devis est relié à une facture ou une session : il ne peut pas être supprimé. Passez-le plutôt en « Refusé ».'
  if (/sign[ée] par le client/i.test(m)) return refusSuppressionDevisSigne(status)
  return "Le devis n'a pas pu être supprimé."
}

export function confirmationRetraitPreuve(preuve) {
  return {
    title: 'Retirer cette preuve ?',
    message: `La preuve « ${preuve?.label || ''} »${preuve?.file_path ? ' et son fichier seront supprimés' : ' sera supprimée'} définitivement. L'indicateur pourra redevenir incomplet pour l'audit.`,
    confirmLabel: 'Retirer définitivement',
    danger: true,
  }
}

// B15 : effacement d'un réglage ou d'une date
export const CONFIRMATION_REINITIALISER_ACCUEIL = {
  title: 'Réinitialiser le tableau de bord ?',
  message: 'Vos widgets reprennent leur ordre, leur taille et leur affichage par défaut. Vos réglages actuels seront perdus.',
  confirmLabel: 'Réinitialiser',
  danger: true,
}

export function confirmationDecocherConventionEnvoyee(dateEnvoi) {
  const quand = dateEnvoi ? ` (envoi noté le ${new Date(dateEnvoi).toLocaleDateString('fr-FR')})` : ''
  return {
    title: 'Retirer « Convention envoyée » ?',
    message: `La date d'envoi${quand} sera effacée.`,
    confirmLabel: 'Retirer',
  }
}
