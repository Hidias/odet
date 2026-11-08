import { supabase } from '../../../core/supabase'

// Mail « Après formation » : annonce du questionnaire à froid en ligne (0482), si la société l'a activé (sans réglage
// enregistré, la base le tient pour actif : app.froid_reglage)
export const PHRASE_FROID_EN_LIGNE = 'Quelques semaines après la formation, chaque participant recevra un court questionnaire en ligne sur ce qu\'il a pu mettre en pratique (évaluation à froid).'
export async function froidEnLigne(companyId) {
  if (!companyId) return false
  try {
    const { data, error } = await supabase.from('froid_reglages').select('actif').eq('company_id', companyId).maybeSingle()
    if (error) return false
    return data ? data.actif !== false : true
  } catch { return false }
}
