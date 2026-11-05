// Contrôle des colonnes demandées au client Supabase.
// Lit chaque appel .from('table') et la chaîne d'appels qui lui est collée : .select('...') (texte fixe, sans ${},
// y compris après .insert/.update/.upsert) et filtres simples (.eq, .neq, .in, .is, .gt, .gte, .lt, .lte, .order,
// .ilike, .like, .contains, .not), puis vérifie que chaque colonne
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

const FILTRES = new Set(['eq', 'neq', 'in', 'is', 'gt', 'gte', 'lt', 'lte', 'order', 'ilike', 'like', 'contains', 'not'])

/** Appels enchaînés à partir de la position i : [{ nom, args }] tant que le code continue par « .nom(...) » */
function chaineAppels(code, i) {
  const appels = []
  for (;;) {
    const m = /^\s*\.\s*(\w+)\s*\(/.exec(code.slice(i, i + 200))
    if (!m) return appels
    let j = i + m[0].length
    let prof = 1
    let quote = null
    const debut = j
    while (j < code.length && prof > 0) {
      const ch = code[j]
      if (quote) {
        if (ch === '\\') j++
        else if (ch === quote) quote = null
      } else if (ch === "'" || ch === '"' || ch === '`') quote = ch
      else if (ch === '(') prof++
      else if (ch === ')') prof--
      j++
    }
    appels.push({ nom: m[1], args: code.slice(debut, j - 1) })
    i = j
  }
}
const constats = []
for (const dossier of dossiers.length ? dossiers : ['src', 'api']) {
  for (const f of fichiers(dossier)) {
    const code = readFileSync(f, 'utf8')
    const re = /\.from\(\s*['"`](\w+)['"`]\s*\)/g
    let m
    while ((m = re.exec(code))) {
      const table = m[1]
      if (!colonnes.has(table)) continue
      // Chaîne d'appels collée à .from(...) : .select(...).eq(...).order(...)... ; tout le reste est ignoré
      const ligne = code.slice(0, m.index).split('\n').length
      for (const appel of chaineAppels(code, re.lastIndex)) {
        const lit = appel.args.match(/^\s*(['"`])((?:(?!\1)[\s\S])*)\1\s*(,|$)/)
        if (!lit || lit[2].includes('${')) continue
        if (appel.nom === 'select') {
          for (const e of verifierSelect(table, lit[2])) constats.push(`${f}:${ligne} ${e}`)
        } else if (FILTRES.has(appel.nom) && /^\w+$/.test(lit[2]) && !/referencedTable|foreignTable/.test(appel.args)) {
          if (!colonnes.get(table).has(lit[2])) constats.push(`${f}:${ligne} ${table} : filtre sur une colonne inconnue « ${lit[2]} »`)
        }
      }
    }
  }
}
for (const c of constats) console.log(c)
console.error(`${constats.length} colonne(s) inconnue(s)`)
process.exit(constats.length ? 1 : 0)
