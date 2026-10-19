// Suivi des affaires (chantier 10, 0380) : calculs purs, partagés par la page Affaires et la fiche client.
// Une affaire ouverte a toujours une date de prochaine action ; la base le garantit.

export const FERMEES = ['gagnee', 'perdue']
export const METIERS = { formation: 'Formation', maintenance: 'Maintenance', autre: 'Autre' }
export const CANAUX = { appel: 'Appel', email: 'Email', courrier: 'Courrier' }
export const ECHANGES = { call: 'Appel', email: 'Email', meeting: 'Rendez-vous', note: 'Note' }
export const CADENCE = { appel: 'Appels', email: 'Emails', rdv: 'Rendez-vous', affaire: 'Affaires créées' }

// Étapes par défaut (la base les pose pour chaque société ; utilisées si la liste n'est pas lisible)
export const ETAPES_DEPART = [
  { code: 'a_qualifier', label: 'À qualifier', probability: 10, position: 10 },
  { code: 'rdv', label: 'Rendez-vous', probability: 25, position: 20 },
  { code: 'devis_envoye', label: 'Devis envoyé', probability: 50, position: 30 },
  { code: 'negociation', label: 'Négociation', probability: 75, position: 40 },
  { code: 'gagnee', label: 'Gagnée', probability: 100, position: 90 },
  { code: 'perdue', label: 'Perdue', probability: 0, position: 99 },
]

const jour = (d) => {
  if (!d) return null
  const x = typeof d === 'string' ? new Date(`${d.slice(0, 10)}T12:00:00`) : new Date(d)
  return new Date(x.getFullYear(), x.getMonth(), x.getDate())
}

// Urgence d'une prochaine action : en retard, aujourd'hui, cette semaine (7 jours), plus tard
export function urgence(dateAction, aujourdhui = new Date()) {
  const d = jour(dateAction)
  if (!d) return 'plus_tard'
  const t = jour(aujourdhui)
  const ecart = Math.round((d - t) / 86400000)
  if (ecart < 0) return 'retard'
  if (ecart === 0) return 'aujourdhui'
  if (ecart <= 7) return 'semaine'
  return 'plus_tard'
}

export const URGENCES = {
  retard: ['danger', 'En retard'],
  aujourdhui: ['warning', 'Aujourd\'hui'],
  semaine: ['info', 'Cette semaine'],
  plus_tard: ['neutral', 'Plus tard'],
}

// Tri de la liste « À faire » : la plus ancienne prochaine action d'abord
export function trierAFaire(lignes) {
  return [...(lignes || [])].sort((a, b) => String(a.next_action_on || '9999').localeCompare(String(b.next_action_on || '9999'))
    || String(a.client_name || '').localeCompare(String(b.client_name || ''), 'fr'))
}

// Colonnes du pipeline : étapes ouvertes dans l'ordre, avec leurs lignes et leurs totaux
export function colonnesPipeline(lignes, etapes = ETAPES_DEPART) {
  const ouvertes = [...etapes].filter((e) => !FERMEES.includes(e.code) && e.is_active !== false)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const cols = ouvertes.map((e) => ({ ...e, lignes: [], montant: 0, pondere: 0 }))
  const parCode = Object.fromEntries(cols.map((c) => [c.code, c]))
  for (const l of lignes || []) {
    const c = parCode[l.stage] || null
    if (!c) continue
    c.lignes.push(l)
    c.montant += Number(l.amount_ht || 0)
    c.pondere += Number(l.montant_pondere || 0)
  }
  for (const c of cols) { c.montant = arrondi(c.montant); c.pondere = arrondi(c.pondere) }
  return cols
}

export function totauxPipeline(lignes) {
  let montant = 0
  let pondere = 0
  for (const l of lignes || []) { montant += Number(l.amount_ht || 0); pondere += Number(l.montant_pondere || 0) }
  return { nb: (lignes || []).length, montant: arrondi(montant), pondere: arrondi(pondere) }
}

// Cadence de la semaine : réel et objectif par type ; objectif personnel prioritaire sur celui de l'équipe
export function cadence(realises, objectifs, profileId) {
  const res = {}
  for (const k of Object.keys(CADENCE)) {
    const reel = (realises || []).filter((r) => r.kind === k && (!profileId || r.profile_id === profileId))
      .reduce((s, r) => s + Number(r.realise || 0), 0)
    const perso = (objectifs || []).find((o) => o.kind === k && o.profile_id && o.profile_id === profileId)
    const equipe = (objectifs || []).find((o) => o.kind === k && !o.profile_id)
    const objectif = perso ? perso.per_week : equipe ? equipe.per_week : null
    res[k] = { reel, objectif, atteint: objectif != null && reel >= objectif }
  }
  return res
}

export function arrondi(n) {
  return Math.round(Number(n || 0) * 100) / 100
}

export const euros = (n) => (n == null ? '—' : `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`)

// Date au format AAAA-MM-JJ, n jours après aujourd'hui (heure locale)
export function dansJours(n, base = new Date()) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
