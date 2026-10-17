// Écran « Un problème est survenu » à la place d'une page blanche, avec signalement de l'erreur.
// RouteErrorBoundary repart à zéro à chaque changement de page.
import { Component } from 'react'
import { useLocation } from 'react-router-dom'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'
import { reportError } from './reporter'
import { CHUNK_ERROR, reloadOnceAfterUpdate } from './chunkReload'

export class PageErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Fichier introuvable après une mise à jour : même comportement qu'avant, rechargement automatique
    if (CHUNK_ERROR.test(error?.message || '')) { reloadOnceAfterUpdate(); return }
    reportError(error, { componentStack: info?.componentStack })
  }

  render() {
    if (!this.state.error) return this.props.children
    const isPublic = /^#\/(portail|entreprise|reclamation)/.test(window.location.hash || '')
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="card max-w-md w-full text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgb(var(--c-danger-bg))' }}>
            <AlertTriangle className="w-6 h-6" style={{ color: 'rgb(var(--c-danger))' }} />
          </div>
          <div>
            <h1 className="section-title">Un problème est survenu</h1>
            <p className="muted mt-2">L'équipe est prévenue. Rechargez la page pour réessayer.</p>
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}><RefreshCw className="w-4 h-4" /> Recharger la page</button>
            {!isPublic && <button type="button" className="btn btn-secondary" onClick={() => { window.location.hash = '#/'; window.location.reload() }}><Home className="w-4 h-4" /> Revenir à l'accueil</button>}
          </div>
        </div>
      </div>
    )
  }
}

export function RouteErrorBoundary({ children }) {
  const { pathname } = useLocation()
  return <PageErrorBoundary key={pathname}>{children}</PageErrorBoundary>
}
