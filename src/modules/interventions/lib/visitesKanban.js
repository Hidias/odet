// Kanban des visites de maintenance (consigne de H du 04/11 ; choix « prudent » de H du 08/11).
// Planifier passe par le Planning (date, technicien, contrôle des habilitations) ; « Terminée » par le rapport
// signé de la visite. Le Kanban ne fait donc qu'un seul déplacement : remettre une visite planifiée « à planifier ».
// Pas d'annulation ici.

import { VISIT_STATUS } from './schedule'

export const COLONNES_VISITES = ['a_planifier', 'planifiee', 'en_cours', 'terminee']
export const JOURS_TERMINEES = 30 // visites terminées montrées : les 30 derniers jours

export function colonnesVisites(visites) {
  return COLONNES_VISITES.map((code) => ({
    code,
    label: VISIT_STATUS[code].label,
    lignes: (visites || []).filter((v) => v.status === code),
  }))
}

/** Seul dépôt permis : une visite planifiée (ni commencée ni terminée) remise « à planifier » */
export function depotVisitePossible(v, code, peutGerer = true) {
  return !!(peutGerer && v && v.status === 'planifiee' && code === 'a_planifier')
}

/** Changement écrit pour remettre une visite à planifier (comme « Retirer de la journée » du Planning) */
export const RETOUR_A_PLANIFIER = { status: 'a_planifier', planned_on: null, technician_id: null, route_order: 0 }

/** Choix du menu « ⋯ » d'une visite */
export function choixVisite(v, peutGerer = true) {
  if (!v) return []
  const choix = [{ code: 'ouvrir', label: 'Ouvrir la visite', lien: `/interventions/visite/${v.id}` }]
  if (!peutGerer) return choix
  if (v.status === 'a_planifier') choix.push({ code: 'planifier', label: 'Planifier (ouvre le Planning)', lien: '/interventions/planning' })
  if (v.status === 'planifiee') {
    choix.push({ code: 'jour', label: 'Changer de jour ou de technicien (Planning)', lien: `/interventions/planning${v.planned_on ? `?jour=${v.planned_on}` : ''}` })
    choix.push({ code: 'deplanifier', label: 'Remettre à planifier…' })
  }
  return choix
}

/** À planifier : l'échéance la plus proche d'abord (sans échéance à la fin), les autres dans l'ordre reçu */
export function trierAPlanifier(visites) {
  const l = visites || []
  const a = l.filter((v) => v.status === 'a_planifier').sort((x, y) => String(x.due_on || '9999').localeCompare(String(y.due_on || '9999')))
  return [...a, ...l.filter((v) => v.status !== 'a_planifier')]
}

/** Jour demandé dans l'adresse du Planning (?jour=) : une vraie date AAAA-MM-JJ, sinon null */
export function jourValide(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return null
  const d = new Date(`${s}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return iso === s ? s : null
}
