import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { LogOut, KeyRound, Sparkles, ImagePlus, X, Loader2, SmilePlus } from 'lucide-react'
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

// ─── Accueil personnalisé (décision de H, 21/10) : « Bonjour » + le prénom de la personne, ou « Bonjour » seul ;
// jamais le nom de l'entreprise. La personne met une photo ou un logo et son prénom (« Personnaliser mon espace »).

// Image choisie réduite dans le navigateur (carré de 256 px, JPEG) : légère, rien d'autre n'est envoyé
export function reduireImage(fichier, cote = 256) {
  return new Promise((resolve, reject) => {
    if (!fichier || !/^image\/(png|jpeg|webp|gif)$/.test(fichier.type)) { reject(new Error('Choisissez une image (JPEG, PNG ou WebP).')); return }
    if (fichier.size > 15 * 1024 * 1024) { reject(new Error('Image trop lourde (15 Mo au plus).')); return }
    const url = URL.createObjectURL(fichier)
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = cote; c.height = cote
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cote, cote)
      // Recadrage au centre, l'image remplit le carré
      const r = Math.max(cote / img.width, cote / img.height)
      const w = img.width * r, h = img.height * r
      ctx.drawImage(img, (cote - w) / 2, (cote - h) / 2, w, h)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible.')) }
    img.src = url
  })
}

export const salutation = (prenom) => (prenom && String(prenom).trim() ? `Bonjour ${String(prenom).trim()}` : 'Bonjour')

export function Avatar({ photo, prenom, taille = 'w-12 h-12', className = '' }) {
  const initiale = (prenom || '').trim().slice(0, 1).toUpperCase()
  return photo
    ? <img src={photo} alt="" className={`${taille} rounded-full object-cover ring-2 ring-white/70 shrink-0 ${className}`} />
    : (
      <span aria-hidden="true" className={`${taille} rounded-full bg-white/15 ring-2 ring-white/30 flex items-center justify-center font-display font-semibold text-white shrink-0 ${className}`}>
        {initiale || <SmilePlus className="w-5 h-5" />}
      </span>
    )
}

// Bandeau sombre animé des espaces : marque, bouton Quitter, avatar et salutation, puis le contenu passé (chiffres…)
export function BandeauAccueil({ branding, libelle, prenom, photo, sousTitre, onPersonnaliser, onQuitter, onSecurite = null, children }) {
  return (
    <section className="relative overflow-hidden bg-primary-900 text-white" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <Halos />
      <div className="relative max-w-3xl mx-auto px-4 pt-4 pb-7">
        <div className="flex items-center justify-between gap-3">
          <Marque branding={branding} sombre libelle={libelle} />
          <span className="flex items-center gap-2 shrink-0">
            {onSecurite && (
              <button type="button" onClick={onSecurite} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 px-3 py-1.5 text-sm">
                <KeyRound className="w-4 h-4" aria-hidden="true" /><span className="hidden sm:inline">Sécurité</span>
              </button>
            )}
            {onQuitter && (
              <button type="button" onClick={onQuitter} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 px-3 py-1.5 text-sm">
                <LogOut className="w-4 h-4" aria-hidden="true" />Quitter
              </button>
            )}
          </span>
        </div>
        <div className="mt-6 flex items-center gap-4">
          <Avatar photo={photo} prenom={prenom} taille="w-14 h-14 sm:w-16 sm:h-16" className="vitrine-monte" />
          <div className="min-w-0">
            <h1 className="vitrine-monte font-display text-2xl sm:text-3xl font-semibold truncate" style={{ '--delai': '80ms' }}>{salutation(prenom)}</h1>
            {sousTitre && <p className="vitrine-monte text-white/70 text-sm truncate" style={{ '--delai': '140ms' }}>{sousTitre}</p>}
          </div>
        </div>
        {onPersonnaliser && (
          <button type="button" onClick={onPersonnaliser} className="vitrine-monte mt-4 inline-flex items-center gap-1.5 text-sm text-white/80 hover:text-white underline-offset-4 hover:underline" style={{ '--delai': '200ms' }}>
            <Sparkles className="w-4 h-4" aria-hidden="true" />Personnaliser mon espace
          </button>
        )}
        {children}
      </div>
    </section>
  )
}

// Fenêtre « Personnaliser mon espace » : prénom affiché et photo ou logo. onEnregistrer({ prenom, photo }) peut échouer.
export function PersonnaliserEspace({ prenom: p0 = '', photo: f0 = null, onEnregistrer, onFermer, note }) {
  const [prenom, setPrenom] = useState(p0 || '')
  const [photo, setPhoto] = useState(f0 || null)
  const [erreur, setErreur] = useState('')
  const [occupe, setOccupe] = useState(false)
  const choisir = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setErreur('')
    try { setPhoto(await reduireImage(f)) } catch (err) { setErreur(err.message) }
  }
  const enregistrer = async () => {
    setOccupe(true); setErreur('')
    try { await onEnregistrer({ prenom: prenom.trim().slice(0, 60), photo }); onFermer() } catch (err) { setErreur(err?.message || 'Enregistrement impossible, réessayez.') } finally { setOccupe(false) }
  }
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onFermer() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onFermer])
  // Rendue au niveau de la page (22/10) : jamais coupée par une carte animée
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onFermer}>
      <div role="dialog" aria-modal="true" aria-labelledby="perso-titre" className="vitrine-monte w-full sm:max-w-md bg-white rounded-t-ui-lg sm:rounded-ui-lg p-5 space-y-4" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h2 id="perso-titre" className="font-display text-lg font-semibold text-gray-900">Personnaliser mon espace</h2>
          <button type="button" onClick={onFermer} aria-label="Fermer" className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex items-center gap-4">
          {photo
            ? <img src={photo} alt="Aperçu de la photo ou du logo" className="w-20 h-20 rounded-full object-cover border border-gray-200" />
            : <span className="w-20 h-20 rounded-full bg-gray-100 border border-dashed border-gray-300 flex items-center justify-center text-gray-400"><ImagePlus className="w-7 h-7" aria-hidden="true" /></span>}
          <div className="space-y-2">
            <label className="btn btn-secondary btn-sm cursor-pointer inline-flex items-center gap-1.5">
              <ImagePlus className="w-4 h-4" aria-hidden="true" />{photo ? 'Changer la photo ou le logo' : 'Ajouter une photo ou un logo'}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={choisir} />
            </label>
            {photo && <button type="button" onClick={() => setPhoto(null)} className="block text-sm text-gray-500 hover:text-gray-800">Retirer l'image</button>}
          </div>
        </div>
        <div>
          <label htmlFor="perso-prenom" className="block text-sm font-medium text-gray-700 mb-1">Votre prénom</label>
          <input id="perso-prenom" className="input w-full" value={prenom} maxLength={60} autoComplete="given-name" onChange={(e) => setPrenom(e.target.value)} placeholder="Pour un accueil à votre nom" />
          <p className="mt-1 text-xs text-gray-500">L'accueil affichera « {salutation(prenom)} ».</p>
        </div>
        {note && <p className="text-xs text-gray-500">{note}</p>}
        {erreur && <p role="alert" className="text-sm text-[rgb(var(--c-danger))]">{erreur}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn btn-secondary" onClick={onFermer}>Annuler</button>
          <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={occupe}>{occupe && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
