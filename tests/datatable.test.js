// Tableau commun : tri, sélection, colonnes masquées et actions de ligne (lot 3 de l'affichage).
import { describe, it, expect } from 'vitest'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DataTable } from '../src/ui/DataTable.jsx'

const lignes = [{ id: 'a', nom: 'Alpha', ville: 'Brest' }, { id: 'b', nom: 'Bravo', ville: 'Quimper' }]
const colonnes = [
  { key: 'nom', label: 'Nom', mobile: 'title', sortKey: 'nom' },
  { key: 'ville', label: 'Ville', hideBelow: 'lg' },
  { key: 'act', label: '', srLabel: 'Actions', actions: true, render: (r) => h('button', { type: 'button' }, `Modifier ${r.nom}`) },
]
const rendu = (props) => renderToStaticMarkup(h(DataTable, { columns: colonnes, rows: lignes, ...props }))

describe('DataTable', () => {
  it('sans les nouvelles options : ni case, ni bouton de tri', () => {
    const html = renderToStaticMarkup(h(DataTable, { columns: [{ key: 'nom', label: 'Nom' }], rows: lignes }))
    expect(html).not.toContain('type="checkbox"')
    expect(html).not.toContain('aria-sort')
  })

  it('en-tête triable : bouton, sens annoncé', () => {
    const html = rendu({ sort: { key: 'nom', dir: 'desc' }, onSort: () => {} })
    expect(html).toContain('aria-sort="descending"')
    expect(html).toMatch(/<th[^>]*aria-sort="descending"[^>]*><button type="button"/)
  })

  it('colonne masquée sous une largeur, dans le tableau seulement', () => {
    const html = rendu({})
    expect(html).toContain('hidden lg:table-cell')
    expect(html).toContain('<dt class="text-gray-500">Ville</dt>')
  })

  it('en-tête vide nommé pour les lecteurs d\'écran', () => {
    expect(rendu({})).toContain('<span class="sr-only">Actions</span>')
  })

  it('sélection : une case par ligne dans les deux rendus et une case « tout »', () => {
    const html = rendu({ selection: { selected: new Set(['a']), onToggle: () => {}, onToggleAll: () => {} } })
    expect(html.match(/type="checkbox"/g)).toHaveLength(5)
    expect(html).toContain('aria-label="Tout sélectionner"')
    expect(html).toContain('aria-label="Sélectionner Alpha"')
  })

  it('carte cliquable : jamais un bouton dans un bouton, actions au-dessus du lien étiré', () => {
    const html = rendu({ onRowClick: () => {} })
    const cartes = html.slice(html.indexOf('dt-cards'))
    expect(cartes).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*<button/)
    expect(cartes).toContain('after:absolute after:inset-0')
    expect(cartes).toContain('relative z-[1]')
  })

  it('classe de ligne appliquée au tableau et à la carte', () => {
    const html = rendu({ rowClassName: (r) => (r.id === 'b' ? 'ligne-b' : '') })
    expect(html.match(/ligne-b/g)).toHaveLength(2)
  })
})

describe('DataTable, cartes', () => {
  it('une ligne « libellé : valeur » sans valeur ne s\'affiche pas', () => {
    const html = renderToStaticMarkup(h(DataTable, { rows: [{ id: 'x', nom: 'X', ville: '' }, { id: 'y', nom: 'Y', ville: null }, { id: 'z', nom: 'Z', ville: '-' }],
      columns: [{ key: 'nom', label: 'Nom', mobile: 'title' }, { key: 'ville', label: 'Ville' }] }))
    expect(html).not.toContain('<dt class="text-gray-500">Ville</dt>')
  })
})
