// Accès aux données du module Passeport de prévention.
// Le numéro de sécurité sociale ne passe jamais par ce fichier : seulement « présent » et ses 3 derniers
// caractères (fonction pp_nir_etat) ; la saisie et la fabrication des fichiers passent par api/passeport.js.

import { supabase } from '../../../core/supabase'
import { apiFetch } from '../../../core/api'

export const PP_ROLES = ['superadmin', 'admin', 'direction', 'gestionnaire']

function check({ data, error }) {
  if (error) throw new Error(error.message || 'Erreur de lecture')
  return data
}

export async function loadFormat() {
  const data = check(await supabase.from('pp_format_versions').select('version, label, contrat, regles, sources')
    .eq('en_vigueur', true).order('created_at', { ascending: false }).limit(1).maybeSingle())
  if (!data) throw new Error("Le format officiel du Passeport n'est pas disponible. Prévenez le support.")
  return data
}

export async function loadPresets() {
  return check(await supabase.from('pp_presets').select('*').order('position'))
}

export async function loadCourses() {
  return check(await supabase.from('courses').select('id, title, code').order('title'))
}

export async function loadSettings() {
  const rows = check(await supabase.from('pp_course_settings').select('*'))
  return Object.fromEntries((rows || []).map((r) => [r.course_id, r]))
}

export async function saveSettings(courseId, values) {
  const { data: { user } } = await supabase.auth.getUser()
  return check(await supabase.from('pp_course_settings')
    .upsert({ ...values, course_id: courseId, updated_at: new Date().toISOString(), updated_by: user?.id || null }, { onConflict: 'course_id' })
    .select('*').single())
}

export async function loadDonnees(sessionIds = null) {
  return check(await supabase.rpc('pp_donnees', { p_session_ids: sessionIds, p_inscription_ids: null })) || []
}

export async function loadFichiers() {
  return check(await supabase.from('pp_fichiers').select('*').order('genere_le', { ascending: false }).limit(200))
}

export async function loadAccuses() {
  return check(await supabase.from('pp_accuses').select('*').order('importe_le', { ascending: false }).limit(100))
}

export async function loadNirEtat(traineeIds) {
  if (!traineeIds?.length) return {}
  const rows = check(await supabase.rpc('pp_nir_etat', { p_trainee_ids: traineeIds }))
  return Object.fromEntries((rows || []).map((r) => [r.trainee_id, r]))
}

export async function enregistrerNom(traineeId, nom, confirme) {
  check(await supabase.rpc('pp_enregistrer_nom', { p_trainee_id: traineeId, p_nom: nom, p_confirme: !!confirme }))
}

export async function enregistrerRefus(traineeId, refus) {
  check(await supabase.rpc('pp_enregistrer_refus', { p_trainee_id: traineeId, p_refus: !!refus }))
}

export async function importerAccuse(nomFichier, lignes) {
  return check(await supabase.rpc('pp_import_accuse', { p_nom_fichier: nomFichier, p_lignes: lignes }))
}

export async function marquerFichier(fichierId, nonDepose) {
  check(await supabase.rpc('pp_marquer_fichier', { p_fichier_id: fichierId, p_non_depose: !!nonDepose }))
}

// Appel de la route serveur (jeton de l'utilisateur connecté)
export async function apiPasseport(action, body = {}) {
  const res = await apiFetch('/api/passeport', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, action }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(json.error || `Erreur ${res.status}`)
    err.status = res.status
    err.details = json
    throw err
  }
  return json
}

// Portail stagiaire (sans compte) : même route, contrôlée par le jeton de session et le code individuel
export async function portailPasseport(action, body) {
  const res = await fetch('/api/passeport', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, action }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(json.error || `Erreur ${res.status}`)
    err.status = res.status
    throw err
  }
  return json
}

// Téléchargement par un vrai clic : le contenu est gardé en mémoire le temps du clic, jamais stocké
export function telechargerTexte(nom, contenu) {
  const blob = new Blob([contenu], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nom
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
