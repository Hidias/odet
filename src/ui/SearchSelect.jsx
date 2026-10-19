// Liste déroulante avec recherche, utilisée partout où une liste longue (clients, formations, sessions...)
// remplace un <select>. Même usage qu'un select : value + onChange(valeur).
//
// options : [{ value, label, hint?, group?, keywords? }]
//   hint     : petite ligne grise sous le libellé (ville, SIRET, date...)
//   group    : titre de section (les options d'un même groupe se suivent)
//   keywords : texte cherché en plus du libellé et du hint (SIRET, contact...)
//   testTbl  : table de la valeur (« clients »...) : pastille « Test » si c'est une fiche de démonstration (0052)
// emptyLabel : libellé de l'option vide (« - Sélectionner - ») ; si présent, la valeur peut être effacée.
//
// Le panneau s'ouvre au clic (jamais au survol) et reste ouvert tant qu'on ne choisit pas,
// qu'on ne clique pas ailleurs ou qu'on n'appuie pas sur Échap. Il est placé au-dessus de la page
// (portail) : une fenêtre ou un tableau ne peut pas le couper.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useId } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, X } from 'lucide-react'
import { useMarquesDemo } from '../core/demo/marquesDemo'

const MAX_RESULTS = 100

export const normalize = (v) => String(v ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().trim()

export function matchesTerm(option, term) {
  if (!term) return true
  const hay = normalize([option.label, option.hint, option.keywords, option.group].filter(Boolean).join(' '))
  return term.split(/\s+/).every(word => hay.includes(word))
}

// Position du panneau sous (ou au-dessus de) l'élément déclencheur, dans la fenêtre
export function usePanelPosition(open, triggerRef, minWidth = 280) {
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const el = triggerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const width = Math.min(Math.max(r.width, minWidth), vw - 16)
      const left = Math.min(Math.max(8, r.left), vw - width - 8)
      const below = vh - r.bottom - 8
      const above = r.top - 8
      const up = below < 260 && above > below
      const maxHeight = Math.max(160, Math.min(400, (up ? above : below) - 4))
      setPos(up
        ? { left, width, bottom: vh - r.top + 4, maxHeight }
        : { left, width, top: r.bottom + 4, maxHeight })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, triggerRef, minWidth])
  return pos
}

// Ferme le panneau sur un clic en dehors du déclencheur et du panneau
export function useOutsideClose(open, refs, onClose) {
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (refs.some(r => r.current && r.current.contains(e.target))) return
      onClose()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler, { passive: true })
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [open, refs, onClose])
}

export default function SearchSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Sélectionner',
  emptyLabel,
  searchPlaceholder = 'Rechercher...',
  disabled = false,
  required = false,
  className = '',
  id,
  name,
  'aria-label': ariaLabel,
  noResultsText = 'Aucun résultat',
}) {
  const { estTest } = useMarquesDemo()
  const estTestOption = (o) => !!(o?.testTbl && estTest(o.testTbl, o.value))
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [active, setActive] = useState(0)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const autoId = useId()
  const listId = (id || autoId) + '-liste'

  const selected = useMemo(
    () => options.find(o => String(o.value) === String(value ?? '')),
    [options, value]
  )

  const results = useMemo(() => {
    const t = normalize(term)
    return options.filter(o => matchesTerm(o, t))
  }, [options, term])
  const shown = results.slice(0, MAX_RESULTS)

  const pos = usePanelPosition(open, triggerRef)
  const close = () => { setOpen(false); setTerm('') }
  useOutsideClose(open, [triggerRef, panelRef], close)

  useEffect(() => {
    if (!open) return
    const i = shown.findIndex(o => String(o.value) === String(value ?? ''))
    setActive(i >= 0 ? i : 0)
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => { setActive(0) }, [term])

  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector(`[data-idx="${active}"]`)
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const pick = (opt) => {
    onChange?.(opt ? opt.value : '')
    close()
    triggerRef.current?.focus()
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, shown.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) pick(shown[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); close(); triggerRef.current?.focus() }
    else if (e.key === 'Tab') { close() }
  }

  const onTriggerKey = (e) => {
    if (disabled) return
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { setTerm(e.key); setOpen(true) }
  }

  let lastGroup = null

  return (
    <div className={'relative ' + className}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => !disabled && (open ? close() : setOpen(true))}
        onKeyDown={onTriggerKey}
        className={'w-full min-h-[38px] flex items-center gap-2 px-3 py-2 text-left text-sm bg-white border rounded-lg transition-colors '
          + (open ? 'border-primary-500 ring-2 ring-primary-100 ' : 'border-gray-300 hover:border-gray-400 ')
          + (disabled ? 'opacity-60 cursor-not-allowed bg-gray-50 ' : 'cursor-pointer ')}
      >
        <span className={'flex-1 min-w-0 truncate ' + (selected ? 'text-gray-900' : 'text-gray-400')}>
          {selected ? selected.label : (emptyLabel || placeholder)}
          {selected && estTestOption(selected) && <span className="badge-test ml-2">Test</span>}
        </span>
        {selected && emptyLabel !== undefined && !disabled && !required && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Effacer"
            onClick={(e) => { e.stopPropagation(); onChange?.('') }}
            className="p-0.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
          >
            <X size={14} />
          </span>
        )}
        <ChevronDown size={16} className={'flex-shrink-0 text-gray-400 transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>
      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          name={name}
          required
          value={value ?? ''}
          onChange={() => {}}
          className="absolute bottom-0 left-4 w-px h-px opacity-0 pointer-events-none"
        />
      )}
      {open && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, zIndex: 9999 }}
          className="bg-white border border-gray-200 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        >
          <div className="flex items-center gap-2 px-3 border-b border-gray-100">
            <Search size={16} className="text-gray-400 flex-shrink-0" />
            <input
              ref={inputRef}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              aria-controls={listId}
              aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
              className="flex-1 min-w-0 py-2.5 text-sm outline-none bg-transparent"
            />
            <span className="text-xs text-gray-400 whitespace-nowrap">{results.length}</span>
          </div>
          <ul ref={listRef} id={listId} role="listbox" style={{ maxHeight: pos.maxHeight - 48 }} className="overflow-y-auto py-1">
            {emptyLabel !== undefined && !normalize(term) && (
              <li>
                <button type="button" onClick={() => pick(null)} className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:bg-gray-50">
                  {emptyLabel}
                </button>
              </li>
            )}
            {shown.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-gray-400">{noResultsText}</li>
            )}
            {shown.map((o, i) => {
              const header = o.group && o.group !== lastGroup ? o.group : null
              lastGroup = o.group || lastGroup
              const isSel = String(o.value) === String(value ?? '')
              return (
                <li key={String(o.value) + '-' + i}>
                  {header && (
                    <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{header}</div>
                  )}
                  <button
                    type="button"
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={isSel}
                    data-idx={i}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(o)}
                    className={'w-full text-left px-3 py-2 text-sm flex flex-col gap-0.5 '
                      + (i === active ? 'bg-primary-50 ' : '')
                      + (isSel ? 'font-semibold text-primary-700 ' : 'text-gray-900 ')}
                  >
                    <span className="truncate">{o.label}{estTestOption(o) && <span className="badge-test ml-2">Test</span>}</span>
                    {o.hint && <span className="text-xs font-normal text-gray-500 truncate">{o.hint}</span>}
                  </button>
                </li>
              )
            })}
            {results.length > MAX_RESULTS && (
              <li className="px-3 py-2 text-xs text-gray-400 text-center">{results.length - MAX_RESULTS} autres résultats : affinez la recherche</li>
            )}
          </ul>
        </div>,
        document.body
      )}
    </div>
  )
}

// Options prêtes à l'emploi pour les listes les plus courantes
export const clientOptions = (clients = [], { excludeArchived = true } = {}) =>
  clients
    .filter(c => !excludeArchived || c.status !== 'archive')
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'))
    .map(c => ({
      value: c.id,
      label: c.name || 'Sans nom',
      testTbl: 'clients',
      hint: [c.postal_code && c.city ? `${c.postal_code.slice(0, 2)} ${c.city}` : c.city, c.siret].filter(Boolean).join(' · '),
      keywords: [c.siren, c.contact_name, c.group_name].filter(Boolean).join(' '),
    }))

export const courseOptions = (courses = []) =>
  courses
    .slice()
    .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'fr'))
    .map(c => ({ value: c.id, label: c.title || c.code || 'Sans titre', hint: [c.code, c.duration_hours ? `${Number(c.duration_hours)} h` : null].filter(Boolean).join(' · ') }))
