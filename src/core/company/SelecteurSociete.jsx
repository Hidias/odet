import { useState } from 'react'
import { Building2, ChevronDown, Check, Layers } from 'lucide-react'
import { useAuthStore } from '../store'
import { choisirSociete, multiSocietes, nomSociete, societeChoisie, VUE_GROUPE } from './societes'

// Sociétés (chantier C3) : sélecteur dans l'en-tête, écran de choix à l'ouverture, bandeau de la vue groupe.
// Rien ne s'affiche tant que le compte n'a qu'une société.

function Logo({ s, taille = 28 }) {
  if (s?.logo_url) return <img src={s.logo_url} alt="" className="rounded-ui-sm object-contain bg-white border border-gray-100 flex-none" style={{ width: taille, height: taille }} />
  return (
    <span className="rounded-ui-sm bg-gray-100 text-gray-600 flex items-center justify-center flex-none" style={{ width: taille, height: taille }}>
      <Building2 className="w-4 h-4" />
    </span>
  )
}

export function SelecteurSociete() {
  const ctx = useAuthStore((s) => s.societes)
  const [ouvert, setOuvert] = useState(false)
  if (!multiSocietes(ctx)) return null
  const courante = ctx.vue_groupe ? null : (ctx.societes || []).find((s) => s.id === ctx.current)
  const libelle = ctx.vue_groupe ? 'Toutes mes sociétés' : nomSociete(courante)
  return (
    <div className="relative">
      <button type="button" onClick={() => setOuvert(!ouvert)} aria-haspopup="listbox" aria-expanded={ouvert} title="Changer de société"
        className="h-9 pl-1.5 pr-2 rounded-ui-sm border border-gray-200 bg-white flex items-center gap-2 max-w-[14rem] hover:bg-gray-50">
        {ctx.vue_groupe ? <span className="w-6 h-6 rounded-ui-sm bg-gray-900 text-white flex items-center justify-center flex-none"><Layers className="w-3.5 h-3.5" /></span> : <Logo s={courante} taille={24} />}
        <span className="text-ui-sm font-medium text-gray-900 truncate hidden sm:block">{libelle}</span>
        <ChevronDown className="w-4 h-4 text-gray-500 flex-none" />
      </button>
      {ouvert && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOuvert(false)} />
          <ul role="listbox" aria-label="Sociétés" className="absolute right-0 top-11 w-72 bg-white rounded-ui border border-gray-200 shadow-md z-50 py-1 animate-fadeIn">
            {(ctx.societes || []).map((s) => {
              const actif = !ctx.vue_groupe && s.id === ctx.current
              return (
                <li key={s.id}>
                  <button type="button" role="option" aria-selected={actif} onClick={() => { setOuvert(false); if (!actif) choisirSociete(s.id) }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50">
                    <Logo s={s} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-ui font-medium text-gray-900 truncate">{nomSociete(s)}</span>
                      {s.status === 'archived' && <span className="block text-ui-sm text-gray-500">Archivée, lecture seule</span>}
                    </span>
                    {actif && <Check className="w-4 h-4 text-gray-900" />}
                  </button>
                </li>
              )
            })}
            {ctx.peut_vue_groupe && (
              <li className="border-t border-gray-100 mt-1 pt-1">
                <button type="button" role="option" aria-selected={!!ctx.vue_groupe} onClick={() => { setOuvert(false); if (!ctx.vue_groupe) choisirSociete(VUE_GROUPE) }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50">
                  <span className="w-7 h-7 rounded-ui-sm bg-gray-900 text-white flex items-center justify-center flex-none"><Layers className="w-4 h-4" /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-ui font-medium text-gray-900">Toutes mes sociétés</span>
                    <span className="block text-ui-sm text-gray-500">Vue groupe, lecture seule</span>
                  </span>
                  {ctx.vue_groupe && <Check className="w-4 h-4 text-gray-900" />}
                </button>
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  )
}

// Écran de choix : plusieurs sociétés et aucune choisie dans cet onglet. La société par défaut est en premier.
export function ChoixSociete() {
  const ctx = useAuthStore((s) => s.societes)
  if (!multiSocietes(ctx) || societeChoisie()) return null
  const liste = [...(ctx.societes || [])].sort((a, b) => Number(b.is_default) - Number(a.is_default))
  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="choix-societe-titre">
      <div className="w-full max-w-md card space-y-4">
        <div>
          <h1 id="choix-societe-titre" className="page-title">Choisir une société</h1>
          <p className="muted mt-1">Vous avez accès à plusieurs sociétés. Vous pourrez en changer à tout moment depuis l'en-tête.</p>
        </div>
        <ul className="grid gap-2">
          {liste.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => choisirSociete(s.id)} className="w-full flex items-center gap-3 rounded-ui border border-gray-200 bg-white px-3 py-3 text-left hover:border-gray-400">
                <Logo s={s} taille={36} />
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-gray-900 truncate">{nomSociete(s)}</span>
                  {s.is_default && <span className="block text-ui-sm text-gray-500">Société par défaut</span>}
                </span>
              </button>
            </li>
          ))}
          {ctx.peut_vue_groupe && (
            <li>
              <button type="button" onClick={() => choisirSociete(VUE_GROUPE)} className="w-full flex items-center gap-3 rounded-ui border border-dashed border-gray-300 bg-white px-3 py-3 text-left hover:border-gray-500">
                <span className="w-9 h-9 rounded-ui-sm bg-gray-900 text-white flex items-center justify-center flex-none"><Layers className="w-4 h-4" /></span>
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-gray-900">Toutes mes sociétés</span>
                  <span className="block text-ui-sm text-gray-500">Vue groupe, lecture seule</span>
                </span>
              </button>
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}

export function BandeauVueGroupe() {
  const ctx = useAuthStore((s) => s.societes)
  if (!ctx?.vue_groupe) return null
  return (
    <div className="mb-4 rounded-ui px-3 py-2 text-ui-sm flex flex-wrap items-center gap-2 bg-gray-900 text-white">
      <Layers className="w-4 h-4" />
      <span className="font-semibold">Vue groupe</span>
      <span>Toutes vos sociétés, en lecture seule : pour créer ou modifier, choisissez une société dans l'en-tête.</span>
    </div>
  )
}
