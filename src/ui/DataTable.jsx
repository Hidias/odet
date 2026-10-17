import { ChevronRight } from 'lucide-react'
import { EmptyState, Spinner } from './EmptyState'

// Tableau commun. Sur PC : un vrai tableau. Sur téléphone (ou si l'utilisateur choisit « Listes en cartes »
// dans l'affichage) : une carte par ligne, sans défilement latéral.
// columns : [{ key, label, render?(row), align?: 'right', mobile?: 'title' | 'subtitle' | 'aside' | 'meta' | false, className? }]
//   title : en gras en tête de carte ; subtitle : sous le titre ; aside : à droite (statut, montant) ;
//   meta : ligne « libellé : valeur » ; false : caché sur téléphone. Par défaut : meta.

export function DataTable({ columns, rows, rowKey = 'id', onRowClick = null, loading = false, empty = null, caption = null, className = '' }) {
  if (loading) return <Spinner />
  if (!rows || rows.length === 0) return empty || <EmptyState title="Aucun élément" compact />

  const cell = (col, row) => (col.render ? col.render(row) : row[col.key])
  const title = columns.find((c) => c.mobile === 'title') || columns[0]
  const subtitle = columns.filter((c) => c.mobile === 'subtitle')
  const aside = columns.filter((c) => c.mobile === 'aside')
  const meta = columns.filter((c) => c !== title && (c.mobile === undefined || c.mobile === 'meta'))
  const key = (row, i) => (typeof rowKey === 'function' ? rowKey(row) : row[rowKey]) ?? i
  const clickable = typeof onRowClick === 'function'

  return (
    <div className={`min-w-0 ${className}`}>
      <div className="dt-table overflow-x-auto">
        <table>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>{columns.map((c) => <th key={c.key} scope="col" className={c.align === 'right' ? 'text-right' : ''}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={key(row, i)} onClick={clickable ? () => onRowClick(row) : undefined}
                className={clickable ? 'cursor-pointer' : ''}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={clickable ? (e) => { if (e.key === 'Enter') onRowClick(row) } : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={`${c.align === 'right' ? 'text-right tabular-nums' : ''} ${c.className || ''}`}>{cell(c, row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="dt-cards" aria-label={caption || undefined}>
        {rows.map((row, i) => {
          const body = (
            <>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-gray-900">{cell(title, row)}</div>
                  {subtitle.map((c) => <div key={c.key} className="text-ui-sm text-gray-500">{cell(c, row)}</div>)}
                </div>
                {aside.length > 0 && <div className="flex-none grid justify-items-end gap-1">{aside.map((c) => <div key={c.key}>{cell(c, row)}</div>)}</div>}
                {clickable && <ChevronRight className="w-4 h-4 text-gray-400 flex-none mt-1" aria-hidden="true" />}
              </div>
              {meta.length > 0 && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 mt-1.5 text-ui-sm">
                  {meta.map((c) => (
                    <div key={c.key} className="contents"><dt className="text-gray-500">{c.label}</dt><dd className="text-gray-800 min-w-0 break-words">{cell(c, row)}</dd></div>
                  ))}
                </dl>
              )}
            </>
          )
          return (
            <li key={key(row, i)} className="dt-card">
              {clickable ? <button type="button" className="w-full text-left" onClick={() => onRowClick(row)}>{body}</button> : body}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default DataTable
