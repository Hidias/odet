// Formation SST (Sauveteur Secouriste du Travail, initiale ou MAC) : reconnue à son intitulé ou à son code.
// Règle unique : onglet de certification, check-list de session, règles SST des CGV dans la convention.
// Même règle qu'avant (intitulé qui contient « sst »), étendue au code et à « sauveteur »
const MOTIF_SST = /sst|secouriste|sauveteur/i

export function estFormationSST(course) {
  if (!course) return false
  return MOTIF_SST.test(String(course.title || '')) || MOTIF_SST.test(String(course.code || ''))
}
