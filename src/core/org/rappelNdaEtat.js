// État du rappel de déclaration d'activité sur l'accueil (B6).
// Le numéro saisi fait disparaître le rappel. Sinon, le suivi de la page Certification › NDA (cert_settings)
// décide : déposée ou dossier complet → « en attente du numéro » ; refusée → alerte ; en préparation → à déposer.

const DEPOSEE = ['depose', 'complet', 'enregistre']

export function etatRappelNda({ nda, suivi, premiereConventionSession }) {
  if (String(nda || '').replace(/\s/g, '')) return { type: 'aucun' }
  const s = suivi || {}
  const premiere = s.first_convention_date || premiereConventionSession || null
  if (s.nda_status === 'refuse') return { type: 'refusee', premiere }
  if (DEPOSEE.includes(s.nda_status) || s.nda_filed_at) {
    return { type: 'attente', deposeeLe: s.nda_filed_at || null, completLe: s.nda_complete_at || null }
  }
  return { type: 'a_deposer', premiere }
}

// Dates du suivi qui se contredisent (ex. dossier complet avant le dépôt).
export function incoherencesNda(suivi) {
  const s = suivi || {}
  const out = []
  if (s.nda_filed_at && s.nda_complete_at && s.nda_complete_at < s.nda_filed_at) {
    out.push("La date « dossier complet » est antérieure à la date de dépôt : vérifiez les deux dates.")
  }
  if (s.nda_filed_at && s.first_convention_date && s.nda_filed_at < s.first_convention_date) {
    out.push('La déclaration est datée d\'avant la première convention signée : vérifiez les deux dates.')
  }
  return out
}
