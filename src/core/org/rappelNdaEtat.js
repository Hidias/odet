// État du rappel de déclaration d'activité sur l'accueil (B6).
// Le numéro saisi fait disparaître le rappel. Sinon, le statut du suivi de Certification › NDA (cert_settings) décide :
// déposée ou dossier complet → « en attente du numéro » ; enregistrée sans numéro → numéro à saisir ;
// refusée → alerte ; en préparation, ou suivi illisible (droit ou module manquant) → à déposer.
// Seul le statut compte : une ancienne date de dépôt (dossier refusé puis repris) ne fait pas passer en attente.

export function etatRappelNda({ nda, suivi, premiereConventionSession }) {
  if (String(nda || '').replace(/\s/g, '')) return { type: 'aucun' }
  const s = suivi || {}
  const premiere = s.first_convention_date || premiereConventionSession || null
  if (s.nda_status === 'refuse') return { type: 'refusee', premiere }
  if (s.nda_status === 'enregistre') return { type: 'numero_a_saisir' }
  if (s.nda_status === 'depose' || s.nda_status === 'complet') {
    return { type: 'attente', deposeeLe: s.nda_filed_at || null, completLe: s.nda_complete_at || null }
  }
  return { type: 'a_deposer', premiere }
}

// Dates du suivi qui se contredisent : dossier complet avant le dépôt.
export function incoherencesNda(suivi) {
  const s = suivi || {}
  if (s.nda_filed_at && s.nda_complete_at && s.nda_complete_at < s.nda_filed_at) {
    return ["La date « dossier complet » est antérieure à la date de dépôt : vérifiez les deux dates."]
  }
  return []
}
