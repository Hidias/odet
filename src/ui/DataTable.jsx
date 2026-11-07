import { ChevronRight, ArrowUp, ArrowDown } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { EmptyState, Spinner } from './EmptyState'

// Tableau commun. Sur PC : un vrai tableau. Sur téléphone (ou si l'utilisateur choisit « Listes en cartes »
// dans l'affichage) : une carte par ligne, sans défilement latéral.
// columns : [{ key, label, render?(row), align?: 'right' | 'center', mobile?: 'title' | 'subtitle' | 'aside' | 'meta' | false, className?,
//              sortKey?, hideBelow?: 'lg' | 'xl', actions?: true, srLabel? }]
//   title : en gras en tête de carte ; subtitle : sous le titre ; aside : à droite (statut, montant) ;
//   meta : ligne « libellé : valeur » ; false : caché sur téléphone. Par défaut : meta.
//   sortKey : en-tête cliquable (avec sort et onSort) ; hideBelow : colonne masquée dans le tableau sous cette largeur ;
//   actions : cellule de boutons, un clic dessus n'ouvre pas la ligne (en carte : en bas à droite) ;
//   srLabel : nom lu par les lecteurs d'écran quand l'en-tête est vide.
// sort : { key, dir: 'asc' | 'desc' } et onSort(key) : tri fait par la page, l'en-tête l'affiche.
// selection : { selected: Set, onToggle(row), onToggleAll(), label?(row) } : une case par ligne et une case « tout ».
// rowClassName(row) : classe en plus sur la ligne et la carte.
// rowHref(row) : adresse de la ligne ; un vrai lien, qui s'ouvre aussi dans un nouvel onglet. Sans adresse pour une ligne
//   (null), le clic de la ligne passe par onRowClick (ex. ligne de groupe qui se déplie).
// Dans une carte cliquable, tout bouton, lien ou champ passe au-dessus de la zone cliquable (index.css, .dt-card).

const CACHE = { lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' }
const ALIGN = { right: 'text-right', center: 'text-center' }
const vide = (v) => v === null || v === undefined || v === false || v === '' || v === '-' || v === '\u2014' || (Array.isArray(v) && v.every(vide))

export function DataTable({ columns, rows, rowKey = 'id', onRowClick = null, loading = false, empty = null, caption = null, className = '',
  sort = null, onSort = null, selection = null, rowClassName = null, rowHref = null }) {
  const navigate = useNavigate()
  if (loading) return <Spinner />
  if (!rows || rows.length === 0) return empty || <EmptyState title="Aucun élément" compact />

  const cell = (col, row) => (col.render ? col.render(row) : row[col.key])
  const title = columns.find((c) => c.mobile === 'title') || columns[0]
  const subtitle = columns.filter((c) => c.mobile === 'subtitle' && !c.actions)
  const aside = columns.filter((c) => c.mobile === 'aside' && !c.actions)
  const actions = columns.filter((c) => c.actions && c.mobile !== false)
  const meta = columns.filter((c) => c !== title && !c.actions && (c.mobile === undefined || c.mobile === 'meta'))
  const key = (row, i) => (typeof rowKey === 'function' ? rowKey(row) : row[rowKey]) ?? i
  const lien = (row) => (typeof rowHref === 'function' ? rowHref(row) || null : null)
  const ouvrir = (row) => { const href = lien(row); if (href) navigate(href); else if (typeof onRowClick === 'function') onRowClick(row) }
  const clickable = typeof rowHref === 'function' || typeof onRowClick === 'function'
  // Un clic qui termine une sélection de texte (copier un e-mail) n'ouvre pas la ligne
  const ouvrirLigne = (row) => { if (typeof window !== 'undefined' && window.getSelection?.().toString()) return; ouvrir(row) }
  const extra = (row) => (typeof rowClassName === 'function' ? rowClassName(row) || '' : '')
  const idDe = (row) => (typeof rowKey === 'function' ? rowKey(row) : row[rowKey])
  const coche = (row) => !!selection?.selected?.has(idDe(row))
  const toutCoche = !!selection && rows.length > 0 && rows.every(coche)
  const libelleCase = (row) => (selection?.label ? selection.label(row) : `Sélectionner ${typeof cell(title, row) === 'string' ? cell(title, row) : 'la ligne'}`)
  const arreter = (e) => e.stopPropagation()

  const entete = (c) => {
    const cls = [ALIGN[c.align] || '', CACHE[c.hideBelow] || ''].join(' ')
    const actif = sort && c.sortKey && sort.key === c.sortKey
    const ariaSort = c.sortKey && onSort ? (actif ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none') : undefined
    const nom = c.label || (c.srLabel ? <span className="sr-only">{c.srLabel}</span> : null)
    return (
      <th key={c.key} scope="col" className={cls} aria-sort={ariaSort}>
        {c.sortKey && onSort ? (
          <button type="button" className="inline-flex items-center gap-1 hover:text-gray-800 select-none" onClick={() => onSort(c.sortKey)}>
            {nom}
            {actif && (sort.dir === 'desc' ? <ArrowDown className="w-3 h-3" aria-hidden="true" /> : <ArrowUp className="w-3 h-3" aria-hidden="true" />)}
          </button>
        ) : nom}
      </th>
    )
  }

  return (
    <div className={`min-w-0 ${className}`}>
      <div className="dt-table overflow-x-auto">
        <table>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {selection && (
                <th scope="col" className="w-10">
                  <input type="checkbox" className="w-4 h-4 align-middle" checked={toutCoche} onChange={() => selection.onToggleAll()} aria-label="Tout sélectionner" />
                </th>
              )}
              {columns.map(entete)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={key(row, i)} onClick={clickable ? () => ouvrirLigne(row) : undefined}
                className={`${clickable ? 'cursor-pointer' : ''} ${extra(row)}`.trim() || undefined}
                tabIndex={clickable && !lien(row) ? 0 : undefined}
                onKeyDown={clickable && !lien(row) ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) ouvrir(row) } : undefined}>
                {selection && (
                  <td className="w-10" onClick={arreter}>
                    <input type="checkbox" className="w-4 h-4 align-middle" checked={coche(row)} onChange={() => selection.onToggle(row)} aria-label={libelleCase(row)} />
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c.key} onClick={c.actions ? arreter : undefined} onKeyDown={c.actions ? arreter : undefined}
                    className={`${c.align === 'right' ? 'text-right tabular-nums' : ALIGN[c.align] || ''} ${CACHE[c.hideBelow] || ''} ${c.className || ''}`.trim() || undefined}>
                    {c === title && lien(row) ? <Link to={lien(row)} className="text-inherit hover:underline" onClick={arreter}>{cell(c, row)}</Link> : cell(c, row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="dt-cards" aria-label={caption || undefined}>
        {rows.map((row, i) => (
          <li key={key(row, i)} className={`dt-card ${clickable ? 'relative' : ''} ${extra(row)}`.trim()}>
            <div className="flex items-start gap-3">
              {selection && (
                <input type="checkbox" className="w-4 h-4 mt-1 flex-none relative z-[1]" checked={coche(row)} onChange={() => selection.onToggle(row)} aria-label={libelleCase(row)} />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-gray-900">
                  {lien(row)
                    ? <Link to={lien(row)} className="dt-etire text-inherit after:absolute after:inset-0 after:content-['']">{cell(title, row)}</Link>
                    : clickable
                      ? <button type="button" className="dt-etire text-left after:absolute after:inset-0 after:content-['']" onClick={() => ouvrir(row)}>{cell(title, row)}</button>
                      : cell(title, row)}
                </div>
                {subtitle.map((c) => <div key={c.key} className="text-ui-sm text-gray-500">{cell(c, row)}</div>)}
              </div>
              {aside.length > 0 && <div className="flex-none grid justify-items-end gap-1">{aside.map((c) => <div key={c.key}>{cell(c, row)}</div>)}</div>}
              {clickable && <ChevronRight className="w-4 h-4 text-gray-400 flex-none mt-1" aria-hidden="true" />}
            </div>
            {(() => {
              // Ligne « libellé : valeur » sans valeur : rien à lire, on ne l'affiche pas dans la carte
              const lignes = meta.map((c) => [c, cell(c, row)]).filter(([, v]) => !vide(v))
              return lignes.length > 0 && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 mt-1.5 text-ui-sm">
                  {lignes.map(([c, v]) => (
                    <div key={c.key} className="contents"><dt className="text-gray-500">{c.label}</dt><dd className="text-gray-800 min-w-0 break-words">{v}</dd></div>
                  ))}
                </dl>
              )
            })()}
            {(() => {
              const boutons = actions.map((c) => [c, cell(c, row)]).filter(([, v]) => !vide(v))
              return boutons.length > 0 && (
                <div className="relative z-[1] flex flex-wrap justify-end gap-1 mt-1.5">
                  {boutons.map(([c, v]) => <div key={c.key} className="contents">{v}</div>)}
                </div>
              )
            })()}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default DataTable
