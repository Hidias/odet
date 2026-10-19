import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

// En-tête de page commun : fil d'Ariane, surtitre, titre, informations, statut et actions.
// Une seule action principale ; les autres en secondaire ou dans un menu.

export function PageHeader({ crumbs = null, eyebrow = null, title, meta = null, status = null, actions = null, className = '' }) {
  return (
    <header className={`grid grid-cols-[minmax(0,1fr)] gap-2 ${className}`}>
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Fil d'Ariane" className="flex items-center gap-1 text-ui-sm text-gray-500 min-w-0">
          {crumbs.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1 min-w-0">
              {i > 0 && <ChevronRight className="w-3.5 h-3.5 flex-none" aria-hidden="true" />}
              {c.to ? <Link to={c.to} className="hover:text-gray-800 truncate">{c.label}</Link> : <span className="truncate">{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-[16rem] grid gap-1">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1 className="page-title leading-tight" style={{ textWrap: 'balance' }}>{title}</h1>
          {meta && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ui-sm text-gray-500">{meta}</div>}
        </div>
        {(status || actions) && (
          <div className="flex flex-wrap items-center gap-2">
            {status}
            {actions}
          </div>
        )}
      </div>
    </header>
  )
}

export default PageHeader
