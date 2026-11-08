// Kanban commun (consigne de H du 04/11, inspiré d'Odoo) : affaires et devis, actions de l'équipe, relances à valider.
// Une colonne par étape, côte à côte ; elles défilent de gauche à droite (au téléphone, une colonne presque pleine
// largeur à la fois). On change d'étape en faisant glisser une carte (ordinateur) ou par le menu « ⋯ » de la carte
// (partout, au clavier aussi). La page décide de ce qui se déplace et de ce que propose le menu.
//
// colonnes : [{ code, label, lignes, sousTitre? }] ; cle(ligne) : clé unique ; carte(ligne) : contenu de la carte ;
// onOuvrir(ligne) : clic sur la carte ; ouvrable(ligne) : la carte s'ouvre (sinon simple texte) ; deplacable(ligne) : la carte se glisse ; peutDeposer(ligne, code) ;
// onDeposer(ligne, code) ; libelleMenu(ligne) : nom du bouton « ⋯ » (absent : pas de menu) ;
// menu({ ligne, fermer, choisir }) : contenu du menu ; choisir(action) ferme le menu, rend ensuite le focus au
// bouton « ⋯ » de la carte (elle a pu changer de colonne) et lance l'action.

import { useCallback, useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import MenuFlottant from './MenuFlottant'

export const CLASSE_ITEM_MENU = 'w-full text-left px-3 py-2 text-ui text-gray-700 hover:bg-gray-50'

export function Kanban({
  colonnes, cle, carte, onOuvrir, ouvrable = () => true, deplacable = () => false, peutDeposer = () => false, onDeposer,
  libelleMenu = null, menu = null, label = 'Tableau par étape', labelMenu = 'Actions', largeurMenu = 220, vide = 'Rien ici',
}) {
  const [ouvert, setOuvert] = useState(null) // { ligne, ancre }
  const [survol, setSurvol] = useState(null) // colonne survolée pendant un glisser
  const glisse = useRef(null)
  const menuRef = useRef(null)
  const zone = useRef(null)
  const aRefocaliser = useRef(null) // clé de la carte dont le bouton « ⋯ » reprend le focus après une action du menu
  const fermer = useCallback(() => setOuvert(null), [])
  const avecMenu = !!(libelleMenu && menu)

  // Clic ou toucher ailleurs : le menu se ferme (MenuFlottant laisse ce soin à la page)
  useEffect(() => {
    if (!ouvert) return
    const ailleurs = (e) => {
      if (menuRef.current?.contains(e.target)) return
      if (e.target.closest?.('[data-kanban-menu]')) return
      setOuvert(null)
    }
    document.addEventListener('mousedown', ailleurs)
    document.addEventListener('touchstart', ailleurs)
    return () => { document.removeEventListener('mousedown', ailleurs); document.removeEventListener('touchstart', ailleurs) }
  }, [ouvert])

  // La carte a pu changer de colonne (elle est recréée) : le focus revient sur son bouton « ⋯ »
  useEffect(() => {
    const cible = aRefocaliser.current
    if (!cible) return
    const b = [...(zone.current?.querySelectorAll('[data-kanban-menu]') || [])].find((x) => x.getAttribute('data-kanban-menu') === cible)
    if (b) { b.focus({ preventScroll: false }); aRefocaliser.current = null }
  }, [colonnes])

  const deposer = (code) => {
    const l = glisse.current
    glisse.current = null
    setSurvol(null)
    if (l && peutDeposer(l, code)) onDeposer?.(l, code)
  }
  const choisir = (action) => {
    const l = ouvert?.ligne
    fermer()
    if (l) aRefocaliser.current = String(cle(l))
    action?.()
  }
  const estOuvert = (l) => !!(ouvert?.ligne && cle(ouvert.ligne) === cle(l))

  return (
    <>
      <div ref={zone} className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1" aria-label={label}>
        {colonnes.map((c) => (
          <section key={c.code} aria-label={`${c.label} : ${c.lignes.length}`}
            className={`card p-3 flex-none w-[85vw] sm:w-72 snap-start flex flex-col gap-2 ${survol === c.code ? 'ring-2 ring-accent-500' : ''}`}
            onDragOver={(e) => { if (glisse.current && peutDeposer(glisse.current, c.code)) { e.preventDefault(); if (survol !== c.code) setSurvol(c.code) } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setSurvol(null) }}
            onDrop={(e) => { e.preventDefault(); deposer(c.code) }}>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-semibold">{c.label}</h3>
              <span className="text-ui-sm text-gray-500 tabular-nums">{c.lignes.length}</span>
            </div>
            {c.sousTitre && <div className="text-ui-sm text-gray-500 tabular-nums">{c.sousTitre}</div>}
            <ul className="space-y-1.5 min-h-[3rem]">
              {c.lignes.length === 0 && <li className="text-ui-sm text-gray-400 px-1 py-2">{vide}</li>}
              {c.lignes.map((l) => (
                <li key={cle(l)} draggable={deplacable(l)}
                  onDragStart={(e) => { glisse.current = l; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(cle(l))) }}
                  onDragEnd={() => { glisse.current = null; setSurvol(null) }}
                  className={`rounded-ui-sm border border-gray-200 bg-white flex items-start ${deplacable(l) ? 'cursor-grab' : ''}`}>
                  {onOuvrir && ouvrable(l) ? (
                    <button type="button" className="min-w-0 flex-1 text-left px-2.5 py-2 hover:bg-gray-50 rounded-ui-sm" onClick={() => onOuvrir(l)}>
                      {carte(l)}
                    </button>
                  ) : <div className="min-w-0 flex-1 px-2.5 py-2">{carte(l)}</div>}
                  {avecMenu && libelleMenu(l) && (
                    <button type="button" data-kanban-menu={String(cle(l))} aria-label={libelleMenu(l)}
                      className="btn btn-ghost flex-none m-1 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-8 sm:h-8 p-0 justify-center"
                      aria-expanded={estOuvert(l) ? 'true' : 'false'}
                      onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setOuvert(estOuvert(l) ? null : { ligne: l, ancre: r }) }}>
                      <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {ouvert && avecMenu && (
        <MenuFlottant ancre={ouvert.ancre} onFermer={fermer} menuRef={menuRef} largeur={largeurMenu} label={labelMenu}>
          {menu({ ligne: ouvert.ligne, fermer, choisir })}
        </MenuFlottant>
      )}
    </>
  )
}
