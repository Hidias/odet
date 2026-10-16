import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

// Onglets communs. Les premiers onglets restent visibles ; au-delà de `visible`, les autres passent
// dans un menu « Plus » (même contenu, aucun onglet supprimé). L'onglet actif caché reste signalé.
// tabs : [{ id, label, count? }]

export function Tabs({ tabs, value, onChange, visible = 6, className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const shown = tabs.slice(0, visible)
  const more = tabs.slice(visible)
  const activeInMore = more.find((t) => t.id === value)

  useEffect(() => {
    if (!open) return undefined
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const Tab = ({ t }) => (
    <button type="button" role="tab" aria-selected={t.id === value} onClick={() => onChange(t.id)}
      className={`tab ${t.id === value ? 'tab-active' : ''} inline-flex items-center gap-1.5`}>
      {t.label}
      {t.count != null && <span className="text-ui-sm text-gray-400 font-normal tabular-nums">{t.count}</span>}
    </button>
  )

  return (
    <div className={`tabs ${className}`} role="tablist" style={{ overflow: 'visible' }}>
      <div className="flex gap-1 overflow-x-auto min-w-0 tabs-scroll">
        {shown.map((t) => <Tab key={t.id} t={t} />)}
      </div>
      {more.length > 0 && (
        <div className="relative flex-none" ref={ref}>
          <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
            className={`tab ${activeInMore ? 'tab-active' : ''} inline-flex items-center gap-1`}>
            {activeInMore ? activeInMore.label : 'Plus'}<ChevronDown className="w-4 h-4" aria-hidden="true" />
          </button>
          {open && (
            <div role="menu" className="absolute right-0 top-full mt-1 z-40 bg-white border hairline min-w-[220px] py-1"
              style={{ borderRadius: 'var(--radius-ui)', boxShadow: 'var(--shadow-pop)' }}>
              {more.map((t) => (
                <button key={t.id} type="button" role="menuitem" onClick={() => { onChange(t.id); setOpen(false) }}
                  className={`w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between gap-3 ${t.id === value ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                  <span>{t.label}</span>{t.count != null && <span className="text-ui-sm text-gray-400 tabular-nums">{t.count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default Tabs
