import { useBranding } from '../core/branding/BrandingProvider'
import { Halos, Marque } from '../modules/portail/components/Vitrine'

// Coque des pages publiques (stagiaires, entreprises, formateurs, calendrier) : vitrine sombre animée aux couleurs
// de l'instance (halos), marque de l'organisme. bandeau : en-tête complet fourni par la page (accueil personnalisé
// « Bonjour » + prénom, voir BandeauAccueil) ; sinon en-tête simple avec le titre de la page.
export default function PublicLayout({ children, title, bandeau = null, accroche = null }) {
  const { branding } = useBranding()

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'rgb(var(--ground))' }}>
      {bandeau || (
        <header className="relative overflow-hidden bg-primary-900 text-white" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <Halos />
          <div className={`relative max-w-3xl mx-auto px-4 ${accroche ? 'pt-4 pb-7' : 'h-16 flex items-center'}`}>
            <Marque branding={branding} sombre libelle={accroche ? null : (title || null)} />
            {accroche && (
              <div className="mt-6">
                <h1 className="vitrine-monte font-display text-2xl sm:text-3xl font-semibold" style={{ '--delai': '80ms' }}>{title}</h1>
                <p className="vitrine-monte text-white/70 text-sm mt-1" style={{ '--delai': '140ms' }}>{accroche}</p>
              </div>
            )}
          </div>
        </header>
      )}

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
