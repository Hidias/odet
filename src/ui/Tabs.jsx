import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

// Onglets communs. Tous les onglets s'affichent quand ils tiennent ; sinon les premiers restent visibles (au plus
// `visible`) et les autres passent dans un menu « Plus » (même contenu, aucun onglet supprimé). L'onglet actif caché reste signalé.
// Le nombre d'onglets visibles s'adapte aussi à la largeur disponible (téléphone, tablette) : un onglet qui ne
// tient pas entier passe dans « Plus » au lieu d'être coupé au bord de l'écran.
// tabs : [{ id, label, count? }]

const PLACE_PLUS = 96 // largeur réservée au bouton « Plus » (libellé de l'onglet actif compris, au plus court)

// Nombre d'onglets entiers qui tiennent dans la largeur `dispo` (tous si la rangée entière tient)
export function ongletsQuiTiennent(largeurs, dispo) {
  const total = largeurs.reduce((a, b) => a + b, 0)
  if (total <= dispo) return largeurs.length
  let somme = 0
  let n = 0
  for (const w of largeurs) {
    if (somme + w > dispo - PLACE_PLUS) break
    somme += w
    n += 1
  }
  return Math.max(1, n)
}

// Quand tous les onglets tiennent, ils sont tous affichés : « Plus » ne sert qu'au manque de place
// (signalé par H le 07/11 : Stock gardait 2 onglets dans « Plus » avec la moitié de la rangée vide).
// `visible` ne limite que lorsque la rangée ne tient pas entière.
export function ongletsAffiches(nombre, tient, visible) {
  if (tient >= nombre) return nombre
  return Math.min(visible, tient)
}

export function Tabs({ tabs, value, onChange, visible = 6, className = '' }) {
  const [open, setOpen] = useState(false)
  const [tient, setTient] = useState(visible)
  const ref = useRef(null)
  const cadre = useRef(null)
  const mesure = useRef(null)

  // Combien d'onglets entiers tiennent dans la largeur du cadre (mesurés dans une rangée invisible)
  useLayoutEffect(() => {
    const el = cadre.current
    const m = mesure.current
    if (!el || !m) return undefined
    const calculer = () => setTient(ongletsQuiTiennent([...m.children].map((c) => c.getBoundingClientRect().width + 4), el.clientWidth))
    calculer()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(calculer) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [tabs])

  const limite = ongletsAffiches(tabs.length, tient, visible)
  const shown = tabs.slice(0, limite)
  const more = tabs.slice(limite)
  const activeInMore = more.find((t) => t.id === value)

  useEffect(() => {
    if (!open) return undefined
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const Tab = ({ t, mesureSeule = false }) => (
    <button type="button" role={mesureSeule ? undefined : 'tab'} aria-selected={mesureSeule ? undefined : t.id === value}
      tabIndex={mesureSeule ? -1 : undefined} onClick={mesureSeule ? undefined : () => onChange(t.id)}
      className={`tab ${t.id === value ? 'tab-active' : ''} inline-flex items-center gap-1.5 whitespace-nowrap`}>
      {t.label}
      {t.count != null && <span className="text-ui-sm text-gray-400 font-normal tabular-nums">{t.count}</span>}
    </button>
  )

  return (
    <div ref={cadre} className={`tabs min-w-0 max-w-full relative ${className}`} role="tablist" style={{ overflow: 'visible' }}>
      {/* Rangée invisible qui sert seulement à mesurer la largeur de chaque onglet */}
      <div ref={mesure} aria-hidden="true" className="flex gap-1 absolute left-0 top-0 pointer-events-none"
        style={{ visibility: 'hidden', height: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>
        {tabs.map((t) => <Tab key={t.id} t={t} mesureSeule />)}
      </div>
      <div className="flex gap-1 overflow-x-auto min-w-0 tabs-scroll">
        {shown.map((t) => <Tab key={t.id} t={t} />)}
      </div>
      {more.length > 0 && (
        <div className="relative flex-none" ref={ref}>
          <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
            className={`tab ${activeInMore ? 'tab-active' : ''} inline-flex items-center gap-1 whitespace-nowrap max-w-[11rem]`}>
            <span className="truncate">{activeInMore ? activeInMore.label : 'Plus'}</span><ChevronDown className="w-4 h-4 flex-none" aria-hidden="true" />
          </button>
          {open && (
            <div role="menu" className="absolute right-0 top-full mt-1 z-40 bg-white border hairline min-w-[220px] max-w-[calc(100vw-2rem)] py-1"
              style={{ borderRadius: 'var(--radius-ui)', boxShadow: 'var(--shadow-pop)' }}>
              {more.map((t) => (
                <button key={t.id} type="button" role="menuitem" onClick={() => { onChange(t.id); setOpen(false) }}
                  className={`w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between gap-3 ${t.id === value ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                  <span>{t.label}</span>{t.count != null && <span className="text-ui-sm text-gray-400 tabular-nums">{t.count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default Tabs
