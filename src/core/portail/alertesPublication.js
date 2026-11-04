// Ce qui part dans l'espace client doit se dire (angles morts B4, B5, B6, B12, 04/11).
// Aucun e-mail ne part : le client voit le document quand il ouvre son espace. Textes seuls, sans accès aux données.

const AUCUN_MAIL = "Aucun e-mail ne part : le client le voit en ouvrant son espace."

// B12 : convention ou contrat d'un groupe inter mis à signer en ligne
export function confirmationSignatureGroupe(groupe) {
  const particulier = groupe?.kind === 'particulier'
  const doc = particulier ? 'le contrat de formation' : 'la convention de formation'
  const qui = groupe?.clients?.name ? ` de ${groupe.clients.name}` : ' du client'
  return {
    title: particulier ? 'Mettre le contrat à signer en ligne ?' : 'Mettre la convention à signer en ligne ?',
    message: `${doc.charAt(0).toUpperCase()}${doc.slice(1)} sera publié${particulier ? '' : 'e'} dans l'espace${qui}, qui pourra ${particulier ? 'le' : 'la'} lire et ${particulier ? 'le' : 'la'} signer. ${AUCUN_MAIL}\n\nVérifiez avant les stagiaires et le prix du groupe : le document signé est figé.`,
    confirmLabel: 'Publier pour signature',
  }
}

// B6 : devis déjà publié (envoyé ou accepté sans signature) qu'on enregistre après modification
export function confirmationModificationDevisPublie(devis) {
  return {
    title: 'Devis déjà dans l\'espace du client',
    message: `Le devis ${devis?.reference || ''} est déjà visible par le client. En enregistrant, la nouvelle version remplace celle qu'il voit (l'ancienne est retirée et gardée). ${AUCUN_MAIL}`.replace(/\s+/g, ' ').trim(),
    confirmLabel: 'Enregistrer et remplacer',
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

// B4 : facture émise téléchargée, publiée une fois dans l'espace du client. `r` : réponse du serveur (ou null)
export function messageFacturePubliee(r, estAvoir = false) {
  if (!r?.id || r.deja) return null
  return `${estAvoir ? 'Avoir' : 'Facture'} mis${estAvoir ? '' : 'e'} aussi à disposition dans l'espace du client (une seule fois, sans e-mail).`
}

// B5 : rapport d'intervention. Seule la première version est publiée : le dire à chaque fois
export function messageRapportPublie(r) {
  if (!r?.id) return { ton: 'erreur', texte: "Le rapport n'a pas pu être mis à disposition dans l'espace du client." }
  if (r.deja) return { ton: 'info', texte: "Le client voit toujours la première version du rapport : elle n'est pas remplacée." }
  return { ton: 'succes', texte: "Rapport mis à disposition dans l'espace du client (sans e-mail). Les versions suivantes ne le remplaceront pas." }
}

// B13 : envois au comptable (e-mail externe)
export function confirmationEnvoiComptable({ nombre, quoi, email }) {
  const n = Number(nombre) || 0
  const libelles = { transactions: ['opération', 'opérations'], factures: ['facture', 'factures'], releve: ['relevé', 'relevés'] }
  const [un, plusieurs] = libelles[quoi] || ['document', 'documents']
  return {
    title: 'Envoyer au comptable ?',
    message: `${n} ${n > 1 ? plusieurs : un} ${n > 1 ? 'partiront' : 'partira'} par e-mail à ${email || 'votre comptable'}, avec les pièces jointes. Un e-mail envoyé ne se reprend pas.`,
    confirmLabel: 'Envoyer',
  }
}

// B14 : suppressions définitives
export function confirmationSuppressionDevis(devis) {
  return {
    title: 'Supprimer ce devis ?',
    message: `Le devis ${devis?.reference || ''} et ses lignes seront supprimés définitivement : rien ne pourra être récupéré. Pour garder une trace, passez-le plutôt en « Refusé ».`.replace(/\s+/g, ' ').trim(),
    confirmLabel: 'Supprimer définitivement',
    danger: true,
  }
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
    message: `La date d'envoi${quand} sera effacée et la session repassera en « Convention en attente » sur l'accueil.`,
    confirmLabel: 'Retirer',
  }
}
