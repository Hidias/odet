import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

// Fenêtre commune : panneau en bas d'écran sur téléphone, fenêtre centrée sur PC.
// Échap et le fond ferment ; le focus entre dans la fenêtre à l'ouverture.
export function Sheet({ title, onClose, children, footer = null, size = 'md' }) {
  const box = useRef(null)
  useEffect(() => {
    const prev = document.activeElement
    box.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [onClose])
  const width = size === 'lg' ? 'sm:max-w-3xl' : size === 'sm' ? 'sm:max-w-md' : 'sm:max-w-xl'
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className={`bg-white w-full ${width} flex flex-col max-h-[92vh] outline-none`}
        style={{ borderRadius: 'var(--radius-ui-lg) var(--radius-ui-lg) 0 0', boxShadow: 'var(--shadow-pop)' }}>
        <div className="flex items-center gap-3 border-b hairline" style={{ padding: 'var(--space-2) var(--space-3)' }}>
          <h2 className="section-title flex-1 min-w-0 truncate">{title}</h2>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fermer"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto flex-1 grid gap-3" style={{ padding: 'var(--space-3)' }}>{children}</div>
        {footer && (
          <div className="border-t hairline flex flex-wrap gap-2 justify-end" style={{ padding: 'var(--space-2) var(--space-3)', paddingBottom: 'max(var(--space-2), env(safe-area-inset-bottom))' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export default Sheet
