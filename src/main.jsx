import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App'
import './core/branding/fonts'
import './app/index.css'
import { applyCachedUiPrefs } from './core/branding/useUiPrefs'

// Préférences d'affichage en cache : appliquées avant le premier rendu
applyCachedUiPrefs()

// Après une mise à jour, un onglet resté ouvert réclame des fichiers qui n'existent plus
// (page blanche). On recharge alors la page une fois, sans boucle (au plus une fois par minute).
const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i
function reloadOnceAfterUpdate() {
  try {
    const last = Number(sessionStorage.getItem('odet_chunk_reload') || 0)
    if (Date.now() - last < 60000) return
    sessionStorage.setItem('odet_chunk_reload', String(Date.now()))
  } catch { /* stockage indisponible : on recharge quand même */ }
  window.location.reload()
}
window.addEventListener('vite:preloadError', (e) => { e.preventDefault(); reloadOnceAfterUpdate() })
window.addEventListener('error', (e) => { if (CHUNK_ERROR.test(e?.message || e?.error?.message || '')) reloadOnceAfterUpdate() })
window.addEventListener('unhandledrejection', (e) => { if (CHUNK_ERROR.test(e?.reason?.message || '')) reloadOnceAfterUpdate() })

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
