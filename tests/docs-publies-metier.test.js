// Documents joints aux devis par métier (DOCS_PAR_METIER) : chacun doit être lisible dans sa version validée par
// published_quality_doc (liste fermée en base, 0036 puis 0499). Un document ajouté d'un côté sans l'autre serait
// joint « non validé » même validé (constat du 07/11).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { DOCS_PAR_METIER } from '../src/modules/commercial/lib/metierDevis.js'

const DOSSIER = 'supabase/migrations'

/** Liste de documents de la dernière migration qui définit published_quality_doc */
function listeEnBase() {
  const fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith('.sql')).sort()
  let liste = null
  for (const f of fichiers) {
    const sql = readFileSync(`${DOSSIER}/${f}`, 'utf8')
    const m = sql.match(/function public\.published_quality_doc\(p_doc_id text\)[\s\S]*?p_doc_id in \(([^)]*)\)/)
    if (m) liste = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  }
  return liste
}

describe('documents qualité publiés et devis par métier', () => {
  it('chaque document joint à un devis est dans la liste publiée en base', () => {
    const enBase = listeEnBase()
    expect(enBase).not.toBeNull()
    const joints = [...new Set(Object.values(DOCS_PAR_METIER).flat().map((d) => d.doc))]
    expect(joints.length).toBeGreaterThan(0)
    expect(joints.filter((d) => !enBase.includes(d))).toEqual([])
  })
})
