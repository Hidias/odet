import { lienEspaceClient } from '../../../core/portail/lienEspace'
import { avisPossible } from '../../portail/components/AvisEntreprise'
import { todayIso } from '../../certification/lib/certData'

// Invitation de l'entreprise à donner son avis (décision de H du 07/11) : dans l'envoi « Après formation », le
// questionnaire de satisfaction porte l'encadré « Répondre en ligne » (adresse, QR code et code de l'espace client)
// quand l'entreprise peut répondre en ligne : formation réalisée (même critère que l'espace et la base, 0504),
// accès actif à son espace, pas un particulier. Sinon le questionnaire reste papier, comme avant.

/** Règle seule (sans lecture) : l'invitation en ligne est-elle possible pour cette session et ce groupe ? */
export function invitationAvisPossible(session, groupe = null, aujourdhui = todayIso()) {
  if (!session?.client_id) return false
  if (groupe?.kind === 'particulier') return false
  return avisPossible(session, aujourdhui)
}

/** Lien de l'espace client à mettre dans le questionnaire, ou null (questionnaire papier seul) */
export async function lienAvisEntreprise(session, groupe = null, aujourdhui = todayIso()) {
  if (!invitationAvisPossible(session, groupe, aujourdhui)) return null
  return lienEspaceClient(session.client_id)
}

/** Phrase du mail qui annonce l'encadré (code d'accès envoyé à part : il n'est pas dans l'encadré, 0449) */
export function phraseAvisEnLigne(lien) {
  if (!lien) return ''
  const ou = lien.codeApart ? 'l\'adresse et le QR code figurent' : 'l\'adresse, le QR code et votre code d\'accès figurent'
  return `Le questionnaire de satisfaction entreprise peut aussi être rempli en ligne depuis votre espace client : ${ou} dans l'encadré « Répondre en ligne » du questionnaire.`
}
