// ════════════════════════════════════════════════════════════════
// prospectClient.js — Fiche client à partir d'une ligne de prospection
// Même logique que le phoning (MarinePhoning.jsx) :
//   1. SIRET exact déjà client → on le réutilise
//   2. SIREN déjà client (autre établissement) → la page affiche
//      SirenConflictModal pour décider
//   3. sinon → création
// ════════════════════════════════════════════════════════════════

import { supabase } from '../../../core/supabase'

export function cleanIds(prospect) {
  const cleanSiren = prospect?.siren && !String(prospect.siren).startsWith('MANUAL_') ? String(prospect.siren).slice(0, 9) : null
  const cleanSiret = prospect?.siret && !String(prospect.siret).startsWith('MANUAL_') ? String(prospect.siret).slice(0, 14) : null
  return { cleanSiren, cleanSiret }
}

export async function createClientFromProspect(prospect, cleanSiren, cleanSiret) {
  const { data: newClient, error } = await supabase.from('clients').insert({
    name: prospect.name,
    address: prospect.city ? prospect.postal_code + ' ' + prospect.city : null,
    postal_code: prospect.postal_code,
    city: prospect.city,
    siret: cleanSiret,
    siren: cleanSiren,
    contact_phone: prospect.phone,
    email: prospect.email || null,
    website: prospect.site_web || null,
    taille_entreprise: prospect.effectif || null,
    status: 'prospect',
    type: 'prospect',
  }).select('id').single()
  if (error) throw error
  return newClient.id
}

export async function findClientBySiret(cleanSiret) {
  if (!cleanSiret) return null
  const { data } = await supabase.from('clients').select('id').eq('siret', cleanSiret).maybeSingle()
  return data?.id || null
}
