import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { StickyNote, Loader2 } from 'lucide-react'
import { callApi } from '../api'
import { STATUTS } from './retours'

// Retours des utilisateurs dans la Console : résumé et accès au suivi (page « Retours des utilisateurs »,
// ouverte aussi aux administrateurs par le droit organisation.retours.suivre).

export default function RetoursConsole() {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    callApi('/api/retours?scope=tous', {}, { method: 'GET' })
      .then((res) => setItems(res.items || []))
      .catch((e) => { setError(e.message); setItems([]) })
  }, [])

  const counts = useMemo(() => {
    const c = {}
    ;(items || []).forEach((it) => { c[it.status] = (c[it.status] || 0) + 1 })
    return c
  }, [items])
  const ouverts = (counts.nouveau || 0) + (counts.vu || 0) + (counts.en_cours || 0)

  return (
    <section className="card space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h2 className="section-title flex items-center gap-2">
          <StickyNote className="w-5 h-5 text-accent-500" /> Retours des utilisateurs
          {counts.nouveau > 0 && <span className="badge badge-warning">{counts.nouveau} nouveau{counts.nouveau > 1 ? 'x' : ''}</span>}
        </h2>
        <Link to="/retours" className="btn btn-secondary btn-sm">Ouvrir le suivi</Link>
      </div>
      {items === null && <div className="flex items-center gap-2 muted"><Loader2 className="w-4 h-4 animate-spin" /> Chargement…</div>}
      {error && <p className="text-ui text-[rgb(var(--c-danger))]">Lecture impossible : {error}</p>}
      {items !== null && !error && (
        <div className="flex flex-wrap gap-2 text-ui-sm">
          <span className="badge badge-neutral">{ouverts} à traiter</span>
          {Object.entries(counts).filter(([s]) => ['fait', 'ecarte'].includes(s)).map(([s, n]) => (
            <span key={s} className="badge badge-neutral">{n} {STATUTS[s]?.[1].toLowerCase()}{n > 1 ? 's' : ''}</span>
          ))}
        </div>
      )}
    </section>
  )
}
