import { Loader2 } from 'lucide-react'

// État vide commun : une phrase qui dit ce qui apparaîtra ici, et l'action pour commencer.
export function EmptyState({ icon: Icon = null, title, children = null, action = null, compact = false }) {
  return (
    <div className={`text-center grid justify-items-center gap-2 ${compact ? 'py-6' : 'py-12'} px-4`}>
      {Icon && <Icon className="w-6 h-6 text-gray-400" aria-hidden="true" />}
      <p className="font-medium text-gray-800">{title}</p>
      {children && <p className="text-ui-sm text-gray-500 max-w-md">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

// Chargement commun : visible, centré, annoncé aux lecteurs d'écran.
export function Spinner({ label = 'Chargement', inline = false }) {
  if (inline) return <Loader2 className="w-4 h-4 animate-spin text-gray-400" aria-label={label} />
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-gray-500 text-ui-sm" role="status">
      <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />{label}
    </div>
  )
}

export default EmptyState
