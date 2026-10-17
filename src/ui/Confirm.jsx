import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { Sheet } from './Sheet'

// Confirmation dans l'écran, pour remplacer window.confirm (bloqué dans certains navigateurs,
// impossible à styler). Deux formes :
//  - <ConfirmInline> : la question s'affiche à la place du bouton, sans fenêtre ;
//  - useConfirm() : const ok = await confirm({ title, message, confirmLabel, danger }) ; nécessite <ConfirmProvider>.

export function ConfirmInline({ label, question = 'Confirmer ?', confirmLabel = 'Confirmer', danger = false, onConfirm, className = '', buttonClassName = 'btn btn-secondary' }) {
  const [asking, setAsking] = useState(false)
  if (!asking) return <button type="button" className={`${buttonClassName} ${className}`} onClick={() => setAsking(true)}>{label}</button>
  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`} role="group" aria-label={question}>
      <span className="text-ui-sm text-gray-700">{question}</span>
      <button type="button" className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => { setAsking(false); onConfirm?.() }}>{confirmLabel}</button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAsking(false)}>Annuler</button>
    </span>
  )
}

const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null)
  const resolver = useRef(null)
  const confirm = useCallback((opts) => new Promise((resolve) => { resolver.current = resolve; setReq(opts || {}) }), [])
  const close = (value) => { resolver.current?.(value); resolver.current = null; setReq(null) }
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {req && (
        <Sheet title={req.title || 'Confirmer'} size="sm" onClose={() => close(false)}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => close(false)}>{req.cancelLabel || 'Annuler'}</button>
            <button type="button" className={`btn ${req.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>{req.confirmLabel || 'Confirmer'}</button>
          </>}>
          {req.message && <p className="text-gray-700">{req.message}</p>}
        </Sheet>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  // Repli sûr si le fournisseur manque : ne confirme jamais une action à la place de l'utilisateur
  return ctx || (async () => false)
}
