// Effectif imposé et prérequis de certificat (0479, règles SST des CGV formation, article 8, décision de H du 04/11).
// Fonctions pures : aucune valeur propre à une formation n'est écrite ici, tout vient de la fiche formation
// (min_participants, max_participants, effectif_strict, prerequis_certificat_mois).

// Découpe un effectif en groupes de taille proche, chacun entre min et max. Ex. 11 pour 4 à 10 : [6, 5].
// Renvoie null si aucun découpage n'est possible (effectif sous le minimum).
export function decouperGroupes(n, min = 1, max = 10) {
  const total = Math.floor(Number(n) || 0)
  const mi = Math.max(1, Math.floor(Number(min) || 1))
  const ma = Math.max(mi, Math.floor(Number(max) || mi))
  if (total < mi) return null
  const nb = Math.ceil(total / ma)
  if (Math.floor(total / nb) < mi) return null
  const base = Math.floor(total / nb), reste = total % nb
  return Array.from({ length: nb }, (_, i) => base + (i < reste ? 1 : 0))
}

// État de l'effectif d'une session d'une formation à effectif imposé.
export function etatEffectif(nbInscrits, course) {
  if (!course?.effectif_strict) return null
  const n = Math.max(0, Number(nbInscrits) || 0)
  const min = Number(course.min_participants) || 0
  const max = Number(course.max_participants) || 0
  if (max && n > max) return { niveau: 'depasse', n, min, max, groupes: decouperGroupes(n, min || 1, max) }
  if (min && n < min) return { niveau: 'insuffisant', n, min, max, manque: min - n }
  return { niveau: 'ok', n, min, max }
}

// Ajoute des mois à une date ISO (AAAA-MM-JJ), fin de mois respectée (31/08 + 6 mois = 28 ou 29/02).
export function ajouterMois(iso, mois) {
  if (!iso) return null
  const [a, m, j] = String(iso).slice(0, 10).split('-').map(Number)
  if (!a || !m || !j) return null
  const cible = new Date(Date.UTC(a, m - 1 + Number(mois || 0), 1))
  const dernier = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate()
  cible.setUTCDate(Math.min(j, dernier))
  return cible.toISOString().slice(0, 10)
}

// Statut du certificat présenté pour une formation qui en exige un.
// valide : en cours de validité au premier jour ; tolere : expiré depuis au plus la tolérance ;
// refuse : au-delà ; manquant : aucune date ou aucune copie.
// interne : certificat délivré par l'organisme lui-même, déjà dans l'outil (aucune copie à demander).
export function statutCertificat({ validUntil, filePath, interne = false, debutFormation, toleranceMois }) {
  if (!validUntil || (!filePath && !interne)) return { statut: 'manquant' }
  const debut = String(debutFormation || '').slice(0, 10)
  const fin = String(validUntil).slice(0, 10)
  if (!debut || fin >= debut) return { statut: 'valide', fin }
  const limite = ajouterMois(fin, Number(toleranceMois) || 0)
  if (limite >= debut) return { statut: 'tolere', fin, limite }
  return { statut: 'refuse', fin, limite }
}

// Statut de la seule date de fin de validité (04/11 : séparé de la copie, l'alerte part dès la saisie).
// valide, tolere (expiré depuis au plus la tolérance), refuse (au-delà), sans_date.
export function statutDate({ validUntil, debutFormation, toleranceMois }) {
  if (!validUntil) return { statut: 'sans_date' }
  const debut = String(debutFormation || '').slice(0, 10)
  const fin = String(validUntil).slice(0, 10)
  if (!debut || fin >= debut) return { statut: 'valide', fin }
  const limite = ajouterMois(fin, Number(toleranceMois) || 0)
  return limite >= debut ? { statut: 'tolere', fin, limite } : { statut: 'refuse', fin, limite }
}

// Date de fin impossible : plus de dureeMois après aujourd'hui (un certificat SST vaut 24 mois), ou illisible.
export function dateFinImpossible(validUntil, aujourdhui, dureeMois = 24) {
  const fin = String(validUntil || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fin) || Number.isNaN(new Date(`${fin}T12:00:00`).getTime())) return 'Date illisible'
  const jour = String(aujourdhui || new Date().toISOString()).slice(0, 10)
  if (fin > ajouterMois(jour, dureeMois)) return `Date impossible : un certificat vaut ${dureeMois} mois au plus`
  return null
}

// Fin de validité d'un certificat délivré par l'organisme lui-même (même durée pour tous : celle de la formation).
export function finValiditeInterne(dateCertification, dureeMois = 24) {
  return dateCertification ? ajouterMois(dateCertification, dureeMois) : null
}

// Dédommagement proposé (CGV, article 8, règles des formations à effectif imposé). Montants HT, modifiables ensuite.
// intra_annulation : 100 % du prix de la session ; intra_report : 50 % ; inter_places : 100 % des places non honorées.
export const DEDOMMAGEMENTS = {
  intra_annulation: { taux: 1, titre: 'Dédommagement, session annulée faute d\'effectif suffisant' },
  intra_report: { taux: 0.5, titre: 'Frais de report de session' },
  inter_places: { taux: 1, titre: 'Dédommagement, places réservées et non honorées' },
}

export function montantDedommagement({ cas, prixSession, prixPlace, places }) {
  const d = DEDOMMAGEMENTS[cas]
  if (!d) return null
  const base = cas === 'inter_places'
    ? (Number(prixPlace) || 0) * Math.max(0, Math.floor(Number(places) || 0))
    : (Number(prixSession) || 0)
  return Math.round(base * d.taux * 100) / 100
}
