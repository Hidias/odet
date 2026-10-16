import { forwardRef } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

// Bouton commun. Variantes : primary (action principale, couleur de marque), secondary, ghost, danger.
// Tailles : sm, md (défaut), lg (cible tactile large). Toutes les dimensions viennent des jetons
// (--control-h, --radius-ui-sm) : les réglages Densité et Angles s'appliquent.

const VARIANTS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
}

export const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', icon: Icon = null, iconRight: IconRight = null, loading = false, block = false, to = null, className = '', children, disabled, type = 'button', ...rest },
  ref,
) {
  const cls = [
    'btn',
    VARIANTS[variant] || VARIANTS.secondary,
    size === 'sm' ? 'btn-sm' : '',
    size === 'lg' ? 'btn-lg' : '',
    !children ? 'btn-icon' : '',
    block ? 'w-full' : '',
    className,
  ].filter(Boolean).join(' ')
  const content = (
    <>
      {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : Icon ? <Icon className="w-4 h-4" aria-hidden="true" /> : null}
      {children}
      {IconRight && !loading ? <IconRight className="w-4 h-4" aria-hidden="true" /> : null}
    </>
  )
  if (to && !disabled) {
    return <Link ref={ref} to={to} className={cls} {...rest}>{content}</Link>
  }
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {content}
    </button>
  )
})

export default Button
