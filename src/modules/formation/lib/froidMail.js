import { supabase } from '../../../core/supabase'

// Mail « Après formation » : annonce du questionnaire à froid en ligne (0482), si la société l'a activé (sans réglage
// enregistré, la base le tient pour actif : app.froid_reglage) et si la session est de celles que la préparation retient
// (ni sous-traitance, ni client organisme de formation : app.froid_preparer_corps). Formulation prudente : le délai se
// règle par société et par formation, chaque envoi est validé à la main et l'envoi peut être fermé dans la Console.
export const PHRASE_FROID_EN_LIGNE = 'Plus tard, les participants pourront être invités à répondre à un court questionnaire en ligne sur ce qu\'ils ont pu mettre en pratique (évaluation à froid).'
export const sessionRetenuePourFroid = (session) => !!session
  && (session.session_type || 'intra') !== 'subcontract' && session.clients?.client_type !== 'organisme_formation'
export async function froidEnLigne(companyId, session = null) {
  if (!companyId) return false
  if (session && !sessionRetenuePourFroid(session)) return false
  try {
    const { data, error } = await supabase.from('froid_reglages').select('actif').eq('company_id', companyId).maybeSingle()
    if (error) return false
    return data ? data.actif !== false : true
  } catch { return false }
}
