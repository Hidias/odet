// Lot fiabilité 4 (B115, 19/11) : reste du lot sessions. Groupes, matériel, coûts, financements, checklist,
// créneaux récurrents, accès aux documents et analyse du besoin passent par « enregistrer ».
// Même contrôle de source que B114 : une mise à jour ou une suppression sans vérification du nombre de lignes
// ferait passer un refus de la règle d'accès pour un succès.
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

// Écritures volontairement hors « enregistrer » : le nombre de lignes est déjà contrôlé, ou 0 ligne y est normal
const EXCEPTIONS = [
  // Recalcul du matériel : vidage préalable, session sans matériel possible ; l'erreur est contrôlée
  { fichier: 'SessionDetail.jsx', motif: "from('session_equipment').delete().eq('session_id', session.id)" },
  // Groupe noté « envoyé » seulement s'il était « à envoyer » : déjà vérifié par .select('id') et maj.length
  { fichier: 'SessionEmailModal.jsx', motif: "from('session_groups').update({ doc_status: 'envoye' }).eq('id', groupe.id).eq('doc_status', 'a_envoyer').select('id')" },
  // Relecture de l'analyse du besoin : déjà vérifiée par .select('id') et data.length
  { fichier: 'BesoinClientRelecture.jsx', motif: "from('session_needs_analysis').update(champs).eq('id', a.id).select('id')" },
]

const TABLES = 'session_groups|session_equipment|session_costs|session_fundings|session_checklists|session_recurrences|session_document_access|session_needs_analysis'

describe('écritures sur le reste des sessions (groupes, matériel, coûts, financements, checklist, créneaux, documents, besoin)', () => {
  const sources = fichiers('src').map((chemin) => ({ chemin, texte: readFileSync(chemin, 'utf8') }))

  it('aucune mise à jour ni suppression sans « enregistrer », hors exceptions listées', () => {
    const fautes = []
    for (const { chemin, texte } of sources) {
      const plat = aplatir(texte)
      const re = new RegExp(`from\\('(${TABLES})'\\)\\.(update|delete)\\(`, 'g')
      let m
      while ((m = re.exec(plat))) {
        const avant = plat.slice(Math.max(0, m.index - 40), m.index)
        if (avant.includes('enregistrer(')) continue
        const exception = EXCEPTIONS.find((e) => chemin.endsWith(e.fichier) && plat.slice(m.index, m.index + 160).startsWith(e.motif))
        if (exception) continue
        fautes.push(`${chemin} : ${m[0]}`)
      }
    }
    expect(fautes).toEqual([])
  })

  it('chaque exception existe encore (sinon la retirer de la liste)', () => {
    for (const e of EXCEPTIONS) {
      const source = sources.find((s) => s.chemin.endsWith(e.fichier))
      expect(source, e.fichier).toBeTruthy()
      expect(aplatir(source.texte), `${e.fichier} : ${e.motif}`).toContain(e.motif)
    }
  })

  it('les exceptions contrôlent leur résultat', () => {
    const fiche = readFileSync('src/modules/formation/pages/SessionDetail.jsx', 'utf8')
    expect(fiche).toContain('if (errVidage) return toast.error(')
    const modal = readFileSync('src/modules/formation/components/SessionEmailModal.jsx', 'utf8')
    expect(modal).toContain('if (eMaj || !maj?.length)')
    const relecture = readFileSync('src/modules/formation/components/BesoinClientRelecture.jsx', 'utf8')
    expect(relecture).toContain('if (!data?.length)')
  })

  it('un échec est montré avec le message d\'« enregistrer », pas un message générique', () => {
    for (const fichier of [
      'src/modules/formation/components/SessionNeedsAnalysis.jsx',
      'src/modules/formation/components/SessionChecklist.jsx',
      'src/modules/formation/components/SessionDocumentAccess.jsx',
    ]) {
      expect(readFileSync(fichier, 'utf8'), fichier).toContain('estAucuneLigne(error) ? error.message')
    }
  })

  it('après un envoi, les cases de checklist non cochées sont signalées', () => {
    const modal = readFileSync('src/modules/formation/components/SessionEmailModal.jsx', 'utf8')
    expect(modal).toContain(".select('id, is_checked')")
    expect(modal).toContain('if (nonCochees.length) toast.error(')
  })

  it('« Tout marquer comme préparé » refuse un enregistrement partiel', () => {
    const fiche = readFileSync('src/modules/formation/pages/SessionDetail.jsx', 'utf8')
    expect(fiche).toContain("{ attendu: aPreparer.length })")
  })
})
