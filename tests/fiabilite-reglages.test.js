// Lot fiabilité réglages (B124, 21/11) : les écritures des réglages passent par « enregistrer »,
// sauf les droits des personnes et des profils (dossier droits/ et fiche des comptes), reportés après l'audit (choix de H).
// Contrôle de source : une mise à jour ou une suppression écrite sans vérification du nombre de lignes
// ferait passer un refus de la règle d'accès pour un succès (société, établissements, facturation, modules...).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function fichiers(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) return nom === 'droits' ? [] : fichiers(chemin)
    return /\.(js|jsx)$/.test(nom) ? [chemin] : []
  })
}

const FICHIERS = fichiers('src/core/settings')

// Écritures volontairement hors « enregistrer », avec leur raison
const EXCEPTIONS = [
  // Ancienne adresse principale retirée avant de poser la nouvelle : 0 ligne est normal, l'erreur est vérifiée
  { fichier: 'Etablissements.jsx', motif: "from('company_establishments').update({ is_main_site: false })" },
  // Prix effacés : 0 ligne est normal (type sans prix enregistré), l'erreur est vérifiée
  { fichier: 'ReglagesContrats.jsx', motif: "from('itv_type_prices').delete()" },
  // Comptes (rôle, activation) : relève des droits, lot reporté après l'audit du 27/11
  { fichier: 'Settings.jsx', motif: "from('profiles').update(patch)" },
]

const plat = (chemin) => readFileSync(chemin, 'utf8').replace(/\)\s*\n\s*\./g, ').').replace(/supabase\s*\n\s*\.from/g, 'supabase.from')

describe('écritures des réglages', () => {
  it("aucune mise à jour, suppression ou upsert sans « enregistrer », hors exceptions listées", () => {
    const fautes = []
    for (const chemin of FICHIERS) {
      const t = plat(chemin)
      const re = /from\('(\w+)'\)\.(update|delete|upsert)\(/g
      let m
      while ((m = re.exec(t))) {
        const avant = t.slice(Math.max(0, m.index - 40), m.index)
        if (/enregistrer(OuLever)?\(/.test(avant)) continue
        if (EXCEPTIONS.find((e) => chemin.endsWith(e.fichier) && t.slice(m.index, m.index + 120).startsWith(e.motif))) continue
        fautes.push(`${chemin} : ${t.slice(m.index, m.index + 80)}`)
      }
    }
    expect(fautes).toEqual([])
  })

  it('chaque exception existe encore', () => {
    for (const e of EXCEPTIONS) {
      const chemin = FICHIERS.find((f) => f.endsWith('/' + e.fichier))
      expect(plat(chemin)).toContain(e.motif)
    }
  })

  it('les tables sans colonne id précisent la colonne relue', () => {
    for (const [fichier, table, colonne] of [
      ['facturation/MentionsFactures.jsx', 'billing_settings', 'company_id'],
      ['shared.jsx', 'org_modules', 'key'],
      ['Settings.jsx', 'quality_roles', 'code'],
      ['Settings.jsx', 'weekly_brief_recipients', 'profile_id'],
    ]) {
      const t = plat(`src/core/settings/${fichier}`)
      const i = t.indexOf(`enregistrer(supabase.from('${table}')`)
      expect(i).toBeGreaterThan(-1)
      expect(t.slice(i, i + 800)).toContain(`colonnes: '${colonne}'`)
    }
  })

  it('la société garde son message de refus', () => {
    const t = plat('src/core/settings/societes/Societes.jsx')
    expect(t.match(/\{ message: MESSAGE_REFUS \}/g)?.length).toBe(2)
  })
})
