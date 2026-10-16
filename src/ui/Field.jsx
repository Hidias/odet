import { forwardRef, useId } from 'react'

// Champ de formulaire commun : libellé, aide, erreur, et le contrôle (Input, Select, Textarea).
// Le libellé est relié au contrôle (accessibilité) ; l'erreur est annoncée par les lecteurs d'écran.

export function Field({ label, hint = null, error = null, required = false, className = '', children, htmlFor = null }) {
  const auto = useId()
  const id = htmlFor || auto
  const child = typeof children === 'function' ? children(id) : children
  return (
    <div className={`min-w-0 ${className}`}>
      {label && (
        <label className="label" htmlFor={id}>
          {label}{required && <span className="text-accent-600" aria-hidden="true"> *</span>}
        </label>
      )}
      {child}
      {error ? (
        <p className="mt-1 text-ui-sm" style={{ color: 'rgb(var(--c-danger))' }} role="alert">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-ui-sm text-gray-500">{hint}</p>
      ) : null}
    </div>
  )
}

export const Input = forwardRef(function Input({ className = '', invalid = false, ...rest }, ref) {
  return <input ref={ref} className={`input ${invalid ? 'border-[rgb(var(--c-danger))]' : ''} ${className}`} aria-invalid={invalid || undefined} {...rest} />
})

export const Select = forwardRef(function Select({ className = '', invalid = false, children, ...rest }, ref) {
  return <select ref={ref} className={`select ${invalid ? 'border-[rgb(var(--c-danger))]' : ''} ${className}`} aria-invalid={invalid || undefined} {...rest}>{children}</select>
})

export const Textarea = forwardRef(function Textarea({ className = '', invalid = false, rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={`textarea ${invalid ? 'border-[rgb(var(--c-danger))]' : ''} ${className}`} aria-invalid={invalid || undefined} {...rest} />
})

export default Field
