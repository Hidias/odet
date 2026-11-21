// Lot fiabilité 6 (B117, 21/11) : reste RH. Équipes, horaires, jours fériés, types d'absence, heures, postes et
// exigences, travail isolé, accueil sécurité, affichages, EPI, entretiens, listes d'arrivée et de départ.
// Même contrôle de source que B116 : une mise à jour ou une suppression sans vérification du nombre de lignes
// ferait passer un refus de la règle d'accès pour un succès.
// Hors contrôle : les upsert (réglages RH, affichages, lieu du panneau, responsable des titres) : un refus y lève
// déjà une erreur de la base.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function fichiers(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom)
    return statSync(chemin).isDirectory() ? fichiers(chemin) : /\.(js|jsx)$/.test(nom) ? [chemin] : []
  })
}

const aplatir = (texte) => texte.replace(/\)\s*\n\s*\./g, ').')

describe('écritures RH (toutes les tables hr_*)', () => {
  const sources = fichiers('src').map((chemin) => ({ chemin, texte: readFileSync(chemin, 'utf8') }))

  it('aucune mise à jour ni suppression d\'une table hr_* sans « enregistrer »', () => {
    const fautes = []
    for (const { chemin, texte } of sources) {
      const plat = aplatir(texte)
      const re = /from\('(hr_[a-z_]+)'\)\.(update|delete)\(/g
      let m
      while ((m = re.exec(plat))) {
        const avant = plat.slice(Math.max(0, m.index - 40), m.index)
        if (avant.includes('enregistrer(') || avant.includes('enregistrerOuLever(')) continue
        fautes.push(`${chemin} : ${m[0]}`)
      }
    }
    expect(fautes).toEqual([])
  })

  it('le poste renvoyé garde sa forme (objet, pas tableau)', () => {
    const postes = readFileSync('src/modules/rh/lib/rhPostes.js', 'utf8')
    expect(postes).toContain(".update(ligne).eq('id', id)))[0]")
  })

  it('les entretiens passent par la fonction commune, sans homonyme local', () => {
    const page = readFileSync('src/modules/rh/pages/EntretiensListes.jsx', 'utf8')
    expect(page).toContain("import { enregistrerOuLever } from '../../../core/enregistrer'")
    expect(page).toContain('onSubmit={enregistrerEntretien}')
    expect(page).not.toMatch(/const enregistrer\s*=/)
  })
})
