// Métier d'un devis : ce qu'il vend (formation, maintenance, vente de matériel…). Une seule règle pour tout l'outil,
// pour que le PDF, l'envoi et les pièces jointes disent la même chose.

/**
 * Le devis contient-il de la formation ? Une ligne rattachée à une formation du catalogue, ou un devis rattaché
 * à une session. Seul un devis de formation reçoit des documents de formation (programme, CGV de formation,
 * NDA, mention d'exonération de TVA de la formation).
 */
export function devisDeFormation(quote, items) {
  return (items || []).some((it) => !!it?.course_id) || !!quote?.session_id
}
