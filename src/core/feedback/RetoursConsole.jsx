import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { StickyNote, RefreshCw, Check, RotateCcw, X, Loader2 } from 'lucide-react'
import { callApi } from '../api'

// Retours des utilisateurs (post-it), dans la Console du super administrateur.

const FILTERS = [
  { id: 'nouveau', label: 'À traiter' },
  { id: 'fait', label: 'Faits' },
  { id: 'ecarte', label: 'Écartés' },
  { id: 'tous', label: 'Tous' },
]

export default function RetoursConsole() {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('nouveau')
  const [busy, setBusy] = useState(null)

  const load = async () => {
    setError(null)
    try {
      const res = await callApi('/api/retours', {}, { method: 'GET' })
      setItems(res.items || [])
    } catch (e) {
      setError(e.message)
      setItems([])
    }
  }

  useEffect(() => { load() }, [])

  const setStatus = async (id, status) => {
    setBusy(id)
    try {
      await callApi('/api/retours', { id, status }, { method: 'PATCH' })
      setItems((list) => list.map((it) => (it.id === id ? { ...it, status } : it)))
    } catch (e) {
      toast.error(e.message)
    }
    setBusy(null)
  }

  const counts = useMemo(() => {
    const c = { nouveau: 0, fait: 0, ecarte: 0, tous: 0 }
    ;(items || []).forEach((it) => { c[it.status] = (c[it.status] || 0) + 1; c.tous += 1 })
    return c
  }, [items])

  const shown = (items || []).filter((it) => filter === 'tous' || it.status === filter)

  return (
    <section className="card space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h2 className="section-title flex items-center gap-2">
          <StickyNote className="w-5 h-5 text-accent-500" /> Retours des utilisateurs
          {counts.nouveau > 0 && <span className="badge badge-warning">{counts.nouveau} à traiter</span>}
        </h2>
        <button type="button" onClick={load} className="btn btn-secondary btn-sm"><RefreshCw className="w-4 h-4" /> Actualiser</button>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrer les retours">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
            className={`btn btn-sm ${filter === f.id ? 'btn-primary' : 'btn-secondary'}`}>
            {f.label} ({counts[f.id] || 0})
          </button>
        ))}
      </div>

      {items === null && <div className="flex items-center gap-2 muted"><Loader2 className="w-4 h-4 animate-spin" /> Chargement…</div>}
      {error && <p className="text-ui text-[rgb(var(--c-danger))]">Lecture impossible : {error}. La migration 0260 est-elle appliquée ?</p>}
      {items !== null && !error && shown.length === 0 && <p className="muted text-ui">Aucun retour ici.</p>}

      <ul className="space-y-3">
        {shown.map((it) => (
          <li key={it.id} className="rounded-ui border border-gray-200 p-3 space-y-2">
            <div className="flex items-start justify-between gap-3 flex-wrap text-ui-sm">
              <div className="space-x-2">
                <span className="font-semibold text-gray-900">{it.author_label || 'Utilisateur'}</span>
                <span className="muted">{format(new Date(it.created_at), "d MMM yyyy 'à' HH:mm", { locale: fr })}</span>
                {it.viewport && <span className="muted">· écran {it.viewport}</span>}
              </div>
              {it.page_path && (
                <Link to={it.page_path} className="text-accent-600 hover:underline truncate max-w-full">
                  {it.page_title || it.page_path}
                </Link>
              )}
            </div>
            <p className="text-ui text-gray-900 whitespace-pre-wrap break-words">{it.message}</p>
            <div className="flex flex-wrap gap-2 justify-end">
              {it.status === 'nouveau' ? (
                <>
                  <button type="button" disabled={busy === it.id} onClick={() => setStatus(it.id, 'ecarte')} className="btn btn-ghost btn-sm"><X className="w-4 h-4" /> Écarter</button>
                  <button type="button" disabled={busy === it.id} onClick={() => setStatus(it.id, 'fait')} className="btn btn-secondary btn-sm"><Check className="w-4 h-4" /> Fait</button>
                </>
              ) : (
                <button type="button" disabled={busy === it.id} onClick={() => setStatus(it.id, 'nouveau')} className="btn btn-ghost btn-sm"><RotateCcw className="w-4 h-4" /> Remettre à traiter</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
