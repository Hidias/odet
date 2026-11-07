// Heure de fin proposée selon la durée de la formation, même règle que la session préparée depuis un devis
// (app.devis_prepare_sessions, 0498) : sur un seul jour et sous 6 heures, fin = début + durée (13 h pour 4 h
// commencées à 9 h) ; sinon journée complète jusqu'à 17 h. Le choix reste modifiable à l'écran (A11, 07/11).
export function finConseillee(debut = '09:00', heures, jours = 1) {
  const h = Number(heures)
  if (!h || h >= 6 || (Number(jours) || 1) > 1) return '17:00'
  const m = /^(\d{1,2}):(\d{2})/.exec(String(debut || ''))
  if (!m) return '17:00'
  const fin = Number(m[1]) * 60 + Number(m[2]) + Math.round(h * 60)
  if (fin >= 24 * 60) return '17:00'
  return `${String(Math.floor(fin / 60)).padStart(2, '0')}:${String(fin % 60).padStart(2, '0')}`
}
