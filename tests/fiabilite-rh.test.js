// Lot fiabilité 5 (B116, 20/11) : RH « critique d'abord ». Fiche personnel, contrats, rémunération, avenants,
// modèles de contrat, DPAE, documents, habilitations (et titre édité), suivi de santé, consignes.
// Avant : ces écritures passaient par must(), qui contrôle l'erreur mais pas « 0 ligne » ; un refus de la règle
// d'accès passait pour un succès. Le titre d'habilitation édité n'était même pas contrôlé.
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

const TABLES = 'hr_people|hr_employments|hr_contract_models|hr_contract_amendments|hr_documents|hr_qualifications|hr_medical_followups|hr_work_restrictions'

// Lectures et écritures volontairement hors « enregistrer » : aucune à ce jour pour ces tables.
// hr_settings (réglages des contrats) passe par upsert : un refus y lève déjà une erreur de la base, pas « 0 ligne ».
const EXCEPTIONS = []

describe('écritures RH critiques (personnes, contrats, avenants, DPAE, documents, habilitations, santé, consignes)', () => {
  const sources = fichiers('src').map((chemin) => ({ chemin, texte: readFileSync(chemin, 'utf8') }))

  it('aucune mise à jour ni suppression sans « enregistrer », hors exceptions listées', () => {
    const fautes = []
    for (const { chemin, texte } of sources) {
      const plat = aplatir(texte)
      const re = new RegExp(`from\\('(${TABLES})'\\)\\.(update|delete)\\(`, 'g')
      let m
      while ((m = re.exec(plat))) {
        const avant = plat.slice(Math.max(0, m.index - 40), m.index)
        if (avant.includes('enregistrer(') || avant.includes('enregistrerOuLever(')) continue
        const exception = EXCEPTIONS.find((e) => chemin.endsWith(e.fichier) && plat.slice(m.index, m.index + 160).startsWith(e.motif))
        if (exception) continue
        fautes.push(`${chemin} : ${m[0]}`)
      }
    }
    expect(fautes).toEqual([])
  })

  it('les fiches renvoyées gardent leur forme (objet, pas tableau)', () => {
    const data = readFileSync('src/modules/rh/lib/rhData.js', 'utf8')
    expect(data).toContain(".update(reste).eq('id', id)))[0]")
    const contrats = readFileSync('src/modules/rh/lib/rhContrats.js', 'utf8')
    expect(contrats).toContain(".update(ligne).eq('id', a.id).select('*')))[0]")
  })

  it('le titre d\'habilitation édité contrôle la mise à jour de l\'habilitation', () => {
    const page = readFileSync('src/modules/rh/pages/DocumentsSante.jsx', 'utf8')
    expect(page).toContain("await enregistrerOuLever(supabase.from('hr_qualifications').update({ delivered_at")
  })

  it('la DPAE passe par la fonction commune, sans homonyme local', () => {
    const page = readFileSync('src/modules/rh/pages/Dpae.jsx', 'utf8')
    expect(page).toContain("import { enregistrer } from '../../../core/enregistrer'")
    expect(page).toContain('onSubmit={enregistrerDpae}')
    expect(page).not.toMatch(/const enregistrer\s*=/)
  })

  it('la suppression d\'un document signale une fiche restée en base après effacement du fichier', () => {
    const docs = readFileSync('src/modules/rh/lib/rhDocuments.js', 'utf8')
    expect(docs).toContain("Fichier effacé, mais la fiche du document n\\'a pas pu être supprimée")
  })
})
