import { createClient } from '@supabase/supabase-js'
import { createCompanyFetch, setTraceSender } from './company/companyContext'

// Configuration de l'instance : uniquement par variables d'environnement.
// Aucune valeur par défaut : une instance mal configurée doit échouer clairement.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Configuration manquante : VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définies pour cette instance.'
  )
}

// Toutes les requêtes passent par l'enveloppe de la société courante (socle multi-sociétés, C1a) :
// en-tête x-company-id quand une société a été choisie, trace des lectures du super administrateur.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: createCompanyFetch((...args) => fetch(...args)) },
})

setTraceSender((tables, page) => supabase.rpc('support_trace', { p_tables: tables, p_path: page }))

// Amorçage temporaire des administrateurs (lot 0).
// Remplacé par la table profiles (rôles en base) au lot 2.
// Format : VITE_BOOTSTRAP_ADMIN_EMAILS="a@exemple.fr,b@exemple.fr"
export const ADMIN_EMAILS = (import.meta.env.VITE_BOOTSTRAP_ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

export const isAdminEmail = (email) => ADMIN_EMAILS.includes(email?.toLowerCase())

// Rétrocompatibilité : isEmailAllowed vérifie uniquement les admins.
// Le rôle comptable est géré dynamiquement dans store.js (organization_settings.comptable_email).
export const isEmailAllowed = (email) => ADMIN_EMAILS.includes(email?.toLowerCase())
