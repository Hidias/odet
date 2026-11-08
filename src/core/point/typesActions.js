// Types d'action et activités enchaînées (0514, idée n° 2 reprise d'Odoo, choix de H du 08/11).
// Un type porte un délai (échéance proposée = jour de création + délai), un responsable par défaut et un type suivant.
// Quand une action d'un type qui a une suite est faite, la suite est PROPOSÉE pré-remplie : rien n'est créé d'office.
import { supabase } from '../supabase'
import { getCurrentCompanyId } from '../company/companyContext'
import { decaler, iso } from './pointSemaine'

const must = ({ data, error }) => { if (error) throw error; return data }

export const DELAI_MAX = 365

/**
 * Types de la société en cours, dans l'ordre ; null si la lecture a échoué (jamais une liste vide inventée).
 * Filtrés par société : un compte membre de plusieurs sociétés les voit toutes (comme le point de la semaine).
 */
export async function chargerTypes() {
  let q = supabase.from('team_action_types').select('*')
  if (getCurrentCompanyId()) q = q.eq('company_id', getCurrentCompanyId())
  const { data, error } = await q.order('position').order('name')
  return error ? null : data || []
}

// Messages lisibles pour les refus de la base (nom pris entre-temps, droits)
const messageType = (err) => (err?.code === '23505' ? 'Un type porte déjà ce nom.'
  : err?.code === 'PGRST116' ? 'Modification refusée : réservée à la direction.' : err?.message || 'Enregistrement impossible.')

/** Nom d'un type : contrôle avant enregistrement (même règle qu'en base : 2 à 80 caractères, nom unique) */
export function erreurNomType(nom, types = [], id = null) {
  const n = String(nom || '').trim()
  if (n.length < 2) return 'Le nom doit compter au moins 2 caractères.'
  if (n.length > 80) return 'Le nom ne doit pas dépasser 80 caractères.'
  const cle = n.toLocaleLowerCase('fr')
  if ((types || []).some((t) => t.id !== id && String(t.name || '').trim().toLocaleLowerCase('fr') === cle)) return 'Un type porte déjà ce nom.'
  return null
}

/** Délai saisi : un entier de 0 à 365, sinon null */
export function delaiValide(v) {
  const s = String(v ?? '').trim()
  if (!/^\d{1,3}$/.test(s)) return null
  const n = Number(s)
  return n <= DELAI_MAX ? n : null
}

/** Échéance proposée pour un type, à partir d'un jour (AAAA-MM-JJ) */
export const echeanceDuType = (type, auj = iso(new Date())) => (type ? decaler(auj, Number(type.delay_days) || 0) : null)

/** Type actif d'une liste par son identifiant */
export const typeActif = (types, id) => (id ? (types || []).find((t) => t.id === id && t.active !== false) || null : null)

/**
 * Choix d'un type dans le formulaire de création : intitulé (s'il est vide ou encore celui du type choisi avant),
 * responsable (si le type en a un) et échéance. types : liste pour retrouver le nom du type choisi avant.
 */
export function choixType(form, type, auj = iso(new Date()), types = []) {
  if (!type) return { ...form, type_id: '' }
  const avant = (types || []).find((t) => t.id === form.type_id)
  const titre = String(form.title || '').trim()
  return {
    ...form,
    type_id: type.id,
    title: !titre || (avant && titre === avant.name) ? type.name : form.title,
    owner_id: type.default_owner_id || form.owner_id,
    due_on: echeanceDuType(type, auj),
  }
}

/**
 * Suite à proposer quand une action vient d'être faite ; null s'il n'y en a pas (pas de type, pas de suite active,
 * suite déjà créée). Même client et même lien que l'action faite ; responsable du type suivant, sinon le même.
 */
export function suiteProposee(action, types, { auj = iso(new Date()), dejaSuivies = [] } = {}) {
  if (!action || !action.type_id) return null
  if ((dejaSuivies || []).includes(action.id)) return null
  // Types de la société de l'action seulement (la suite se crée dans la même société)
  const memes = (types || []).filter((t) => !action.company_id || !t.company_id || t.company_id === action.company_id)
  const type = typeActif(memes, action.type_id)
  const suivant = type ? typeActif(memes, type.next_type_id) : null
  if (!suivant) return null
  const client = action.clients?.name || null
  return {
    title: (client ? `${suivant.name} : ${client}` : suivant.name).slice(0, 300),
    owner_id: suivant.default_owner_id || action.owner_id || '',
    due_on: echeanceDuType(suivant, auj),
    type_id: suivant.id,
    previous_id: action.id,
    company_id: action.company_id || null,
    client_id: action.client_id || null,
    link: action.link || null,
  }
}

/** Libellé du délai d'un type */
export const libelleDelai = (n) => (!Number(n) ? 'le jour même' : Number(n) === 1 ? '1 jour après' : `${Number(n)} jours après`)

export async function enregistrerType(t) {
  const ligne = {
    name: String(t.name || '').trim(),
    delay_days: delaiValide(t.delay_days) ?? 0,
    default_owner_id: t.default_owner_id || null,
    next_type_id: t.next_type_id || null,
    active: t.active !== false,
  }
  try {
    if (t.id) return must(await supabase.from('team_action_types').update(ligne).eq('id', t.id).select('*').single())
    const societe = getCurrentCompanyId()
    return must(await supabase.from('team_action_types').insert({ ...ligne, position: Number(t.position) || 0, ...(societe ? { company_id: societe } : {}) }).select('*').single())
  } catch (err) { throw new Error(messageType(err)) }
}

export async function supprimerType(id) {
  // Une suppression refusée par les droits ne renvoie aucune ligne, sans erreur
  const lignes = must(await supabase.from('team_action_types').delete().eq('id', id).select('id'))
  if (!lignes?.length) throw new Error('Suppression refusée : réservée à la direction.')
}
