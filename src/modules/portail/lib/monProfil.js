import { supabase } from '../../../core/supabase'
import { useAuthStore } from '../../../core/store'

// Prénom et photo du compte connecté (espaces entreprise, formateur, stagiaire) : lus dans le profil, changés par la
// personne elle-même (fonctions mon_profil_prenom et mon_profil_photo, 0426), puis mis à jour à l'écran sans recharger.
export function useMonProfil(prenomDeSecours = '') {
  const profile = useAuthStore((s) => s.profile)
  const prenom = profile?.first_name || prenomDeSecours || ''
  const photo = profile?.photo || null
  const enregistrer = async ({ prenom: p, photo: f }) => {
    if ((p || '') !== (profile?.first_name || '')) {
      const { error } = await supabase.rpc('mon_profil_prenom', { p_prenom: p || null })
      if (error) throw new Error('Prénom non enregistré, réessayez.')
    }
    if ((f || null) !== (profile?.photo || null)) {
      const { error } = await supabase.rpc('mon_profil_photo', { p_photo: f || null })
      if (error) throw new Error('Image non enregistrée : choisissez une image plus légère.')
    }
    useAuthStore.setState((s) => ({ profile: { ...(s.profile || {}), first_name: p || null, photo: f || null } }))
  }
  return { prenom, photo, enregistrer, connecte: !!profile?.id }
}
