// Actions de l'équipe (0407) : une seule table pour le point de la semaine, le bilan, les réunions et la saisie libre.
import { supabase } from '../supabase'
import { decaler, iso, lundi } from './pointSemaine'
import { FILTRE_EQUIPE } from '../org/currentOrg'
import { MESSAGE_VUE_GROUPE, estRefusVueGroupe, enVueGroupe } from '../company/societes'

// Vue groupe (0516) : lecture seule ; refus clair avant tout envoi, et même phrase si la base refuse
const sansVueGroupe = () => { if (enVueGroupe()) throw new Error(MESSAGE_VUE_GROUPE) }
const ecrire = async (requete) => {
  const { data, error } = await requete
  if (error) throw (estRefusVueGroupe(error) ? new Error(MESSAGE_VUE_GROUPE) : error)
  return data
}

export const STATUTS_ACTION = { a_faire: 'À faire', fait: 'Fait', abandonne: 'Abandonné' }

export async function chargerEquipe() {
  const { data } = await supabase.from('profiles').select('id, display_name, first_name, last_name, email, is_active').eq('is_active', true).or(FILTRE_EQUIPE).order('display_name')
  return (data || []).filter((p) => p.email)
}

export const nomProfil = (p) => (p ? (p.display_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email) : '')

export async function creerAction(a) {
  const ligne = {
    title: String(a.title || '').trim().slice(0, 300),
    detail: a.detail || null,
    owner_id: a.owner_id || null,
    due_on: a.due_on || null,
    urgent: !!a.urgent,
    source: a.source || 'manuel',
    source_id: a.source_id || null,
    client_id: a.client_id || null,
    link: a.link && /^\/[A-Za-z0-9]/.test(a.link) ? a.link.slice(0, 300) : null,
  }
  // Type et action précédente (0514) : envoyés seulement s'ils sont connus (base d'avant 0514 : colonnes absentes)
  if (a.type_id) ligne.type_id = a.type_id
  if (a.previous_id) ligne.previous_id = a.previous_id
  // Suite d'une action : dans la société de l'action faite (compte membre de plusieurs sociétés)
  if (a.company_id) ligne.company_id = a.company_id
  if (ligne.title.length < 2) throw new Error('Intitulé trop court')
  sansVueGroupe()
  return ecrire(supabase.from('team_actions').insert(ligne).select('*').single())
}

export async function modifierAction(id, patch) {
  sansVueGroupe()
  return ecrire(supabase.from('team_actions').update(patch).eq('id', id).select('*').single())
}

export async function supprimerAction(id) {
  sansVueGroupe()
  return ecrire(supabase.from('team_actions').delete().eq('id', id))
}

/** Report d'une semaine (à partir de l'échéance, ou d'aujourd'hui si elle est passée ou absente) */
export function dateReport(dueOn, auj = iso(new Date())) {
  const base = dueOn && dueOn > auj ? dueOn : auj
  return decaler(base, 7)
}

/** Échéance lue : en retard, aujourd'hui, cette semaine, plus tard, sans échéance */
export function groupeEcheance(a, auj = iso(new Date())) {
  if (a.status !== 'a_faire') return 'terminees'
  if (!a.due_on) return 'sans'
  if (a.due_on < auj) return 'retard'
  return a.due_on <= finDeSemaine(auj) ? 'semaine' : 'plus_tard'
}

export const GROUPES = [
  { id: 'retard', titre: 'En retard' },
  { id: 'semaine', titre: 'Cette semaine' },
  { id: 'plus_tard', titre: 'Plus tard' },
  { id: 'sans', titre: 'Sans échéance' },
  { id: 'terminees', titre: 'Terminées' },
]

/** Dimanche de la semaine d'une date (AAAA-MM-JJ) */
export const finDeSemaine = (auj) => decaler(lundi(auj), 6)
/** Lundi de la semaine suivante */
export const lundiProchain = (auj) => decaler(lundi(auj), 7)

// Kanban des actions (consigne de H du 04/11) : une colonne par échéance, comme la liste. Déplacer une carte change
// sa date : « Cette semaine » la met à aujourd'hui, « Plus tard » au lundi suivant (compté comme un report),
// « Sans échéance » retire la date, « Terminées » la marque faite. On ne dépose jamais dans « En retard ».
// La colonne « En retard » n'apparaît que si elle a des cartes ; « Terminées » seulement quand on les affiche.
export function colonnesActions(actions, { auj = iso(new Date()), avecTerminees = false } = {}) {
  return GROUPES
    .filter((g) => g.id !== 'terminees' || avecTerminees)
    .map((g) => ({ code: g.id, label: g.titre, lignes: (actions || []).filter((a) => groupeEcheance(a, auj) === g.id) }))
    .filter((c) => c.code !== 'retard' || c.lignes.length > 0)
}

/** Changement à écrire quand une action est déposée dans une colonne ; null si rien ne change ou si c'est refusé */
export function changementColonne(a, code, auj = iso(new Date())) {
  if (!a || !code || code === 'retard') return null
  const actuelle = groupeEcheance(a, auj)
  if (actuelle === code) return null
  if (code === 'terminees') return { status: 'fait' }
  const rouvrir = a.status !== 'a_faire' ? { status: 'a_faire' } : {}
  if (code === 'semaine') return { ...rouvrir, due_on: auj }
  if (code === 'plus_tard') return { ...rouvrir, due_on: lundiProchain(auj) }
  if (code === 'sans') return { ...rouvrir, due_on: null }
  return null
}

/** Choix du menu « ⋯ » d'une action du Kanban (les choix sans effet sont retirés) */
export function choixAction(a, auj = iso(new Date())) {
  if (!a) return []
  if (a.status !== 'a_faire') return [{ code: 'rouvrir', label: 'Remettre à faire', patch: { status: 'a_faire' }, message: 'Action remise à faire' }]
  const tous = [
    { code: 'aujourdhui', label: 'Pour aujourd\'hui', patch: { due_on: auj }, message: 'Prévue aujourd\'hui' },
    { code: 'lundi', label: 'Pour lundi prochain', patch: { due_on: lundiProchain(auj) }, message: 'Prévue lundi prochain' },
    { code: 'report', label: 'Reporter d\'une semaine', patch: { due_on: dateReport(a.due_on, auj) }, message: 'Reportée d\'une semaine' },
    { code: 'sans', label: 'Sans échéance', patch: { due_on: null }, message: 'Échéance retirée' },
    { code: 'fait', label: 'Marquer comme fait', patch: { status: 'fait' }, message: 'Bravo !' },
    { code: 'abandonne', label: 'Abandonner', patch: { status: 'abandonne' }, message: 'Action abandonnée' },
  ]
  // Choix sans effet retirés, et « Reporter » quand il tombe sur le même jour que « lundi prochain » (un lundi)
  return tous.filter((c) => (!('due_on' in c.patch) || (c.patch.due_on || null) !== (a.due_on || null))
    && !(c.code === 'report' && c.patch.due_on === lundiProchain(auj)))
}
