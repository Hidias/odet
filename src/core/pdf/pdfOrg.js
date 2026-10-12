// Identité de l'organisme prête pour les PDF (logo et signature préchargés en base64),
// au format attendu par core/pdf/layout.js. Lue dans organization_settings, jamais écrite ici.

import { supabase } from '../supabase'
import { buildORG, prepareOrgForPDF } from '../org/orgUtils'

let cache = null

/** À partir d'une ligne organization_settings déjà chargée */
export async function pdfOrgFrom(row) {
  const r = (await prepareOrgForPDF(row || {})) || {}
  return { ...r, ...buildORG(r) }
}

/** Ligne organization_settings brute, logo et signature préchargés (pour les générateurs qui appellent buildORG eux-mêmes) */
export async function loadOrgRowForPDF() {
  const { data } = await supabase.from('organization_settings').select('*').limit(1).maybeSingle()
  return (await prepareOrgForPDF(data || {})) || data || {}
}

/** Charge organization_settings (une fois, force: true pour relire) */
export async function loadPdfOrg(force = false) {
  if (cache && !force) return cache
  const { data } = await supabase.from('organization_settings').select('*').limit(1).maybeSingle()
  cache = await pdfOrgFrom(data || {})
  return cache
}
