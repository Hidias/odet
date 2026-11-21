// Lot fiabilité interventions et stock (B119, 21/11) : les écritures des modules Interventions et Stock passent par « enregistrer ».
// Contrôle de source : une mise à jour ou une suppression écrite sans vérification du nombre de lignes
// ferait passer un refus de la règle d'accès pour un succès.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function fichiers(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) return fichiers(chemin)
    return /\.(js|jsx)$/.test(nom) ? [chemin] : []
  })
}

const FICHIERS = [...fichiers('src/modules/interventions'), ...fichiers('src/modules/stock')]

// Écritures volontairement hors « enregistrer », avec leur raison
const EXCEPTIONS = [
  // Retour « à planifier » seulement si la visite l'est encore : 0 ligne est un cas normal, compté et affiché par le Kanban
  { fichier: 'itvData.js', motif: "from('itv_visits').update(retour).eq('id', id).eq('status', 'planifiee').select('id')" },
]

const plat = (chemin) => readFileSync(chemin, 'utf8').replace(/\)\s*\n\s*\./g, ').').replace(/supabase\s*\n\s*\.from/g, 'supabase.from')

describe('écritures des modules Interventions et Stock', () => {
  it("aucune mise à jour ni suppression sans « enregistrer », hors exceptions listées", () => {
    const fautes = []
    for (const chemin of FICHIERS) {
      const t = plat(chemin)
      const re = /from\('(\w+)'\)\.(update|delete)\(/g
      let m
      while ((m = re.exec(t))) {
        const avant = t.slice(Math.max(0, m.index - 40), m.index)
        if (/enregistrer(OuLever)?\(/.test(avant)) continue
        const exception = EXCEPTIONS.find((e) => chemin.endsWith(e.fichier) && t.slice(m.index, m.index + 120).startsWith(e.motif))
        if (exception) continue
        fautes.push(`${chemin} : ${t.slice(m.index, m.index + 80)}`)
      }
    }
    expect(fautes).toEqual([])
  })

  it('chaque exception existe encore (sinon la retirer de la liste)', () => {
    for (const e of EXCEPTIONS) {
      const chemin = FICHIERS.find((f) => f.endsWith(e.fichier))
      expect(plat(chemin)).toContain(e.motif)
    }
  })

  it("aucune écriture vérifiée n'est suivie de .single() (enregistrer attend une liste)", () => {
    for (const chemin of FICHIERS) {
      const t = plat(chemin)
      expect(t).not.toMatch(/enregistrer(OuLever)?\(supabase\.from\('\w+'\)\.(update|delete)\([^\n]*\.single\(\)/)
    }
  })

  it('les techniciens sont reconnus par leur profil (table sans colonne id)', () => {
    const t = plat('src/modules/interventions/lib/itvData.js')
    expect(t.match(/from\('itv_technicians'\)\.update\([^\n]*\{ colonnes: 'profile_id' \}\)/g)?.length).toBe(2)
  })

  it("« Tout conforme » refuse un enregistrement partiel", () => {
    const t = plat('src/modules/interventions/pages/Visite.jsx')
    expect(t).toContain('{ attendu: rest.length }')
  })

  it("l'ordre de passage vérifie chaque visite", () => {
    const t = plat('src/modules/interventions/lib/itvData.js')
    expect(t).toContain("enregistrerOuLever(supabase.from('itv_visits').update({ route_order: i + 1 }).eq('id', id))")
  })

  it('le prix des pièces reste masqué au technicien (fonctions de la base, pas de relecture de la table)', () => {
    const t = plat('src/modules/interventions/lib/itvData.js')
    expect(t).toContain("supabase.rpc('itv_visit_part_set_quantity'")
    expect(t).toContain("supabase.rpc('itv_visit_part_remove'")
  })
})
