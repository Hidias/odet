// Lot fiabilité prospection et mailing (B122, 21/11) : les écritures de ces deux modules passent par « enregistrer ».
// Contrôle de source : une mise à jour ou une suppression écrite sans vérification du nombre de lignes
// ferait passer un refus de la règle d'accès pour un succès (rendez-vous, rappels, campagnes, modèles...).
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

const FICHIERS = [...fichiers('src/modules/prospection'), ...fichiers('src/modules/mailing')]

// Écritures volontairement hors « enregistrer », avec leur raison
const EXCEPTIONS = [
  // Répertoire de prospection : 0 ligne est normal (SIREN absent), l'erreur de la base est vérifiée
  { fichier: 'ProspectRDVDetail.jsx', motif: "from('prospection_massive').update(" },
  // Nettoyage d'une campagne incomplète : 0 envoi est normal (échec avant l'ajout des destinataires)
  { fichier: 'MailingComposer.jsx', motif: "from('mailing_sends').delete().eq('campaign_id', campaign.id)" },
  // Remise en attente des envois en erreur : 0 ligne est normal (aucune erreur restante), l'erreur de la base est vérifiée
  { fichier: 'Mailing.jsx', motif: "from('mailing_sends').update({ status: 'pending', error_message: null }).eq('campaign_id', campaign.id)" },
  { fichier: 'Mailing.jsx', motif: "from('mailing_sends').update({ status: 'pending', error_message: null }).eq('campaign_id', c.id)" },
]

const plat = (chemin) => readFileSync(chemin, 'utf8').replace(/\)\s*\n\s*\./g, ').').replace(/supabase\s*\n\s*\.from/g, 'supabase.from')

describe('écritures des modules prospection et mailing', () => {
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

  it('chaque exception existe encore', () => {
    for (const e of EXCEPTIONS) {
      const chemin = FICHIERS.find((f) => f.endsWith('/' + e.fichier))
      expect(plat(chemin)).toContain(e.motif)
    }
  })

  it("les écritures sans retour vérifié signalent l'échec à l'écran", () => {
    const t = plat('src/modules/prospection/pages/EnrichissementRapide.jsx')
    expect(t).toContain("toast.error('Fiche non enregistrée : ' + error.message)")
    expect(t).toContain("toast.error('Fiche non exclue : ' + error.message); return")
    expect(t).toContain("import toast from 'react-hot-toast'")
    const c = plat('src/modules/mailing/components/MailingComposer.jsx')
    expect(c).toContain("n'a pas pu être retirée")
  })
})
