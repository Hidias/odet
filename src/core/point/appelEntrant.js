// Appel entrant (B110, demande d'Anthony du 09/11, choix de H du 18/11) : un prospect ou un client appelle.
// 1. On cherche la fiche par nom, téléphone ou SIRET.
// 2. Fiche trouvée : l'outil dit « Client » ou « Prospect » (clients.type, passage automatique en client, règle 0507).
//    Aucune fiche : on crée une fiche prospect (nom, téléphone, contact) dans la même fenêtre.
// 3. Une action de l'équipe « Rappeler » ou « Aller voir » est créée, reliée à la fiche, avec responsable et échéance.
// Rien de nouveau en base : team_actions.client_id existe depuis 0407, source « manuel ».
import { supabase } from '../supabase'
import { creerAction } from './actions'
import { societeActive, enVueGroupe, MESSAGE_VUE_GROUPE } from '../company/societes'

const chiffres = (s) => String(s || '').replace(/\D/g, '')

/**
 * Chiffres d'un téléphone sans le préfixe : un numéro français complet (06…, +33 6…, 0033 6…) est réduit à ses 9 derniers
 * chiffres, pour retrouver la fiche quel que soit le format enregistré ; un numéro partiel est cherché tel quel.
 */
export function chiffresTelephone(n) {
  const d = chiffres(n)
  if (d.length === 10 && d.startsWith('0')) return d.slice(1)
  if (d.length === 11 && d.startsWith('33')) return d.slice(2)
  if (d.length === 13 && d.startsWith('0033')) return d.slice(4)
  return d
}

/**
 * Filtre PostgREST de la recherche (null si le texte est trop court).
 * Nom (ou raison sociale) qui contient le texte ; SIRET ou SIREN exact (9 ou 14 chiffres) ;
 * téléphone : les chiffres dans l'ordre, quels que soient les espaces ou points de la fiche (6 chiffres au moins).
 */
export function filtreRecherche(texte) {
  const t = String(texte || '').trim()
  if (t.length < 2) return null
  const parts = []
  // Caractères qui casseraient le filtre PostgREST (virgule, parenthèses, guillemet) : remplacés par un joker, pour que
  // « Garage (Brest) » retrouve la fiche enregistrée avec ses parenthèses
  const nom = t.replace(/[,()%*\\"]/g, '*').replace(/\s+/g, ' ').replace(/\*+/g, '*').replace(/^[\s*]+|[\s*]+$/g, '')
  if (nom.replace(/[\s*]/g, '').length >= 2) {
    parts.push(`name.ilike.*${nom}*`)
    parts.push(`legal_name.ilike.*${nom}*`)
  }
  const n = chiffres(t)
  if (n.length === 14) parts.push(`siret.eq.${n}`)
  if (n.length === 9) parts.push(`siren.eq.${n}`)
  if (n.length >= 6) {
    const motif = `*${chiffresTelephone(n).split('').join('*')}*`
    parts.push(`contact_phone.ilike.${motif}`, `mobile.ilike.${motif}`)
  }
  return parts.length ? parts.join(',') : null
}

/** Statut lisible d'une fiche : « Client » ou « Prospect » (jamais saisi à la main, règle 0507) */
export const statutFiche = (c) => (c?.type === 'client' ? 'Client' : 'Prospect')

export const SUITES = {
  rappeler: 'Rappeler',
  aller_voir: 'Aller voir',
}

/** Intitulé de l'action : « Rappeler Nom (appel entrant) : motif », coupé à 300 caractères (règle de la base) */
export function titreAction(suite, nomFiche, motif) {
  const verbe = SUITES[suite] || SUITES.rappeler
  const nom = String(nomFiche || '').trim() || 'le correspondant'
  const m = String(motif || '').replace(/\s+/g, ' ').trim()
  return `${verbe} ${nom} (appel entrant)${m ? ` : ${m}` : ''}`.slice(0, 300)
}

/** Détail de l'action : qui a appelé et à quel numéro (2 000 caractères au plus) */
export function detailAction({ contact, telephone, motif }) {
  const lignes = []
  if (String(contact || '').trim()) lignes.push(`Contact : ${String(contact).trim()}`)
  if (String(telephone || '').trim()) lignes.push(`Téléphone : ${String(telephone).trim()}`)
  if (String(motif || '').trim()) lignes.push(`Motif : ${String(motif).trim()}`)
  const t = lignes.join('\n')
  return t ? t.slice(0, 2000) : null
}

export const LIMITE = 8

/** Fiches qui correspondent (LIMITE + 1 lues : au-delà de LIMITE, l'écran demande de préciser) ; null si la lecture a échoué (jamais une liste vide inventée) */
export async function chercherFiches(texte) {
  const filtre = filtreRecherche(texte)
  if (!filtre) return []
  const { data, error } = await supabase.from('clients')
    .select('id, name, legal_name, city, type, status, contact_name, contact_phone, mobile, company_id, company_ids')
    .or(filtre).order('name').limit(LIMITE + 1)
  return error ? null : data || []
}

/** Fiche prospect créée depuis l'appel (le type n'est jamais écrit à la main : « prospect » par défaut en base) */
export async function creerFicheProspect({ nom, telephone, contact }) {
  if (enVueGroupe()) throw new Error(MESSAGE_VUE_GROUPE)
  const name = String(nom || '').trim()
  if (name.length < 2) throw new Error('Nom de l\'entreprise ou de la personne trop court')
  const { data, error } = await supabase.from('clients').insert({
    name: name.slice(0, 255),
    contact_name: String(contact || '').trim() || null,
    contact_phone: String(telephone || '').trim().slice(0, 20) || null,
    status: 'actif',
    client_type: 'entreprise',
  }).select('id, name, type, company_id').single()
  if (error) throw error
  return data
}

/**
 * Société de l'action : celle où l'on travaille quand la fiche lui est partagée (une fiche d'une autre société partagée
 * avec elle serait refusée par la règle d'accès des actions), sinon la société de la fiche.
 */
export function societeAction(fiche, enCours = societeActive()) {
  const partagees = Array.isArray(fiche?.company_ids) ? fiche.company_ids : []
  if (enCours && (fiche?.company_id === enCours || partagees.includes(enCours))) return enCours
  return fiche?.company_id || null
}

/** Action de l'équipe reliée à la fiche */
export async function creerActionAppel({ fiche, suite, motif, contact, telephone, owner_id, due_on, urgent, ctxSocietes = null }) {
  if (!fiche?.id) throw new Error('Choisissez ou créez d\'abord la fiche')
  return creerAction({
    title: titreAction(suite, fiche.name, motif),
    detail: detailAction({ contact, telephone, motif }),
    owner_id: owner_id || null,
    due_on: due_on || null,
    urgent: !!urgent,
    client_id: fiche.id,
    // Société choisie dans l'onglet, sinon société par défaut du compte (contexte des sociétés du compte)
    company_id: societeAction(fiche, societeActive(ctxSocietes)),
  })
}
