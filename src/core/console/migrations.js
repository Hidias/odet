// Classement des migrations embarquées pour la Console.
// Une migration écartée volontairement n'est ni « à appliquer » ni comptée comme manquante :
// elle est affichée à part, avec sa raison.

export const MIGRATIONS_ECARTEES = {
  '0110_finance_generique': "Budget générique de l'ancien outil, écartée volontairement (19/10) : à réécrire pour GLD avant toute application.",
}

export function classerMigrations(embarquees, appliquees, ecartees = MIGRATIONS_ECARTEES) {
  const faites = new Set((appliquees || []).map((m) => m.version))
  const aAppliquer = []
  const mises_a_part = []
  for (const m of embarquees) {
    if (faites.has(m.version)) continue
    if (ecartees[m.version]) mises_a_part.push({ ...m, raison: ecartees[m.version] })
    else aAppliquer.push(m)
  }
  return { aAppliquer, ecartees: mises_a_part, attendues: embarquees.length - mises_a_part.length }
}
