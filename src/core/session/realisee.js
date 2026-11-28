// B126 : une seule règle « session réalisée » pour tout l'outil (résultats, indicateurs, froid, facturation),
// et le parcours du statut (décisions de H du 25/11) : Prévue / Confirmée / En cours → À clôturer (heure de fin)
// → À facturer (tout est saisi) → Terminée (facture émise ou « pas de facture » avec motif).
// Équivalent en base : app.session_realisee et app.session_avancer (migration 0528). La base écrit le statut
// (nuit, ouverture de la fiche, émission d'une facture) ; l'écran affiche « À clôturer » dès l'heure de fin.

export const STATUTS_REALISEE = Object.freeze(['to_close', 'to_invoice', 'completed'])
export const STATUTS_AVANT_FIN = Object.freeze(['planned', 'confirmed', 'in_progress'])

export const LIBELLES_STATUT = Object.freeze({
  draft: 'Brouillon',
  planned: 'Planifiée',
  confirmed: 'Confirmée',
  in_progress: 'En cours',
  to_close: 'À clôturer',
  to_invoice: 'À facturer',
  completed: 'Terminée',
  cancelled: 'Annulée',
})

const statutDe = (sessionOuStatut) => (typeof sessionOuStatut === 'string' ? sessionOuStatut : sessionOuStatut?.status)

// Accepte une session ({ status }) ou directement un statut.
export function estRealisee(sessionOuStatut) {
  return STATUTS_REALISEE.includes(statutDe(sessionOuStatut))
}

// Date et heure actuelles à Paris, au format « AAAA-MM-JJTHH:MM » (comparables comme du texte)
export function maintenantParis(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

// Fin de la session au même format (heure de fin, 23:59 si absente)
export function finSession(session) {
  const jour = session?.end_date || session?.start_date
  if (!jour) return null
  const heure = String(session?.end_time || '23:59').slice(0, 5)
  return `${String(jour).slice(0, 10)}T${heure}`
}

// Statut à afficher : « À clôturer » dès l'heure de fin passée (sauf sous-traitance, hors parcours)
export function statutAffiche(session, maintenant = maintenantParis()) {
  const statut = session?.status
  if (!STATUTS_AVANT_FIN.includes(statut) || session?.session_type === 'subcontract') return statut
  const fin = finSession(session)
  return fin && fin <= maintenant ? 'to_close' : statut
}
