import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Identifiant de la construction : commit déployé par Vercel, sinon l'heure de construction.
// Il est inscrit dans l'application (__BUILD_ID__) et dans /version.json ; un onglet resté ouvert compare les deux
// pour proposer de recharger quand une nouvelle version est en ligne (src/core/version/NouvelleVersion.jsx).
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || `local-${Date.now().toString(36)}`

function fichierVersion() {
  return {
    name: 'fichier-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
    },
  }
}

export default defineConfig({
  plugins: [react(), fichierVersion()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  // Noms des fichiers : suffixe « -r2 » (incident du 19/10). Des réponses de secours (page HTML à la place d'un
  // fichier) ont été gardées en cache, chez Vercel et dans les navigateurs, sous des noms de fichiers existants :
  // un suffixe nouveau garantit qu'aucun nom déjà vu n'est redemandé. À changer de nouveau si cela se reproduisait.
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash]-r2.js',
        chunkFileNames: 'assets/[name]-[hash]-r2.js',
        assetFileNames: 'assets/[name]-[hash]-r2[extname]',
      },
    },
  },
  server: {
    port: 5173
  }
})
