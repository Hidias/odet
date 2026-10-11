import { useBranding, brandLogo } from '../core/branding/BrandingProvider'

// Coque des pages publiques (stagiaires, entreprises) : logo et nom de l'organisme,
// style grand public, aux couleurs de l'instance.
export default function PublicLayout({ children, title }) {
  const { branding } = useBranding()
  const logo = brandLogo(branding, false)

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'rgb(var(--ground))' }}>
      <header className="bg-white border-b border-gray-200" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center gap-3">
          {logo ? (
            <img src={logo} alt={branding.org_name || ''} className="h-9 w-auto max-w-[140px] object-contain" />
          ) : (
            <div className="w-9 h-9 rounded-ui-sm bg-accent-500 text-accent-fg flex items-center justify-center font-display font-bold">
              {(branding.org_name || 'O').slice(0, 1)}
            </div>
          )}
          <div className="min-w-0 leading-tight">
            <div className="font-display font-semibold text-gray-900 truncate">{title || branding.org_name}</div>
            {title && branding.org_name && <div className="text-ui-sm text-gray-500 truncate">{branding.org_name}</div>}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 w-full flex-1">
        {children}
      </main>

      <footer className="border-t border-gray-200 bg-white" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="max-w-3xl mx-auto px-4 py-4 text-center text-ui-sm text-gray-500">
          {branding.org_name}{branding.qualiopi_certified ? ', organisme certifié Qualiopi' : ''}
        </div>
      </footer>
    </div>
  )
}
