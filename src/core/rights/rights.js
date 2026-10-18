// Droits composés par société (chantier C1b) : lecture par l'application.
//
// UNE SEULE SOURCE : les droits viennent de la base (fonction public.my_rights), qui les calcule avec la même
// fonction que les règles d'accès (app.a_le_droit). L'écran ne recalcule rien : il lit la liste des droits du compte
// dans la société courante.
//
// Compatibilité : tant que les migrations 0370 à 0375 ne sont pas appliquées (fonction absente) ou si la lecture
// échoue, les droits valent null et l'application garde exactement son comportement d'avant C1b (rôle du compte).
// Aujourd'hui, seul le module Interventions s'en sert (pièces et réglages sans prix pour qui n'a pas le droit des
// prix). Les gardes des pages et des boutons viendront avec la branche ecrans/gardes.

export const PRIX_INTERVENTIONS = 'interventions.tarifs.voir'

// Réponse de la base → { companyId, role, profiles, rights (tableau trié), fullLicense } ; null si inutilisable
export function normaliserDroits(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.rights)) return null
  return {
    companyId: data.company_id || null,
    role: data.role || null,
    profiles: Array.isArray(data.profiles) ? data.profiles.filter((p) => typeof p === 'string') : [],
    rights: data.rights.filter((d) => typeof d === 'string').sort(),
    fullLicense: data.full_license === true,
  }
}

// Lecture des droits du compte connecté ; jamais d'exception (null = comportement d'avant C1b)
export async function chargerDroits(supabase) {
  try {
    const { data, error } = await supabase.rpc('my_rights')
    if (error) return null
    return normaliserDroits(data)
  } catch {
    return null
  }
}

// Le compte a-t-il ce droit ? true ou false si les droits sont connus ; null s'ils ne le sont pas (repli sur le rôle)
export function aLeDroit(droits, code) {
  if (!droits || !Array.isArray(droits.rights)) return null
  return droits.rights.includes(code)
}

// Prix des interventions masqués : seulement si les droits sont connus et ne comprennent pas le droit des prix
export function prixMasques(droits) {
  return aLeDroit(droits, PRIX_INTERVENTIONS) === false
}
