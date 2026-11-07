// Cadre de page commun (07/11, demande de H : écrans uniformes, contenu jamais arrêté aux deux tiers).
// Le cadre (`Layout.jsx`, balise <main>) donne seul la largeur, la marge et le fond. Une page affichée dans le
// cadre ne fixe ni sa largeur (max-w-3xl à max-w-7xl), ni une marge de page (p-6, px-4 py-6...), ni un fond
// pleine hauteur (min-h-screen). Décision de H du 07/11 : pleine largeur partout, pages de lecture comprises.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const app = readFileSync('src/app/App.jsx', 'utf8')
const debut = app.indexOf('<Route path="/" element={')
const bloc = app.slice(debut, app.indexOf('</Route>', debut))
const imports = {}
for (const m of app.matchAll(/const (\w+) = lazy\((?:importSur\()?\(\) => import\('([^']+)'\)/g)) imports[m[1]] = m[2]
for (const m of app.matchAll(/import (\w+) from '([^']+)'/g)) imports[m[1]] = m[2]

function fichier(chemin) {
  const base = normalize(join('src/app', chemin))
  return [base, `${base}.jsx`, `${base}.js`].find((c) => existsSync(c) && !c.endsWith('/'))
}

// Pages du cadre, et les composants voisins de leur dossier `pages` (onglets d'une page : EnrichissementRapide...)
const pages = new Set()
for (const m of bloc.matchAll(/element=\{<(\w+)/g)) {
  const f = imports[m[1]] && fichier(imports[m[1]])
  if (!f) continue
  pages.add(f)
  if (dirname(f).endsWith('/pages')) for (const v of readdirSync(dirname(f))) if (v.endsWith('.jsx')) pages.add(join(dirname(f), v))
}

// Pages hors du cadre (écran public, téléphone du formateur, espace comptable ; SetPassword sert dans et hors du cadre)
const HORS_CADRE = ['RelectureExpert.jsx', 'SuiviTelephone.jsx', 'EspaceComptable.jsx', 'SignatureFormateur.jsx', 'EspaceEntreprise.jsx', 'MonEspace.jsx', 'SetPassword.jsx']

const RACINE = /className="(?:[^"]*\s)?(?:max-w-[3-7]xl mx-auto|min-h-screen|p-6 max-w-|p-4 md:p-6|p-3 sm:p-6|md:p-6 max-w-|space-y-\d max-w-[3-7]xl)/

describe('cadre de page commun', () => {
  it('les pages du cadre sont bien trouvées', () => {
    const noms = [...pages].map((p) => p.split('/').pop())
    for (const n of ['AValider.jsx', 'Quotes.jsx', 'Invoices.jsx', 'BudgetModule.jsx', 'Completude.jsx', 'QuoiDeNeuf.jsx']) expect(noms).toContain(n)
    expect(pages.size).toBeGreaterThan(60)
  })
  it('aucune page ne fixe sa largeur, sa marge ni un fond pleine hauteur', () => {
    const fautes = []
    for (const f of pages) {
      if (HORS_CADRE.some((h) => f.endsWith(h))) continue
      readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
        // Les fenêtres (fixed) gardent leur largeur propre
        if (RACINE.test(l) && !/fixed|rounded-ui|shadow/.test(l)) fautes.push(`${f}:${i + 1}`)
      })
    }
    expect(fautes).toEqual([])
  })
  it('le cadre garde la largeur commune', () => {
    expect(readFileSync('src/app/Layout.jsx', 'utf8')).toMatch(/<main className=\{`max-w-7xl mx-auto/)
  })
})
