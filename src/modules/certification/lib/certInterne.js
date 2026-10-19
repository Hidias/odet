// Face interne des certifications (chantier F, 0350) : « erreurs à éviter », conseil réservé à la direction.
// Lecture et écriture protégées en base (droit « Voir le cockpit de direction »). Ce fichier ne doit jamais être
// importé par un export, un PDF, un portail ou un document d'audit (test tests/certification-face-interne.test.js).

import { supabase } from '../../../core/supabase'

export const DOMAINES = [
  { v: 'apsad', label: 'APSAD et NF Service' },
  { v: 'qualiopi', label: 'Qualiopi' },
  { v: 'nda', label: 'Déclaration d\'activité' },
  { v: 'autre', label: 'Autres' },
]

export const STATUTS_POINT = [
  { v: 'a_confirmer', label: 'À confirmer', badge: 'badge-warning' },
  { v: 'confirme', label: 'Confirmé', badge: 'badge-success' },
  { v: 'ecarte', label: 'Écarté', badge: 'badge-neutral' },
]

export const SOURCES_POINT = { officiel: 'Texte officiel', secondaire: 'Source secondaire', societe: 'Expérience de la société' }

export async function chargerPoints() {
  const { data, error } = await supabase.from('cert_pitfalls').select('*').order('domaine').order('position')
  if (error) throw error
  return data || []
}

export async function enregistrerPoint(id, patch) {
  if (id) {
    const { error } = await supabase.from('cert_pitfalls').update(patch).eq('id', id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('cert_pitfalls').insert(patch)
    if (error) throw error
  }
}

/** Regroupe les points par domaine et compte ceux qui restent à confirmer */
export function parDomaine(points) {
  return DOMAINES.map((d) => {
    const liste = points.filter((p) => p.domaine === d.v)
    return { ...d, liste, aConfirmer: liste.filter((p) => p.statut === 'a_confirmer').length }
  }).filter((d) => d.liste.length > 0)
}
