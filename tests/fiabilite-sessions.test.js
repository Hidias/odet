// Lot fiabilité 3 (B114, 19/11) : les écritures sur les sessions, leurs inscrits et l'émargement passent par « enregistrer ».
// Contrôle de source : une mise à jour ou une suppression écrite sans vérification du nombre de lignes
// ferait passer un refus de la règle d'accès pour un succès (session « enregistrée », présence « notée »).
// Groupes, matériel, financements, checklist et créneaux : lot suivant (B115).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function fichiers(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom)
    return statSync(chemin).isDirectory() ? fichiers(chemin) : /\.(js|jsx)$/.test(nom) ? [chemin] : []
  })
}

// Écritures volontairement hors « enregistrer » : 0 ligne y est normal, l'erreur est contrôlée (ou la cascade fait le travail)
const EXCEPTIONS = [
  // Formateurs d'une session supprimée ou d'un formateur supprimé (cascade 0495) et retrait des formateurs non choisis
  { fichier: 'store.js', motif: "from('session_trainers').delete()" },
  // Retrait puis réinsertion des stagiaires d'une session (session sans stagiaire possible)
  { fichier: 'store.js', motif: "from('session_trainees').delete().eq('session_id', id)" },
  // Rattachement automatique à un groupe : déjà vérifié par .select('id') et maj.length
  { fichier: 'SessionDetail.jsx', motif: "from('session_trainees').update({ group_id: g.id })" },
  // Convocations notées remises seulement si elles ne l'étaient pas encore (.is('convocation_sent_at', null))
  { fichier: 'SessionDetail.jsx', motif: "from('session_trainees').update({ convocation_sent_at" },
  { fichier: 'SessionEmailModal.jsx', motif: "from('session_trainees').update({ convocation_sent_at" },
  // Détachement des stagiaires d'un groupe supprimé (groupe vide possible)
  { fichier: 'SessionGroupes.jsx', motif: "from('session_trainees').update({ group_id: null })" },
]

const TABLES = 'sessions|session_trainees|session_trainers|attendance_halfdays'

describe('écritures sur les sessions, les inscrits et l\'émargement', () => {
  const sources = fichiers('src').map((chemin) => ({ chemin, texte: readFileSync(chemin, 'utf8') }))

  it('aucune mise à jour ni suppression sans « enregistrer », hors exceptions listées', () => {
    const fautes = []
    for (const { chemin, texte } of sources) {
      const plat = texte.replace(/\)\s*\n\s*\./g, ').')
      const re = new RegExp(`from\\('(${TABLES})'\\)\\.(update|delete)\\(`, 'g')
      let m
      while ((m = re.exec(plat))) {
        const avant = plat.slice(Math.max(0, m.index - 40), m.index)
        if (avant.includes('enregistrer(')) continue
        const exception = EXCEPTIONS.find((e) => chemin.endsWith(e.fichier) && plat.slice(m.index, m.index + 120).startsWith(e.motif))
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
      expect(source.texte.replace(/\)\s*\n\s*\./g, ').'), `${e.fichier} : ${e.motif}`).toContain(e.motif)
    }
  })

  it('les exceptions contrôlent leur erreur', () => {
    const store = readFileSync('src/core/store.js', 'utf8')
    expect(store).toContain("if (errStagiaires) {")
    const groupes = readFileSync('src/modules/formation/components/SessionGroupes.jsx', 'utf8')
    expect(groupes).toContain('if (errDetache) return toast.error(')
    const fiche = readFileSync('src/modules/formation/pages/SessionDetail.jsx', 'utf8')
    expect(fiche.match(/if \(errRemise\) toast\.error\(/g)?.length).toBe(2)
  })

  it('une présence non enregistrée est signalée, pas affichée comme faite', () => {
    const fiche = readFileSync('src/modules/formation/pages/SessionDetail.jsx', 'utf8')
    expect(fiche).toContain("toast.error(estAucuneLigne(error) ? error.message : 'Présence non enregistrée')")
    expect(fiche).toContain('if (echecs) toast.error(')
  })

  it('la suppression d\'une session vérifie qu\'une ligne a bien été supprimée', () => {
    const store = readFileSync('src/core/store.js', 'utf8')
    expect(store).toContain("const { error } = await enregistrer(supabase.from('sessions').delete().eq('id', id), {")
  })
})
