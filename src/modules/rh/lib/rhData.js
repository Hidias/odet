// Module RH, socle (chantier 12, 0290) : personnes, contrats, équipes, horaires, rémunérations.
// Droits contrôlés en base : l'annuaire (v_hr_annuaire) ne montre que les champs professionnels ; la fiche complète
// demande « Voir les dossiers » ; la rémunération passe par hr_remuneration(), qui journalise chaque consultation.

import { supabase } from '../../../core/supabase'
import { fetchAll } from '../../../core/fetchAll'

const must = ({ data, error }) => { if (error) throw error; return data }

export const CONTRATS = {
  cdi: 'CDI', cdd: 'CDD', apprentissage: 'Apprentissage', professionnalisation: 'Professionnalisation',
  stage: 'Stage', interim: 'Intérim', mandataire: 'Mandataire social', autre: 'Autre',
}
export const STATUTS = {
  actif: { label: 'En poste', badge: 'badge-success' },
  a_venir: { label: 'Arrivée prévue', badge: 'badge-info' },
  termine: { label: 'Parti', badge: 'badge-neutral' },
  sans_contrat: { label: 'Sans contrat', badge: 'badge-warning' },
}
export const PERIODES = { mensuel: 'par mois', horaire: 'de l\'heure', annuel: 'par an' }
export const JOURS = [['lun', 'Lundi'], ['mar', 'Mardi'], ['mer', 'Mercredi'], ['jeu', 'Jeudi'], ['ven', 'Vendredi'], ['sam', 'Samedi'], ['dim', 'Dimanche']]

export const nomComplet = (p) => [p?.first_name, p?.usage_name || p?.last_name].filter(Boolean).join(' ')

/** Statut d'un contrat à une date (même règle que la vue v_hr_annuaire) */
export function statutContrat(c, aujourdhui = new Date().toISOString().slice(0, 10)) {
  if (!c) return 'sans_contrat'
  if (c.start_on > aujourdhui) return 'a_venir'
  if (c.end_on && c.end_on < aujourdhui) return 'termine'
  return 'actif'
}

/** « 08:30-12:30, 13:30-17:30 » ↔ [["08:30","12:30"],["13:30","17:30"]] */
export function plagesVersTexte(plages) {
  return (plages || []).map(([a, b]) => `${a}-${b}`).join(', ')
}
export function texteVersPlages(texte) {
  const out = []
  for (const morceau of String(texte || '').split(/[,;]/)) {
    const m = morceau.trim().match(/^(\d{1,2})[:h](\d{2})\s*-\s*(\d{1,2})[:h](\d{2})$/)
    if (!m) { if (morceau.trim()) return null; continue }
    const a = `${m[1].padStart(2, '0')}:${m[2]}`
    const b = `${m[3].padStart(2, '0')}:${m[4]}`
    if (a >= b || Number(m[1]) > 23 || Number(m[3]) > 23) return null
    out.push([a, b])
  }
  return out
}
/** Heures par semaine d'un horaire de référence */
export function heuresSemaine(days) {
  let minutes = 0
  for (const plages of Object.values(days || {})) {
    for (const [a, b] of plages || []) {
      const [ha, ma] = a.split(':').map(Number)
      const [hb, mb] = b.split(':').map(Number)
      minutes += (hb * 60 + mb) - (ha * 60 + ma)
    }
  }
  return Math.round((minutes / 60) * 100) / 100
}

export const chargerAnnuaire = async () => must(await fetchAll(() => supabase.from('v_hr_annuaire').select('*').order('last_name')))
export const chargerPersonne = async (id) => must(await supabase.from('hr_people').select('*').eq('id', id).maybeSingle())
export const chargerContrats = async (personId) => must(await supabase.from('hr_employments')
  .select('*, hr_teams:team_id(name), manager:manager_person_id(first_name, last_name, usage_name)')
  .eq('person_id', personId).order('start_on', { ascending: false }))
export const chargerEquipes = async () => must(await supabase.from('hr_teams').select('*').order('position').order('name'))
export const chargerHoraires = async () => must(await supabase.from('hr_schedules').select('*').order('is_default', { ascending: false }).order('name'))
export const chargerEtablissements = async () => {
  const { data } = await supabase.from('company_establishments').select('id, name, city').order('name')
  return data || []
}
export const chargerPersonnesChoix = async () => must(await supabase.from('v_hr_annuaire').select('id, first_name, last_name, usage_name').order('last_name'))

const nettoyer = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? (v.trim() || null) : v]))

export async function enregistrerPersonne(p) {
  const { id, ...reste } = nettoyer(p)
  if (id) return must(await supabase.from('hr_people').update(reste).eq('id', id).select('id').single())
  return must(await supabase.from('hr_people').insert(reste).select('id').single())
}
export async function archiverPersonne(id, archive) {
  must(await supabase.from('hr_people').update({ archived_at: archive ? new Date().toISOString() : null }).eq('id', id))
}
export async function enregistrerContrat(c) {
  const { id, hr_teams: _t, manager: _m, ...reste } = nettoyer(c)
  for (const k of ['weekly_hours', 'days_per_year']) reste[k] = reste[k] === '' || reste[k] == null ? null : Number(reste[k])
  if (id) return must(await supabase.from('hr_employments').update(reste).eq('id', id))
  return must(await supabase.from('hr_employments').insert(reste))
}
export const supprimerContrat = async (id) => must(await supabase.from('hr_employments').delete().eq('id', id))

/** Rémunérations d'un contrat : lecture journalisée par la base */
export const voirRemuneration = async (employmentId) => must(await supabase.rpc('hr_remuneration', { p_employment: employmentId }))
export async function ajouterRemuneration(employmentId, { amount, period, effective_on, note }) {
  // Pas de lecture en retour : la table n'est lue que par hr_remuneration (consultation journalisée)
  must(await supabase.from('hr_compensation').insert({ employment_id: employmentId, amount: Number(amount), period, effective_on, note: note || null }))
}

export async function enregistrerEquipe(e) {
  const { id, ...reste } = nettoyer(e)
  if (id) return must(await supabase.from('hr_teams').update(reste).eq('id', id))
  return must(await supabase.from('hr_teams').insert(reste))
}
export const supprimerEquipe = async (id) => must(await supabase.from('hr_teams').delete().eq('id', id))
export async function enregistrerHoraire(h) {
  const { id, ...reste } = h
  if (id) return must(await supabase.from('hr_schedules').update(reste).eq('id', id))
  return must(await supabase.from('hr_schedules').insert(reste))
}
