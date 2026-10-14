// Bouton qui ouvre une liste à choisir (avec recherche), par exemple « Ajouter depuis le catalogue ».
// S'ouvre au clic, jamais au survol : la liste ne disparaît pas quand la souris s'en écarte.
// Se ferme après un choix, sur un clic ailleurs ou avec Échap.
//
// items : [{ key, label, hint?, group?, keywords? }] ; onPick(item) est appelé au choix.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search } from 'lucide-react'
import { normalize, matchesTerm, usePanelPosition, useOutsideClose } from './SearchSelect'

export default function PickerMenu({
  children,
  items = [],
  onPick,
  className = '',
  buttonClassName = '',
  searchPlaceholder = 'Rechercher...',
  emptyText = 'Aucun élément',
  disabled = false,
  minWidth = 320,
  keepOpen = false,
  searchable = true,
}) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [active, setActive] = useState(0)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const inputRef = useRef(null)

  const results = useMemo(() => {
    const t = normalize(term)
    return items.filter(it => matchesTerm(it, t))
  }, [items, term])

  const pos = usePanelPosition(open, triggerRef, minWidth)
  const close = () => { setOpen(false); setTerm('') }
  useOutsideClose(open, [triggerRef, panelRef], close)

  useEffect(() => {
    if (!open) return
    setActive(0)
    const t = setTimeout(() => (searchable ? inputRef.current : panelRef.current?.querySelector('button'))?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])
  useEffect(() => { setActive(0) }, [term])

  const choose = (it) => {
    onPick?.(it)
    if (!keepOpen) close()
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) choose(results[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); close(); triggerRef.current?.focus() }
  }

  let lastGroup = null

  return (
    <div className={'relative inline-block ' + className}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className={buttonClassName}
      >
        {children}
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, zIndex: 9999 }}
          className="bg-white border border-gray-200 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        >
          {searchable && <div className="flex items-center gap-2 px-3 border-b border-gray-100">
            <Search size={16} className="text-gray-400 flex-shrink-0" />
            <input
              ref={inputRef}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="flex-1 min-w-0 py-2.5 text-sm outline-none bg-transparent"
            />
          </div>}
          <ul role="listbox" onKeyDown={searchable ? undefined : onKeyDown} style={{ maxHeight: pos.maxHeight - (searchable ? 48 : 0) }} className="overflow-y-auto py-1">
            {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-gray-400">{emptyText}</li>}
            {results.map((it, i) => {
              const header = it.group && it.group !== lastGroup ? it.group : null
              lastGroup = it.group || lastGroup
              return (
                <li key={it.key ?? i}>
                  {header && <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{header}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(it)}
                    className={'w-full text-left px-3 py-2 text-sm flex flex-col gap-0.5 ' + (i === active ? 'bg-primary-50' : '')}
                  >
                    <span className="text-gray-900">{it.label}</span>
                    {it.hint && <span className="text-xs text-gray-500">{it.hint}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>,
        document.body
      )}
    </div>
  )
}
