// Lecture des tables de droits pour les écrans Paramètres › Droits des personnes et › Profils de droits,
// et pour la page Règles de gestion (chantier 2, branche droits/ecrans).
// La base calcule les droits effectifs (member_rights_preview, 0377) : l'écran ne fait qu'afficher et écrire
// les choix (profils en plus, droits accordés ou retirés, contenu des profils).

import { supabase } from '../../supabase'

export const DOMAINES = {
  organisation: 'Organisation', planning: 'Planning', parametres: 'Paramètres', validations: 'Validations',
  formation: 'Formation', clients: 'Clients', commercial: 'Commercial', communication: 'Communication',
  facturation: 'Facturation', finance: 'Finance', qualite: 'Qualité', prestations: 'Prestations',
  passeport: 'Passeport de prévention', conformite: 'Conformité', interventions: 'Interventions',
  rh: 'Ressources humaines', frais: 'Frais', vehicules: 'Véhicules', stock: 'Stock', manager: 'Pilotage',
  plateforme: 'Plateforme',
}

export const ROLES_DE_BASE = {
  superadmin: 'Super administrateur', admin: 'Administrateur', direction: 'Direction', gestionnaire: 'Gestionnaire',
  formateur: 'Formateur', commercial: 'Commercial', comptable: 'Comptable interne', lecture: 'Lecture',
  technicien: 'Technicien', membre: 'Sans profil de base',
}

function verifier({ data, error }) {
  if (error) throw error
  return data || []
}

// Catalogue des droits (hors plateforme), rangé par domaine dans l'ordre du catalogue
export async function chargerCatalogue() {
  const lignes = verifier(await supabase.from('permissions')
    .select('code, module, label, description, own_scope, shows_prices, full_license_only, platform_only, position')
    .order('position'))
  return lignes.filter((d) => !d.platform_only)
}

export function parDomaine(catalogue) {
  const groupes = new Map()
  for (const d of catalogue) {
    const cle = d.module || d.code.split('.')[0]
    if (!groupes.has(cle)) groupes.set(cle, [])
    groupes.get(cle).push(d)
  }
  return [...groupes.entries()].map(([cle, droits]) => ({ cle, libelle: DOMAINES[cle] || cle, droits }))
}

// Profils visibles dans la société courante : modèle de plateforme, ou copie de la société qui le remplace
export async function chargerProfils(companyId) {
  const profils = verifier(await supabase.from('permission_profiles')
    .select('id, company_id, key, label, description, base_role, is_system, position')
    .order('position'))
  const ids = profils.map((p) => p.id)
  const droits = ids.length
    ? verifier(await supabase.from('permission_profile_rights').select('profile_id, right_code').in('profile_id', ids))
    : []
  const parProfil = new Map()
  for (const r of droits) {
    if (!parProfil.has(r.profile_id)) parProfil.set(r.profile_id, new Set())
    parProfil.get(r.profile_id).add(r.right_code)
  }
  const modeles = new Map()
  const propres = new Map()
  for (const p of profils) {
    const entree = { ...p, droits: parProfil.get(p.id) || new Set() }
    if (p.company_id === null) modeles.set(p.key, entree)
    else if (p.company_id === companyId) propres.set(p.key, entree)
  }
  const cles = [...new Set([...modeles.keys(), ...propres.keys()])].filter((k) => k !== 'superadmin')
  return cles.map((k) => ({ key: k, modele: modeles.get(k) || null, propre: propres.get(k) || null, actif: propres.get(k) || modeles.get(k) }))
    .sort((a, b) => (a.actif.position || 0) - (b.actif.position || 0))
}

// Personnes de la société courante, avec leurs profils en plus et leurs ajustements individuels
export async function chargerPersonnes(companyId) {
  const membres = verifier(await supabase.from('company_members')
    .select('id, company_id, profile_id, role, is_active, profiles:profile_id (display_name, email, is_active)')
    .eq('company_id', companyId))
  const ids = membres.map((m) => m.id)
  const [roles, ajustements] = ids.length ? await Promise.all([
    supabase.from('company_member_roles').select('id, member_id, role_key').in('member_id', ids).then(verifier),
    supabase.from('company_member_rights').select('id, member_id, right_code, effect, reason').in('member_id', ids).then(verifier),
  ]) : [[], []]
  return membres.map((m) => ({
    ...m,
    nom: m.profiles?.display_name || m.profiles?.email || '',
    email: m.profiles?.email || '',
    profilsEnPlus: roles.filter((r) => r.member_id === m.id),
    ajustements: ajustements.filter((a) => a.member_id === m.id),
  })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
}

export async function apercuDroits(profileId) {
  const { data, error } = await supabase.rpc('member_rights_preview', { p_profile: profileId })
  if (error) throw error
  return { profiles: data?.profiles || [], rights: new Set(data?.rights || []), role: data?.role || null }
}
