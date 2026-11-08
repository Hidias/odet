// Kanban des affaires et des devis envoyés (consigne de H du 04/11, inspiré d'Odoo) : une colonne par étape ouverte,
// côte à côte ; elles défilent de gauche à droite (au téléphone, une colonne presque pleine largeur à la fois).
// Montant exact sur la carte, totaux de colonne en K€ arrondis. On change d'étape en faisant glisser une carte
// (ordinateur) ou par « Changer d'étape » dans le menu de la carte (partout, au clavier aussi).
// Un devis pas encore suivi comme affaire suit le statut du devis : il ne se déplace pas, son menu ouvre le devis.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import MenuFlottant from '../../../ui/MenuFlottant'
import { BadgeTest } from '../../../core/demo/BadgeTest'
import { money } from '../../../core/utils'
import { kEuros, etapesProposees, deplacementPossible } from '../lib/affaires'

const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : 'Relance à dater')
const cle = (l) => `${l.origine}-${l.id}`

export function KanbanAffaires({ colonnes, etapes, peutModifier, onOuvrir, onChanger }) {
  const [menu, setMenu] = useState(null) // { ligne, ancre }
  const [survol, setSurvol] = useState(null) // colonne survolée pendant un glisser
  const glisse = useRef(null)
  const menuRef = useRef(null)
  const zone = useRef(null)
  const aRefocaliser = useRef(null) // carte dont le bouton « ⋯ » reprend le focus après un changement d'étape au clavier
  const fermerMenu = useCallback(() => setMenu(null), [])
  const deplacable = (l) => peutModifier && l.origine === 'affaire'
  const libelle = (l) => `Actions : ${l.client_name}, ${l.title}`

  // Clic ou toucher ailleurs : le menu se ferme (MenuFlottant laisse ce soin à la page, comme Devis et Clients)
  useEffect(() => {
    if (!menu) return
    const ailleurs = (e) => {
      if (menuRef.current?.contains(e.target)) return
      if (e.target.closest?.('[data-kanban-menu]')) return
      setMenu(null)
    }
    document.addEventListener('mousedown', ailleurs)
    document.addEventListener('touchstart', ailleurs)
    return () => { document.removeEventListener('mousedown', ailleurs); document.removeEventListener('touchstart', ailleurs) }
  }, [menu])

  // La carte a changé de colonne (elle est recréée) : le focus revient sur son bouton « ⋯ »
  useEffect(() => {
    const cible = aRefocaliser.current
    if (!cible) return
    const b = [...(zone.current?.querySelectorAll('[data-kanban-menu]') || [])].find((x) => x.getAttribute('aria-label') === cible)
    if (b) { b.focus({ preventScroll: false }); aRefocaliser.current = null }
  }, [colonnes])

  const deposer = (code) => {
    const l = glisse.current
    glisse.current = null
    setSurvol(null)
    if (deplacementPossible(l, code, peutModifier)) onChanger(l, code)
  }

  return (
    <>
      <div ref={zone} className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1" aria-label="Affaires par étape">
        {colonnes.map((c) => (
          <section key={c.code} aria-label={`${c.label} : ${c.lignes.length}`}
            className={`card p-3 flex-none w-[85vw] sm:w-72 snap-start flex flex-col gap-2 ${survol === c.code ? 'ring-2 ring-accent-500' : ''}`}
            onDragOver={(e) => { if (glisse.current) { e.preventDefault(); if (survol !== c.code) setSurvol(c.code) } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setSurvol(null) }}
            onDrop={(e) => { e.preventDefault(); deposer(c.code) }}>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-semibold">{c.label}</h3>
              <span className="text-ui-sm text-gray-500 tabular-nums">{c.lignes.length}</span>
            </div>
            <div className="text-ui-sm text-gray-500 tabular-nums">{kEuros(c.montant)} · pondéré {kEuros(c.pondere)} · {c.probability} %</div>
            <ul className="space-y-1.5 min-h-[3rem]">
              {c.lignes.map((l) => (
                <li key={cle(l)} draggable={deplacable(l)}
                  onDragStart={(e) => { glisse.current = l; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', cle(l)) }}
                  onDragEnd={() => { glisse.current = null; setSurvol(null) }}
                  className={`rounded-ui-sm border border-gray-200 bg-white flex items-start ${deplacable(l) ? 'cursor-grab' : ''}`}>
                  <button type="button" className="min-w-0 flex-1 text-left px-2.5 py-2 hover:bg-gray-50 rounded-ui-sm" onClick={() => onOuvrir(l)}>
                    <div className="text-ui font-medium truncate">{l.client_name} <BadgeTest tbl="clients" id={l.client_id} /></div>
                    <div className="text-ui-sm text-gray-500 truncate">{l.title}</div>
                    <div className="text-ui-sm text-gray-400 flex justify-between gap-2">
                      <span className="tabular-nums">{l.amount_ht != null ? money(l.amount_ht) : 'Montant à estimer'}</span>
                      <span>{fr(l.next_action_on)}</span>
                    </div>
                    {l.origine === 'devis' && <div className="text-ui-sm text-gray-400">Devis envoyé</div>}
                  </button>
                  {peutModifier && (
                    <button type="button" data-kanban-menu="" aria-label={libelle(l)}
                      className="btn btn-ghost flex-none m-1 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-8 sm:h-8 p-0 justify-center"
                      aria-expanded={menu?.ligne && cle(menu.ligne) === cle(l) ? 'true' : 'false'}
                      onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu(menu?.ligne && cle(menu.ligne) === cle(l) ? null : { ligne: l, ancre: r }) }}>
                      <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {menu && (
        <MenuFlottant ancre={menu.ancre} onFermer={fermerMenu} menuRef={menuRef} largeur={220} label="Actions de l'affaire">
          {menu.ligne.origine === 'devis' ? (
            <Link to={`/devis?open=${menu.ligne.id}`} className="block w-full px-3 py-2 text-ui text-gray-700 hover:bg-gray-50" onClick={fermerMenu}>
              Ouvrir le devis (l'étape suit son statut)
            </Link>
          ) : (
            <>
              <div className="px-3 pt-1.5 pb-1 text-ui-sm text-gray-500">Changer d'étape</div>
              {etapesProposees(etapes, menu.ligne.stage).map((e) => (
                <button key={e.code} type="button" className="w-full text-left px-3 py-2 text-ui text-gray-700 hover:bg-gray-50"
                  onClick={() => { const l = menu.ligne; fermerMenu(); aRefocaliser.current = libelle(l); onChanger(l, e.code) }}>
                  {e.code === 'perdue' || e.code === 'gagnee' ? `${e.label}…` : e.label}
                </button>
              ))}
            </>
          )}
        </MenuFlottant>
      )}
    </>
  )
}
