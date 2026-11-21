// Lot fiabilité certification et social (B123, 21/11) : les écritures de ces deux modules passent par « enregistrer ».
// Contrôle de source : une mise à jour ou une suppression écrite sans vérification du nombre de lignes
// ferait passer un refus de la règle d'accès pour un succès (suivi de certification, preuves, publications...).
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

const FICHIERS = [...fichiers('src/modules/certification'), ...fichiers('src/modules/social')]

const plat = (chemin) => readFileSync(chemin, 'utf8').replace(/\)\s*\n\s*\./g, ').').replace(/supabase\s*\n\s*\.from/g, 'supabase.from')

describe('écritures des modules certification et social', () => {
  it("aucune mise à jour, suppression ou upsert sans « enregistrer »", () => {
    const fautes = []
    for (const chemin of FICHIERS) {
      const t = plat(chemin)
      const re = /from\('(\w+)'\)\.(update|delete|upsert)\(/g
      let m
      while ((m = re.exec(t))) {
        const avant = t.slice(Math.max(0, m.index - 40), m.index)
        if (/enregistrer(OuLever)?\(/.test(avant)) continue
        fautes.push(`${chemin} : ${t.slice(m.index, m.index + 80)}`)
      }
    }
    expect(fautes).toEqual([])
  })

  it("une pièce ou une preuve n'efface son fichier qu'après la suppression acceptée par la base", () => {
    const t = readFileSync('src/modules/certification/lib/certData.js', 'utf8')
    for (const [fonction, table] of [['removeDocument', 'cert_documents'], ['removeProof', 'cert_proofs']]) {
      const corps = t.slice(t.indexOf(`export async function ${fonction}`), t.indexOf('\n}\n', t.indexOf(`export async function ${fonction}`)))
      expect(corps.indexOf(`from('${table}').delete()`)).toBeGreaterThan(-1)
      expect(corps.indexOf(`from('${table}').delete()`)).toBeLessThan(corps.indexOf('storage.from(BUCKET).remove'))
    }
  })

  it("les actions de la page Réseaux sociaux signalent l'échec au lieu d'afficher un succès", () => {
    const t = plat('src/modules/social/pages/SocialMedia.jsx')
    for (const texte of ['Publication non annulée : ', 'Publication non supprimée : ', 'Image non supprimée : ', 'Brouillon non supprimé : ']) {
      expect(t).toContain(texte)
    }
  })
})
