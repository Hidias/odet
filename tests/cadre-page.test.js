// Cadre de page commun (07/11, demande de H : écrans uniformes, contenu jamais arrêté aux deux tiers).
// Le cadre (`Layout.jsx`, balise <main>) donne seul la largeur, la marge et le fond. Une page affichée dans le
// cadre ne fixe ni sa largeur, ni une marge de page, ni un fond pleine hauteur. Décision de H du 07/11 :
// pleine largeur partout, pages de lecture comprises.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const app = readFileSync('src/app/App.jsx', 'utf8')

// Routes du cadre : de <Route path="/" element={...}> à sa balise fermante, routes filles imbriquées comptées.
// Une balise <Route ...> qui se termine par « /> » n'ouvre rien ; par « > » seul, elle ouvre un niveau.
function blocDuCadre() {
  const lignes = app.split('\n')
  const debut = lignes.findIndex((l) => l.includes('<Route path="/" element={'))
  let profondeur = 0
  let enCours = false
  for (let i = debut; i < lignes.length; i += 1) {
    const l = lignes[i].trim()
    if (l.startsWith('<Route')) enCours = true
    if (enCours && /\/>$/.test(l) && !/^<\w+[^<]*\/>$/.test(l.replace(/^<Route\b.*?element=\{<\w+[^}]*\}/, '<Route'))) { /* ligne intermédiaire */ }
    if (enCours && (/\}\s*\/>$/.test(l) || /^<Route\b.*\/>$/.test(l))) enCours = false
    else if (enCours && /(\}|")>$/.test(l)) { enCours = false; profondeur += 1 }
    if (l === '</Route>') {
      profondeur -= 1
      if (profondeur === 0) return lignes.slice(debut, i + 1).join('\n')
    }
  }
  throw new Error('bloc du cadre introuvable')
}
const bloc = blocDuCadre()

const imports = {}
for (const m of app.matchAll(/const (\w+) = lazy\((?:importSur\()?\(\) => import\('([^']+)'\)/g)) imports[m[1]] = m[2]
for (const m of app.matchAll(/import (\w+) from '([^']+)'/g)) imports[m[1]] = m[2]
const fichier = (chemin) => {
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

// Fichiers d'un dossier `pages` affichés hors du cadre (écran public, téléphone du formateur, espace comptable)
const HORS_CADRE = ['RelectureExpert.jsx', 'SuiviTelephone.jsx', 'EspaceComptable.jsx', 'SignatureFormateur.jsx', 'EspaceEntreprise.jsx', 'MonEspace.jsx']
const aControler = [...pages].filter((f) => !HORS_CADRE.some((h) => f.endsWith(`/${h}`)))

// Racine d'une page ou d'une vue : l'élément rendu par « return ( » ou « return <div »
const RACINES = /return \(\s*\n\s*<(?:div|section|main)\b([^>]*)>|return <(?:div|section|main)\b([^>]*)>/g
// Ce qu'une racine ne doit pas porter : largeur maximale, marge de page (adaptée à l'écran, ou p-6 et plus,
// ou px et py ensemble), fond pleine hauteur. Une carte ou un encart (bordure, fond blanc) garde sa marge.
const INTERDIT = /\bmax-w-(?:[2-7]xl|screen)|(?:^|[\s"`])(?:sm|md|lg):p[xy]?-\d|(?:^|[\s"`])p-(?:[6-9]|1\d)\b|(?:^|[\s"`])px-\d+\s+(?:sm:px-\d+\s+)?py-\d|min-h-screen|(?<!:)bg-gray-50|maxWidth/
const ENCART = /\bcard\b|\bborder\b|bg-white|rounded/
// Partout dans une page : largeur centrée fixe ou fond pleine hauteur (hors fenêtre `fixed`)
const LIGNE = /max-w-(?:[2-7]xl|screen-\w+)\s+mx-auto|mx-auto\s+max-w-(?:[2-7]xl|screen-\w+)|min-h-screen/

function fautesDe(source, nom = '') {
  const fautes = []
  for (const m of source.matchAll(RACINES)) {
    const attrs = m[1] || m[2] || ''
    const ligne = source.slice(m.index, source.indexOf('\n', m.index + m[0].length) + 1 || undefined)
    if (ligne.includes('// hors du cadre')) continue // branche d'une page qui sert aussi hors du cadre (SetPassword)
    if (/\bfixed\b/.test(attrs) || ENCART.test(attrs)) continue // fenêtre, carte ou encart
    if (INTERDIT.test(attrs)) fautes.push(`${nom}:${source.slice(0, m.index).split('\n').length} racine`)
  }
  source.split('\n').forEach((l, i) => {
    if (LIGNE.test(l) && !/\bfixed\b/.test(l) && !l.includes('// hors du cadre')) fautes.push(`${nom}:${i + 1}`)
  })
  return fautes
}

describe('cadre de page commun', () => {
  it('les pages du cadre sont bien trouvées, jusqu\'à la dernière route', () => {
    const noms = aControler.map((p) => p.split('/').pop())
    for (const n of ['AValider.jsx', 'Quotes.jsx', 'Invoices.jsx', 'BudgetModule.jsx', 'Completude.jsx', 'QuoiDeNeuf.jsx', 'Clients.jsx', 'RetoursSuivi.jsx', 'SetPassword.jsx', 'EmailSettings.jsx', 'DesignReference.jsx']) expect(noms).toContain(n)
    expect(bloc.trim().endsWith('</Route>')).toBe(true)
    expect(bloc).not.toContain('path="*"')
  })
  it('aucune page ne fixe sa largeur, sa marge ni un fond pleine hauteur', () => {
    expect(aControler.flatMap((f) => fautesDe(readFileSync(f, 'utf8'), f))).toEqual([])
  })
  it('le contrôle attrape les formes connues du défaut', () => {
    for (const c of [
      'return (\n    <div className="md:p-6">',
      'return <div className="space-y-4 max-w-3xl">{c}</div>',
      'return (\n  <div className="space-y-4 max-w-3xl">',
      'return (\n  <div className="mx-auto max-w-5xl">',
      'return (\n  <div className={`p-6 ${x}`}>',
      'return (\n  <div className="grid" style={{ maxWidth: 1100 }}>',
      'return (\n  <div className="min-h-screen bg-gray-50 p-6">',
      '      <div className="max-w-2xl mx-auto py-12">',
      '    <div className="max-w-5xl mx-auto bg-white rounded-ui shadow-sm">',
    ]) expect(fautesDe(c)).not.toEqual([])
  })
  it('les fenêtres et les racines sans marge passent', () => {
    for (const c of [
      'return (\n  <div className="fixed inset-0 z-50 flex items-center justify-center">\n<div className="bg-white rounded-ui max-w-3xl">',
      'return (\n  <div className="space-y-4">',
      'return <div className="flex justify-center py-10" />',
      'return (\n  <table className="table-fixed w-full">',
    ]) expect(fautesDe(c)).toEqual([])
  })
  it('le cadre garde la largeur commune', () => {
    expect(readFileSync('src/app/Layout.jsx', 'utf8')).toMatch(/<main className=\{`max-w-7xl mx-auto/)
  })
})
