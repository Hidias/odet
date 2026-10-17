// Carte commune : surface blanche à filet fin, sans ombre (direction Ardoise).
// CardHeader porte un titre et des actions ; CardBody garde l'espacement des jetons.

export function Card({ as: Tag = 'section', className = '', children, ...rest }) {
  return <Tag className={`surface min-w-0 overflow-hidden ${className}`} {...rest}>{children}</Tag>
}

export function CardHeader({ title, subtitle = null, actions = null, className = '' }) {
  return (
    <div className={`flex items-center gap-3 border-b hairline ${className}`} style={{ padding: 'var(--space-2) var(--space-4)' }}>
      <div className="min-w-0 flex-1">
        <h2 className="section-title truncate">{title}</h2>
        {subtitle && <p className="text-ui-sm text-gray-500 truncate">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-none">{actions}</div>}
    </div>
  )
}

export function CardBody({ className = '', flush = false, children }) {
  return <div className={className} style={flush ? undefined : { padding: 'var(--space-4)' }}>{children}</div>
}

export default Card
