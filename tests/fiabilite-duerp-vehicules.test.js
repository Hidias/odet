// Lot fiabilité DUERP et véhicules (B120, 21/11) : les écritures des modules DUERP et Véhicules passent par « enregistrer ».
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

const FICHIERS = [...fichiers('src/modules/duerp'), ...fichiers('src/modules/vehicules')]

// Écritures volontairement hors « enregistrer », avec leur raison
const EXCEPTIONS = [
  // Rattachement des risques : un risque ignoré sans action liée est un cas normal (0 ligne) ; l'erreur de la base est vérifiée
  { fichier: 'DuerpProjects.jsx', motif: "from('duerp_actions').delete().in('risk_id', toDelete)" },
]

const plat = (chemin) => readFileSync(chemin, 'utf8').replace(/\)\s*\n\s*\./g, ').').replace(/supabase\s*\n\s*\.from/g, 'supabase.from')

describe('écritures des modules DUERP et Véhicules', () => {
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

  it('chaque exception existe encore et son erreur est vérifiée', () => {
    for (const e of EXCEPTIONS) {
      const chemin = FICHIERS.find((f) => f.endsWith(e.fichier))
      expect(plat(chemin)).toContain(e.motif)
    }
    expect(plat('src/modules/duerp/pages/DuerpProjects.jsx')).toContain('if (erreurActions) throw erreurActions')
  })

  it("aucune écriture vérifiée n'est suivie de .single() (enregistrer attend une liste)", () => {
    for (const chemin of FICHIERS) {
      expect(plat(chemin)).not.toMatch(/enregistrer(OuLever)?\(supabase\.from\('\w+'\)\.(update|delete)\([^\n]*\.single\(\)/)
    }
  })

  it('les risques ignorés au rattachement sont tous supprimés, ou rien ne passe pour un succès', () => {
    expect(plat('src/modules/duerp/pages/DuerpProjects.jsx')).toContain("enregistrerOuLever(supabase.from('duerp_risks').delete().in('id', toDelete), { attendu: toDelete.length })")
  })

  it("le code NAF du client non mis à jour est signalé sans annuler la création du projet", () => {
    const t = plat('src/modules/duerp/pages/DuerpProjects.jsx')
    expect(t).toContain("enregistrer(supabase.from('clients').update(")
    expect(t).toContain('if (erreurClient) toast.error(')
  })

  it('un véhicule et un avis modifiés renvoient toujours une fiche (pas une liste)', () => {
    expect(plat('src/modules/vehicules/lib/vehiculesData.js')).toContain("(await enregistrerOuLever(supabase.from('vehicles').update(reste).eq('id', id)))[0]")
    expect(plat('src/modules/vehicules/lib/suiviVehicule.js')).toContain("(await enregistrerOuLever(supabase.from('vehicle_fines').update(ligne).eq('id', id).select('*')))[0]")
  })
})
