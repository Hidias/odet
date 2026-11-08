// Postes et titres exigés (0513, idée n° 3 reprise d'Odoo, choix de H du 08/11). Chaque nuit, la base prépare une action
// de l'équipe pour chaque titre exigé qui manque ou finit dans moins de 3 mois (public.habilitations_actions_generer) ;
// rien n'est envoyé. Écriture réservée au droit « rh.parametres.gerer » (règles de la base).

import { supabase } from '../../../core/supabase'
import { TYPES_HABILITATION } from './rhDocuments'

const must = ({ data, error }) => { if (error) throw error; return data }

/** Libellé proposé pour une exigence : type de titre, puis les symboles acceptés (« ou ») */
export function libelleExigence(kind, symboles = []) {
  const base = TYPES_HABILITATION[kind] || 'Titre'
  const s = (symboles || []).filter(Boolean)
  if (!s.length) return base
  return `${base} ${s.length === 1 ? s[0] : `${s.slice(0, -1).join(', ')} ou ${s[s.length - 1]}`}`
}

/** Emploi écrit sur le contrat : le texte saisi, sinon le nom du poste choisi */
export function emploiDuContrat(jobTitle, poste) {
  const t = String(jobTitle || '').trim()
  return t || String(poste?.name || '').trim()
}

/** Nom de poste valide (2 à 100 caractères, sans doublon dans la société, casse ignorée) */
export function erreurNomPoste(nom, postes = [], idModifie = null) {
  const n = String(nom || '').trim()
  if (n.length < 2) return 'Nom du poste trop court'
  if (n.length > 100) return 'Nom du poste trop long (100 caractères au plus)'
  if (postes.some((p) => p.id !== idModifie && String(p.name).trim().toLowerCase() === n.toLowerCase())) return 'Ce poste existe déjà'
  return null
}

export const chargerPostes = async () => must(await supabase.from('hr_jobs')
  .select('id, name, position, hr_job_requirements(id, required_kind, required_symbols, label)')
  .order('position').order('name'))

export async function enregistrerPoste({ id, name }) {
  const ligne = { name: String(name || '').trim() }
  if (id) return must(await supabase.from('hr_jobs').update(ligne).eq('id', id).select('id').single())
  return must(await supabase.from('hr_jobs').insert(ligne).select('id').single())
}
export const supprimerPoste = async (id) => must(await supabase.from('hr_jobs').delete().eq('id', id))

export async function ajouterExigence({ jobId, kind, symboles = [], label = '' }) {
  const s = (symboles || []).filter(Boolean)
  return must(await supabase.from('hr_job_requirements').insert({
    job_id: jobId, required_kind: kind, required_symbols: s.length ? s : null,
    label: String(label || '').trim() || libelleExigence(kind, s),
  }))
}
export const supprimerExigence = async (id) => must(await supabase.from('hr_job_requirements').delete().eq('id', id))

/** Compte à qui la nuit confie les actions (sans ligne : personne en particulier) */
export async function chargerResponsableTitres() {
  const rows = must(await supabase.from('hr_settings').select('company_id, titres_owner_id').limit(1))
  return rows?.[0]?.titres_owner_id || null
}
export const enregistrerResponsableTitres = async (ownerId) => must(await supabase.from('hr_settings')
  .upsert({ titres_owner_id: ownerId || null, updated_at: new Date().toISOString() }, { onConflict: 'company_id' }))
