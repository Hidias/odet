// Relances à valider (0043) : règles partagées par la liste et le Kanban (consigne de H du 04/11).
// Rien ne part tout seul : « Valider » met la relance « à envoyer » ; « Envoyée » ne se pose qu'à la main, après
// l'envoi depuis sa messagerie, jamais en faisant glisser une carte. Envoyées et ignorées ne bougent plus.

export const COLONNES_RELANCES = [
  { code: 'a_valider', label: 'À valider' },
  { code: 'valide', label: 'À envoyer' },
  { code: 'envoye', label: 'Envoyées' },
  { code: 'ignore', label: 'Ignorées' },
]

export function colonnesRelances(items) {
  return COLONNES_RELANCES.map((c) => ({ ...c, lignes: (items || []).filter((i) => i.status === c.code) }))
}

/** Passages possibles depuis l'état d'une relance (dans l'ordre du menu) */
export function passagesRelance(a) {
  if (!a) return []
  if (a.status === 'a_valider') {
    return [
      ...(a.blocked_reason ? [] : [{ status: 'valide', label: 'Valider (à envoyer)' }]),
      { status: 'ignore', label: 'Ignorer…', confirmer: 'Ignorer cette relance ? Elle ne sera plus proposée.' },
    ]
  }
  if (a.status === 'valide') {
    return [
      { status: 'a_valider', label: 'Remettre à valider' },
      { status: 'envoye', label: 'Marquer envoyée…', confirmer: 'L\'avez-vous bien envoyée depuis votre messagerie ? Elle passera « envoyée ».', parGlisser: false },
    ]
  }
  return []
}

/** Une carte peut-elle être déposée dans cette colonne ? (jamais « Envoyées ») */
export function depotRelancePossible(a, status) {
  return passagesRelance(a).some((p) => p.status === status && p.parGlisser !== false)
}

export const MESSAGES_RELANCE = { valide: 'Relance validée : à envoyer', envoye: 'Relance marquée envoyée', ignore: 'Relance ignorée', a_valider: 'Remise à valider' }
