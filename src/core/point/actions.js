// Actions de l'équipe (0407) : une seule table pour le point de la semaine, le bilan, les réunions et la saisie libre.
import { supabase } from '../supabase'
import { decaler, iso } from './pointSemaine'
import { FILTRE_EQUIPE } from '../org/currentOrg'

const must = ({ data, error }) => { if (error) throw error; return data }

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
  if (ligne.title.length < 2) throw new Error('Intitulé trop court')
  return must(await supabase.from('team_actions').insert(ligne).select('*').single())
}

export async function modifierAction(id, patch) {
  return must(await supabase.from('team_actions').update(patch).eq('id', id).select('*').single())
}

/** Report d'une semaine (à partir de l'échéance, ou d'aujourd'hui si elle est passée ou absente) */
export function dateReport(dueOn) {
  const auj = iso(new Date())
  const base = dueOn && dueOn > auj ? dueOn : auj
  return decaler(base, 7)
}

/** Échéance lue : en retard, aujourd'hui, cette semaine, plus tard, sans échéance */
export function groupeEcheance(a, auj = iso(new Date())) {
  if (a.status !== 'a_faire') return 'terminees'
  if (!a.due_on) return 'sans'
  if (a.due_on < auj) return 'retard'
  const fin = (() => { const d = new Date(`${auj}T12:00:00`); d.setDate(d.getDate() + (7 - ((d.getDay() + 6) % 7)) - 1); return iso(d) })()
  return a.due_on <= fin ? 'semaine' : 'plus_tard'
}

export const GROUPES = [
  { id: 'retard', titre: 'En retard' },
  { id: 'semaine', titre: 'Cette semaine' },
  { id: 'plus_tard', titre: 'Plus tard' },
  { id: 'sans', titre: 'Sans échéance' },
  { id: 'terminees', titre: 'Terminées' },
]
