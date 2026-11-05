// Contrôle des colonnes demandées au client Supabase.
// Lit chaque appel .from('table') suivi de .select('...') (texte fixe, sans ${}) et des filtres simples
// (.eq, .neq, .in, .is, .gt, .gte, .lt, .lte, .order, .ilike, .like, .not), puis vérifie que chaque colonne
// existe dans la base locale construite par scripts/securite/base_locale.py.
// Usage : node scripts/qualite/colonnes.mjs <schema.json> [dossiers...]
// schema.json : sortie de scripts/qualite/schema.sql sur la base locale (psql -XAt -f scripts/qualite/schema.sql)
// Sortie : une ligne par colonne inconnue ; code de sortie 1 s'il y en a.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const [schemaFichier, ...dossiers] = process.argv.slice(2)
if (!schemaFichier) { console.error('Usage : node scripts/qualite/colonnes.mjs <schema.json> [dossiers...]'); process.exit(2) }
const schema = JSON.parse(readFileSync(schemaFichier, 'utf8'))
const colonnes = new Map(Object.entries(schema.cols || {}).map(([t, c]) => [t, new Set(c)]))
const fks = schema.fks || []

function fichiers(dossier) {
  const out = []
  for (const n of readdirSync(dossier)) {
    const p = join(dossier, n)
    if (n === 'node_modules' || n.startsWith('.')) continue
    if (statSync(p).isDirectory()) out.push(...fichiers(p))
    else if (/\.(js|jsx|mjs)$/.test(n) && !/\.test\.(js|jsx|mjs)$/.test(n)) out.push(p)
  }
  return out
}

/** Découpe une liste au premier niveau de parenthèses */
function decouper(s) {
  const parts = []
  let prof = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') prof++
    if (ch === ')') prof--
    if (ch === ',' && prof === 0) { parts.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts.map((p) => p.trim()).filter(Boolean)
}

/** Table visée par une sous-sélection « nom!indice(...) » depuis la table parente */
function tableLiee(parent, nom, indice) {
  if (indice) {
    const parNom = fks.find((f) => f.name === indice)
    if (parNom) return parNom.t === parent ? parNom.ref : parNom.t
    const parCol = fks.find((f) => f.t === parent && f.col === indice)
    if (parCol) return parCol.ref
    if (colonnes.has(indice)) return indice
  }
  if (colonnes.has(nom)) return nom
  const parCol = fks.find((f) => f.t === parent && f.col === nom)
  if (parCol) return parCol.ref
  return null
}

/** Colonnes inconnues d'une sélection, relativement à une table */
function verifierSelect(table, texte, chemin = table) {
  const erreurs = []
  if (!colonnes.has(table)) return erreurs
  for (const brut of decouper(texte.replace(/\s+/g, ' '))) {
    let item = brut.replace(/^\.\.\./, '').trim()
    if (item === '*' || item === 'count' || /^count\(/.test(item)) continue
    const sous = item.match(/^(?:[\w]+:)?([\w]+)(?:!([\w]+))?(?:!inner|!left)?\s*\(([\s\S]*)\)$/)
    if (sous) {
      const [, nom, indice, interieur] = sous
      const cible = tableLiee(table, nom, indice)
      if (!cible) { erreurs.push(`${chemin} : relation inconnue « ${nom}${indice ? '!' + indice : ''} »`); continue }
      erreurs.push(...verifierSelect(cible, interieur, `${chemin} > ${cible}`))
      continue
    }
    const col = item.replace(/^[\w]+:/, '').replace(/::\w+$/, '').replace(/->>?.*$/, '').trim()
    if (!/^\w+$/.test(col)) continue
    if (!colonnes.get(table).has(col)) erreurs.push(`${chemin} : colonne inconnue « ${col} »`)
  }
  return erreurs
}

const FILTRES = 'eq|neq|in|is|gt|gte|lt|lte|order|ilike|like|contains|not'
const constats = []
for (const dossier of dossiers.length ? dossiers : ['src', 'api']) {
  for (const f of fichiers(dossier)) {
    const code = readFileSync(f, 'utf8')
    const re = /\.from\(\s*['"`](\w+)['"`]\s*\)/g
    let m
    while ((m = re.exec(code))) {
      const table = m[1]
      if (!colonnes.has(table)) continue
      // Chaîne d'appels qui suit, jusqu'à la requête suivante, une ligne vide, un « ; » en fin de ligne ou 1 500 caractères
      const suite = code.slice(re.lastIndex, re.lastIndex + 1500)
      const fin = suite.search(/\.from\(|supabase\.|\bcount\(|\bfetchAll\(|\n\s*\n|;\s*\n/)
      const chaine = fin >= 0 ? suite.slice(0, fin) : suite
      const ligne = code.slice(0, m.index).split('\n').length
      const sel = chaine.match(/^\s*\.select\(\s*(['"`])((?:(?!\1)[\s\S])*)\1/)
      if (sel && !sel[2].includes('${')) {
        for (const e of verifierSelect(table, sel[2])) constats.push(`${f}:${ligne} ${e}`)
      }
      const fre = new RegExp(`\\.(?:${FILTRES})\\(\\s*['"](\\w+)['"]`, 'g')
      let g
      while ((g = fre.exec(chaine))) {
        if (!colonnes.get(table).has(g[1])) constats.push(`${f}:${ligne} ${table} : filtre sur une colonne inconnue « ${g[1]} »`)
      }
    }
  }
}
for (const c of constats) console.log(c)
console.error(`${constats.length} colonne(s) inconnue(s)`)
process.exit(constats.length ? 1 : 0)
