import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App'
import './core/branding/fonts'
import './app/index.css'
import { applyCachedUiPrefs } from './core/branding/useUiPrefs'

// Préférences d'affichage en cache : appliquées avant le premier rendu
applyCachedUiPrefs()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
