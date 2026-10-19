import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App'
import './core/branding/fonts'
import './app/index.css'
import { applyCachedUiPrefs } from './core/branding/useUiPrefs'
import { CHUNK_ERROR, reloadOnceAfterUpdate } from './core/errors/chunkReload'
import { installGlobalErrorHandlers } from './core/errors/reporter'

// Préférences d'affichage en cache : appliquées avant le premier rendu
applyCachedUiPrefs()

// Après une mise à jour, un onglet resté ouvert réclame des fichiers qui n'existent plus
// (page blanche). On recharge alors la page une fois, sans boucle (au plus une fois par minute).
// La règle est dans core/errors/chunkReload.js, partagée avec l'écran d'erreur.
// L'événement vite:preloadError n'est plus intercepté (audit du 19/10 au soir) : l'annuler faisait résoudre l'import à
// « undefined » et React.lazy plantait (« reading 'default' »). L'erreur suit maintenant son cours jusqu'à importSur
// (core/errors/chunkReload.js), qui recharge la page une fois ou affiche une erreur claire.
window.addEventListener('error', (e) => { if (CHUNK_ERROR.test(e?.message || e?.error?.message || '')) reloadOnceAfterUpdate() })
window.addEventListener('unhandledrejection', (e) => { if (CHUNK_ERROR.test(e?.reason?.message || '')) reloadOnceAfterUpdate() })

// Suivi des erreurs : erreurs non gérées et promesses rejetées remontées à la Console (Erreurs)
installGlobalErrorHandlers()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
