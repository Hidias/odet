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
