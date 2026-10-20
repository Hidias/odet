import { supabase } from '../supabase'

// Signatures enregistrées une fois par compte (0387) : posées sur les titres, certificats et attestations qu'il signe.
const nom = (p) => p?.display_name || [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.email || ''

export async function chargerSignatures(companyId) {
  let q = supabase.from('user_signatures').select('company_id, profile_id, image, signer_title, updated_at, profiles(first_name, last_name, display_name, email)')
  if (companyId) q = q.eq('company_id', companyId)
  const { data, error } = await q
  if (error) throw error
  return (data || []).map((s) => ({ ...s, nom: nom(s.profiles) }))
}

export async function enregistrerMaSignature({ companyId, profileId, image, signerTitle }) {
  const { error } = await supabase.from('user_signatures').upsert({
    company_id: companyId, profile_id: profileId, image, signer_title: signerTitle?.trim() || null, updated_at: new Date().toISOString(),
  }, { onConflict: 'company_id,profile_id' })
  if (error) throw error
}

export async function retirerMaSignature({ companyId, profileId }) {
  const { error } = await supabase.from('user_signatures').delete().eq('company_id', companyId).eq('profile_id', profileId)
  if (error) throw error
}
