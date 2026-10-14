// Configuration des tests automatiques (Vitest).
// Lancés à chaque push par .github/workflows/verification.yml.
import { defineConfig } from 'vitest/config'

// Les calculs de dates de l'application se font à l'heure de Paris
process.env.TZ = 'Europe/Paris'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // Valeurs factices : certains modules créent un client Supabase au chargement.
    // Aucun test n'appelle le réseau.
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'cle-de-test',
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'cle-de-test',
    },
  },
})
