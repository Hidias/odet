import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

// Bandeau commun : information, réussite, avertissement ou alerte, toujours avec une icône
// (la couleur seule ne porte jamais le sens). Fermable si onClose est fourni.
const TONES = {
  info: { icon: Info, c: '--c-info', bg: '--c-info-bg' },
  success: { icon: CheckCircle2, c: '--c-success', bg: '--c-success-bg' },
  warning: { icon: AlertTriangle, c: '--c-warning', bg: '--c-warning-bg' },
  danger: { icon: XCircle, c: '--c-danger', bg: '--c-danger-bg' },
}

export function Banner({ tone = 'info', title = null, children = null, action = null, onClose = null, className = '' }) {
  const t = TONES[tone] || TONES.info
  const Icon = t.icon
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`flex items-start gap-3 ${className}`}
      style={{ background: `rgb(var(${t.bg}))`, color: `rgb(var(${t.c}))`, borderRadius: 'var(--radius-ui)', padding: 'var(--space-2) var(--space-3)' }}>
      <Icon className="w-5 h-5 flex-none mt-0.5" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-gray-800">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ui-sm text-gray-700">{children}</div>}
      </div>
      {action && <div className="flex-none">{action}</div>}
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Fermer" className="flex-none p-1 -m-1 text-gray-500 hover:text-gray-800">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

export default Banner
