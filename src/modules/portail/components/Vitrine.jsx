import { brandLogo } from '../../../core/branding/BrandingProvider'

// Vitrine commune des pages vues de l'extérieur (espace entreprise, portail stagiaire, espaces externes, calendrier) :
// halos animés aux couleurs de l'organisme, marque, saisie du code en six cases. Styles dans src/app/index.css
// (« Vitrine des portails publics »), animations coupées si l'appareil demande moins de mouvement.

export function Halos() {
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      <div className="vitrine-halo w-72 h-72 -top-16 -left-10 bg-accent-500" />
      <div className="vitrine-halo w-80 h-80 top-1/3 -right-24 bg-highlight-500" style={{ animationDelay: '-5s' }} />
      <div className="vitrine-halo w-64 h-64 -bottom-20 left-1/3 bg-primary-400" style={{ animationDelay: '-9s' }} />
      <div className="absolute inset-0 vitrine-grain" />
    </div>
  )
}

export function Marque({ branding, sombre = false, libelle = 'Espace entreprise' }) {
  const logo = brandLogo(branding, sombre)
  return (
    <div className="flex items-center gap-3 min-w-0">
      {logo ? (
        <span className={`inline-flex items-center justify-center rounded-ui ${sombre ? 'bg-white/95 p-1.5' : ''}`}>
          <img src={logo} alt={branding.org_name || ''} className="h-9 w-auto max-w-[140px] object-contain" />
        </span>
      ) : (
        <div className="w-10 h-10 rounded-ui bg-accent-500 text-accent-fg flex items-center justify-center font-display font-bold">{(branding.org_name || 'O').slice(0, 1)}</div>
      )}
      <div className="min-w-0 leading-tight">
        <div className={`font-display font-semibold truncate ${sombre ? 'text-white' : 'text-gray-900'}`}>{branding.org_name}</div>
        {libelle && <div className={`text-xs truncate ${sombre ? 'text-white/60' : 'text-gray-500'}`}>{libelle}</div>}
      </div>
    </div>
  )
}

// Code à 6 chiffres en six cases (un seul champ invisible par-dessus : clavier numérique, collage, code reçu par SMS)
export function CodeCases({ id, code, onChange, onComplet, erreur = false, secoue = 0, label = 'Code à 6 chiffres' }) {
  const chiffres = Array.from({ length: 6 }, (_, k) => code[k] || '')
  return (
    <>
      <label htmlFor={id} className="sr-only">{label}</label>
      <div key={secoue} className={`relative ${secoue ? 'vitrine-secoue' : ''}`}>
        <div className="grid grid-cols-6 gap-2" aria-hidden="true">
          {chiffres.map((c, k) => {
            const actif = k === Math.min(code.length, 5)
            return (
              <div key={k} className={`h-14 rounded-ui border-2 flex items-center justify-center font-mono text-2xl font-semibold transition-colors ${erreur ? 'border-[rgb(var(--c-danger))]/60' : c ? 'border-primary-500 text-gray-900 bg-white' : actif ? 'border-accent-500 bg-white' : 'border-gray-200 bg-white'}`}>
                {c || (actif ? <span className="vitrine-curseur w-0.5 h-6 bg-accent-500" /> : '')}
              </div>
            )
          })}
        </div>
        <input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
          className="absolute inset-0 w-full h-full opacity-0 cursor-text"
          value={code} autoFocus
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 6)
            onChange(v)
            if (v.length === 6) onComplet?.(v)
          }} />
      </div>
    </>
  )
}

// Écran d'accueil en deux parties : à gauche la vitrine de l'organisme, à droite le contenu (saisie du code…)
export function EcranVitrine({ branding, libelle, pastille, pastilleIcone: PI, titre, accroche, atouts = [], pied, children }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]" style={{ background: 'rgb(var(--ground))' }}>
      <section className="relative overflow-hidden bg-primary-900 text-white px-6 py-10 sm:px-10 lg:px-14 flex flex-col" style={{ paddingTop: 'max(2.5rem, env(safe-area-inset-top))' }}>
        <Halos />
        <div className="relative"><Marque branding={branding} sombre libelle={libelle} /></div>
        <div className="relative mt-6 sm:mt-10 lg:mt-auto max-w-lg">
          {pastille && (
            <p className="vitrine-monte inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/15 px-3 py-1 text-xs tracking-wide" style={{ '--delai': '80ms' }}>
              {PI && <PI className="w-3.5 h-3.5" aria-hidden="true" />} {pastille}
            </p>
          )}
          <h1 className="vitrine-monte mt-4 font-display text-2xl sm:text-4xl font-semibold leading-tight" style={{ '--delai': '160ms' }}>{titre}</h1>
          {accroche && <p className="vitrine-monte mt-3 text-white/75" style={{ '--delai': '240ms' }}>{accroche}</p>}
          {atouts.length > 0 && (
            <ul className="mt-6 space-y-3 text-sm hidden sm:block">
              {atouts.map((x, k) => (
                <li key={k} className="vitrine-monte flex items-start gap-3" style={{ '--delai': `${320 + k * 90}ms` }}>
                  <span className="shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center"><x.i className="w-4 h-4" aria-hidden="true" /></span>
                  <span className="pt-1.5 text-white/85">{x.t}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {pied && <p className="relative mt-10 lg:mt-auto pt-8 text-xs text-white/50 hidden sm:block">{pied}</p>}
      </section>
      <section className="flex items-center justify-center px-6 py-10 sm:px-10" style={{ paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}>
        <div className="w-full max-w-sm vitrine-monte" style={{ '--delai': '200ms' }}>{children}</div>
      </section>
    </div>
  )
}
