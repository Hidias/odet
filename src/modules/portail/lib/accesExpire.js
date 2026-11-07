// Ticket du code personnel absent ou expiré (0501, app.portal_session_for : refus 42501) : le stagiaire ressaisit son
// code. Même texte que celui rendu par la base pour l'émargement et le refus d'e-mail.
export const ACCES_EXPIRE = 'Votre accès a expiré : saisissez à nouveau votre code personnel'

export function messagePortail(erreur, defaut) {
  return erreur?.code === '42501' ? ACCES_EXPIRE : defaut
}
