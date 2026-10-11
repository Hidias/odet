import { createClient } from '@supabase/supabase-js'

// Configuration de l'instance : uniquement par variables d'environnement.
// Aucune valeur par défaut : une instance mal configurée doit échouer clairement.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Configuration manquante : VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définies pour cette instance.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Amorçage temporaire des administrateurs (lot 0).
// Remplacé par la table profiles (rôles en base) au lot 2.
// Format : VITE_BOOTSTRAP_ADMIN_EMAILS="a@exemple.fr,b@exemple.fr"
export const ADMIN_EMAILS = (import.meta.env.VITE_BOOTSTRAP_ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

export const isAdminEmail = (email) => ADMIN_EMAILS.includes(email?.toLowerCase())

// Rétrocompatibilité : isEmailAllowed vérifie uniquement les admins.
// Le rôle comptable est géré dynamiquement dans store.js (org_settings).
export const isEmailAllowed = (email) => ADMIN_EMAILS.includes(email?.toLowerCase())
