// Appel entrant (B110, demande d'Anthony du 09/11, choix de H du 18/11) : un prospect ou un client appelle.
// 1. On cherche la fiche par nom, téléphone ou SIRET.
// 2. Fiche trouvée : l'outil dit « Client » ou « Prospect » (clients.type, passage automatique en client, règle 0507).
//    Aucune fiche : on crée une fiche prospect (nom, téléphone, contact) dans la même fenêtre.
// 3. Une action de l'équipe « Rappeler » ou « Aller voir » est créée, reliée à la fiche, avec responsable et échéance.
// Rien de nouveau en base : team_actions.client_id existe depuis 0407, source « manuel ».
import { supabase } from '../supabase'
import { creerAction } from './actions'

const chiffres = (s) => String(s || '').replace(/\D/g, '')

/**
 * Filtre PostgREST de la recherche (null si le texte est trop court).
 * Nom (ou raison sociale) qui contient le texte ; SIRET ou SIREN exact (9 ou 14 chiffres) ;
 * téléphone : les chiffres dans l'ordre, quels que soient les espaces ou points de la fiche (6 chiffres au moins).
 */
export function filtreRecherche(texte) {
  const t = String(texte || '').trim()
  if (t.length < 2) return null
  const parts = []
  // Caractères qui casseraient le filtre PostgREST (virgule, parenthèses) ou joker : remplacés par un joker simple
  const nom = t.replace(/[,()%*\\"]/g, ' ').replace(/\s+/g, ' ').trim()
  if (nom.length >= 2) {
    parts.push(`name.ilike.*${nom}*`)
    parts.push(`legal_name.ilike.*${nom}*`)
  }
  const n = chiffres(t)
  if (n.length === 14) parts.push(`siret.eq.${n}`)
  if (n.length === 9) parts.push(`siren.eq.${n}`)
  if (n.length >= 6) {
    // Numéro international (+33 6…) ramené au format national (06…)
    const national = n.startsWith('33') && n.length === 11 ? `0${n.slice(2)}` : n
    const motif = `*${national.split('').join('*')}*`
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

/** Fiches qui correspondent (8 au plus) ; null si la lecture a échoué (jamais une liste vide inventée) */
export async function chercherFiches(texte) {
  const filtre = filtreRecherche(texte)
  if (!filtre) return []
  const { data, error } = await supabase.from('clients')
    .select('id, name, legal_name, city, type, status, contact_name, contact_phone, mobile, company_id')
    .or(filtre).order('name').limit(8)
  return error ? null : data || []
}

/** Fiche prospect créée depuis l'appel (le type n'est jamais écrit à la main : « prospect » par défaut en base) */
export async function creerFicheProspect({ nom, telephone, contact }) {
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

/** Action de l'équipe reliée à la fiche (dans la société de la fiche) */
export async function creerActionAppel({ fiche, suite, motif, contact, telephone, owner_id, due_on, urgent }) {
  if (!fiche?.id) throw new Error('Choisissez ou créez d\'abord la fiche')
  return creerAction({
    title: titreAction(suite, fiche.name, motif),
    detail: detailAction({ contact, telephone, motif }),
    owner_id: owner_id || null,
    due_on: due_on || null,
    urgent: !!urgent,
    client_id: fiche.id,
    company_id: fiche.company_id || null,
  })
}
